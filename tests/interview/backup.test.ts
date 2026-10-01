import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LibraryRepository } from "../../src/main/library/repository";
import { InterviewRepository } from "../../src/main/interview/repository";
import { exportLibrary } from "../../src/main/backup/export";
import { importBackup } from "../../src/main/backup/merge";
import { validateBackup } from "../../src/main/backup/validate";
import { validateSession } from "../../src/main/interview/scoring";
test("interview backups retain independent snapshots and merge conflicts idempotently", async () => {
  const root = mkdtempSync(join(tmpdir(), "interview-backup-")),
    a = new LibraryRepository(join(root, "a")),
    b = new LibraryRepository(join(root, "b")),
    ra = new InterviewRepository(a.db),
    rb = new InterviewRepository(b.db);
  try {
    const resume = ra.saveMaterial({
        name: "resume",
        kind: "resume",
        text: "project experience",
      }),
      jd = ra.saveMaterial({ name: "jd", kind: "jd", text: "target role" }),
      question = ra.saveQuestion({
        prompt: "Project choices?",
        referenceAnswer: "explain tradeoffs",
        knowledgePoints: ["Project"],
        kind: "project",
        difficulty: "medium",
      });
    const session = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      config: {
        scope: "job" as const,
        mode: "bank" as const,
        feedback: "formal" as const,
        provider: "online" as const,
        difficulty: "medium" as const,
        questionCount: 1,
        topic: "",
        knowledgePoints: [],
        resumeId: resume.id,
        jdId: jd.id,
      },
      resume,
      jd,
      rulesVersion: "interview-v1" as const,
      status: "aborted" as const,
      turns: [{ question, draft: "saved draft", isFollowup: false }],
      bankQueue: [question],
    };
    ra.putSession(session);
    ra.deleteMaterial(resume.id);
    ra.deleteQuestion(question.id);
    const file = join(root, "test.ikb");
    await exportLibrary(a, file);
    await importBackup(b, file);
    expect(rb.getSession(session.id)).toEqual(session);
    expect(rb.listMaterials()).toEqual([jd]);
    expect(rb.listQuestions()).toEqual([]);
    rb.putSession({
      ...session,
      turns: [{ ...session.turns[0], draft: "local change" }],
    });
    await importBackup(b, file);
    await importBackup(b, file);
    expect(rb.listSessions()).toHaveLength(2);
    const checked = await validateBackup(file);
    expect(checked.manifest.formatVersion).toBe(5);
    await checked.dispose();
  } finally {
    a.close();
    b.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("import validation rejects impossible completed or scored sessions", () => {
  expect(() =>
    validateSession({
      config: { scope: "topic", questionCount: 1 },
      turns: [],
      status: "completed",
    } as any),
  ).toThrow();
});
test("legacy backups remain readable and malformed imported sessions leave the target unchanged", async () => {
  const { ZipFile } = await import("yazl"),
    { createWriteStream } = await import("node:fs"),
    { pipeline } = await import("node:stream/promises");
  const root = mkdtempSync(join(tmpdir(), "interview-validate-")),
    lib = new LibraryRepository(root),
    repo = new InterviewRepository(lib.db);
  try {
    const existing = repo.saveMaterial({
        name: "local",
        kind: "resume",
        text: "keep me",
      }),
      file = join(root, "original.ikb");
    await exportLibrary(lib, file);
    const checked = await validateBackup(file);
    const write = async (name: string, data: unknown) => {
      const z = new ZipFile(),
        path = join(root, name),
        done = pipeline(z.outputStream, createWriteStream(path));
      z.addBuffer(Buffer.from(JSON.stringify(data)), "manifest.json");
      z.end();
      await done;
      return path;
    };
    const legacy = await write("old.ikb", {
      ...checked.manifest,
      formatVersion: 3,
      interviewMaterials: undefined,
      interviewQuestions: undefined,
      interviewSessions: undefined,
    });
    await importBackup(lib, legacy);
    expect(repo.listMaterials()).toEqual([existing]);
    const bad = await write("bad.ikb", {
      ...checked.manifest,
      interviewSessions: [
        {
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          config: {
            scope: "topic",
            mode: "ai",
            feedback: "formal",
            provider: "online",
            difficulty: "medium",
            questionCount: 1,
            topic: "",
            knowledgePoints: [],
          },
          rulesVersion: "interview-v1",
          status: "completed",
          turns: [],
          bankQueue: [],
        },
      ],
    });
    await expect(importBackup(lib, bad)).rejects.toThrow();
    expect(repo.listMaterials()).toEqual([existing]);
    expect(repo.listSessions()).toEqual([]);
    await checked.dispose();
  } finally {
    lib.close();
    rmSync(root, { recursive: true, force: true });
  }
});
