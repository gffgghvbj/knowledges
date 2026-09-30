import type {
  InterviewSession,
  InterviewSessionView,
} from "../../shared/interview";
export function projectSession(
  session: InterviewSession,
): InterviewSessionView {
  const { bankQueue, retryStep, turns, ...rest } = session;
  const ended = ["completed", "aborted"].includes(session.status);
  return {
    ...rest,
    turns: turns.map((turn) => {
      const reveal =
        ended || (session.config.feedback === "practice" && !!turn.grade);
      if (reveal) return structuredClone(turn);
      const { question, grade, gradeModel, gradedAt, ...safe } = turn;
      const { id, prompt, knowledgePoints, difficulty, kind, origin } =
        question;
      return {
        ...safe,
        question: { id, prompt, knowledgePoints, difficulty, kind, origin },
      };
    }),
  };
}
