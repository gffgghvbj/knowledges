import type {
  InterviewMaterial,
  InterviewQuestion,
  InterviewSession,
} from "./interview";
import type { QaRecord } from "./knowledge";
export type MaterialSummary = Omit<InterviewMaterial, "text"> & {
  characters: number;
};
export type QuestionSummary = Pick<
  InterviewQuestion,
  "id" | "prompt" | "knowledgePoints" | "difficulty" | "kind" | "origin"
>;
export type QaSummary = Pick<
  QaRecord,
  "id" | "question" | "status" | "createdAt" | "category"
>;
export type SessionSummary = Pick<
  InterviewSession,
  "id" | "createdAt" | "status"
> & { title: string; answered: number; questionCount: number };
