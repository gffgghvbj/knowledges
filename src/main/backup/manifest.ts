import { z } from "zod";
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
  formatVersion: z.literal(1),
  createdAt: time,
  sources: z.array(
    z.object({
      id,
      entryUrl: web,
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
