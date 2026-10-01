import { memo, useEffect, useState } from "react";
import type { QaSummary } from "../shared/lists";
import { Pagination } from "./components/Pagination";
import type { Run } from "./App";
import { api } from "./api";
const statusText = {
  pending: "正在检索与生成…",
  complete: "已完成",
  failed: "生成失败",
  cancelled: "已取消",
};
type Dialog =
  | { kind: "create" }
  | { kind: "rename"; category: string }
  | { kind: "category"; category: string }
  | { kind: "records"; ids: string[] };
export const QaHistory = memo(function QaHistory({
  history,
  selected,
  onSelect,
  onChanged,
  run,
}: {
  history: QaSummary[];
  selected: string;
  onSelect: (id: string) => void;
  onChanged: () => Promise<void>;
  run: Run;
}) {
  const [categories, setCategories] = useState<string[]>([]),
    [filter, setFilter] = useState("*"),
    [page, setPage] = useState(0),
    [checked, setChecked] = useState<string[]>([]),
    [target, setTarget] = useState(""),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => setError(""), [dialog]);
  useEffect(() => {
    let active = true;
    void api
      .qaCategories()
      .then((rows) => {
        if (active) setCategories(rows);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const filtered = history.filter(
    (r) => filter === "*" || (r.category ? "cat:" + r.category : "") === filter,
  );
  const safePage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / 50) - 1),
  );
  const rows = filtered.slice(safePage * 50, (safePage + 1) * 50);
  const ids = checked.filter((id) => rows.some((r) => r.id === id));
  const allChecked = rows.length > 0 && ids.length === rows.length;
  const perform = (action: () => Promise<unknown>) =>
    run(async () => {
      setBusy(true);
      setError("");
      try {
        await action();
        setCategories(await api.qaCategories());
        await onChanged();
        setChecked([]);
        setDialog(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "操作失败，请重试");
      } finally {
        setBusy(false);
      }
    });
  const confirm = () => {
    if (!dialog) return;
    void perform(async () => {
      if (dialog.kind === "create") await api.createQaCategory(name);
      else if (dialog.kind === "rename") {
        const renamed = await api.renameQaCategory(dialog.category, name);
        setFilter("cat:" + renamed);
        if (target === dialog.category) setTarget(renamed);
      } else if (dialog.kind === "category") {
        await api.deleteQaCategory(dialog.category);
        setFilter("");
        if (target === dialog.category) setTarget("");
      } else {
        await api.deleteQa(dialog.ids);
        if (dialog.ids.includes(selected)) onSelect("");
      }
    });
  };
  return (
    <aside className="qa-history">
      <div className="section-heading">
        <h3>提问记录</h3>
        <button onClick={() => onSelect("")}>新问题</button>
      </div>
      <div className="qa-history-tools">
        {!dialog && error && (
          <p role="alert" className="danger-text">
            {error}
          </p>
        )}
        <label>
          分类
          <select
            aria-label="筛选提问分类"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(0);
              setChecked([]);
            }}
          >
            <option value="*">全部记录（{history.length}）</option>
            <option value="">
              未分类（{history.filter((r) => !r.category).length}）
            </option>
            {categories.map((c) => (
              <option key={c} value={"cat:" + c}>
                {c}（{history.filter((r) => r.category === c).length}）
              </option>
            ))}
          </select>
        </label>
        <div className="qa-category-actions">
          <button
            disabled={busy}
            onClick={() => {
              setName("");
              setDialog({ kind: "create" });
            }}
          >
            新建分类
          </button>
          {filter !== "*" && filter !== "" && (
            <>
              <button
                disabled={busy}
                onClick={() => {
                  setName(filter.slice(4));
                  setDialog({ kind: "rename", category: filter.slice(4) });
                }}
              >
                重命名分类
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  setDialog({ kind: "category", category: filter.slice(4) })
                }
              >
                删除分类
              </button>
            </>
          )}
        </div>
        {rows.length > 0 && (
          <label className="qa-check-all">
            <input
              type="checkbox"
              aria-label="选择本页记录"
              checked={allChecked}
              disabled={busy}
              onChange={(e) =>
                setChecked(e.target.checked ? rows.map((r) => r.id) : [])
              }
            />
            全选本页 · 已选 {ids.length} 条
          </label>
        )}
        {ids.length > 0 && (
          <div className="qa-batch">
            <select
              aria-label="移动到分类"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">未分类</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <button
              disabled={busy}
              onClick={() =>
                void perform(() => api.moveQa(ids, target || null))
              }
            >
              移动所选
            </button>
            <button
              disabled={busy}
              className="danger-text"
              onClick={() => setDialog({ kind: "records", ids })}
            >
              删除所选
            </button>
          </div>
        )}
      </div>
      {!rows.length && (
        <p className="list-empty">
          {history.length
            ? "这个分类还没有提问记录。"
            : "你的问题和答案会保存在这里。"}
        </p>
      )}
      {rows.map((r) => (
        <div className="qa-history-row" key={r.id}>
          <input
            type="checkbox"
            aria-label={`选择记录 ${r.question}`}
            checked={ids.includes(r.id)}
            disabled={busy}
            onChange={(e) =>
              setChecked(
                e.target.checked
                  ? [...checked, r.id]
                  : checked.filter((id) => id !== r.id),
              )
            }
          />
          <button
            className={
              selected === r.id ? "article-item active" : "article-item"
            }
            onClick={() => onSelect(r.id)}
          >
            <strong>{r.question}</strong>
            <small>
              {r.category ?? "未分类"} · {statusText[r.status]}
            </small>
            <small>{new Date(r.createdAt).toLocaleString()}</small>
          </button>
          <button
            className="qa-delete danger-text"
            aria-label={`删除记录 ${r.question}`}
            disabled={busy}
            onClick={() => setDialog({ kind: "records", ids: [r.id] })}
          >
            删除
          </button>
        </div>
      ))}
      <Pagination
        page={safePage}
        total={filtered.length}
        onChange={(p) => {
          setPage(p);
          setChecked([]);
        }}
      />
      {dialog && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              dialog.kind === "create" || dialog.kind === "rename"
                ? "编辑分类"
                : "删除确认"
            }
          >
            <h3>
              {dialog.kind === "create"
                ? "新建分类"
                : dialog.kind === "rename"
                  ? "重命名分类"
                  : dialog.kind === "category"
                    ? "删除分类"
                    : `删除 ${dialog.ids.length} 条提问记录`}
            </h3>
            {error && (
              <p role="alert" className="danger-text">
                {error}
              </p>
            )}
            {dialog.kind === "create" || dialog.kind === "rename" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  confirm();
                }}
              >
                <label>
                  分类名称
                  <input
                    autoFocus
                    value={name}
                    maxLength={60}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <div className="modal-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setDialog(null)}
                  >
                    取消
                  </button>
                  <button className="primary" disabled={busy || !name.trim()}>
                    保存分类
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p>
                  {dialog.kind === "category"
                    ? `「${dialog.category}」中的记录将移到「未分类」，问题和答案会保留。`
                    : "将永久删除所选问题和答案，正在生成的回答会停止。资料原文不受影响。"}
                </p>
                <div className="modal-actions">
                  <button
                    autoFocus
                    disabled={busy}
                    onClick={() => setDialog(null)}
                  >
                    取消
                  </button>
                  <button
                    className="danger-text"
                    disabled={busy}
                    onClick={confirm}
                  >
                    确认删除
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </aside>
  );
});
