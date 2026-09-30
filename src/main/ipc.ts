import { ipcMain, dialog, shell, type BrowserWindow } from "electron";
import { z } from "zod";
import { LibraryRepository } from "./library/repository";
import { CaptureQueue } from "./capture/queue";
import { openLogin } from "./capture/sessions";
import { normalizeUrl } from "./library/files";
import { searchArticles } from "./library/search";
import { exportLibrary } from "./backup/export";
import { inspectBackup, importBackup } from "./backup/merge";
export function registerIpc(
  win: BrowserWindow,
  repo: LibraryRepository,
  queue: CaptureQueue,
) {
  const id = z.string().min(1).max(128),
    text = z.string().max(4000);
  const approvedImports = new Set<string>();
  const handle = (
    name: string,
    schema: z.ZodType,
    fn: (...args: any[]) => unknown,
  ) =>
    ipcMain.handle(`library:${name}`, (event, ...args) => {
      if (
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame
      )
        throw new Error("Forbidden");
      const values = schema.parse(args) as any[];
      return fn(...values);
    });
  handle("getStatus", z.tuple([]), () => ({ ready: true }));
  handle("state", z.tuple([]), () => ({
    sources: repo.listSources(),
    articles: repo.listArticles(),
    tasks: repo.listTasks(),
    root: repo.root,
  }));
  handle("addSource", z.tuple([text]), (url) => repo.addSource(url));
  handle("login", z.tuple([id]), (sourceId) => {
    const source = repo.getSource(sourceId);
    if (!source) throw Error("网站不存在");
    openLogin(source);
  });
  handle("scan", z.tuple([id]), (sourceId) => queue.scan(sourceId));
  handle(
    "capture",
    z.tuple([id, z.array(text).max(10000)]),
    (taskId, sections) => queue.captureSelection(taskId, sections),
  );
  handle("update", z.tuple([id]), (sourceId) => queue.scan(sourceId, "update"));
  handle(
    "control",
    z.tuple([id, z.enum(["pause", "resume", "retry"])]),
    (taskId, action) => {
      if (action === "pause") queue.pauseTask(taskId);
      else if (action === "resume") queue.resumeTask(taskId);
      else queue.retryFailed(taskId);
    },
  );
  handle("read", z.tuple([id, id.optional()]), (articleId, versionId) =>
    repo.readArticle(articleId, versionId),
  );
  handle("versions", z.tuple([id]), (articleId) =>
    repo.listVersions(articleId),
  );
  handle("restore", z.tuple([id, id]), (articleId, versionId) =>
    repo.restoreVersion(articleId, versionId),
  );
  handle(
    "search",
    z.tuple([
      text,
      id.optional(),
      text.optional(),
      z.number().int().min(0).optional(),
    ]),
    (q, sourceId, section, page) =>
      searchArticles(
        repo,
        q,
        { sourceId, sectionPath: section ? [section] : undefined },
        page,
      ),
  );
  handle("openArticle", z.tuple([id]), async (articleId) => {
    if (!repo.getArticle(articleId)) throw Error("文章不存在");
    const error = await shell.openPath(
      repo.resolvePath(`articles/${articleId}/current.md`),
    );
    if (error) throw Error(error);
  });
  handle("openUrl", z.tuple([text]), (url) =>
    shell.openExternal(normalizeUrl(url)),
  );
  handle("exportBackup", z.tuple([]), async () => {
    const result = await dialog.showSaveDialog(win, {
      title: "导出资料库",
      defaultPath: `拾知备份-${new Date().toISOString().slice(0, 10)}.ikb`,
      filters: [{ name: "拾知备份", extensions: ["ikb"] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    await exportLibrary(repo, result.filePath);
    return { cancelled: false, path: result.filePath };
  });
  handle("inspectBackup", z.tuple([]), async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "选择备份包",
      properties: ["openFile"],
      filters: [{ name: "拾知备份", extensions: ["ikb"] }],
    });
    if (result.canceled) return null;
    const path = result.filePaths[0],
      preview = await inspectBackup(path);
    approvedImports.add(path);
    return { path, preview };
  });
  handle("importBackup", z.tuple([text]), (path) => {
    if (!approvedImports.has(path)) throw Error("请先选择并检查备份文件");
    return importBackup(repo, path);
  });
}
