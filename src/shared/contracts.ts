import type { InterviewConfig, InterviewSessionView } from "./interview";
import type { InterviewQuestion, QuestionInput } from "./interview";
import type { InterviewMaterial, MaterialInput } from "./interview";
import type {
  RetrievalConfig,
  RetrievalInput,
  VectorStatus,
} from "./retrieval";
import type {
  ModelProfile,
  ProfileInput,
  QaRecord,
  QaScope,
} from "./knowledge";
export interface Source {
  id: string;
  entryUrl: string;
  allowedOrigins: string[];
  adapterId: string;
  label: string;
  selectedSections?: string[];
}
export interface Candidate {
  sourceId: string;
  canonicalUrl: string;
  title: string;
  sectionPath: string[];
}
export interface PageSnapshot {
  finalUrl: string;
  html: string;
  fetchedAt: string;
  statusCode: number;
}
export type PageResult =
  | { kind: "article"; snapshot: PageSnapshot }
  | { kind: "login-required" }
  | {
      kind: "unavailable" | "failed";
      reason: string;
      statusCode?: number;
      retryAfterMs?: number;
    };
export interface AssetInput {
  remoteUrl: string;
  localRef: string;
}
export interface Asset {
  hash: string;
  relativePath: string;
  mimeType: string;
  size: number;
}
export interface ExtractedArticle {
  candidate: Candidate;
  markdown: string;
  text: string;
  fetchedAt: string;
  assets: AssetInput[];
}
export interface Article extends Candidate {
  id: string;
  currentVersionId: string;
  sourceStatus: "available" | "unavailable" | "removed";
  lastSeenAt: string;
}
export interface ArticleVersion {
  id: string;
  articleId: string;
  contentHash: string;
  capturedAt: string;
  markdownPath: string;
  assets: Asset[];
  completeness: "complete" | "assets-pending";
}
export type TaskState =
  | "queued"
  | "running"
  | "paused"
  | "login-required"
  | "partial"
  | "failed"
  | "complete";
export interface QueueItem {
  candidate: Candidate;
  state: "queued" | "running" | "complete" | "failed" | "partial";
  error?: string;
}
export interface CaptureTask {
  id: string;
  sourceId: string;
  state: TaskState;
  items: QueueItem[];
  createdAt: string;
  scanComplete: boolean;
  discovered: number;
  error?: string;
  mode: "scan" | "capture" | "update";
}
export interface MergeReport {
  interviewsAdded?: number;
  interviewConflicts?: number;
  questionsAdded?: number;
  questionConflicts?: number;
  added: number;
  updated: number;
  duplicates: number;
  conflicts: number;
  failed: number;
}
export interface BackupPreview {
  interviewCount?: number;
  materialCount?: number;
  bankCount?: number;
  questionCount?: number;
  formatVersion: number;
  recordCount: number;
  totalBytes: number;
}
export interface LibraryState {
  vectorIndex?: VectorStatus;
  knowledgeIndex?: { articles: number; chunks: number };
  sources: Source[];
  articles: Article[];
  tasks: CaptureTask[];
  root: string;
}
export interface LibraryApi {
  interviewSessions(): Promise<InterviewSessionView[]>;
  createInterview(config: InterviewConfig): Promise<string>;
  saveInterviewDraft(id: string, index: number, text: string): Promise<void>;
  submitInterviewAnswer(id: string, index: number, text: string): Promise<void>;
  nextInterview(id: string): Promise<void>;
  retryInterview(id: string): Promise<void>;
  finishInterview(id: string): Promise<void>;
  deleteInterview(id: string): Promise<void>;
  interviewQuestions(): Promise<InterviewQuestion[]>;
  saveInterviewQuestion(input: QuestionInput): Promise<InterviewQuestion>;
  deleteInterviewQuestion(id: string): Promise<void>;
  proposeInterviewQuestions(
    ids: string[],
    count: number,
    provider: "online" | "ollama",
  ): Promise<InterviewQuestion[]>;
  acceptInterviewQuestions(ids: string[]): Promise<InterviewQuestion[]>;
  interviewMaterials(): Promise<InterviewMaterial[]>;
  saveInterviewMaterial(input: MaterialInput): Promise<InterviewMaterial>;
  deleteInterviewMaterial(id: string): Promise<void>;
  importInterviewDocument(): Promise<{ name: string; text: string } | null>;
  retrievalConfig(): Promise<RetrievalConfig>;
  saveRetrieval(input: RetrievalInput): Promise<RetrievalConfig>;
  testRetrieval(): Promise<{ dimensions: number }>;
  controlVectorIndex(action: "start" | "pause" | "rebuild"): Promise<void>;
  modelProfiles(): Promise<ModelProfile[]>;
  saveModel(input: ProfileInput): Promise<ModelProfile[]>;
  testModel(provider: "online" | "ollama"): Promise<void>;
  ask(
    question: string,
    scope: QaScope,
    provider: "online" | "ollama",
    allowSupplement: boolean,
  ): Promise<string>;
  qaHistory(): Promise<QaRecord[]>;
  qaCategories(): Promise<string[]>;
  createQaCategory(name: string): Promise<string>;
  renameQaCategory(old: string, name: string): Promise<string>;
  deleteQaCategory(name: string): Promise<void>;
  moveQa(ids: string[], category: string | null): Promise<void>;
  deleteQa(ids: string[]): Promise<void>;
  cancelQa(id: string): Promise<void>;
  getStatus(): Promise<{ ready: boolean }>;
  state(): Promise<LibraryState>;
  addSource(url: string): Promise<Source>;
  login(id: string): Promise<void>;
  scan(id: string): Promise<string>;
  capture(taskId: string, sections: string[]): Promise<string>;
  update(id: string): Promise<string>;
  control(id: string, action: "pause" | "resume" | "retry"): Promise<void>;
  read(
    id: string,
    versionId?: string,
  ): Promise<{ article: Article; version: ArticleVersion; markdown: string }>;
  versions(id: string): Promise<ArticleVersion[]>;
  restore(id: string, versionId: string): Promise<void>;
  search(
    query: string,
    sourceId?: string,
    section?: string,
    page?: number,
  ): Promise<{ items: Article[]; total: number }>;
  openArticle(id: string, versionId?: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  exportBackup(): Promise<{ cancelled: boolean; path?: string }>;
  inspectBackup(): Promise<{ path: string; preview: BackupPreview } | null>;
  importBackup(path: string): Promise<MergeReport>;
}
