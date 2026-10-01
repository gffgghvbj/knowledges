import { test, expect, vi } from "vitest";
import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LibraryRepository } from "../../src/main/library/repository";
import { searchArticles } from "../../src/main/library/search";
function save(repo: LibraryRepository, url: string, text = "Redis 持久化 AOF") {
  const source = repo.addSource("https://example.com/");
  return repo.saveArticle(
    {
      candidate: {
        sourceId: source.id,
        canonicalUrl: source.entryUrl + url,
        title: url,
        sectionPath: [],
      },
      markdown: text,
      text,
      assets: [],
      fetchedAt: new Date().toISOString(),
    },
    [],
  );
}
test("unchanged restart reuses both indexes and current Markdown without writes", () => {
  const root = mkdtempSync(join(tmpdir(), "startup-reuse-"));
  let repo = new LibraryRepository(root);
  try {
    const v = save(repo, "redis"),
      path = join(root, `articles/${v.articleId}/current.md`),
      before = statSync(path).mtimeMs;
    const chunks = repo.db.prepare("SELECT * FROM knowledge_chunks").all();
    repo.close();
    const index = vi.spyOn(LibraryRepository.prototype, "index"),
      file = vi.spyOn(LibraryRepository.prototype, "materialize");
    repo = new LibraryRepository(root);
    expect(index).not.toHaveBeenCalled();
    expect(file).not.toHaveBeenCalled();
    expect(statSync(path).mtimeMs).toBe(before);
    expect(repo.db.prepare("SELECT * FROM knowledge_chunks").all()).toEqual(
      chunks,
    );
    expect(searchArticles(repo, "AOF", {}).total).toBe(1);
  } finally {
    vi.restoreAllMocks();
    repo.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("interrupted current-file write and incomplete indexes repair only affected articles", () => {
  const root = mkdtempSync(join(tmpdir(), "startup-recover-"));
  let repo = new LibraryRepository(root);
  try {
    save(repo, "stable");
    save(repo, "changed");
    const fail = vi.spyOn(repo, "materialize").mockImplementationOnce(() => {
      throw Error("interrupted");
    });
    expect(() => save(repo, "changed", "new RDB snapshot")).toThrow(
      "interrupted",
    );
    fail.mockRestore();
    const changed = repo.listArticles().find((a) => a.title === "changed")!;
    repo.close();
    const index = vi.spyOn(LibraryRepository.prototype, "index"),
      file = vi.spyOn(LibraryRepository.prototype, "materialize");
    repo = new LibraryRepository(root);
    expect(index).not.toHaveBeenCalled();
    expect(file).toHaveBeenCalledTimes(1);
    expect(
      readFileSync(join(root, `articles/${changed.id}/current.md`), "utf8"),
    ).toBe("new RDB snapshot");
    repo.db
      .prepare("DELETE FROM knowledge_chunks WHERE article_id=?")
      .run(changed.id);
    repo.db.prepare("DELETE FROM search_fts WHERE id=?").run(changed.id);
    index.mockClear();
    file.mockClear();
    repo.close();
    repo = new LibraryRepository(root);
    expect(index).toHaveBeenCalledTimes(1);
    expect(file).not.toHaveBeenCalled();
    expect(searchArticles(repo, "snapshot", {}).total).toBe(1);
  } finally {
    vi.restoreAllMocks();
    repo.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("v5 upgrade initializes maintenance once; partial async upgrade can resume", async () => {
  const root = mkdtempSync(join(tmpdir(), "startup-upgrade-"));
  let repo = new LibraryRepository(root);
  try {
    for (let i = 0; i < 25; i++) save(repo, `article-${i}`);
    repo.db.exec("DROP TABLE article_maintenance; PRAGMA user_version=5;");
    repo.close();
    repo = new LibraryRepository(root, { deferMaintenance: true });
    await expect(
      repo.prepare((done) => {
        if (done === 20) throw Error("cancelled");
      }),
    ).rejects.toThrow("cancelled");
    repo.close();
    const index = vi.spyOn(LibraryRepository.prototype, "index");
    repo = new LibraryRepository(root);
    expect(index).toHaveBeenCalledTimes(5);
    expect(repo.db.prepare("PRAGMA user_version").get()!.user_version).toBe(7);
    index.mockClear();
    repo.close();
    repo = new LibraryRepository(root);
    expect(index).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    repo.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("benchmark normal reopen versus previous full startup maintenance", () => {
  const root = mkdtempSync(join(tmpdir(), "startup-benchmark-"));
  let repo = new LibraryRepository(root);
  try {
    const body = Array.from(
      { length: 100 },
      (_, i) =>
        `## Redis ${i}\nRedis 持久化与缓存管理，用于说明数据库恢复和知识检索机制。`,
    ).join("\n\n");
    for (let i = 0; i < 200; i++) save(repo, `article-${i}`, body);
    let start = performance.now();
    for (const a of repo.listArticles()) repo.materialize(a);
    repo.rebuildIndex();
    const fullMs = performance.now() - start;
    repo.close();
    start = performance.now();
    repo = new LibraryRepository(root);
    const reopenMs = performance.now() - start;
    console.log(
      JSON.stringify({
        benchmark: "startup 200 articles",
        charactersPerArticle: body.length,
        previousMaintenanceMs: Math.round(fullMs),
        incrementalReopenMs: Math.round(reopenMs),
      }),
    );
    expect(repo.listArticles()).toHaveLength(200);
  } finally {
    repo.close();
    rmSync(root, { recursive: true, force: true });
  }
});
