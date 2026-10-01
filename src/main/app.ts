import type { StartupStatus } from "../shared/contracts";
import { app, BrowserWindow, protocol, dialog, ipcMain } from "electron";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { registerIpc } from "./ipc";
import { LibraryRepository } from "./library/repository";
import { CaptureQueue } from "./capture/queue";
import { loadPage, fetchAsset } from "./capture/browser";

if (process.env.LIBRARY_DATA_DIR)
  app.setPath("userData", process.env.LIBRARY_DATA_DIR);
protocol.registerSchemesAsPrivileged([
  {
    scheme: "library",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app.whenReady().then(async () => {
  let repo: LibraryRepository | undefined;
  let queue: CaptureQueue | undefined;
  let closeServices: (() => void) | undefined;
  let closing = false;
  let status: StartupStatus = { message: "正在打开本地资料库…" };
  let complete!: (result: { error?: string }) => void;
  const ready = new Promise<{ error?: string }>((resolve) => {
    complete = resolve;
  });
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 950,
    minHeight: 650,
    show: false,
    title: "拾知",
    backgroundColor: "#f6f7fb",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  for (const [name, result] of [
    ["startupReady", () => ready],
    ["startupStatus", () => status],
  ] as const)
    ipcMain.handle(`library:${name}`, (event) => {
      if (
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame
      )
        throw Error("Forbidden");
      return result();
    });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  app.on("before-quit", (event) => {
    try {
      closeServices?.();
      queue?.stop();
      closing = true;
    } catch {
      event.preventDefault();
      dialog.showErrorBox(
        "草稿尚未保存",
        "无法写入资料库，请检查磁盘后再退出。",
      );
    }
  });
  protocol.handle("library", (request) => {
    try {
      const url = new URL(request.url),
        path = decodeURIComponent(url.pathname).replace(/^\//, "");
      if (
        url.hostname !== "assets" ||
        !/^assets\/[a-f0-9]{64}\.(png|jpg|webp|gif|avif|svg)$/.test(path)
      )
        return new Response("Forbidden", { status: 403 });
      const mime: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        webp: "image/webp",
        gif: "image/gif",
        avif: "image/avif",
        svg: "image/svg+xml",
      };
      return new Response(readFileSync(repo!.resolvePath(path)), {
        headers: {
          "Content-Type": mime[path.split(".").at(-1)!],
          "Content-Security-Policy": "default-src 'none'",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  try {
    const painted = new Promise<void>((resolve) =>
      win.once("ready-to-show", () => {
        win.show();
        resolve();
      }),
    );
    await win.loadFile(join(__dirname, "../renderer/index.html"));
    await painted;
    if (closing || win.isDestroyed()) return;
    // Yield after the first paint, then repair in bounded batches so progress/close events remain responsive.
    await new Promise<void>((resolve) => setImmediate(resolve));
    repo = new LibraryRepository(join(app.getPath("userData"), "library"), {
      deferMaintenance: true,
    });
    await repo.prepare((completed, total) => {
      if (closing || win.isDestroyed()) throw Error("closed");
      status = {
        message: "正在检查本地资料，仅恢复需要更新的内容…",
        completed,
        total,
      };
    });
    if (closing || win.isDestroyed()) return;
    status = { message: "正在恢复任务状态…" };
    queue = new CaptureQueue(repo, { load: loadPage, asset: fetchAsset });
    closeServices = registerIpc(win, repo, queue);
    status = { message: "资料库已就绪" };
    complete({});
  } catch (error) {
    if (closing || win.isDestroyed()) return;
    const message = error instanceof Error ? error.message : "";
    const safe = /^(资料库来自|文章版本缺失)/.test(message)
      ? message
      : "资料库初始化失败，请检查资料目录是否可用、磁盘空间和文件权限。";
    status = { message: "启动未完成", error: safe };
    complete({ error: safe });
    repo?.close();
  }
});
app.on("window-all-closed", () => app.quit());
