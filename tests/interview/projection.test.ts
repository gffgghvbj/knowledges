import { test, expect } from "vitest";
import { projectSession } from "../../src/main/interview/projection";
import type { InterviewSession } from "../../src/shared/interview";
test("formal projections remove scores references and future questions at every unfinished state", () => {
  const question = {
    id: "id",
    prompt: "visible prompt",
    knowledgePoints: ["Redis"],
    difficulty: "medium",
    kind: "technical",
    origin: "manual",
    referenceAnswer: "HIDDEN",
    evidence: [{ quote: "HIDDEN" }],
    supplement: true,
  };
  for (const status of [
    "preparing",
    "awaiting-answer",
    "grading",
    "awaiting-next",
    "failed",
  ]) {
    const session = {
      id: "session",
      config: { feedback: "formal" },
      status,
      bankQueue: [{ ...question, prompt: "FUTURE" }],
      retryStep: "grade",
      turns: [
        {
          question,
          draft: "draft",
          answer: "answer",
          isFollowup: false,
          grade: { referenceAnswer: "HIDDEN" },
          gradeModel: "HIDDEN",
          gradedAt: "HIDDEN",
        },
      ],
    } as unknown as InterviewSession;
    const view = projectSession(session);
    expect(JSON.stringify(view)).not.toMatch(
      /HIDDEN|FUTURE|bankQueue|retryStep/,
    );
    expect(view.turns[0].answer).toBe("answer");
  }
});
