import { QualityNotice } from "./QualityNotice";
import { memo, useMemo } from "react";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import type { Article, ArticleVersion } from "../../shared/contracts";
import { api } from "../api";
import type { Run } from "../App";
export const Reader = memo(function Reader({
  value,
  run,
}: {
  value: { article: Article; version: ArticleVersion; markdown: string };
  run: Run;
}) {
  const html = useMemo(() => {
    const md = new MarkdownIt({ html: false, linkify: false });
    md.renderer.rules.image = (tokens, index) => {
      const t = tokens[index],
        src = String(t.attrGet("src") || ""),
        asset = value.version.assets.find((a) => src.endsWith(a.relativePath));
      return asset
        ? `<img src="library://assets/${asset.relativePath}" alt="${md.utils.escapeHtml(t.content)}" loading="lazy">`
        : `<span class="missing-image">[图片未下载：${md.utils.escapeHtml(t.content)}]</span>`;
    };
    return DOMPurify.sanitize(md.render(value.markdown), {
      ADD_URI_SAFE_ATTR: ["src"],
      FORBID_TAGS: ["style", "form", "input"],
      ALLOW_UNKNOWN_PROTOCOLS: true,
    });
  }, [value]);
  return (
    <>
      <div className="reader-meta">
        <span>
          {new Date(value.version.capturedAt).toLocaleString()} ·{" "}
          {value.version.completeness === "complete"
            ? "已保存到本地"
            : "部分图片待重试"}
        </span>
        <button
          onClick={() => run(() => api.openUrl(value.article.canonicalUrl))}
        >
          原网页 ↗
        </button>
        <button
          onClick={() =>
            run(() => api.openArticle(value.article.id, value.version.id))
          }
        >
          打开 Markdown
        </button>
      </div>
      <QualityNotice quality={value.version.quality} />
      <article
        className="markdown"
        onClick={(e) => {
          const link = (e.target as HTMLElement).closest("a");
          if (link) {
            e.preventDefault();
            if (/^https?:\/\//.test(link.href))
              void run(() => api.openUrl(link.href));
          }
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
});
