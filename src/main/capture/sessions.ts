import { session, BrowserWindow } from "electron";
import type { Source } from "../../shared/contracts";
const configured = new Set<string>();
export function sourceSession(source: Source) {
  const ses = session.fromPartition(`persist:source-${source.id}`);
  if (!configured.has(source.id)) {
    ses.setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false),
    );
    ses.setPermissionCheckHandler(() => false);
    ses.on("will-download", (event) => event.preventDefault());
    configured.add(source.id);
  }
  return ses;
}
export function openLogin(source: Source): void {
  const window = new BrowserWindow({
    width: 1050,
    height: 760,
    title: `登录 · ${source.label}`,
    webPreferences: {
      session: sourceSession(source),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void window.loadURL(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!/^https?:\/\//.test(url)) event.preventDefault();
  });
  void window.loadURL(source.entryUrl).catch(() => {});
}
