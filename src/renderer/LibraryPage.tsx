import { useEffect, useMemo, useState } from "react";
import type {
  LibraryState,
  Article,
  ArticleVersion,
} from "../shared/contracts";
import type { Run } from "./App";
import { api } from "./api";
import { Reader } from "./components/Reader";
export function LibraryPage({ state, run }: { state: LibraryState; run: Run }) {
  const [query, setQuery] = useState(""),
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
  useEffect(() => {
    if (composing) return;
    let alive = true;
    const timer = setTimeout(() => {
      void api
        .search(query, source || undefined, section || undefined, page)
        .then((r) => {
          if (alive) setResults(r);
        })
        .catch(() => {});
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, source, section, page, state.articles, composing]);
  const select = (id: string, version?: string) =>
    run(async () => {
      setValue(await api.read(id, version));
      setVersions(await api.versions(id));
    });
  const sections = useMemo(
    () => [
      ...new Set(
        state.articles
          .filter((a) => !source || a.sourceId === source)
          .map((a) => a.sectionPath[0])
          .filter(Boolean),
      ),
    ],
    [state.articles, source],
  );
  return (
    <>
      <div className="page-heading compact">
        <div>
          <div className="eyebrow">YOUR KNOWLEDGE, OFFLINE</div>
          <h2>资料库</h2>
          <p>读过的内容，留下来慢慢消化。</p>
        </div>
        <span className="tag">{state.articles.length} 篇本地文章</span>
      </div>
      <div className="library-toolbar">
        <input
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          placeholder="搜索标题或正文…"
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
          <div className="list-count">{results.total} 篇资料</div>
          {results.items.map((a) => (
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
          ))}
          {!results.items.length && <p className="list-empty">没有找到资料</p>}
          {results.total > 50 && (
            <div className="pagination">
              <button disabled={!page} onClick={() => setPage(page - 1)}>
                上一页
              </button>
              <span>{page + 1}</span>
              <button
                disabled={(page + 1) * 50 >= results.total}
                onClick={() => setPage(page + 1)}
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
                {value.version.id !== value.article.currentVersionId && (
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
    </>
  );
}
