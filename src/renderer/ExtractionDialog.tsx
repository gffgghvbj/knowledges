import { QualityNotice } from "./components/QualityNotice";
import { useMemo, useState } from "react";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import {
  resolveExtractionRule,
  type ExtractionSelection,
  type ExtractionPreview,
} from "../shared/extraction";
import type { Source } from "../shared/contracts";
import { api } from "./api";
import type { Run } from "./App";

export const ruleOptions = [
  ["auto", "自动匹配网站"],
  ["generic", "通用规则"],
  ["xiaolin", "小林 coding"],
  ["javaguide", "JavaGuide"],
  ["carl", "代码随想录"],
  ["custom", "自定义规则"],
];
export function ExtractionDialog({
  source,
  run,
  onClose,
  initialUrl,
  onCaptured,
}: {
  initialUrl?: string;
  onCaptured?: () => void;
  source: Source;
  run: Run;
  onClose: () => void;
}) {
  const [selection, setSelection] = useState<ExtractionSelection>(
    source.extraction ?? {
      preset: source.adapterId as "generic" | "xiaolin" | "javaguide",
    },
  );
  const [json, setJson] = useState(
    JSON.stringify(resolveExtractionRule(source), null, 2),
  );
  const [url, setUrl] = useState(initialUrl ?? source.entryUrl);
  const [preview, setPreview] = useState<ExtractionPreview | null>(null);
  const [tab, setTab] = useState("rendered");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        String(e).replace(
          /^Error: (?:Error invoking remote method '[^']+': Error: )?/,
          "",
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const current = async (): Promise<ExtractionSelection> =>
    selection.preset === "custom"
      ? { preset: "custom", rule: await api.parseExtractionRule(json) }
      : selection;
  const html = useMemo(() => {
    const md = new MarkdownIt({ html: false });
    md.renderer.rules.image = () =>
      '<span class="missing-image">[图片将在正式采集时下载]</span>';
    return DOMPurify.sanitize(md.render(preview?.markdown ?? ""));
  }, [preview]);
  return (
    <div className="modal-backdrop">
      <section
        className="modal extraction-modal"
        role="dialog"
        aria-modal="true"
        aria-label="提取规则与预览"
      >
        <div className="section-heading">
          <h3>提取规则与预览</h3>
          <button disabled={busy} onClick={onClose}>
            关闭
          </button>
        </div>
        <p>
          单篇采集只处理下方地址，保留已有历史版本，不改变网站更新范围。临时规则仅用于本次；保存到网站后才影响后续任务。
        </p>
        {error && (
          <p role="alert" className="error-banner">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="success-text">
            {message}
          </p>
        )}
        <label>
          提取规则
          <select
            aria-label="提取规则"
            disabled={busy}
            value={selection.preset}
            onChange={(e) => {
              const preset = e.target.value as ExtractionSelection["preset"];
              if (preset === "custom") {
                const rule = resolveExtractionRule({
                  ...source,
                  extraction: selection,
                });
                setSelection({ preset, rule });
                setJson(JSON.stringify(rule, null, 2));
              } else setSelection({ preset });
              setPreview(null);
            }}
          >
            {ruleOptions.map(([id, name]) => (
              <option value={id} key={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div className="card-actions">
          <label className="rule-import">
            导入 JSON 规则
            <input
              aria-label="导入 JSON 规则"
              disabled={busy}
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file)
                  void act(async () => {
                    if (file.size > 32000)
                      throw Error("规则文件不得超过 32 KB");
                    const rule = await api.parseExtractionRule(
                      await file.text(),
                    );
                    setJson(JSON.stringify(rule, null, 2));
                    setSelection({ preset: "custom", rule });
                    setPreview(null);
                    setMessage("已导入，请预览并保存到网站");
                  });
              }}
            />
          </label>
          <button
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const selected = await current();
                const path = await api.exportExtractionRule(
                  resolveExtractionRule({ ...source, extraction: selected }),
                );
                if (path) setMessage("规则已导出：" + path);
              })
            }
          >
            导出当前规则
          </button>
        </div>
        {selection.preset === "custom" && (
          <>
            <label>
              规则 JSON
              <textarea
                aria-label="规则 JSON"
                className="rule-json"
                spellCheck={false}
                disabled={busy}
                value={json}
                maxLength={32000}
                onChange={(e) => {
                  setJson(e.target.value);
                  setPreview(null);
                }}
              />
            </label>
            <small>
              bodySelector：正文；titleSelector：标题；linkSelector：扫描链接；removeSelectors：排除元素；pathPrefixes：扫描路径前缀（空数组代表全部同源路径）；normalizeCode：保留代码语言并清理行号；expandDetails：展开折叠说明。规则不执行脚本。
            </small>
          </>
        )}
        <label>
          预览文章地址
          <input
            aria-label="预览文章地址"
            type="url"
            disabled={busy}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setPreview(null);
            }}
          />
        </label>
        <div className="modal-actions">
          <button
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await api.captureUrl(source.id, url, await current());
                await run(async () => {});
                onClose();
                onCaptured?.();
              })
            }
          >
            按当前规则采集此页
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void act(async () =>
                setPreview(
                  await api.previewExtraction(source.id, url, await current()),
                ),
              )
            }
          >
            {busy ? "正在处理…" : "预览提取"}
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await api.saveExtraction(source.id, await current());
                await run(async () => {});
                setMessage(
                  "规则已保存。关闭窗口后点击更新，重新采集已有文章。",
                );
              })
            }
          >
            保存到此网站
          </button>
        </div>
        {preview && (
          <section className="extraction-preview">
            <p>
              {preview.ruleName} · {preview.imageCount} 张图片 ·{" "}
              {preview.linkCount} 条符合扫描规则的链接
            </p>
            <small>预览不写入资料库，也不下载图片。</small>
            <QualityNotice quality={preview.quality} />
            <div className="card-actions">
              <button
                aria-pressed={tab === "rendered"}
                onClick={() => setTab("rendered")}
              >
                阅读效果
              </button>
              <button
                aria-pressed={tab === "markdown"}
                onClick={() => setTab("markdown")}
              >
                Markdown 源文
              </button>
            </div>
            {tab === "markdown" ? (
              <pre className="rule-markdown">{preview.markdown}</pre>
            ) : (
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
            )}
          </section>
        )}
      </section>
    </div>
  );
}
