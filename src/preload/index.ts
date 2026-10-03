import { contextBridge, ipcRenderer } from "electron";
const ready = ipcRenderer.invoke("library:startupReady") as Promise<{
  error?: string;
}>;
const names = [
  "deleteSource",
  "deleteTasks",
  "trashArticles",
  "restoreArticles",
  "trashedArticles",
  "saveExtraction",
  "previewExtraction",
  "parseExtractionRule",
  "exportExtractionRule",
  "reviewSummaries",
  "reviewItem",
  "addReview",
  "setReviewState",
  "deleteReview",
  "practiceReview",
  "startupStatus",
  "qaSummaries",
  "qaRecord",
  "interviewSessionSummaries",
  "interviewSession",
  "interviewMaterialSummaries",
  "interviewMaterial",
  "interviewQuestionSummaries",
  "interviewQuestion",
  "flushInterviewDrafts",
  "interviewSessions",
  "createInterview",
  "saveInterviewDraft",
  "submitInterviewAnswer",
  "nextInterview",
  "retryInterview",
  "finishInterview",
  "deleteInterview",
  "interviewQuestions",
  "saveInterviewQuestion",
  "deleteInterviewQuestion",
  "proposeInterviewQuestions",
  "acceptInterviewQuestions",
  "interviewMaterials",
  "saveInterviewMaterial",
  "deleteInterviewMaterial",
  "importInterviewDocument",
  "retrievalConfig",
  "saveRetrieval",
  "testRetrieval",
  "controlVectorIndex",
  "modelProfiles",
  "saveModel",
  "testModel",
  "ask",
  "qaHistory",
  "qaCategories",
  "createQaCategory",
  "renameQaCategory",
  "deleteQaCategory",
  "moveQa",
  "deleteQa",
  "cancelQa",
  "getStatus",
  "state",
  "stateUpdate",
  "addSource",
  "login",
  "scan",
  "capture",
  "captureArticles",
  "captureUrl",
  "update",
  "control",
  "read",
  "versions",
  "restore",
  "search",
  "openArticle",
  "openUrl",
  "exportBackup",
  "inspectBackup",
  "importBackup",
  "syncSettings",
  "saveSyncSettings",
  "syncPush",
];
contextBridge.exposeInMainWorld(
  "libraryApi",
  {
    ...Object.fromEntries(
      names.map((name) => [
        name,
        async (...args: unknown[]) => {
          if (name !== "startupStatus") {
            const result = await ready;
            if (result.error) throw Error(result.error);
          }
          return ipcRenderer.invoke(`library:${name}`, ...args);
        },
      ]),
    ),
    onProgress: (callback: (event: unknown) => void) => {
      let lastEmit = 0;
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: unknown,
      ): void => {
        const progress = data as { completed: number; total: number };
        const now = Date.now();
        if (progress.completed < progress.total && now - lastEmit < 100)
          return;
        lastEmit = now;
        callback(data);
      };
      ipcRenderer.on("library:progress", handler);
      return () => ipcRenderer.removeListener("library:progress", handler);
    },
  },
);
