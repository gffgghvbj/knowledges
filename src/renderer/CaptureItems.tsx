import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { CaptureTask, Source } from "../shared/contracts";
import { api } from "./api";
import type { Run } from "./App";
import { ExtractionDialog } from "./ExtractionDialog";
import { Pagination } from "./components/Pagination";
import { QualityNotice } from "./components/QualityNotice";
type CaptureItemProps = {
  task: CaptureTask;
  source?: Source;
  run: Run;
  busy: boolean;
  latest?: boolean;
};
export function CaptureItems(props: CaptureItemProps) {
  const automatic =
    !!props.latest && props.task.mode === "scan" && props.task.scanComplete;
  const [expanded, setExpanded] = useState(automatic);
  const [visited, setVisited] = useState(automatic);
  useEffect(() => {
    if (automatic) {
      setExpanded(true);
      setVisited(true);
    }
  }, [automatic]);
  return (
    <details
      className="capture-items"
      open={expanded}
      onToggle={(e) => {
        const open = e.currentTarget.open;
        setExpanded(open);
        if (open) setVisited(true);
      }}
    >
      <summary>
        {props.task.mode === "scan" ? "逐篇选择文章" : "文章结果与质量检查"} ·{" "}
        {props.task.items.length} 项
      </summary>
      {visited && <CaptureItemList {...props} />}
    </details>
  );
}
function CaptureItemList({
  task,
  source,
  run,
  busy,
}: {
  task: CaptureTask;
  source?: Source;
  run: Run;
  busy: boolean;
}) {
  const [query, setQuery] = useState(""),
    [section, setSection] = useState(""),
    [exclude, setExclude] = useState(""),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [page, setPage] = useState(0),
    [onlyIssues, setOnlyIssues] = useState(false),
    [preview, setPreview] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query.toLowerCase().trim());
  const isScan = task.mode === "scan";
  const excludedPaths = useMemo(
    () =>
      exclude
        .split(/[\n,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
    [exclude],
  );
  const eligible = useMemo(
    () =>
      task.items.filter(
        (i) =>
          !excludedPaths.some((p) =>
            new URL(i.candidate.canonicalUrl).pathname.startsWith(p),
          ),
      ),
    [task.items, excludedPaths],
  );
  const filtered = useMemo(
    () =>
      eligible.filter(
        (i) =>
          (!section || (i.candidate.sectionPath[0] || "其他") === section) &&
          (!onlyIssues || i.error || i.quality?.issues.length) &&
          `${i.candidate.title} ${i.candidate.canonicalUrl} ${i.candidate.sectionPath.join(" ")}`
            .toLowerCase()
            .includes(deferredQuery),
      ),
    [eligible, section, onlyIssues, deferredQuery],
  );
  const chosen = useMemo(
    () =>
      eligible
        .filter((i) => selected.has(i.candidate.canonicalUrl))
        .map((i) => i.candidate.canonicalUrl),
    [eligible, selected],
  );
  const safePage = Math.min(
      page,
      Math.max(0, Math.ceil(filtered.length / 50) - 1),
    ),
    visible = filtered.slice(safePage * 50, (safePage + 1) * 50);
  const sections = [
    ...new Set(task.items.map((i) => i.candidate.sectionPath[0] || "其他")),
  ];
  const toggle = (urls: string[], checked: boolean) =>
    setSelected((old) => {
      const next = new Set(old);
      for (const url of urls) checked ? next.add(url) : next.delete(url);
      return next;
    });
  return (
    <div>
      <div className="capture-filters">
        <input
          aria-label="搜索扫描文章"
          placeholder="搜索标题、栏目或 URL"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <select
          aria-label="采集栏目筛选"
          value={section}
          onChange={(e) => {
            setSection(e.target.value);
            setPage(0);
          }}
        >
          <option value="">全部栏目</option>
          {sections.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={onlyIssues}
            onChange={(e) => {
              setOnlyIssues(e.target.checked);
              setPage(0);
            }}
          />
          仅看待检查
        </label>
      </div>
      {isScan && (
        <>
          <label>
            排除路径前缀（逗号或换行分隔）
            <textarea
              aria-label="排除路径前缀"
              rows={2}
              placeholder="/about, /news/"
              value={exclude}
              onChange={(e) => {
                setExclude(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <small>
            按 URL
            路径开头匹配，不使用通配符。被排除的文章不会提交；清空排除条件后原勾选仍保留。
          </small>
          <div className="card-actions">
            <button
              disabled={busy || !task.scanComplete || !visible.length}
              onClick={() =>
                toggle(
                  visible.map((i) => i.candidate.canonicalUrl),
                  true,
                )
              }
            >
              选择本页
            </button>
            <button
              disabled={!selected.size}
              onClick={() => setSelected(new Set())}
            >
              清空选择
            </button>
            <span>
              已选 {chosen.length} 篇（跨搜索和分页保留） · 当前显示{" "}
              {filtered.length} 项
            </span>
            <button
              className="primary"
              disabled={busy || !task.scanComplete || !chosen.length}
              onClick={() => run(() => api.captureArticles(task.id, chosen))}
            >
              采集所选文章
            </button>
          </div>
          <p className="quality-summary">
            逐篇采集后，网站更新仅处理本次所选链接，替换此前选择范围。按栏目采集可切回栏目范围。
          </p>
        </>
      )}
      {visible.map((i) => (
        <div className="capture-row" key={i.candidate.canonicalUrl}>
          {isScan && (
            <input
              type="checkbox"
              aria-label={`采集文章：${i.candidate.title}`}
              checked={selected.has(i.candidate.canonicalUrl)}
              disabled={!task.scanComplete}
              onChange={(e) =>
                toggle([i.candidate.canonicalUrl], e.target.checked)
              }
            />
          )}
          <div className="capture-row-content">
            <strong>{i.candidate.title}</strong>
            <small>
              {i.candidate.sectionPath.join(" / ") || "未分栏目"} ·{" "}
              {
                {
                  queued: "等待",
                  running: "处理中",
                  complete: "完成",
                  partial: "图片待补全",
                  failed: "失败",
                  skipped: "已跳过",
                }[i.state]
              }
            </small>
            <small className="capture-url">{i.candidate.canonicalUrl}</small>
            {i.error && <p className="error-text">{i.error}</p>}
            {i.note && <p>{i.note}</p>}
            <QualityNotice quality={i.quality} />
          </div>
          <button
            disabled={busy || !source || !!source.deletedAt}
            onClick={() => setPreview(i.candidate.canonicalUrl)}
          >
            预览 / 单篇采集
          </button>
        </div>
      ))}
      {!visible.length && <p>没有符合条件的文章。</p>}
      <Pagination page={safePage} total={filtered.length} onChange={setPage} />
      {preview && source && (
        <ExtractionDialog
          source={source}
          initialUrl={preview}
          run={run}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
