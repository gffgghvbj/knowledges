import { z } from "zod";

const selector = z.string().trim().min(1).max(500);
export const extractionRuleSchema = z
  .object({
    formatVersion: z.literal(1),
    name: z.string().trim().min(1).max(80),
    bodySelector: selector,
    titleSelector: selector,
    linkSelector: selector,
    removeSelectors: z.array(selector).max(30),
    pathPrefixes: z.array(z.string().max(200).startsWith("/")).max(30),
    normalizeCode: z.boolean(),
    expandDetails: z.boolean(),
  })
  .strict();
export const extractionSelectionSchema = z.discriminatedUnion("preset", [
  z
    .object({
      preset: z.enum(["auto", "generic", "xiaolin", "javaguide", "carl"]),
    })
    .strict(),
  z
    .object({ preset: z.literal("custom"), rule: extractionRuleSchema })
    .strict(),
]);
