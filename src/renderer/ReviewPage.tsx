import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { ReviewItem, ReviewSummary } from "../shared/review";
import type { InterviewTurn } from "../shared/interview";
import { api } from "./api";
import type { Run } from "./App";
import { Pagination } from "./components/Pagination";
import { InterviewFeedback } from "./InterviewReport";

export function ReviewPage({
  run,
  onPractice,
}: {
  run: Run;
  onPractice: (id: string) => void;
}) {
  const [rows, setRows] = useState<ReviewSummary[]>([]);
  const [selected, setSelected] = useState("");
  const [item, setItem] = useState<ReviewItem | null>(null);
  const [search, setSearch] = useState("");
  const deferred = useDeferredValue(search);
  const [state, setState] = useState("pending");
  const [point, setPoint] = useState("");
  const [page, setPage] = useState(0);
  const [provider, setProvider] = useState<"online" | "ollama">("online");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [attempt, setAttempt] = useState(-1);
  useEffect(() => {
    void run(async () => setRows(await api.reviewSummaries()));
  }, [run]);
  useEffect(() => {
    let active = true;
    setItem(null);
    setAttempt(-1);
    setConfirm(false);
    if (selected)
      void run(async () => {
        const value = await api.reviewItem(selected);
        if (active) {
          setItem(value);
          if (value) setProvider(value.config.provider);
        }
      });
    return () => {
      active = false;
    };
  }, [selected, run]);
  const points = useMemo(
    () => [...new Set(rows.flatMap((r) => r.knowledgePoints))].sort(),
    [rows],
  );
  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!state || r.state === state) &&
          (!point || r.knowledgePoints.includes(point)) &&
          (r.prompt + " " + r.knowledgePoints.join(" "))
            .toLowerCase()
            .includes(deferred.trim().toLowerCase()),
      ),
    [rows, state, point, deferred],
  );
  const safePage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / 50) - 1),
  );
  const act = (fn: () => Promise<void>) =>
    void run(async () => {
      setBusy(true);
      try {
        await fn();
      } finally {
        setBusy(false);
      }
    });
  const latest =
    item?.attempts[attempt < 0 ? item.attempts.length - 1 : attempt];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">REVISIT & GROW</div>
          <h2>复习</h2>
          <p>从面试报告加入题目，再答一次，看清回答有哪些变化。</p>
        </div>
      </div>
      <div className="review-filters">
        <label>
          搜索复习题
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="题目或知识点"
          />
        </label>
        <label>
          掌握状态
          <select
            aria-label="掌握状态"
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              setPage(0);
            }}
          >
            <option value="pending">待复习</option>
            <option value="mastered">已掌握</option>
            <option value="">全部</option>
          </select>
        </label>
        <label>
          知识点
          <select
            aria-label="知识点"
            value={point}
            onChange={(e) => {
              setPoint(e.target.value);
              setPage(0);
            }}
          >
            <option value="">全部知识点</option>
            {points.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="interview-grid">
        <aside className="source-card">
          <h3>复习题目 · {filtered.length}</h3>
          {!rows.length ? (
            <p>完成或结束一场面试后，点击报告中的“加入复习”。</p>
          ) : (
            !filtered.length && <p>没有符合条件的题目。</p>
          )}
          {filtered.slice(safePage * 50, (safePage + 1) * 50).map((r) => (
            <button
              key={r.id}
              className={
                "article-item session-item" +
                (selected === r.id ? " active" : "")
              }
              onClick={() => setSelected(r.id)}
            >
              <strong>{r.prompt}</strong>
              <small>{r.knowledgePoints.join(" · ")}</small>
              <small>
                {r.state === "pending" ? "待复习" : "已掌握"} · 已练{" "}
                {r.attempts} 次
              </small>
            </button>
          ))}
          <Pagination
            page={safePage}
            total={filtered.length}
            onChange={setPage}
          />
        </aside>
        <section>
          {!item ? (
            <p>
              {selected
                ? "正在读取复习记录…"
                : "选择一道题，查看原回答或开始练习。"}
            </p>
          ) : (
            <>
              <div className="source-card">
                <h3>{item.baseline.question.prompt}</h3>
                <p>{item.baseline.question.knowledgePoints.join(" · ")}</p>
                <div className="card-actions">
                  <label>
                    复习模型
                    <select
                      aria-label="复习模型"
                      value={provider}
                      onChange={(e) =>
                        setProvider(e.target.value as typeof provider)
                      }
                    >
                      <option value="online">在线模型</option>
                      <option value="ollama">本地 Ollama</option>
                    </select>
                  </label>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      act(async () =>
                        onPractice(await api.practiceReview(item.id, provider)),
                      )
                    }
                  >
                    再练一次
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        const next =
                          item.state === "pending" ? "mastered" : "pending";
                        await api.setReviewState(item.id, next);
                        setItem({ ...item, state: next });
                        setRows(await api.reviewSummaries());
                      })
                    }
                  >
                    {item.state === "pending" ? "标记已掌握" : "标记待复习"}
                  </button>
                  <button disabled={busy} onClick={() => setConfirm(true)}>
                    移出复习
                  </button>
                </div>
                <p className="info-note">
                  掌握状态由你决定。重练保留原题及当时的简历/JD；回答提交后才会调用所选模型评分。
                </p>
              </div>
              <h3>回答对比</h3>
              {item.attempts.length > 0 && (
                <label>
                  对比练习
                  <select
                    aria-label="对比练习"
                    value={attempt}
                    onChange={(e) => setAttempt(Number(e.target.value))}
                  >
                    <option value={-1}>最近一次</option>
                    {item.attempts.map((a, i) => (
                      <option key={a.sessionId} value={i}>
                        第 {i + 1} 次 ·{" "}
                        {new Date(
                          a.turn.gradedAt ?? item.updatedAt,
                        ).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p>
                结合回答内容、遗漏与建议判断进步；模型或评分波动可能影响分数。
              </p>
              <div className="review-comparison">
                <ReviewAnswer title="最初回答" turn={item.baseline} run={run} />
                {latest ? (
                  <ReviewAnswer title="重练回答" turn={latest.turn} run={run} />
                ) : (
                  <div className="source-card">
                    <h4>重练回答</h4>
                    <p>完成一次重练后，在这里对照两次回答和反馈。</p>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
      {confirm && item && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="移出复习"
          >
            <h3>移出这道复习题？</h3>
            <p>将删除这里保存的原回答和练习对比，面试历史仍会保留。</p>
            <div className="modal-actions">
              <button disabled={busy} onClick={() => setConfirm(false)}>
                取消
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await api.deleteReview(item.id);
                    setSelected("");
                    setItem(null);
                    setConfirm(false);
                    setRows(await api.reviewSummaries());
                  })
                }
              >
                确认移出
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
function ReviewAnswer({
  title,
  turn,
  run,
}: {
  title: string;
  turn: InterviewTurn;
  run: Run;
}) {
  return (
    <article className="source-card">
      <h4>{title}</h4>
      <p className="pre-wrap">
        {turn.answer ?? (turn.draft ? "未提交草稿：" + turn.draft : "未作答")}
      </p>
      <InterviewFeedback turn={turn} run={run} />
    </article>
  );
}
