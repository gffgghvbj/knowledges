import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryRepository } from "../../src/main/library/repository";
import { InterviewRepository } from "../../src/main/interview/repository";
import { ModelSettings } from "../../src/main/knowledge/settings";
import { InterviewService } from "../../src/main/interview/service";
import { projectSession } from "../../src/main/interview/projection";
import type { InterviewConfig } from "../../src/shared/interview";
const codec = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString(),
};
const config: InterviewConfig = {
  scope: "topic",
  mode: "bank",
  feedback: "practice",
  provider: "ollama",
  difficulty: "medium",
  questionCount: 2,
  topic: "Redis",
  knowledgePoints: [],
};
function setup() {
  const root = mkdtempSync(join(tmpdir(), "interview-service-")),
    lib = new LibraryRepository(root),
    repo = new InterviewRepository(lib.db),
    settings = new ModelSettings(root, codec);
  settings.save({
    provider: "ollama",
    baseUrl: "http://localhost:11434",
    model: "test",
  });
  for (let i = 1; i <= 2; i++)
    repo.saveQuestion({
      prompt: `Redis Q${i}`,
      referenceAnswer: `secret reference ${i}`,
      knowledgePoints: ["Redis"],
      difficulty: "medium",
      kind: "technical",
    });
  const resume = repo.saveMaterial({
      name: "Resume",
      kind: "resume",
      text: "Led payment migration",
    }),
    jd = repo.saveMaterial({
      name: "JD",
      kind: "jd",
      text: "Redis engineering",
    });
  return {
    root,
    lib,
    repo,
    settings,
    resume,
    jd,
    dispose: () => {
      lib.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
const retriever = {
  retrieve: async () => ({ evidence: [], trace: { mode: "keyword" as const } }),
};
const model = async (_p: any, m: { content: string }[]) => {
  const d = JSON.parse(m[1].content);
  if (d.task === "select")
    return JSON.stringify({
      ids: d.candidates.slice(0, d.count).map((q: any) => q.id),
    });
  if (d.task === "question")
    return JSON.stringify({
      question: {
        prompt: `Question ${d.history.length + 1} ${d.resume?.text ?? d.config.topic}`,
        referenceAnswer: "secret reference",
        knowledgePoints: ["Redis"],
        difficulty: "medium",
        kind: "technical",
        evidenceIds: [],
        supplement: true,
      },
      isFollowup: d.history.length > 0,
    });
  return JSON.stringify({
    dimensions: d.dimensions.map((v: any) => ({
      name: v.name,
      score: 80,
      reason: "Answer-specific feedback",
    })),
    omissions: [],
    suggestions: ["Study Redis"],
    referenceAnswer: "secret analysis",
    uncertainty: "Model supplement",
    evidenceIds: [],
  });
};
for (const scope of ["topic", "job"] as const)
  for (const mode of ["bank", "ai"] as const)
    for (const feedback of ["practice", "formal"] as const)
      test(`${scope}/${mode}/${feedback} respects total and feedback visibility`, async () => {
        const f = setup(),
          service = new InterviewService(
            f.lib,
            f.repo,
            f.settings,
            retriever,
            model,
          );
        try {
          const id = service.create({
            ...config,
            scope,
            mode,
            feedback,
            resumeId: f.resume.id,
            jdId: f.jd.id,
          });
          await service.waitForIdle();
          for (let i = 0; i < 2; i++) {
            let s = f.repo.getSession(id)!;
            expect(s.status).toBe("awaiting-answer");
            if (scope === "job" && mode === "ai")
              expect(s.turns[i].question.prompt).toContain(
                "Led payment migration",
              );
            service.saveDraft(id, i, "saved draft");
            expect(f.repo.getSession(id)!.turns[i].draft).toBe("saved draft");
            service.submit(id, i, "My actual answer");
            service.submit(id, i, "duplicate");
            await service.waitForIdle();
            s = f.repo.getSession(id)!;
            expect(s.turns[i].answer).toBe("My actual answer");
            if (i === 0) {
              const view = projectSession(s);
              if (feedback === "formal") {
                expect(JSON.stringify(view)).not.toContain("secret");
                expect(view.turns[0].grade).toBeUndefined();
              } else expect(view.turns[0].grade?.total).toBe(80);
              service.next(id);
              await service.waitForIdle();
            }
          }
          const s = f.repo.getSession(id)!;
          expect(s.status).toBe("completed");
          expect(s.turns).toHaveLength(2);
          expect(projectSession(s).turns[1].grade?.total).toBe(80);
          if (mode === "ai") expect(s.turns[1].isFollowup).toBe(true);
          service.next(id);
          expect(f.repo.getSession(id)!.turns).toHaveLength(2);
        } finally {
          service.close();
          await service.waitForIdle();
          f.dispose();
        }
      });
test("insufficient bank does not invent questions; failed grading is retryable without losing answer", async () => {
  const f = setup();
  let fail = true;
  const service = new InterviewService(
    f.lib,
    f.repo,
    f.settings,
    retriever,
    async (p, m) => {
      if (fail) throw Error("remote secret");
      return model(p, m);
    },
  );
  try {
    expect(() => service.create({ ...config, questionCount: 3 })).toThrow();
    const id = service.create(config);
    await service.waitForIdle();
    service.submit(id, 0, "retained answer");
    await service.waitForIdle();
    expect(f.repo.getSession(id)!.status).toBe("failed");
    expect(f.repo.getSession(id)!.error).not.toContain("secret");
    fail = false;
    service.retry(id);
    service.retry(id);
    await service.waitForIdle();
    expect(f.repo.getSession(id)!.turns).toHaveLength(1);
    expect(f.repo.getSession(id)!.turns[0].answer).toBe("retained answer");
    expect(f.repo.getSession(id)!.status).toBe("awaiting-next");
  } finally {
    service.close();
    await service.waitForIdle();
    f.dispose();
  }
});
test("deleting or finishing in-flight work ignores late writes and reveals only answered turns", async () => {
  const f = setup();
  let release!: () => void;
  const pending = new Promise<void>((r) => (release = r));
  const service = new InterviewService(
    f.lib,
    f.repo,
    f.settings,
    retriever,
    async (p, m) => {
      await pending;
      return model(p, m);
    },
  );
  try {
    const a = service.create(config),
      b = service.create({ ...config, feedback: "formal" });
    await service.waitForIdle();
    service.submit(a, 0, "a");
    service.submit(b, 0, "b");
    await new Promise((r) => setImmediate(r));
    service.delete(a);
    service.finish(b);
    release();
    await service.waitForIdle();
    expect(f.repo.getSession(a)).toBeUndefined();
    expect(f.repo.getSession(b)!.status).toBe("aborted");
    expect(f.repo.getSession(b)!.turns[0].grade).toBeUndefined();
    expect(projectSession(f.repo.getSession(b)!).turns).toHaveLength(1);
  } finally {
    release();
    service.close();
    await service.waitForIdle();
    f.dispose();
  }
});
test("restart retains drafts and interrupted answers without starting network work", async () => {
  const f = setup();
  let release!: () => void;
  const pending = new Promise<void>((r) => (release = r));
  let requests = 0;
  let service = new InterviewService(
    f.lib,
    f.repo,
    f.settings,
    retriever,
    async (p, m) => {
      requests++;
      await pending;
      return model(p, m);
    },
  );
  try {
    const id = service.create(config);
    await service.waitForIdle();
    service.saveDraft(id, 0, "draft survives");
    service.close();
    service = new InterviewService(
      f.lib,
      f.repo,
      f.settings,
      retriever,
      async (p, m) => {
        requests++;
        await pending;
        return model(p, m);
      },
    );
    expect(f.repo.getSession(id)!.turns[0].draft).toBe("draft survives");
    expect(requests).toBe(0);
    service.submit(id, 0, "submitted survives");
    await new Promise((r) => setImmediate(r));
    service.close();
    release();
    await service.waitForIdle();
    const next = new InterviewService(
      f.lib,
      f.repo,
      f.settings,
      retriever,
      model,
    );
    expect(f.repo.getSession(id)!.status).toBe("failed");
    expect(f.repo.getSession(id)!.turns[0].answer).toBe("submitted survives");
    expect(requests).toBe(1);
    next.retry(id);
    await next.waitForIdle();
    expect(f.repo.getSession(id)!.status).toBe("awaiting-next");
    next.close();
  } finally {
    release();
    service.close();
    await service.waitForIdle();
    f.dispose();
  }
});
test("invalid AI questions or selection never advance a session", async () => {
  const f = setup(),
    service = new InterviewService(
      f.lib,
      f.repo,
      f.settings,
      retriever,
      async () =>
        JSON.stringify({ ids: ["invented"], question: { prompt: "bad" } }),
    );
  try {
    const a = service.create({ ...config, mode: "ai" }),
      b = service.create({
        ...config,
        scope: "job",
        resumeId: f.resume.id,
        jdId: f.jd.id,
      });
    await service.waitForIdle();
    for (const id of [a, b]) {
      expect(f.repo.getSession(id)!.status).toBe("failed");
      expect(f.repo.getSession(id)!.turns).toHaveLength(0);
      expect(
        JSON.stringify(projectSession(f.repo.getSession(id)!)),
      ).not.toContain("secret");
    }
  } finally {
    service.close();
    await service.waitForIdle();
    f.dispose();
  }
});
