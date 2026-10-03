import type { CaptureQuality } from "./capture-quality";
import type {
  ExtractionSelection,
  ExtractionRule,
  ExtractionPreview,
} from "./extraction";
import type { ReviewItem, ReviewSummary } from "./review";
import type {
  QaSummary,
  MaterialSummary,
  QuestionSummary,
  SessionSummary,
} from "./lists";
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
import type { SyncPushResult, SyncSettings, ProgressEvent } from "./sync";
export interface Source {
  deletedAt?: string;
  extraction?: ExtractionSelection;
  id: string;
  entryUrl: string;
  allowedOrigins: string[];
  adapterId: string;
  label: string;
  selectedSections?: string[];
  selectedUrls?: string[];
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
  extractionStats?: {
    codeBlocks: number;
    emptyCodeBlocks: number;
    missingImageSources: number;
  };
  candidate: Candidate;
  markdown: string;
  text: string;
  fetchedAt: string;
  assets: AssetInput[];
}
export interface Article extends Candidate {
  deletedAt?: string;
  id: string;
  currentVersionId: string;
  sourceStatus: "available" | "unavailable" | "removed";
  lastSeenAt: string;
}
export interface ArticleVersion {
  quality?: CaptureQuality;
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
  quality?: CaptureQuality;
  note?: string;
  candidate: Candidate;
  state: "queued" | "running" | "complete" | "failed" | "partial" | "skipped";
  error?: string;
}
export interface CaptureTask {
  extraction?: ExtractionSelection;
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
  reviewCount?: number;
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
export interface StartupStatus {
  message: string;
  completed?: number;
  total?: number;
  error?: string;
}
export interface LibraryApi {
  captureArticles(taskId: string, urls: string[]): Promise<string>;
  captureUrl(
    sourceId: string,
    url: string,
    selection?: ExtractionSelection,
  ): Promise<string>;
  deleteSource(id: string): Promise<void>;
  deleteTasks(ids: string[]): Promise<void>;
  trashArticles(ids: string[]): Promise<void>;
  restoreArticles(ids: string[]): Promise<void>;
  trashedArticles(): Promise<Article[]>;
  reviewSummaries(): Promise<ReviewSummary[]>;
  reviewItem(id: string): Promise<ReviewItem | null>;
  addReview(sessionId: string, index: number): Promise<string>;
  setReviewState(id: string, state: ReviewItem["state"]): Promise<void>;
  deleteReview(id: string): Promise<void>;
  practiceReview(id: string, provider: "online" | "ollama"): Promise<string>;
  startupStatus(): Promise<StartupStatus>;
  qaSummaries(): Promise<QaSummary[]>;
  qaRecord(id: string): Promise<QaRecord | null>;
  interviewSessionSummaries(): Promise<SessionSummary[]>;
  interviewSession(id: string): Promise<InterviewSessionView | null>;
  interviewMaterialSummaries(): Promise<MaterialSummary[]>;
  interviewMaterial(id: string): Promise<InterviewMaterial | null>;
  interviewQuestionSummaries(): Promise<QuestionSummary[]>;
  interviewQuestion(id: string): Promise<InterviewQuestion | null>;
  flushInterviewDrafts(): Promise<void>;

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
  stateUpdate(
    revision?: string,
  ): Promise<{ revision: string; patch: Partial<LibraryState> }>;
  addSource(url: string, extraction?: ExtractionSelection): Promise<Source>;
  saveExtraction(
    sourceId: string,
    selection: ExtractionSelection,
  ): Promise<void>;
  previewExtraction(
    sourceId: string,
    url: string,
    selection: ExtractionSelection,
  ): Promise<ExtractionPreview>;
  parseExtractionRule(json: string): Promise<ExtractionRule>;
  exportExtractionRule(rule: ExtractionRule): Promise<string | null>;
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
  syncSettings(): Promise<SyncSettings & { hasToken: boolean }>;
  saveSyncSettings(endpoint: string, token?: string): Promise<void>;
  syncPush(): Promise<SyncPushResult>;
  onProgress(callback: (event: ProgressEvent) => void): () => void;
}
