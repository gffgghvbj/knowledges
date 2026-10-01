import { z } from "zod";
import {
  interviewId,
  turnSchema,
  materialSchema,
  configSchema,
} from "./interview";

export const reviewStateSchema = z.enum(["pending", "mastered"]);
export const reviewSchema = z.object({
  id: interviewId,
  sourceSessionId: interviewId,
  sourceIndex: z.number().int().min(0).max(19),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  state: reviewStateSchema,
  baseline: turnSchema,
  config: configSchema,
  resume: materialSchema.optional(),
  jd: materialSchema.optional(),
  attempts: z
    .array(
      z.object({
        sessionId: interviewId,
        turn: turnSchema,
      }),
    )
    .max(10000),
});
export type ReviewItem = z.infer<typeof reviewSchema>;
export type ReviewSummary = Pick<
  ReviewItem,
  "id" | "state" | "updatedAt" | "sourceSessionId" | "sourceIndex"
> & {
  prompt: string;
  knowledgePoints: string[];
  attempts: number;
};
