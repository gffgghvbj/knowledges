import { useEffect, useState } from "react";
import { api } from "./api";
import type { Run } from "./App";
import type { LibraryState } from "../shared/contracts";
import type { InterviewQuestion, QuestionInput } from "../shared/interview";
const blank: QuestionInput = {
  prompt: "",
  referenceAnswer: "",
  knowledgePoints: [],
  difficulty: "medium",
  kind: "technical",
};
export function QuestionBankPage({
  state,
  run,
}: {
  state: LibraryState;
  run: Run;
}) {
  const [items, setItems] = useState<InterviewQuestion[]>([]),
    [form, setForm] = useState<QuestionInput>(blank),
    [points, setPoints] = useState(""),
    [filter, setFilter] = useState(""),
    [difficulty, setDifficulty] = useState(""),
    [kind, setKind] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [candidates, setCandidates] = useState<InterviewQuestion[]>([]),
    [accepted, setAccepted] = useState<string[]>([]),
    [count, setCount] = useState(3),
    [provider, setProvider] = useState<"online" | "ollama">("online"),
    [busy, setBusy] = useState(false),
    [deleting, setDeleting] = useState(false),
    [message, setMessage] = useState("");
  const refresh = async () => setItems(await api.interviewQuestions());
  useEffect(() => {
    void run(refresh);
  }, []);
  const act = (fn: () => Promise<void>) =>
    run(async () => {
      setBusy(true);
      setMessage("");
      try {
        await fn();
      } finally {
        setBusy(false);
      }
    });
  const rows = items.filter(
    (q) =>
      (!filter ||
        q.knowledgePoints
          .join(" ")
          .toLowerCase()
          .includes(filter.toLowerCase())) &&
      (!difficulty || q.difficulty === difficulty) &&
      (!kind || q.kind === kind),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">BUILD YOUR PRACTICE</div>
          <h2>题库</h2>
          <p>整理值得反复练习的问题，保留答案的来源。</p>
        </div>
        <button
          disabled={busy}
          onClick={() => {
            setForm(blank);
            setPoints("");
          }}
        >
          新建题目
        </button>
      </div>
      <div className="interview-grid">
        <aside className="source-card">
          <input
            aria-label="筛选知识点"
            placeholder="筛选知识点"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <select
            aria-label="筛选难度"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
          >
            <option value="">全部难度</option>
            <option value="easy">基础</option>
            <option value="medium">进阶</option>
            <option value="hard">挑战</option>
          </select>
          <select
            aria-label="筛选类型"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">全部类型</option>
            <option value="technical">技术题</option>
            <option value="project">项目题</option>
          </select>
          <p>{rows.length} 道题</p>
          {rows.map((q) => (
            <button
              key={q.id}
              className="article-item bank-item"
              onClick={() => {
                setForm(q);
                setPoints(q.knowledgePoints.join(", "));
              }}
            >
              <strong>{q.prompt}</strong>
              <small>
                {q.knowledgePoints.join(" · ")} ·{" "}
                {q.origin === "manual" ? "手工录入" : "AI 整理"}
              </small>
            </button>
          ))}
        </aside>
        <form
          className="source-card interview-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api.saveInterviewQuestion({
                ...form,
                knowledgePoints: points
                  .split(/[,，]/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              });
              await refresh();
              setForm(blank);
              setPoints("");
              setMessage("题目已保存");
            });
          }}
        >
          <label>
            题目内容
            <textarea
              aria-label="题目内容"
              rows={3}
              maxLength={4000}
              required
              value={form.prompt}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            />
          </label>
          <label>
            参考答案
            <textarea
              aria-label="参考答案"
              rows={6}
              maxLength={10000}
              required
              value={form.referenceAnswer}
              onChange={(e) =>
                setForm({ ...form, referenceAnswer: e.target.value })
              }
            />
          </label>
          <label>
            知识点
            <input
              aria-label="知识点"
              placeholder="例如 Redis, 持久化"
              required
              value={points}
              onChange={(e) => setPoints(e.target.value)}
            />
          </label>
          <div className="form-pair">
            <label>
              难度
              <select
                value={form.difficulty}
                onChange={(e) =>
                  setForm({
                    ...form,
                    difficulty: e.target.value as QuestionInput["difficulty"],
                  })
                }
              >
                <option value="easy">基础</option>
                <option value="medium">进阶</option>
                <option value="hard">挑战</option>
              </select>
            </label>
            <label>
              类型
              <select
                value={form.kind}
                onChange={(e) =>
                  setForm({
                    ...form,
                    kind: e.target.value as QuestionInput["kind"],
                  })
                }
              >
                <option value="technical">技术题</option>
                <option value="project">项目题</option>
              </select>
            </label>
          </div>
          {form.id &&
            items
              .find((q) => q.id === form.id)
              ?.evidence.map((e) => (
                <small key={e.id}>
                  依据：{e.title} · 第 {e.lineStart}–{e.lineEnd} 行{" "}
                  <button
                    type="button"
                    onClick={() =>
                      void run(() => api.openArticle(e.articleId, e.versionId))
                    }
                  >
                    打开引用版本
                  </button>
                </small>
              ))}
          <small>手工编辑后的答案会标为手工录入，不代表已经过原文验证。</small>
          <div className="card-actions">
            <button className="primary" disabled={busy}>
              保存题目
            </button>
            {form.id && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setDeleting(true)}
              >
                删除题目
              </button>
            )}
          </div>
          {message && <p role="status">{message}</p>}
        </form>
      </div>
      <section className="source-card question-generator">
        <h3>从资料整理候选题</h3>
        <p>
          选择最多 10 篇文章，每次生成 1–5
          题；核对后勾选入库。在线模型会接收选定文章的相关片段。
        </p>
        <div className="article-picker">
          {state.articles.map((a) => (
            <label key={a.id}>
              <input
                type="checkbox"
                checked={selected.includes(a.id)}
                disabled={
                  busy || (!selected.includes(a.id) && selected.length >= 10)
                }
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, a.id]
                      : selected.filter((id) => id !== a.id),
                  )
                }
              />
              {a.title}
            </label>
          ))}
        </div>
        <div className="card-actions">
          <select
            aria-label="题库生成模型"
            value={provider}
            onChange={(e) => setProvider(e.target.value as typeof provider)}
          >
            <option value="online">在线模型</option>
            <option value="ollama">Ollama</option>
          </select>
          <input
            aria-label="候选题数量"
            type="number"
            min={1}
            max={5}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
          <button
            disabled={busy || !selected.length}
            onClick={() =>
              void act(async () => {
                const rows = await api.proposeInterviewQuestions(
                  selected,
                  count,
                  provider,
                );
                setCandidates(rows);
                setAccepted([]);
              })
            }
          >
            {busy ? "正在整理…" : "生成候选题"}
          </button>
        </div>
        {candidates.map((q) => (
          <div className="candidate-card" key={q.id}>
            <label>
              <input
                type="checkbox"
                checked={accepted.includes(q.id)}
                onChange={(e) =>
                  setAccepted(
                    e.target.checked
                      ? [...accepted, q.id]
                      : accepted.filter((id) => id !== q.id),
                  )
                }
              />
              <b>{q.prompt}</b>
            </label>
            <p>{q.referenceAnswer}</p>
            <small>
              AI 整理 · {q.supplement ? "包含模型补充" : "依据本地资料"} ·{" "}
              {q.evidence.map((e) => e.title).join("、")}
            </small>
          </div>
        ))}
        {candidates.length > 0 && (
          <div className="card-actions">
            <button
              className="primary"
              disabled={busy || !accepted.length}
              onClick={() =>
                void act(async () => {
                  await api.acceptInterviewQuestions(accepted);
                  await refresh();
                  setCandidates([]);
                  setAccepted([]);
                  setMessage("所选候选题已入库");
                })
              }
            >
              保存所选候选题
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setCandidates([]);
                setAccepted([]);
              }}
            >
              放弃候选
            </button>
          </div>
        )}
      </section>
      {deleting && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true">
            <h3>删除题目？</h3>
            <p>历史面试中的题目快照会保留。</p>
            <div className="modal-actions">
              <button onClick={() => setDeleting(false)}>取消</button>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await api.deleteInterviewQuestion(form.id!);
                    await refresh();
                    setForm(blank);
                    setPoints("");
                    setDeleting(false);
                  })
                }
              >
                确认删除
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
