import type {
  ExtractionRule,
  ExtractionSelection,
} from "../../../shared/extraction";
import { parseHTML } from "linkedom";
import {
  extractionRuleSchema,
  extractionSelectionSchema,
} from "../../../shared/extraction-schema";

export function validateRule(raw: unknown): ExtractionRule {
  const rule = extractionRuleSchema.parse(raw);
  const { document } = parseHTML(
    "<html><body><article><h1>Title</h1></article></body></html>",
  );
  for (const selector of [
    rule.bodySelector,
    rule.titleSelector,
    rule.linkSelector,
    ...rule.removeSelectors,
  ]) {
    try {
      document.querySelectorAll(selector);
    } catch {
      throw Error("规则包含无效的 CSS 选择器：" + selector);
    }
  }
  return rule;
}
export function validateSelection(raw: unknown): ExtractionSelection {
  const selection = extractionSelectionSchema.parse(raw);
  if (selection.preset === "custom") validateRule(selection.rule);
  return selection;
}
