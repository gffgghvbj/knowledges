import { resolveExtractionRule } from "../../shared/extraction";
import { dialog, type BrowserWindow } from "electron";
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  extractionSelectionSchema,
  extractionRuleSchema,
} from "../../shared/extraction-schema";
import { validateRule, validateSelection } from "./adapters/rules";
import { getAdapter } from "./adapters/types";
import { loadPage } from "./browser";
import { normalizeUrl } from "../library/files";
import type { LibraryRepository } from "../library/repository";
import type { CaptureQueue } from "./queue";
import type { IpcHandle } from "../interview/ipc";

export function registerRuleIpc(
  handle: IpcHandle,
  win: BrowserWindow,
  repo: LibraryRepository,
  queue: CaptureQueue,
) {
  const id = z.string().min(1).max(128);
  handle(
    "saveExtraction",
    z.tuple([id, extractionSelectionSchema]),
    (id, raw) => {
      const source = repo.getSource(id);
      if (!source || source.deletedAt) throw Error("网站不存在或已移除");
      if (
        queue.isActive(id) ||
        repo
          .listTasks()
          .some(
            (t) => t.sourceId === id && ["running", "queued"].includes(t.state),
          )
      )
        throw Error("请先暂停该网站任务，并等待当前请求结束后再保存规则");
      repo.putSource({ ...source, extraction: validateSelection(raw) });
    },
  );
  handle("parseExtractionRule", z.tuple([z.string().max(32000)]), (json) => {
    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch {
      throw Error("规则文件不是有效的 JSON");
    }
    return validateRule(value);
  });
  handle(
    "exportExtractionRule",
    z.tuple([extractionRuleSchema]),
    async (raw) => {
      const rule = validateRule(raw);
      const result = await dialog.showSaveDialog(win, {
        title: "导出提取规则",
        defaultPath: "extraction-rule.json",
        filters: [{ name: "JSON 规则", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePath) return null;
      await writeFile(
        result.filePath,
        JSON.stringify(rule, null, 2) + "\n",
        "utf8",
      );
      return result.filePath;
    },
  );
  let previewing = false;
  handle(
    "previewExtraction",
    z.tuple([id, z.string().max(4000), extractionSelectionSchema]),
    async (id, url, raw) => {
      if (previewing) throw Error("正在预览网页，请稍候");
      const original = repo.getSource(id);
      if (!original || original.deletedAt) throw Error("网站不存在或已移除");
      const source = { ...original, extraction: validateSelection(raw) };
      const target = normalizeUrl(url);
      if (!source.allowedOrigins.includes(new URL(target).origin))
        throw Error("预览地址必须属于当前网站");
      previewing = true;
      try {
        const result = await loadPage(source, target);
        if (result.kind !== "article")
          throw Error(
            result.kind === "login-required"
              ? "请先通过网站来源的登录入口完成登录"
              : "无法预览：" + result.reason,
          );
        const adapter = getAdapter(source);
        const article = adapter.extract(result.snapshot, {
          sourceId: id,
          canonicalUrl: result.snapshot.finalUrl,
          title: "预览",
          sectionPath: [],
        });
        if (article.markdown.length > 200000)
          throw Error("提取内容超过预览上限，请缩小正文选择范围");
        return {
          title: article.candidate.title,
          markdown: article.markdown,
          ruleName: resolveExtractionRule(source).name,
          imageCount: article.assets.length,
          linkCount: adapter.discover(result.snapshot).length,
          finalUrl: result.snapshot.finalUrl,
        };
      } finally {
        previewing = false;
      }
    },
  );
}
