export interface SyncSettings {
  endpoint: string;
}

/** 长任务进度事件（云同步 / 备份导出 / 备份导入共用） */
export interface ProgressEvent {
  task: "sync" | "export" | "import";
  label: string;
  completed: number;
  total: number;
}

export interface SyncPushResult {
  sources: number;
  articles: number;
  versions: number;
  questions: number;
  reviews: number;
  assets: number;
  chunks: number;
  pendingVectors?: number;
  batches: number;
  finishedAt: string;
}
