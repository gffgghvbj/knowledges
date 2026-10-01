import { useEffect, useState } from "react";
import type { InterviewSessionView, InterviewTurn } from "../shared/interview";
import type { Evidence } from "../shared/knowledge";
import type { LibraryApi } from "../shared/contracts";
import type { Run } from "./App";
import { api } from "./api";
import { Reader } from "./components/Reader";
export function InterviewFeedback({
  turn,
  run,
}: {
  turn: InterviewSessionView["turns"][number];
  run: Run;
}) {
  const [original, setOriginal] = useState<Awaited<
      ReturnType<LibraryApi["read"]>
    > | null>(null),
    [citation, setCitation] = useState<Evidence | null>(null);
  const grade = turn.grade;
  if (!grade) return <p>本题尚未完成评分。</p>;
  return (
    <div className="interview-feedback">
      <div className="score-heading">
        <b>
          {grade.total}
          <small> / 100</small>
        </b>
        <span>本题得分 · {turn.gradeModel}</span>
      </div>
      {grade.dimensions.map((d) => (
        <div className="score-dimension" key={d.name}>
          <strong>
            {d.name} · {d.score}
          </strong>
          <p>{d.reason}</p>
        </div>
      ))}
      {grade.omissions.length > 0 && (
        <>
          <h4>遗漏与改进点</h4>
          <ul>
            {grade.omissions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </>
      )}
      {grade.suggestions.length > 0 && (
        <>
          <h4>复习建议</h4>
          <ul>
            {grade.suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </>
      )}
      <h4>解析与参考</h4>
      <p className="pre-wrap">{grade.referenceAnswer}</p>
      {grade.uncertainty && (
        <p className="info-note">依据说明：{grade.uncertainty}</p>
      )}
      {turn.question.supplement && (
        <small>参考内容包含模型补充或手工答案，请结合实际资料核对。</small>
      )}
      {(turn.question.evidence ?? []).map((e) => (
        <button
          key={e.id}
          onClick={() =>
            void run(async () => {
              setOriginal(await api.read(e.articleId, e.versionId));
              setCitation(e);
            })
          }
        >
          复习资料：{e.title} · 第 {e.lineStart}–{e.lineEnd} 行
        </button>
      ))}
      {original && citation && (
        <div className="modal-backdrop">
          <section
            className="citation-modal"
            role="dialog"
            aria-modal="true"
            aria-label="面试引用原文"
          >
            <div className="section-heading">
              <h3>{citation.title}</h3>
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
            <Reader value={original} run={run} />
          </section>
        </div>
      )}
    </div>
  );
}
export function InterviewReport({
  session,
  run,
}: {
  session: InterviewSessionView;
  run: Run;
}) {
  const [added, setAdded] = useState<Set<number>>(new Set());
  useEffect(() => {
    let active = true;
    void run(async () => {
      const rows = await api.reviewSummaries();
      if (active)
        setAdded(
          new Set(
            session.turns.flatMap((_, i) =>
              rows.some(
                (r) =>
                  (r.sourceSessionId === session.id && r.sourceIndex === i) ||
                  r.id === session.reviewId,
              )
                ? [i]
                : [],
            ),
          ),
        );
    });
    return () => {
      active = false;
    };
  }, [session.id, run]);
  const graded = session.turns.filter((t) => t.grade),
    answered = session.turns.filter((t) => t.answer),
    average = graded.length
      ? Math.round(
          (graded.reduce((n, t) => n + t.grade!.total, 0) / graded.length) * 10,
        ) / 10
      : null;
  const weak = [
    ...new Set(
      graded
        .filter((t) => t.grade!.total < 70)
        .flatMap((t) => t.question.knowledgePoints),
    ),
  ];
  return (
    <section className="interview-report">
      <div className="source-card">
        <div className="eyebrow">REFLECT & IMPROVE</div>
        <h3>面试复盘</h3>
        <div className="score-heading">
          <b>
            {average ?? "—"}
            <small>{average === null ? " 暂无评分" : " / 100"}</small>
          </b>
          <span>
            {session.status === "completed" ? "本场完成" : "本场提前结束"}
          </span>
        </div>
        <p>
          已答 {answered.length} / 计划 {session.config.questionCount} 题 ·
          已评分 {graded.length} 题 · 未评分 {answered.length - graded.length}{" "}
          题
        </p>
        <p>
          {weak.length
            ? "优先复习：" + weak.join("、")
            : "暂无低于 70 分的已评分知识点。"}
        </p>
        <small>
          规则 {session.rulesVersion} ·
          总分为已评分题目的平均分。评分是练习反馈，不代表真实招聘评价，也不验证个人履历真实性。
        </small>
      </div>
      {session.turns.map((turn, i) => (
        <article className="source-card report-turn" key={turn.question.id}>
          <small>
            第 {i + 1} 题{turn.isFollowup ? " · 追问" : ""} ·{" "}
            {turn.questionModel ?? "题库"}
          </small>
          <h3>{turn.question.prompt}</h3>
          <button
            disabled={added.has(i)}
            onClick={() =>
              void run(async () => {
                await api.addReview(session.id, i);
                setAdded((old) => new Set([...old, i]));
              })
            }
          >
            {added.has(i) ? "已加入复习" : "加入复习"}
          </button>
          <h4>你的回答</h4>
          <p className="pre-wrap">
            {turn.answer ??
              (turn.draft ? "未提交草稿：" + turn.draft : "未作答")}
          </p>
          <InterviewFeedback turn={turn} run={run} />
        </article>
      ))}
    </section>
  );
}
