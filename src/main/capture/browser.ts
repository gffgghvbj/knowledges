import { BrowserWindow } from "electron";
import type { Source, PageResult, PageSnapshot } from "../../shared/contracts";
import { getAdapter } from "./adapters/types";
import { sourceSession } from "./sessions";

export async function readLimited(
  response: Response,
  limit: number,
): Promise<Buffer> {
  if (Number(response.headers.get("content-length") ?? 0) > limit)
    throw new Error("资源超过大小限制");
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("资源超过大小限制");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}
export async function loadPage(
  source: Source,
  url: string,
): Promise<PageResult> {
  if (!source.allowedOrigins.includes(new URL(url).origin))
    return { kind: "failed", reason: "地址不在所选网站范围内" };
  const adapter = getAdapter(source);
  try {
    let finalUrl = url;
    let response: Response | undefined;
    for (let redirects = 0; redirects <= 10; redirects++) {
      response = await sourceSession(source).fetch(finalUrl, {
        signal: AbortSignal.timeout(25000),
        redirect: "manual",
      });
      const location = response.headers.get("location");
      if (![301, 302, 303, 307, 308].includes(response.status) || !location)
        break;
      await response.body?.cancel();
      if (redirects === 10) throw Error("网站重定向过多");
      finalUrl = new URL(location, finalUrl).href;
      if (!source.allowedOrigins.includes(new URL(finalUrl).origin))
        return { kind: "login-required" };
    }
    if (!response) throw Error("未收到网页响应");
    const snapshot: PageSnapshot = {
      html: (await readLimited(response, 20 * 1024 * 1024)).toString("utf8"),
      finalUrl,
      fetchedAt: new Date().toISOString(),
      statusCode: response.status,
    };
    const result = adapter.classify(snapshot);
    if (result.kind === "article" || result.kind === "login-required")
      return result;
    if (response.status >= 400)
      return {
        ...result,
        retryAfterMs: Math.max(
          0,
          Number(response.headers.get("retry-after") || 0) * 1000,
        ),
      };
    // Landing pages still carry useful discovery links even without article content.
    if (adapter.discover(snapshot).length > 0)
      return { kind: "article", snapshot };
    return await renderPage(source, url);
  } catch (error) {
    return {
      kind: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
async function renderPage(source: Source, url: string): Promise<PageResult> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      session: sourceSession(source),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const timer = setTimeout(() => win.destroy(), 25000);
  try {
    await win.loadURL(url);
    const html = await win.webContents.executeJavaScript(
      "document.documentElement.outerHTML",
      false,
    );
    return getAdapter(source).classify({
      html,
      finalUrl: win.webContents.getURL(),
      fetchedAt: new Date().toISOString(),
      statusCode: 200,
    });
  } finally {
    clearTimeout(timer);
    if (!win.isDestroyed()) win.destroy();
  }
}
export async function fetchAsset(
  source: Source,
  url: string,
): Promise<{ bytes: Buffer; mimeType: string }> {
  const response = await sourceSession(source).fetch(url, {
    signal: AbortSignal.timeout(25000),
    headers: { Referer: source.entryUrl },
  });
  if (!response.ok) throw new Error(`图片 HTTP ${response.status}`);
  return {
    bytes: await readLimited(response, 32 * 1024 * 1024),
    mimeType: response.headers.get("content-type")?.split(";")[0] || "",
  };
}
