import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LibraryRepository } from "../../src/main/library/repository";
import { InterviewRepository } from "../../src/main/interview/repository";
import { projectSession } from "../../src/main/interview/projection";
import { revision } from "../../src/main/library/revision";
test("large history lists omit private snapshots; details stay intact; measure payload", () => {
  const root = mkdtempSync(join(tmpdir(), "list-perf-")),
    lib = new LibraryRepository(root),
    repo = new InterviewRepository(lib.db);
  try {
    const material = repo.saveMaterial({
      name: "简历",
      kind: "resume",
      text: "private".repeat(4000),
    });
    const q = repo.saveQuestion({
      prompt: "Redis",
      referenceAnswer: "reference".repeat(500),
      knowledgePoints: ["Redis"],
      difficulty: "medium",
      kind: "technical",
    });
    lib.transaction(() => {
      for (let i = 0; i < 200; i++)
        repo.putSession({
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          config: {
            scope: "topic",
            mode: "bank",
            feedback: "formal",
            provider: "ollama",
            difficulty: "medium",
            questionCount: 10,
            topic: "Redis",
            knowledgePoints: [],
          },
          resume: material,
          rulesVersion: "interview-v1",
          status: "awaiting-answer",
          turns: [{ question: q, isFollowup: false, draft: "" }],
          bankQueue: Array.from({ length: 10 }, () => q),
        });
    });
    const start = performance.now(),
      full = repo.listSessions().map(projectSession),
      fullMs = performance.now() - start;
    const next = performance.now(),
      brief = repo.sessionSummaries(),
      summaryMs = performance.now() - next;
    const fullBytes = Buffer.byteLength(JSON.stringify(full)),
      summaryBytes = Buffer.byteLength(JSON.stringify(brief));
    expect(brief).toHaveLength(200);
    expect(summaryBytes).toBeLessThan(fullBytes / 100);
    expect(JSON.stringify(brief)).not.toMatch(
      /private|reference|bankQueue|draft/,
    );
    expect(repo.getSession(brief[0].id)?.resume?.text).toBe(material.text);
    expect(repo.materialSummaries()[0]).not.toHaveProperty("text");
    expect(repo.questionSummaries()[0]).not.toHaveProperty("referenceAnswer");
    console.log(
      JSON.stringify({
        benchmark: "200 interview sessions",
        fullBytes,
        summaryBytes,
        fullMs: Math.round(fullMs),
        summaryMs: Math.round(summaryMs),
      }),
    );
  } finally {
    lib.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("table revision invalidates on writes and rollback preserves cached version", () => {
  const root = mkdtempSync(join(tmpdir(), "revision-")),
    lib = new LibraryRepository(root),
    repo = new InterviewRepository(lib.db);
  try {
    const tables = ["interview_materials"],
      first = revision(lib.db, tables);
    repo.saveMaterial({ name: "a", kind: "jd", text: "text" });
    const second = revision(lib.db, tables);
    expect(second).not.toBe(first);
    expect(() =>
      lib.transaction(() => {
        repo.saveMaterial({ name: "b", kind: "jd", text: "text" });
        throw Error("rollback");
      }),
    ).toThrow();
    expect(revision(lib.db, tables)).toBe(second);
  } finally {
    lib.close();
    rmSync(root, { recursive: true, force: true });
  }
});
