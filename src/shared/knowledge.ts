import { z } from "zod";
import { retrievalTraceSchema } from "./retrieval";
export const MAX_CONTEXT_CHARS = 18000;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const scopeSchema = z.object({
  sourceId: hash.optional(),
  section: z.string().max(300).optional(),
  topic: z.string().max(200).optional(),
});
export const evidenceSchema = z
  .object({
    id: hash,
    articleId: hash,
    versionId: hash,
    title: z.string().max(2000),
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
    quote: z.string().max(MAX_CONTEXT_CHARS),
  })
  .refine((v) => v.lineEnd >= v.lineStart);
export const answerSchema = z.object({
  paragraphs: z
    .array(
      z.object({
        text: z.string().min(1).max(12000),
        sources: z.array(hash).min(1).max(12),
      }),
    )
    .max(30),
  insufficient: z.boolean(),
  supplement: z.string().max(16000),
});
export const recordSchema = z.object({
  retrieval: retrievalTraceSchema.optional(),
  id: z.string().regex(/^[a-f0-9-]{36,128}$/),
  createdAt: z.string().datetime(),
  question: z.string().min(1).max(4000),
  scope: scopeSchema,
  allowSupplement: z.boolean(),
  provider: z.enum(["online", "ollama"]),
  model: z.string().max(200),
  status: z.enum(["pending", "complete", "failed", "cancelled"]),
  evidence: z.array(evidenceSchema).max(12),
  answer: answerSchema.optional(),
  error: z.string().max(1000).optional(),
});
export type Evidence = z.infer<typeof evidenceSchema>;
export type QaScope = z.infer<typeof scopeSchema>;
export type QaRecord = z.infer<typeof recordSchema>;
export type Answer = z.infer<typeof answerSchema>;
export const profileSchema = z.object({
  provider: z.enum(["online", "ollama"]),
  baseUrl: z.string().max(2000),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().max(1000).optional(),
  clearKey: z.boolean().optional(),
});
export type ProfileInput = z.infer<typeof profileSchema>;
export interface ModelProfile {
  provider: "online" | "ollama";
  baseUrl: string;
  model: string;
  hasKey: boolean;
}
