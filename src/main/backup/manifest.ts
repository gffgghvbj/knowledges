import { extractionSelectionSchema } from "../../shared/extraction-schema";
import { reviewSchema } from "../../shared/review";
import {
  materialSchema,
  questionSchema,
  sessionSchema,
} from "../../shared/interview";
import { z } from "zod";
import { recordSchema, categoryNameSchema } from "../../shared/knowledge";
const id = z.string().regex(/^[a-f0-9]{64}$/),
  time = z
    .string()
    .refine((s) => Number.isFinite(Date.parse(s)))
    .transform((s) => new Date(s).toISOString());
const web = z
  .string()
  .url()
  .refine((s) => /^https?:\/\//.test(s));
const asset = z.object({
  hash: id,
  relativePath: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
});
export const manifestSchema = z.object({
  formatVersion: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
    z.literal(7),
  ]),
  interviewReviews: z.array(reviewSchema).max(100000).default([]),
  interviewMaterials: z.array(materialSchema).max(10000).default([]),
  interviewQuestions: z.array(questionSchema).max(100000).default([]),
  interviewSessions: z.array(sessionSchema).max(10000).default([]),
  qaCategories: z.array(categoryNameSchema).max(10000).default([]),
  qaRecords: z.array(recordSchema).max(100000).default([]),
  createdAt: time,
  sources: z.array(
    z.object({
      id,
      deletedAt: time.optional(),
      entryUrl: web,
      extraction: extractionSelectionSchema.optional(),
      allowedOrigins: z.array(web),
      adapterId: z
        .string()
        .refine((s) => ["generic", "xiaolin", "javaguide"].includes(s)),
      label: z.string(),
      selectedSections: z.array(z.string()).optional(),
    }),
  ),
  articles: z.array(
    z.object({
      id,
      deletedAt: time.optional(),
      sourceId: id,
      canonicalUrl: web,
      title: z.string(),
      sectionPath: z.array(z.string()),
      currentVersionId: id,
      sourceStatus: z.enum(["available", "unavailable", "removed"]),
      lastSeenAt: time,
    }),
  ),
  versions: z.array(
    z.object({
      id,
      articleId: id,
      contentHash: id,
      capturedAt: time,
      markdownPath: z.string(),
      assets: z.array(asset),
      completeness: z.enum(["complete", "assets-pending"]),
    }),
  ),
  files: z.array(
    z.object({
      path: z.string(),
      hash: id,
      size: z.number().int().nonnegative(),
    }),
  ),
});
export type Manifest = z.infer<typeof manifestSchema>;
