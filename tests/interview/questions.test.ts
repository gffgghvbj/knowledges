import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryRepository } from "../../src/main/library/repository";
import { InterviewRepository } from "../../src/main/interview/repository";
import { QuestionService } from "../../src/main/interview/questions";
import { ModelSettings } from "../../src/main/knowledge/settings";
const codec = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString(),
};
test("question candidates require acceptance, retain version evidence and reject invented citations", async () => {
  const root = mkdtempSync(join(tmpdir(), "bank-")),
    lib = new LibraryRepository(root),
    repo = new InterviewRepository(lib.db),
    settings = new ModelSettings(root, codec);
  try {
    settings.save({
      provider: "ollama",
      baseUrl: "http://localhost:11434",
      model: "test",
    });
    const source = lib.addSource("https://example.com");
    const input = {
      candidate: {
        sourceId: source.id,
        canonicalUrl: source.entryUrl,
        title: "Redis",
        sectionPath: [],
      },
      markdown: "AOF saves commands.",
      text: "AOF",
      assets: [],
      fetchedAt: new Date().toISOString(),
    };
    const v = lib.saveArticle(input, []);
    let invalid = false;
    const service = new QuestionService(lib, repo, settings, async (_p, m) => {
      const data = JSON.parse(m[1].content);
      return JSON.stringify({
        questions: [
          {
            prompt: "What is AOF?",
            referenceAnswer: "A command log.",
            knowledgePoints: ["Redis"],
            difficulty: "easy",
            kind: "technical",
            evidenceIds: [invalid ? "a".repeat(64) : data.evidence[0].id],
            supplement: false,
          },
        ],
      });
    });
    const rows = await service.propose([v.articleId], 1, "ollama");
    expect(repo.listQuestions()).toHaveLength(0);
    service.acceptCandidates([rows[0].id]);
    service.acceptCandidates([rows[0].id]);
    expect(repo.listQuestions()).toHaveLength(1);
    lib.saveArticle({ ...input, markdown: "New article body" }, []);
    expect(repo.listQuestions()[0].evidence[0].versionId).toBe(v.id);
    expect(repo.listQuestions()[0].origin).toBe("ai-organized");
    invalid = true;
    await expect(service.propose([v.articleId], 1, "ollama")).rejects.toThrow();
    const manual = repo.saveQuestion({
      prompt: "Project?",
      referenceAnswer: "Describe decisions",
      knowledgePoints: ["Project"],
      kind: "project",
      difficulty: "medium",
    });
    expect(manual.origin).toBe("manual");
    repo.deleteQuestion(manual.id);
    expect(repo.listQuestions()).toHaveLength(1);
  } finally {
    lib.close();
    rmSync(root, { recursive: true, force: true });
  }
});
