import { useEffect, useMemo, useRef, useState } from "react";
import type {
  LibraryState,
  Article,
  ArticleVersion,
} from "../shared/contracts";
import type { Run } from "./App";
import { api } from "./api";
import { Reader } from "./components/Reader";
import { ConfirmDelete } from "./components/ConfirmDelete";
export function LibraryPage({ state, run }: { state: LibraryState; run: Run }) {
  const [query, setQuery] = useState(""),
    [trash, setTrash] = useState(false),
    [trashed, setTrashed] = useState<Article[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [deleting, setDeleting] = useState<string[]>([]),
    [composing, setComposing] = useState(false),
    [source, setSource] = useState(""),
    [section, setSection] = useState(""),
    [page, setPage] = useState(0),
    [results, setResults] = useState<{ items: Article[]; total: number }>({
      items: [],
      total: 0,
    });
  const [value, setValue] = useState<Awaited<
      ReturnType<typeof api.read>
    > | null>(null),
    [versions, setVersions] = useState<ArticleVersion[]>([]);
  const selectSequence = useRef(0);
  useEffect(() => {
    setSelected([]);
  }, [query, source, section, page, trash]);
  useEffect(() => {
    let alive = true;
    if (trash)
      void run(async () => {
        const rows = await api.trashedArticles();
        if (alive) setTrashed(rows);
      });
    return () => {
      alive = false;
    };
  }, [trash, state.articles, run]);
  useEffect(() => {
    setSelected((old) =>
      old.filter((id) =>
        (trash ? trashed : state.articles).some((a) => a.id === id),
      ),
    );
  }, [state.articles, trashed, trash]);
  useEffect(() => {
    if (composing || trash) return;
    let alive = true;
    const timer = setTimeout(() => {
      void api
        .search(query, source || undefined, section || undefined, page)
        .then((r) => {
          if (alive) {
            setResults(r);
            if (page > 0 && page * 50 >= r.total)
              setPage(Math.max(0, Math.ceil(r.total / 50) - 1));
          }
        })
        .catch(() => {});
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, source, section, page, state.articles, composing, trash]);
  const select = (id: string, version?: string) => {
    const sequence = ++selectSequence.current;
    return run(async () => {
      const detail = await api.read(id, version),
        history = await api.versions(id);
      if (sequence === selectSequence.current) {
        setValue(detail);
        setVersions(history);
      }
    });
  };
  const clearReader = () => {
    ++selectSequence.current;
    setValue(null);
    setVersions([]);
  };
  const filteredTrash = useMemo(
    () =>
      trashed.filter(
        (a) =>
          (!source || a.sourceId === source) &&
          (!section || a.sectionPath[0] === section) &&
          (a.title + " " + a.sectionPath.join(" "))
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      ),
    [trashed, source, section, query],
  );
  const trashPage = Math.min(
    page,
    Math.max(0, Math.ceil(filteredTrash.length / 50) - 1),
  );
  const displayed = trash
    ? {
        items: filteredTrash.slice(trashPage * 50, (trashPage + 1) * 50),
        total: filteredTrash.length,
      }
    : results;
  const currentPage = trash ? trashPage : page;
  const restore = (ids: string[]) =>
    run(async () => {
      await api.restoreArticles(ids);
      setTrashed(await api.trashedArticles());
      setSelected([]);
      clearReader();
    });
  const sections = useMemo(
    () => [
      ...new Set(
        (trash ? trashed : state.articles)
          .filter((a) => !source || a.sourceId === source)
          .map((a) => a.sectionPath[0])
          .filter(Boolean),
      ),
    ],
    [state.articles, source, trash, trashed],
  );
  return (
    <>
      <div className="page-heading compact">
        <div>
          <div className="eyebrow">YOUR KNOWLEDGE, OFFLINE</div>
          <h2>资料库</h2>
          <p>读过的内容，留下来慢慢消化。</p>
        </div>
        <span className="tag">
          {trash ? trashed.length : state.articles.length} 篇
          {trash ? "回收站文章" : "本地文章"}
        </span>
      </div>
      <div className="card-actions library-management">
        <button
          aria-pressed={!trash}
          onClick={() => {
            setTrash(false);
            setPage(0);
            setSelected([]);
            clearReader();
          }}
        >
          全部资料
        </button>
        <button
          aria-pressed={trash}
          onClick={() => {
            setTrash(true);
            setPage(0);
            setSelected([]);
            clearReader();
          }}
        >
          回收站
        </button>
        {trash && <small>文章仍保留原文和历史引用，可随时恢复。</small>}
      </div>
      <div className="library-toolbar">
        <input
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          placeholder={trash ? "搜索回收站标题或栏目…" : "搜索标题或正文…"}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <select
          aria-label="网站筛选"
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setSection("");
            setPage(0);
          }}
        >
          <option value="">全部网站</option>
          {state.sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
              {s.deletedAt ? "（来源已移除）" : ""}
            </option>
          ))}
        </select>
        <select
          aria-label="栏目筛选"
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
      </div>
      <div className="library-split">
        <div className="article-list">
          <div className="list-count">
            {displayed.total} 篇{trash ? "已删除文章" : "资料"}
          </div>
          <div className="article-selection">
            <label>
              <input
                type="checkbox"
                aria-label="全选本页文章"
                checked={
                  displayed.items.length > 0 &&
                  displayed.items.every((a) => selected.includes(a.id))
                }
                onChange={(e) =>
                  setSelected(
                    e.target.checked ? displayed.items.map((a) => a.id) : [],
                  )
                }
              />
              全选本页
            </label>
            <button
              disabled={!selected.length}
              className={trash ? "" : "danger-button"}
              onClick={() =>
                trash ? void restore(selected) : setDeleting(selected)
              }
            >
              {trash ? "恢复所选" : "删除所选"} {selected.length || ""}
            </button>
          </div>
          {displayed.items.map((a) => (
            <div className="article-select-row" key={a.id}>
              <input
                type="checkbox"
                aria-label={`选择文章：${a.title}`}
                checked={selected.includes(a.id)}
                onChange={(e) =>
                  setSelected((old) =>
                    e.target.checked
                      ? [...old, a.id]
                      : old.filter((id) => id !== a.id),
                  )
                }
              />
              <button
                key={a.id}
                aria-label={a.title}
                className={`article-item ${value?.article.id === a.id ? "active" : ""}`}
                onClick={() => select(a.id)}
              >
                <strong>{a.title}</strong>
                <small>
                  {a.sectionPath.join(" / ") || "未分栏目"}
                  {a.sourceStatus !== "available" ? " · 源站不可用" : ""}
                </small>
              </button>
            </div>
          ))}
          {!displayed.items.length && (
            <p className="list-empty">
              {trash ? "回收站中没有符合条件的文章" : "没有找到资料"}
            </p>
          )}
          {displayed.total > 50 && (
            <div className="pagination">
              <button
                disabled={!currentPage}
                onClick={() => setPage(currentPage - 1)}
              >
                上一页
              </button>
              <span>{currentPage + 1}</span>
              <button
                disabled={(currentPage + 1) * 50 >= displayed.total}
                onClick={() => setPage(currentPage + 1)}
              >
                下一页
              </button>
            </div>
          )}
        </div>
        <div className="reader">
          {value ? (
            <>
              <div className="version-bar">
                <button
                  className={trash ? "" : "danger-button"}
                  onClick={() =>
                    trash
                      ? void restore([value.article.id])
                      : setDeleting([value.article.id])
                  }
                >
                  {trash ? "恢复文章" : "删除文章"}
                </button>
                <select
                  aria-label="文章版本"
                  value={value.version.id}
                  onChange={(e) => select(value.article.id, e.target.value)}
                >
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {new Date(v.capturedAt).toLocaleString()}
                      {v.id === value.article.currentVersionId
                        ? " · 当前版本"
                        : " · 历史版本"}
                    </option>
                  ))}
                </select>
                {!trash &&
                  value.version.id !== value.article.currentVersionId && (
                    <button
                      onClick={() =>
                        run(async () => {
                          await api.restore(value.article.id, value.version.id);
                          setValue(await api.read(value.article.id));
                        })
                      }
                    >
                      恢复此版本
                    </button>
                  )}
              </div>
              <Reader value={value} run={run} />
            </>
          ) : (
            <div className="reader-empty">
              <div>▤</div>
              <h3>选择一篇文章，开始阅读</h3>
              <p>正文、代码与图片，都在本地。</p>
            </div>
          )}
        </div>
      </div>
      {deleting.length > 0 && (
        <ConfirmDelete
          title="将文章移入回收站？"
          action="确认移入回收站"
          description={`将 ${deleting.length} 篇文章移入回收站，不再用于搜索和新的知识库检索。已有问答、面试中的历史引用仍可查看。网站更新不会自动恢复这些文章，可在回收站手动恢复。`}
          onCancel={() => setDeleting([])}
          onConfirm={() =>
            run(async () => {
              await api.trashArticles(deleting);
              setSelected([]);
              clearReader();
              setDeleting([]);
            })
          }
        />
      )}
    </>
  );
}
