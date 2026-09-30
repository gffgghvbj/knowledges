import { useEffect, useState } from "react";
import type { LibraryState, LibraryApi } from "../shared/contracts";
import type { QaRecord, Evidence } from "../shared/knowledge";
import type { Run } from "./App";
import { api } from "./api";
import { Reader } from "./components/Reader";
const statusText = {
  pending: "正在检索与生成…",
  complete: "已完成",
  failed: "生成失败",
  cancelled: "已取消",
};
export function KnowledgePage({
  state,
  run,
  onSettings,
}: {
  state: LibraryState;
  run: Run;
  onSettings: () => void;
}) {
  const [history, setHistory] = useState<QaRecord[]>([]),
    [selected, setSelected] = useState(""),
    [question, setQuestion] = useState(""),
    [source, setSource] = useState(""),
    [section, setSection] = useState(""),
    [topic, setTopic] = useState(""),
    [provider, setProvider] = useState<"online" | "ollama">("online"),
    [supplement, setSupplement] = useState(false),
    [sending, setSending] = useState(false),
    [citation, setCitation] = useState<Evidence | null>(null),
    [original, setOriginal] = useState<Awaited<
      ReturnType<LibraryApi["read"]>
    > | null>(null);
  useEffect(() => {
    let mounted = true;
    const refresh = () =>
      api.qaHistory().then((rows) => {
        if (mounted) setHistory(rows);
      });
    void run(refresh);
    const timer = setInterval(() => void refresh().catch(() => {}), 1200);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);
  const current = history.find((r) => r.id === selected);
  const sections = [
    ...new Set(
      state.articles
        .filter((a) => !source || a.sourceId === source)
        .flatMap((a) => a.sectionPath),
    ),
  ];
  const ask = (old?: QaRecord) =>
    run(async () => {
      setSending(true);
      try {
        const id = await api.ask(
          old?.question ?? question,
          {
            ...(old?.scope ?? {
              sourceId: source || undefined,
              section: section || undefined,
              topic: topic.trim() || undefined,
            }),
          },
          provider,
          old?.allowSupplement ?? supplement,
        );
        setSelected(id);
        setHistory(await api.qaHistory());
        if (!old) setQuestion("");
      } finally {
        setSending(false);
      }
    });
  const openCitation = (e: Evidence) =>
    run(async () => {
      const value = await api.read(e.articleId, e.versionId);
      setOriginal(value);
      setCitation(e);
    });
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ASK YOUR KNOWLEDGE</div>
          <h2>知识库问答</h2>
          <p>从你的资料中找答案，让每一次理解都有出处。</p>
          <small>
            关键词索引已就绪 ·{" "}
            {state.knowledgeIndex?.articles ?? state.articles.length} 篇文章 ·{" "}
            {state.knowledgeIndex?.chunks ?? 0} 个段落
            {state.vectorIndex?.state !== "disabled" && state.vectorIndex
              ? ` · 向量 ${state.vectorIndex.ready}/${state.vectorIndex.total} 段`
              : " · 向量检索未启用"}
          </small>
        </div>
        <button onClick={onSettings}>模型设置 ↗</button>
      </div>
      <div className="qa-layout">
        <aside className="qa-history">
          <div className="section-heading">
            <h3>提问记录</h3>
            <button onClick={() => setSelected("")}>新问题</button>
          </div>
          {!history.length && (
            <p className="list-empty">你的问题和答案会保存在这里。</p>
          )}
          {history.map((r) => (
            <button
              key={r.id}
              className={
                selected === r.id ? "article-item active" : "article-item"
              }
              onClick={() => setSelected(r.id)}
            >
              <strong>{r.question}</strong>
              <small>
                {new Date(r.createdAt).toLocaleString()} ·{" "}
                {statusText[r.status]}
              </small>
            </button>
          ))}
        </aside>
        <section className="qa-main">
          {current ? (
            <div className="qa-answer">
              <div className="qa-question">
                <small>
                  你的问题 ·{" "}
                  {current.provider === "online" ? "在线模型" : "Ollama"} /{" "}
                  {current.model}
                </small>
                <h3>{current.question}</h3>
                <small>
                  范围：
                  {state.sources.find((s) => s.id === current.scope.sourceId)
                    ?.label ?? "全部网站"}
                  {current.scope.section ? ` / ${current.scope.section}` : ""}
                  {current.scope.topic ? ` / 主题：${current.scope.topic}` : ""}
                </small>
              </div>
              {current.retrieval && (
                <div className="retrieval-trace">
                  <small>
                    本次使用：
                    {
                      {
                        keyword: "关键词检索",
                        "keyword-rerank": "关键词检索 + 精排",
                        hybrid: "关键词 + 向量混合检索",
                        "hybrid-rerank": "混合检索 + 精排",
                      }[current.retrieval.mode]
                    }
                    {current.retrieval.embeddingModel
                      ? ` · ${current.retrieval.embeddingModel}`
                      : ""}
                    {current.retrieval.rerankModel
                      ? ` · ${current.retrieval.rerankModel}`
                      : ""}
                  </small>
                  {current.retrieval.warning && (
                    <p>{current.retrieval.warning}</p>
                  )}
                </div>
              )}
              {current.status === "pending" ? (
                <div className="info-note">
                  <b aria-live="polite">正在检索与生成回答…</b>
                  <p>
                    已找到 {current.evidence.length}{" "}
                    个相关段落。可以切换页面，完成后记录会自动保存。
                  </p>
                  <button onClick={() => run(() => api.cancelQa(current.id))}>
                    取消生成
                  </button>
                </div>
              ) : (
                <>
                  {current.error && (
                    <div className="error-banner">{current.error}</div>
                  )}
                  {current.answer && (
                    <>
                      <h3 className="answer-label">来自资料的回答</h3>
                      {current.answer.insufficient && (
                        <div className="insufficient">
                          当前资料不足以完整回答这个问题。可以扩大范围、换用资料中的关键词，或补充采集资料。
                        </div>
                      )}
                      {current.answer.paragraphs.map((p, i) => (
                        <div key={i} className="answer-paragraph">
                          <p>{p.text}</p>
                          <div className="citation-links">
                            {[...new Set(p.sources)].map((id) => {
                              const e = current.evidence.find(
                                (e) => e.id === id,
                              );
                              return e ? (
                                <button
                                  key={id}
                                  onClick={() => openCitation(e)}
                                >
                                  ↗ {e.title} · 第 {e.lineStart}–{e.lineEnd} 行
                                </button>
                              ) : null;
                            })}
                          </div>
                        </div>
                      ))}
                      {current.answer.supplement && (
                        <div className="model-supplement">
                          <h3>模型补充 · 未经本地资料佐证</h3>
                          <p>{current.answer.supplement}</p>
                        </div>
                      )}
                    </>
                  )}
                  <div className="card-actions">
                    <button disabled={sending} onClick={() => ask(current)}>
                      使用当前所选模型重试
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="qa-welcome">
              <span>✧</span>
              <h3>把收藏的资料，变成自己的理解</h3>
              <p>例如：Redis 的 AOF 和 RDB 有什么区别？</p>
              <small>检索当前文章版本；引用和历史答案保留当时的原文。</small>
            </div>
          )}
          <form
            className="qa-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void ask();
            }}
          >
            <div className="qa-filters">
              <select
                aria-label="问答网站范围"
                value={source}
                onChange={(e) => {
                  setSource(e.target.value);
                  setSection("");
                }}
              >
                <option value="">全部网站</option>
                {state.sources.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="问答栏目范围"
                value={section}
                onChange={(e) => setSection(e.target.value)}
              >
                <option value="">全部栏目</option>
                {sections.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <input
                aria-label="主题关键词"
                placeholder="主题关键词（可选）"
                value={topic}
                maxLength={200}
                onChange={(e) => setTopic(e.target.value)}
              />
            </div>
            <label className="sr-only" htmlFor="qa-question">
              输入问题
            </label>
            <textarea
              id="qa-question"
              placeholder="向你的资料库提问…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={4000}
              rows={3}
            />
            <div className="qa-controls">
              <select
                aria-label="问答模型"
                value={provider}
                onChange={(e) => setProvider(e.target.value as typeof provider)}
              >
                <option value="online">DeepSeek / 在线模型</option>
                <option value="ollama">Ollama 本地模型</option>
              </select>
              <label>
                <input
                  type="checkbox"
                  checked={supplement}
                  onChange={(e) => setSupplement(e.target.checked)}
                />
                允许模型补充
              </label>
              <button
                className="primary"
                type="submit"
                disabled={sending || !question.trim()}
              >
                发送问题 ↑
              </button>
            </div>
            <small>
              {provider === "online"
                ? "发送时会把问题及相关段落交给所配置的在线服务。"
                : "请求发送至设置中的 Ollama 服务。"}
              每次提问独立检索；重试保留原记录。
            </small>
          </form>
        </section>
      </div>
      {citation && original && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="引用原文"
            className="citation-modal"
          >
            <div className="section-heading">
              <div>
                <h3>{citation.title}</h3>
                <small>
                  引用版本 {citation.versionId.slice(0, 12)} · 第{" "}
                  {citation.lineStart}–{citation.lineEnd} 行
                </small>
              </div>
              <button
                onClick={() => {
                  setCitation(null);
                  setOriginal(null);
                }}
              >
                关闭引用
              </button>
            </div>
            <pre className="citation-quote">{citation.quote}</pre>
            <details>
              <summary>查看这个版本的完整文章</summary>
              <Reader value={original} run={run} />
            </details>
          </section>
        </div>
      )}
    </>
  );
}
