import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LibraryRepository } from "../../src/main/library/repository";
import { exportLibrary } from "../../src/main/backup/export";
import { importBackup, inspectBackup } from "../../src/main/backup/merge";
let root: string, a: LibraryRepository, b: LibraryRepository;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "backup-"));
  a = new LibraryRepository(join(root, "a"));
  b = new LibraryRepository(join(root, "b"));
});
afterEach(() => {
  a.close();
  b.close();
  rmSync(root, { recursive: true, force: true });
});
function add(
  repo: LibraryRepository,
  path: string,
  body: string,
  date: string,
) {
  const s = repo.addSource("https://example.com/");
  return repo.saveArticle(
    {
      candidate: {
        sourceId: s.id,
        canonicalUrl: "https://example.com/" + path,
        title: path,
        sectionPath: [],
      },
      markdown: body,
      text: body,
      fetchedAt: date,
      assets: [],
    },
    [],
  );
}
test("merges additions and newer versions while repeat imports are idempotent", async () => {
  const old = add(a, "redis", "old", "2026-09-01T00:00:00Z");
  add(a, "java", "java", "2026-09-01T00:00:00Z");
  add(b, "redis", "new", "2026-09-30T00:00:00Z");
  add(b, "mysql", "mysql", "2026-09-30T00:00:00Z");
  const file = join(root, "export.ikb");
  await exportLibrary(b, file);
  expect((await inspectBackup(file)).recordCount).toBe(2);
  const report = await importBackup(a, file);
  expect(report.added).toBe(1);
  expect(report.updated).toBe(1);
  expect(a.listArticles()).toHaveLength(3);
  expect(a.readArticle(old.articleId).markdown).toBe("new");
  expect(a.listVersions(old.articleId)).toHaveLength(2);
  expect((await importBackup(a, file)).added).toBe(0);
  expect(a.listArticles()).toHaveLength(3);
  a.restoreVersion(old.articleId, old.id);
  expect(a.readArticle(old.articleId).markdown).toBe("old");
});
test("equal-time conflicts keep target current version and retain incoming history", async () => {
  const date = "2026-09-30T00:00:00Z",
    v = add(a, "redis", "A", date);
  add(b, "redis", "B", date);
  const file = join(root, "conflict.ikb");
  await exportLibrary(b, file);
  expect((await importBackup(a, file)).conflicts).toBe(1);
  expect(a.readArticle(v.articleId).markdown).toBe("A");
  expect(a.listVersions(v.articleId)).toHaveLength(2);
});
