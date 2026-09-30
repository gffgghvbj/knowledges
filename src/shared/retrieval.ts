import { z } from "zod";
const connection = {
  url: z.string().trim().max(2000),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().max(2000).optional(),
  clearKey: z.boolean().optional(),
};
export const retrievalSettingsSchema = z.object({
  enabled: z.boolean(),
  embedding: z.object({
    ...connection,
    protocol: z.enum(["dashscope", "openai", "ollama"]),
    dimensions: z.number().int().min(1).max(8192),
  }),
  rerank: z.object({
    ...connection,
    protocol: z.enum(["dashscope", "compatible"]),
    enabled: z.boolean(),
  }),
  minSimilarity: z.number().min(-1).max(1),
});
export type RetrievalInput = z.infer<typeof retrievalSettingsSchema>;
export type PublicConnection<T> = Omit<T, "apiKey" | "clearKey"> & {
  hasKey: boolean;
};
export interface RetrievalConfig {
  enabled: boolean;
  embedding: PublicConnection<RetrievalInput["embedding"]>;
  rerank: PublicConnection<RetrievalInput["rerank"]>;
  minSimilarity: number;
}
export interface VectorStatus {
  state: "disabled" | "paused" | "running" | "ready" | "failed";
  ready: number;
  total: number;
  excluded: number;
  error?: string;
  model: string;
}
export const retrievalTraceSchema = z.object({
  mode: z.enum(["keyword", "keyword-rerank", "hybrid", "hybrid-rerank"]),
  embeddingModel: z.string().max(200).optional(),
  rerankModel: z.string().max(200).optional(),
  warning: z.string().max(1500).optional(),
});
export type RetrievalTrace = z.infer<typeof retrievalTraceSchema>;
