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
