import {
  gradeSchema,
  type InterviewGrade,
  type InterviewSession,
} from "../../shared/interview";
import type { Evidence } from "../../shared/knowledge";
export function dimensionsFor(kind: "technical" | "project") {
  return kind === "technical"
    ? [
        { name: "正确性", weight: 50 },
        { name: "完整性", weight: 30 },
        { name: "表达清晰度", weight: 20 },
      ]
    : [
        { name: "职责说明", weight: 25 },
        { name: "技术取舍", weight: 30 },
        { name: "解决过程", weight: 30 },
        { name: "回答一致性", weight: 15 },
      ];
}
export function validateGrade(
  grade: InterviewGrade,
  kind: "technical" | "project",
  evidence: Evidence[],
) {
  const dimensions = dimensionsFor(kind),
    ids = new Set(evidence.map((e) => e.id));
  if (
    grade.dimensions.length !== dimensions.length ||
    new Set(grade.dimensions.map((d) => d.name)).size !== dimensions.length ||
    grade.dimensions.some((d) => !dimensions.some((v) => v.name === d.name)) ||
    grade.evidenceIds.some((id) => !ids.has(id))
  )
    throw Error("评分维度或引用无效，请重试");
  const total =
    Math.round(
      dimensions.reduce(
        (n, d) =>
          n +
          (grade.dimensions.find((v) => v.name === d.name)!.score * d.weight) /
            100,
        0,
      ) * 10,
    ) / 10;
  if (grade.total !== total) throw Error("评分总分不符合量表");
  return grade;
}
export function parseGrade(
  text: string,
  kind: "technical" | "project",
  evidence: Evidence[],
): InterviewGrade {
  let parsed: InterviewGrade;
  try {
    parsed = gradeSchema.parse({ ...JSON.parse(text), total: 0 });
  } catch {
    throw Error("评分格式无效，请重试或更换模型");
  }
  const dimensions = dimensionsFor(kind);
  parsed.total =
    Math.round(
      dimensions.reduce(
        (n, d) =>
          n +
          ((parsed.dimensions.find((v) => v.name === d.name)?.score ?? 0) *
            d.weight) /
            100,
        0,
      ) * 10,
    ) / 10;
  return validateGrade(parsed, kind, evidence);
}
export function validateSession(session: InterviewSession) {
  const turns = session.turns;
  if (
    turns.length > session.config.questionCount ||
    new Set(turns.map((t) => t.question.prompt.trim().toLowerCase())).size !==
      turns.length
  )
    throw Error("面试题量或题目重复");
  if (
    session.config.scope === "job" &&
    (!session.resume ||
      session.resume.kind !== "resume" ||
      !session.jd ||
      session.jd.kind !== "jd")
  )
    throw Error("岗位面试缺少有效资料快照");
  for (const [i, t] of turns.entries()) {
    if (t.grade) {
      if (!t.answer) throw Error("评分缺少对应回答");
      validateGrade(t.grade, t.question.kind, t.question.evidence);
    }
    if (i < turns.length - 1 && !t.grade) throw Error("历史题目缺少评分");
  }
  if (
    session.status === "completed" &&
    (turns.length !== session.config.questionCount ||
      turns.some((t) => !t.grade))
  )
    throw Error("完成面试缺少评分");
  if (
    ["awaiting-answer", "grading", "awaiting-next"].includes(session.status) &&
    !turns.length
  )
    throw Error("面试缺少当前题目");
  if (session.status === "awaiting-next" && !turns.at(-1)?.grade)
    throw Error("当前题目尚未完成评分");
  if (session.status === "grading" && !turns.at(-1)?.answer)
    throw Error("评分缺少已提交回答");
}
