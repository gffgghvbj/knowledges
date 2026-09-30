import { useEffect, useState } from "react";
import type { InterviewSessionView } from "../shared/interview";
import { api } from "./api";
import type { Run } from "./App";
import { InterviewSetup } from "./InterviewSetup";
import { InterviewFeedback, InterviewReport } from "./InterviewReport";
const states = {
  preparing: "正在出题",
  "awaiting-answer": "等待作答",
  grading: "正在评分",
  "awaiting-next": "等待下一题",
  completed: "已完成",
  failed: "需要重试",
  aborted: "已结束",
};
export function InterviewPage({ run }: { run: Run }) {
  const [sessions, setSessions] = useState<InterviewSessionView[]>([]),
    [selected, setSelected] = useState(""),
    [draft, setDraft] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState<"finish" | "delete" | null>(null);
  const refresh = async () => setSessions(await api.interviewSessions());
  useEffect(() => {
    let active = true;
    const load = async () => {
      const rows = await api.interviewSessions();
      if (active) setSessions(rows);
    };
    void run(load);
    const timer = setInterval(() => void load().catch(() => {}), 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const current = sessions.find((s) => s.id === selected),
    turn = current?.turns.at(-1),
    index = (current?.turns.length ?? 0) - 1;
  useEffect(() => {
    setDraft(turn?.draft ?? "");
    setError("");
  }, [selected, index]);
  const act = (fn: () => Promise<void>) =>
    run(async () => {
      setBusy(true);
      try {
        await fn();
        await refresh();
      } finally {
        setBusy(false);
      }
    });
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PRACTICE WITH PURPOSE</div>
          <h2>模拟面试</h2>
          <p>认真回答每一道题，把反馈变成下一次的进步。</p>
        </div>
        <button disabled={busy} onClick={() => setSelected("")}>
          新建面试
        </button>
      </div>
      <div className="interview-grid">
        <aside className="source-card">
          <h3>面试记录</h3>
          {!sessions.length && <p>完成的面试和进行中的进度会保存在这里。</p>}
          {sessions.map((s) => (
            <button
              key={s.id}
              className={
                "article-item session-item" +
                (s.id === selected ? " active" : "")
              }
              onClick={() => setSelected(s.id)}
            >
              <strong>
                {s.config.scope === "job"
                  ? (s.jd?.name ?? "岗位面试")
                  : s.config.topic || "专题练习"}
              </strong>
              <small>
                {states[s.status]} · {s.turns.filter((t) => t.answer).length}/
                {s.config.questionCount} 题
              </small>
              <small>{new Date(s.createdAt).toLocaleString()}</small>
            </button>
          ))}
        </aside>
        <div>
          {!current ? (
            <InterviewSetup
              run={run}
              onCreated={async (id) => {
                await refresh();
                setSelected(id);
              }}
            />
          ) : (
            <>
              <div className="interview-session-meta">
                <span>
                  {current.config.feedback === "formal"
                    ? "正式模拟"
                    : "逐题练习"}{" "}
                  · {current.config.mode === "ai" ? "AI 延伸" : "题库抽题"} ·{" "}
                  {states[current.status]}
                </span>
                <div className="card-actions">
                  {!["completed", "aborted"].includes(current.status) && (
                    <button
                      disabled={busy}
                      onClick={() => setConfirm("finish")}
                    >
                      提前结束
                    </button>
                  )}
                  <button disabled={busy} onClick={() => setConfirm("delete")}>
                    删除场次
                  </button>
                </div>
              </div>
              {["completed", "aborted"].includes(current.status) ? (
                <InterviewReport session={current} run={run} />
              ) : (
                <section className="source-card interview-form">
                  <small>
                    第 {Math.max(1, current.turns.length)} /{" "}
                    {current.config.questionCount} 题{" "}
                    {turn?.isFollowup ? "· 追问" : ""}
                  </small>
                  {turn && <h3>{turn.question.prompt}</h3>}
                  {current.status === "preparing" && (
                    <p role="status">正在结合资料准备下一道题…</p>
                  )}
                  {current.status === "awaiting-answer" && (
                    <>
                      <label>
                        本题回答
                        <textarea
                          aria-label="本题回答"
                          value={draft}
                          rows={10}
                          maxLength={12000}
                          placeholder="用自己的语言说明思路、依据和取舍…"
                          onChange={(e) => {
                            const value = e.target.value;
                            setDraft(value);
                            void api
                              .saveInterviewDraft(current.id, index, value)
                              .catch(() => setError("草稿保存失败，请重试"));
                          }}
                        />
                      </label>
                      <small>
                        {draft.length} / 12000 字符 · 草稿自动保存在本机
                      </small>
                      {error && <p role="alert">{error}</p>}
                      <button
                        className="primary"
                        disabled={busy || !draft.trim()}
                        onClick={() =>
                          void act(() =>
                            api.submitInterviewAnswer(current.id, index, draft),
                          )
                        }
                      >
                        提交回答
                      </button>
                    </>
                  )}
                  {turn?.answer && current.status !== "awaiting-answer" && (
                    <>
                      <h4>已提交的回答</h4>
                      <p className="pre-wrap">{turn.answer}</p>
                    </>
                  )}
                  {current.status === "grading" && (
                    <p role="status">回答已保存，正在生成反馈…</p>
                  )}
                  {current.status === "failed" && (
                    <div className="info-note">
                      <p>{current.error}</p>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act(() => api.retryInterview(current.id))
                        }
                      >
                        重试失败步骤
                      </button>
                    </div>
                  )}
                  {current.status === "awaiting-next" && (
                    <>
                      {current.config.feedback === "practice" && turn ? (
                        <InterviewFeedback turn={turn} run={run} />
                      ) : (
                        <p className="info-note">
                          本题回答已保存。正式模拟将在结束后统一展示评分与解析。
                        </p>
                      )}
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                          void act(() => api.nextInterview(current.id))
                        }
                      >
                        下一题
                      </button>
                    </>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>
      {confirm && current && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true">
            <h3>
              {confirm === "delete" ? "删除这场面试？" : "提前结束这场面试？"}
            </h3>
            <p>
              {confirm === "delete"
                ? "将删除本场问题、回答与报告，正在处理的请求会停止。"
                : "当前处理将停止，展示已有反馈。尚未评分的回答不计入平均分，结束后不能继续本场面试。"}
            </p>
            <div className="modal-actions">
              <button disabled={busy} onClick={() => setConfirm(null)}>
                取消
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    if (confirm === "delete") {
                      await api.deleteInterview(current.id);
                      setSelected("");
                    } else await api.finishInterview(current.id);
                    setConfirm(null);
                  })
                }
              >
                确认{confirm === "delete" ? "删除" : "结束"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
