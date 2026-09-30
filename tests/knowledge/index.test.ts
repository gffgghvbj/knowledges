import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryRepository } from "../../src/main/library/repository";
import { retrieve } from "../../src/main/knowledge/index";
test("中文问题检索、范围与版本更新恢复", () => {
  const root = mkdtempSync(join(tmpdir(), "qa-index-")),
    repo = new LibraryRepository(root);
  try {
    const source = repo.addSource("https://example.com/redis");
    const candidate = {
      sourceId: source.id,
      canonicalUrl: source.entryUrl,
      title: "Redis 持久化",
      sectionPath: ["数据库"],
    };
    const save = (markdown: string) =>
      repo.saveArticle(
        {
          candidate,
          markdown,
          text: markdown,
          assets: [],
          fetchedAt: new Date().toISOString(),
        },
        [],
      );
    const v1 = save(
      "# Redis 持久化\n\nAOF 通过追加写命令保存数据。\n\nRDB 是内存快照。",
    );
    const hit = retrieve(repo, "Redis 的 AOF 如何保存数据？", {});
    expect(hit[0].quote).toContain("AOF");
    expect(hit[0].versionId).toBe(v1.id);
    expect(retrieve(repo, "AOF", { section: "Java" })).toEqual([]);
    expect(retrieve(repo, "AOF", { topic: "垃圾回收" })).toEqual([]);
    const v2 = save("# Redis\n\n只讨论内存淘汰策略。");
    expect(retrieve(repo, "AOF", {})).toEqual([]);
    repo.restoreVersion(v1.articleId, v1.id);
    expect(retrieve(repo, "AOF", {})[0].versionId).toBe(v1.id);
    expect(repo.readArticle(v1.articleId, v2.id).markdown).toContain(
      "内存淘汰",
    );
  } finally {
    repo.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("第一版 SQLite 自动升级，原文与版本保持不变", () => {
  const root = mkdtempSync(join(tmpdir(), "qa-upgrade-"));
  let repo = new LibraryRepository(root);
  try {
    const s = repo.addSource("https://example.com/old");
    const v = repo.saveArticle(
      {
        candidate: {
          sourceId: s.id,
          canonicalUrl: s.entryUrl,
          title: "旧资料",
          sectionPath: [],
        },
        markdown: "AOF 追加日志。",
        text: "AOF",
        assets: [],
        fetchedAt: new Date().toISOString(),
      },
      [],
    );
    // Remove only phase-two schema additions to recreate the actual v1 schema.
    repo.db.exec(
      "DROP TABLE knowledge_chunks; DROP TABLE qa_records; PRAGMA user_version=1;",
    );
    repo.close();
    repo = new LibraryRepository(root);
    expect(repo.db.prepare("PRAGMA user_version").get()?.user_version).toBe(2);
    expect(repo.readArticle(v.articleId, v.id).markdown).toBe("AOF 追加日志。");
    expect(retrieve(repo, "AOF", {})[0].versionId).toBe(v.id);
    expect(repo.listQa()).toEqual([]);
  } finally {
    repo.close();
    rmSync(root, { recursive: true, force: true });
  }
});
