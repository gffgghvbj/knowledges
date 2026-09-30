import { RetrievalSettings } from "./knowledge/retrieval-settings";
import { VectorIndex } from "./knowledge/vector-index";
import { HybridRetriever } from "./knowledge/hybrid";
import { embed, rerank, retrievalError } from "./knowledge/retrieval-api";
import { retrievalSettingsSchema } from "../shared/retrieval";
import { ModelSettings } from "./knowledge/settings";
import { QaService } from "./knowledge/service";
import { requestModel } from "./knowledge/model";
import { profileSchema, scopeSchema } from "../shared/knowledge";
import {
  ipcMain,
  dialog,
  shell,
  safeStorage,
  type BrowserWindow,
} from "electron";
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
  const settings = new ModelSettings(repo.root, safeStorage),
    retrievalSettings = new RetrievalSettings(repo.root, safeStorage),
    vectorIndex = new VectorIndex(repo, retrievalSettings),
    qa = new QaService(
      repo,
      settings,
      120000,
      new HybridRetriever(repo, retrievalSettings, vectorIndex),
    );
  vectorIndex.watch();
  handle("retrievalConfig", z.tuple([]), () => retrievalSettings.get());
  handle("saveRetrieval", z.tuple([retrievalSettingsSchema]), (input) => {
    vectorIndex.pause();
    return retrievalSettings.save(input);
  });
  handle(
    "controlVectorIndex",
    z.tuple([z.enum(["start", "pause", "rebuild"])]),
    (action) => {
      if (action === "pause") vectorIndex.pause();
      else if (action === "rebuild") vectorIndex.rebuild();
      else vectorIndex.start();
    },
  );
  handle("testRetrieval", z.tuple([]), async () => {
    try {
      const config = retrievalSettings.resolve(),
        signal = AbortSignal.timeout(30000);
      const vectors = await embed(
        config.embedding,
        ["数据库持久化保存数据"],
        "document",
        signal,
      );
      if (config.rerank.enabled)
        await rerank(
          config.rerank,
          "如何保存数据",
          ["数据库持久化保存数据", "花卉种植"],
          signal,
        );
      return { dimensions: vectors[0].length };
    } catch (e) {
      throw Error(retrievalError(e));
    }
  });
  handle("modelProfiles", z.tuple([]), () => settings.list());
  handle("saveModel", z.tuple([profileSchema]), (input) =>
    settings.save(input),
  );
  handle(
    "testModel",
    z.tuple([z.enum(["online", "ollama"])]),
    async (provider) => {
      try {
        await requestModel(
          settings.resolve(provider),
          [{ role: "user", content: 'Return JSON: {"ok":true}' }],
          AbortSignal.timeout(30000),
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "";
        throw Error(
          /^(请先|无法解密|API Key|模型)/.test(message)
            ? message
            : "连接失败或超时，请检查模型设置与网络",
        );
      }
    },
  );
  handle(
    "ask",
    z.tuple([
      z.string().trim().min(1).max(4000),
      scopeSchema,
      z.enum(["online", "ollama"]),
      z.boolean(),
    ]),
    (question, scope, provider, supplement) =>
      qa.ask(question, scope, provider, supplement),
  );
  handle("qaHistory", z.tuple([]), () => repo.listQa());
  handle("cancelQa", z.tuple([id]), (id) => qa.cancel(id));
  handle("getStatus", z.tuple([]), () => ({ ready: true }));
  handle("state", z.tuple([]), () => ({
    sources: repo.listSources(),
    articles: repo.listArticles(),
    tasks: repo.listTasks(),
    root: repo.root,
    vectorIndex: vectorIndex.status(),
    knowledgeIndex: {
      articles: repo.listArticles().length,
      chunks: Number(
        repo.db.prepare("SELECT count(*) AS n FROM knowledge_chunks").get()
          ?.n ?? 0,
      ),
    },
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
  handle(
    "openArticle",
    z.tuple([id, id.optional()]),
    async (articleId, versionId) => {
      const value = repo.readArticle(articleId, versionId);
      const error = await shell.openPath(
        repo.resolvePath(
          versionId
            ? value.version.markdownPath
            : `articles/${articleId}/current.md`,
        ),
      );
      if (error) throw Error(error);
    },
  );
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
  return () => vectorIndex.close();
}
