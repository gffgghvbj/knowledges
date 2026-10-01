import type { SessionSummary } from "../shared/lists";
import { Pagination } from "./components/Pagination";
import { InterviewAnswer } from "./components/InterviewAnswer";
import { useEffect, useRef, useState } from "react";
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
  const [sessions, setSessions] = useState<SessionSummary[]>([]),
    [selected, setSelected] = useState(""),
    [current, setCurrent] = useState<InterviewSessionView | null>(null),
    [page, setPage] = useState(0),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<"finish" | "delete" | null>(null);
  const drafts = useRef(new Map<string, string>());
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const refresh = async () => {
    setSessions(await api.interviewSessionSummaries());
    const id = selectedRef.current;
    if (id) {
      const detail = await api.interviewSession(id);
      if (selectedRef.current === id) setCurrent(detail);
    }
  };
  useEffect(() => {
    void run(refresh);
  }, []);
  const working = sessions.some((s) =>
    ["preparing", "grading"].includes(s.status),
  );
  useEffect(() => {
    if (!working) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const rows = await api.interviewSessionSummaries();
        if (!active) return;
        const id = selectedRef.current;
        const previous = sessions.find((s) => s.id === id);
        if (
          id &&
          previous &&
          ["preparing", "grading"].includes(previous.status)
        ) {
          const detail = await api.interviewSession(id);
          if (active && selectedRef.current === id) setCurrent(detail);
        }
        if (active) setSessions(rows);
      } finally {
        if (active) timer = setTimeout(() => void poll().catch(() => {}), 1000);
      }
    };
    timer = setTimeout(() => void poll().catch(() => {}), 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [working, selected, current?.status]);
  useEffect(() => {
    let active = true;
    if (!selected) {
      setCurrent(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void run(async () => {
      try {
        const detail = await api.interviewSession(selected);
        if (active) setCurrent(detail);
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [selected]);
  const safePage = Math.min(
    page,
    Math.max(0, Math.ceil(sessions.length / 50) - 1),
  );
  const turn = current?.turns.at(-1),
    index = (current?.turns.length ?? 0) - 1;
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
          {sessions.slice(safePage * 50, (safePage + 1) * 50).map((s) => (
            <button
              key={s.id}
              className={
                "article-item session-item" +
                (s.id === selected ? " active" : "")
              }
              onClick={() => setSelected(s.id)}
            >
              <strong>{s.title}</strong>
              <small>
                {states[s.status]} · {s.answered}/{s.questionCount} 题
              </small>
              <small>{new Date(s.createdAt).toLocaleString()}</small>
            </button>
          ))}
          <Pagination
            page={safePage}
            total={sessions.length}
            onChange={setPage}
          />
        </aside>
        <div>
          {loading ? (
            <p role="status">正在读取面试…</p>
          ) : !current ? (
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
                    <InterviewAnswer
                      key={`${current.id}:${index}`}
                      id={current.id}
                      index={index}
                      initial={turn?.draft ?? ""}
                      cache={drafts.current}
                      busy={busy}
                      submit={(text) =>
                        act(() =>
                          api.submitInterviewAnswer(current.id, index, text),
                        )
                      }
                    />
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
