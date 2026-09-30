import { z } from "zod";
import { evidenceSchema } from "./knowledge";
export const interviewId = z.string().regex(/^[a-f0-9-]{36,128}$/);
export const providerSchema = z.enum(["online", "ollama"]);
export const difficultySchema = z.enum(["easy", "medium", "hard"]);
export const materialInputSchema = z.object({
  id: interviewId.optional(),
  name: z.string().trim().min(1).max(100),
  kind: z.enum(["resume", "jd"]),
  text: z.string().trim().min(1).max(30000),
});
export const materialSchema = materialInputSchema.extend({
  id: interviewId,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MaterialInput = z.infer<typeof materialInputSchema>;
export type InterviewMaterial = z.infer<typeof materialSchema>;
export const questionInputSchema = z.object({
  id: interviewId.optional(),
  prompt: z.string().trim().min(1).max(4000),
  referenceAnswer: z.string().trim().min(1).max(10000),
  knowledgePoints: z.array(z.string().trim().min(1).max(100)).min(1).max(15),
  difficulty: difficultySchema,
  kind: z.enum(["technical", "project"]),
});
export const questionSchema = questionInputSchema.extend({
  id: interviewId,
  origin: z.enum(["manual", "ai-organized", "ai-extended"]),
  evidence: z.array(evidenceSchema).max(12),
  supplement: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type QuestionInput = z.infer<typeof questionInputSchema>;
export type InterviewQuestion = z.infer<typeof questionSchema>;
export const configSchema = z.object({
  scope: z.enum(["topic", "job"]),
  mode: z.enum(["bank", "ai"]),
  feedback: z.enum(["practice", "formal"]),
  provider: providerSchema,
  difficulty: difficultySchema,
  questionCount: z.number().int().min(1).max(20).default(5),
  topic: z.string().trim().max(200).default(""),
  knowledgePoints: z
    .array(z.string().trim().min(1).max(100))
    .max(15)
    .default([]),
  resumeId: interviewId.optional(),
  jdId: interviewId.optional(),
});
export type InterviewConfig = z.infer<typeof configSchema>;
export const gradeSchema = z.object({
  dimensions: z
    .array(
      z.object({
        name: z.string().min(1).max(40),
        score: z.number().min(0).max(100),
        reason: z.string().trim().min(1).max(2000),
      }),
    )
    .min(3)
    .max(4),
  omissions: z.array(z.string().max(1000)).max(15),
  suggestions: z.array(z.string().max(1000)).max(15),
  referenceAnswer: z.string().trim().min(1).max(10000),
  uncertainty: z.string().max(2000),
  evidenceIds: z.array(z.string()).max(12),
  total: z.number().min(0).max(100),
});
export type InterviewGrade = z.infer<typeof gradeSchema>;
export const turnSchema = z.object({
  question: questionSchema,
  isFollowup: z.boolean(),
  draft: z.string().max(12000),
  answer: z.string().trim().min(1).max(12000).optional(),
  submittedAt: z.string().datetime().optional(),
  grade: gradeSchema.optional(),
  questionModel: z.string().max(200).optional(),
  gradeModel: z.string().max(200).optional(),
  gradedAt: z.string().datetime().optional(),
});
export type InterviewTurn = z.infer<typeof turnSchema>;
export const sessionSchema = z.object({
  id: interviewId,
  createdAt: z.string().datetime(),
  config: configSchema,
  resume: materialSchema.optional(),
  jd: materialSchema.optional(),
  rulesVersion: z.literal("interview-v1"),
  status: z.enum([
    "preparing",
    "awaiting-answer",
    "grading",
    "awaiting-next",
    "completed",
    "failed",
    "aborted",
  ]),
  turns: z.array(turnSchema).max(20),
  bankQueue: z.array(questionSchema).max(100),
  retryStep: z.enum(["select", "question", "grade"]).optional(),
  error: z.string().max(1000).optional(),
  selectionModel: z.string().max(200).optional(),
  endedAt: z.string().datetime().optional(),
});
export type InterviewSession = z.infer<typeof sessionSchema>;
export type PublicQuestion = Pick<
  InterviewQuestion,
  "id" | "prompt" | "knowledgePoints" | "difficulty" | "kind" | "origin"
> &
  Partial<
    Pick<InterviewQuestion, "referenceAnswer" | "evidence" | "supplement">
  >;
export type InterviewSessionView = Omit<
  InterviewSession,
  "bankQueue" | "retryStep" | "turns"
> & {
  turns: (Omit<InterviewTurn, "question"> & { question: PublicQuestion })[];
};
