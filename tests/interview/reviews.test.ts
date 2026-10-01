import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LibraryRepository } from "../../src/main/library/repository";
import { InterviewRepository } from "../../src/main/interview/repository";
import { ReviewRepository } from "../../src/main/interview/reviews";
import { InterviewService } from "../../src/main/interview/service";
import { ModelSettings } from "../../src/main/knowledge/settings";
import { dimensionsFor } from "../../src/main/interview/scoring";
import { exportLibrary } from "../../src/main/backup/export";
import { importBackup } from "../../src/main/backup/merge";
import type { InterviewSession } from "../../src/shared/interview";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "review-"));
  const lib = new LibraryRepository(join(root, "a"));
  const repo = new InterviewRepository(lib.db),
    reviews = new ReviewRepository(lib.db);
  const question = repo.saveQuestion({
    prompt: "Explain your Redis project",
    referenceAnswer: "Tradeoffs",
    knowledgePoints: ["Redis"],
    difficulty: "medium",
    kind: "project",
  });
  const resume = repo.saveMaterial({
    name: "CV",
    kind: "resume",
    text: "Old project snapshot",
  });
  const jd = repo.saveMaterial({
    name: "JD",
    kind: "jd",
    text: "Backend role",
  });
  const session: InterviewSession = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    config: {
      scope: "job",
      mode: "bank",
      feedback: "formal",
      provider: "ollama",
      difficulty: "medium",
      questionCount: 1,
      topic: "",
      knowledgePoints: [],
      resumeId: resume.id,
      jdId: jd.id,
    },
    resume,
    jd,
    rulesVersion: "interview-v1",
    status: "aborted",
    turns: [
      {
        question,
        draft: "first attempt",
        answer: "first attempt",
        isFollowup: false,
      },
    ],
    bankQueue: [question],
  };
  repo.putSession(session);
  const settings = new ModelSettings(root, {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => b.toString(),
  });
  settings.save({
    provider: "ollama",
    baseUrl: "http://localhost:11434",
    model: "fixture",
  });
  return {
    root,
    lib,
    repo,
    reviews,
    session,
    settings,
    dispose: () => {
      lib.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("review snapshots survive source deletion; repeat practice records once and never changes mastery", async () => {
  const f = fixture();
  let fail = true;
  const service = new InterviewService(
    f.lib,
    f.repo,
    f.settings,
    { retrieve: async () => ({ evidence: [], trace: { mode: "keyword" } }) },
    async (_profile, messages) => {
      const data = JSON.parse(messages[1].content);
      expect(data.resume.text).toBe("Old project snapshot");
      if (fail) throw Error("offline");
      return JSON.stringify({
        dimensions: dimensionsFor("project").map((d) => ({
          name: d.name,
          score: 80,
          reason: "specific feedback",
        })),
        omissions: ["tradeoff detail"],
        suggestions: ["give an example"],
        referenceAnswer: "comparison",
        uncertainty: "",
        evidenceIds: [],
      });
    },
  );
  try {
    const id = f.reviews.add(f.session.id, 0);
    expect(f.reviews.add(f.session.id, 0)).toBe(id);
    expect(() => f.reviews.add(f.session.id, 1)).toThrow();
    f.repo.deleteSession(f.session.id);
    f.repo.deleteMaterial(f.session.resume!.id);
    f.repo.deleteQuestion(f.session.turns[0].question.id);
    f.reviews.setState(id, "mastered");
    const practice = service.createReview(id, "ollama");
    service.submit(practice, 0, "new detailed answer");
    await service.waitForIdle();
    expect(f.repo.getSession(practice)!.status).toBe("failed");
    expect(f.reviews.get(id)!.attempts).toHaveLength(0);
    fail = false;
    service.retry(practice);
    await service.waitForIdle();
    f.reviews.recordAttempt(f.repo.getSession(practice)!);
    expect(f.reviews.get(id)!.attempts).toHaveLength(1);
    expect(f.reviews.get(id)!.state).toBe("mastered");
    expect(f.reviews.get(id)!.baseline.answer).toBe("first attempt");
    expect(f.reviews.get(id)!.attempts[0].turn.answer).toBe(
      "new detailed answer",
    );
    expect(f.reviews.add(practice, 0)).toBe(id);
    f.repo.deleteSession(practice);
    expect(f.reviews.get(id)!.attempts).toHaveLength(1);
    const late = service.createReview(id, "ollama");
    f.reviews.delete(id);
    service.submit(late, 0, "after deletion");
    await service.waitForIdle();
    expect(f.repo.getSession(late)!.status).toBe("completed");
    expect(f.reviews.list()).toHaveLength(0);
  } finally {
    service.close();
    await service.waitForIdle();
    f.dispose();
  }
});
test("unfinished formal sessions cannot expose answers through review", () => {
  const f = fixture();
  try {
    f.repo.putSession({ ...f.session, status: "awaiting-answer" });
    expect(() => f.reviews.add(f.session.id, 0)).toThrow("结束面试");
    expect(f.reviews.list()).toHaveLength(0);
  } finally {
    f.dispose();
  }
});
test("review backups preserve divergent snapshots idempotently and remap practice links", async () => {
  const f = fixture(),
    target = new LibraryRepository(join(f.root, "b"));
  const other = new ReviewRepository(target.db),
    sessions = new InterviewRepository(target.db);
  try {
    const id = f.reviews.add(f.session.id, 0);
    const practice = { ...f.session, id: randomUUID(), reviewId: id };
    f.repo.putSession(practice);
    const file = join(f.root, "review.ikb");
    await exportLibrary(f.lib, file);
    await importBackup(target, file);
    expect(other.get(id)).toEqual(f.reviews.get(id));
    other.setState(id, "mastered");
    await importBackup(target, file);
    await importBackup(target, file);
    expect(other.list()).toHaveLength(2);
    const incoming = other.list().find((r) => r.state === "pending")!;
    expect(
      sessions.listSessions().some((s) => s.reviewId === incoming.id),
    ).toBe(true);
    expect(sessions.listSessions()).toHaveLength(3);
    expect(other.summaries()[0]).not.toHaveProperty("baseline");
  } finally {
    target.close();
    f.dispose();
  }
});
