import type { z } from "zod";
import type {
  extractionRuleSchema,
  extractionSelectionSchema,
} from "./extraction-schema";
export type ExtractionRule = z.infer<typeof extractionRuleSchema>;
export type ExtractionSelection = z.infer<typeof extractionSelectionSchema>;
const common: ExtractionRule = {
  formatVersion: 1,
  name: "通用规则",
  bodySelector: "article, .theme-default-content, [vp-content], .vp-doc, main",
  titleSelector: "h1",
  linkSelector: "a[href]",
  removeSelectors: [],
  pathPrefixes: [],
  normalizeCode: true,
  expandDetails: true,
};
export const extractionPresets: Record<
  "generic" | "xiaolin" | "javaguide" | "carl",
  ExtractionRule
> = {
  generic: common,
  xiaolin: {
    ...common,
    name: "小林 coding",
    bodySelector: ".theme-default-content",
  },
  javaguide: { ...common, name: "JavaGuide", bodySelector: "[vp-content]" },
  carl: {
    ...common,
    name: "代码随想录",
    bodySelector: ".theme-default-content",
    removeSelectors: [
      ".sr-only",
      ".icon.outbound",
      ".page-edit",
      ".page-nav",
      ".last-updated",
    ],
  },
};
export function resolveExtractionRule(source: {
  entryUrl: string;
  adapterId: string;
  extraction?: ExtractionSelection;
}): ExtractionRule {
  const selection = source.extraction;
  if (selection?.preset === "custom") return selection.rule;
  let name = selection?.preset ?? source.adapterId;
  if (name === "auto") {
    const host = new URL(source.entryUrl).hostname;
    name = /(^|\.)programmercarl\.com$/.test(host)
      ? "carl"
      : host === "xiaolincoding.com"
        ? "xiaolin"
        : /(^|\.)javaguide\.cn$/.test(host)
          ? "javaguide"
          : "generic";
  }
  return extractionPresets[name as keyof typeof extractionPresets] ?? common;
}
export interface ExtractionPreview {
  title: string;
  markdown: string;
  ruleName: string;
  imageCount: number;
  linkCount: number;
  finalUrl: string;
}
