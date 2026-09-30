import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LibraryRepository } from "../../src/main/library/repository";
import { CaptureQueue } from "../../src/main/capture/queue";
test("manual update retains offline copy for removed and unavailable sources", async () => {
  const root = mkdtempSync(join(tmpdir(), "updates-")),
    repo = new LibraryRepository(root),
    s = repo.addSource("https://example.com/");
  try {
    const candidate = {
      sourceId: s.id,
      canonicalUrl: s.entryUrl,
      title: "文章",
      sectionPath: [],
    };
    const v = repo.saveArticle(
      {
        candidate,
        markdown: "# 保留原文",
        text: "保留原文",
        fetchedAt: "2026-09-30T00:00:00Z",
        assets: [],
      },
      [],
    );
    const q = new CaptureQueue(
      repo,
      {
        load: async () => ({
          kind: "unavailable",
          reason: "404",
          statusCode: 404,
        }),
        asset: async () => {
          throw Error("unused");
        },
      },
      0,
    );
    q.startCapture(s.id, [candidate]);
    await q.waitForIdle();
    expect(repo.getArticle(v.articleId)?.sourceStatus).toBe("removed");
    expect(repo.readArticle(v.articleId).markdown).toContain("保留原文");
    repo.markStatus(candidate, "unavailable");
    expect(repo.listVersions(v.articleId)).toHaveLength(1);
  } finally {
    repo.close();
    rmSync(root, { recursive: true, force: true });
  }
});
