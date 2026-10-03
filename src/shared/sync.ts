export interface SyncSettings {
  endpoint: string;
}

export interface SyncPushResult {
  sources: number;
  articles: number;
  versions: number;
  questions: number;
  reviews: number;
  assets: number;
  chunks: number;
  batches: number;
  finishedAt: string;
}
