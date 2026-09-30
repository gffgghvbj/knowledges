import { app, BrowserWindow, protocol } from "electron";
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
app.whenReady().then(() => {
  const repo = new LibraryRepository(join(app.getPath("userData"), "library"));
  const queue = new CaptureQueue(repo, { load: loadPage, asset: fetchAsset });
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
      return new Response(readFileSync(repo.resolvePath(path)), {
        headers: {
          "Content-Type": mime[path.split(".").at(-1)!],
          "Content-Security-Policy": "default-src 'none'",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 950,
    minHeight: 650,
    title: "拾知",
    backgroundColor: "#f6f7fb",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const closeServices = registerIpc(win, repo, queue);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  void win.loadFile(join(__dirname, "../renderer/index.html"));
  app.on("before-quit", () => {
    queue.stop();
    closeServices();
  });
});
app.on("window-all-closed", () => app.quit());
