import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryRepository } from "../../src/main/library/repository";
import { searchArticles } from "../../src/main/library/search";
import { retrieve } from "../../src/main/knowledge/index";
import { currentChunks } from "../../src/main/knowledge/vector-index";
import { exportLibrary } from "../../src/main/backup/export";
import { importBackup } from "../../src/main/backup/merge";

function save(
  repo: LibraryRepository,
  text = "Redis persistence and recovery",
  fetchedAt = "2026-10-01T00:00:00Z",
) {
  const source = repo.addSource("https://example.com/docs/");
  const input = {
    candidate: {
      sourceId: source.id,
      canonicalUrl: "https://example.com/docs/redis",
      title: "Redis",
      sectionPath: ["docs"],
    },
    markdown: text,
    text,
    assets: [],
    fetchedAt,
  };
  return { source, input, version: repo.saveArticle(input, []) };
}

test("trash removes search and vectors, retains historical references and resists late recapture and restart", () => {
  const root = mkdtempSync(join(tmpdir(), "trash-"));
  let repo = new LibraryRepository(root);
  try {
    const { input, version } = save(repo);
    const evidence = retrieve(repo, "Redis", {});
    expect(evidence).toHaveLength(1);
    repo.db
      .prepare("INSERT INTO vector_embeddings VALUES (?,?,?,?)")
      .run("fixture", evidence[0].id, "hash", Buffer.alloc(4));
    repo.trashArticles([version.articleId, version.articleId]);
    expect(repo.listArticles()).toHaveLength(0);
    expect(repo.trashedArticles()).toHaveLength(1);
    expect(searchArticles(repo, "Redis", {}).total).toBe(0);
    expect(searchArticles(repo, "", {}).total).toBe(0);
    expect(retrieve(repo, "Redis", {})).toHaveLength(0);
    expect(currentChunks(repo)).toHaveLength(0);
    expect(
      repo.db.prepare("SELECT count(*) n FROM vector_embeddings").get()!.n,
    ).toBe(0);
    expect(
      repo.readArticle(evidence[0].articleId, evidence[0].versionId).markdown,
    ).toContain(evidence[0].quote);
    repo.saveArticle(
      { ...input, markdown: "late update", text: "late update" },
      [],
    );
    expect(repo.listVersions(version.articleId)).toHaveLength(1);
    repo.close();
    repo = new LibraryRepository(root);
    expect(repo.trashedArticles()).toHaveLength(1);
    expect(currentChunks(repo)).toHaveLength(0);
    repo.restoreArticles([version.articleId]);
    expect(repo.trashedArticles()).toHaveLength(0);
    expect(searchArticles(repo, "Redis", {}).total).toBe(1);
    expect(retrieve(repo, "Redis", {})).toHaveLength(1);
  } finally {
    repo.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("source removal retains articles and source configuration, and re-adding restores the source", () => {
  const root = mkdtempSync(join(tmpdir(), "source-remove-")),
    repo = new LibraryRepository(root);
  try {
    const { source, version } = save(repo);
    repo.putSource({ ...source, extraction: { preset: "carl" } });
    repo.deleteSource(source.id);
    expect(repo.listSources()).toHaveLength(0);
    expect(repo.listSources(true)).toHaveLength(1);
    expect(repo.listArticles()).toHaveLength(1);
    expect(repo.readArticle(version.articleId).markdown).toContain("Redis");
    expect(repo.addSource(source.entryUrl).extraction).toEqual({
      preset: "carl",
    });
    expect(repo.listSources()).toHaveLength(1);
  } finally {
    repo.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("backups retain trash and removed sources; merging newer content preserves local deletion decisions", async () => {
  const root = mkdtempSync(join(tmpdir(), "trash-backup-")),
    a = new LibraryRepository(join(root, "a")),
    b = new LibraryRepository(join(root, "b")),
    c = new LibraryRepository(join(root, "c"));
  try {
    const { source, version } = save(a);
    const file = join(root, "normal.ikb");
    await exportLibrary(a, file);
    await importBackup(b, file);
    b.trashArticles([version.articleId]);
    b.deleteSource(source.id);
    save(a, "Redis newer persisted content", "2026-10-02T00:00:00Z");
    await exportLibrary(a, file);
    await importBackup(b, file);
    expect(b.listArticles()).toHaveLength(0);
    expect(b.listSources()).toHaveLength(0);
    expect(b.readArticle(version.articleId).markdown).toContain("newer");
    const trashFile = join(root, "trash.ikb");
    await exportLibrary(b, trashFile);
    await importBackup(c, trashFile);
    expect(c.listArticles()).toHaveLength(0);
    expect(c.trashedArticles()).toHaveLength(1);
    expect(c.listSources()).toHaveLength(0);
    expect(c.readArticle(version.articleId, version.id).markdown).toContain(
      "persistence",
    );
    // Remote deletion is not imposed on an existing active article.
    await importBackup(a, trashFile);
    expect(a.listArticles()).toHaveLength(1);
    c.restoreArticles([version.articleId]);
    expect(searchArticles(c, "Redis", {}).total).toBe(1);
  } finally {
    a.close();
    b.close();
    c.close();
    rmSync(root, { recursive: true, force: true });
  }
});
