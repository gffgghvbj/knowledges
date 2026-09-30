import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LibraryRepository } from "../../src/main/library/repository";
import { searchArticles } from "../../src/main/library/search";
test("searches Chinese short words and code symbols with scope filtering", () => {
  const root = mkdtempSync(join(tmpdir(), "search-")),
    repo = new LibraryRepository(root),
    s = repo.addSource("https://example.com/");
  try {
    repo.saveArticle(
      {
        candidate: {
          sourceId: s.id,
          canonicalUrl: s.entryUrl,
          title: "Redis 内存回收",
          sectionPath: ["Redis"],
        },
        markdown: "C++ 与垃圾回收",
        text: "C++ 与垃圾回收",
        fetchedAt: "2026-09-30T00:00:00Z",
        assets: [],
      },
      [],
    );
    for (const q of ["回收", "Redis", "C++"])
      expect(searchArticles(repo, q, {}, 0).total).toBe(1);
    expect(searchArticles(repo, "Redis", { sourceId: "other" }, 0).total).toBe(
      0,
    );
    expect(searchArticles(repo, "' OR 1=1 --", {}, 0).total).toBe(0);
    expect(searchArticles(repo, "%", {}, 0).total).toBe(0);
  } finally {
    repo.close();
    rmSync(root, { recursive: true, force: true });
  }
});
