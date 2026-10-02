import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryRepository } from "../../src/main/library/repository";
import { exportLibrary } from "../../src/main/backup/export";
import { importBackup } from "../../src/main/backup/merge";
import { extractionPresets } from "../../src/shared/extraction";

test("source rules survive restart and backup; existing destination preferences remain local", async () => {
  const root = mkdtempSync(join(tmpdir(), "rule-backup-"));
  let a = new LibraryRepository(join(root, "a"));
  const b = new LibraryRepository(join(root, "b"));
  try {
    const source = a.addSource("https://programmercarl.com/algo/", {
      preset: "custom",
      rule: {
        ...extractionPresets.carl,
        name: "My Carl",
        removeSelectors: [".promo"],
      },
    });
    a.close();
    a = new LibraryRepository(join(root, "a"));
    expect(a.getSource(source.id)).toEqual(source);
    const file = join(root, "rules.ikb");
    await exportLibrary(a, file);
    await importBackup(b, file);
    expect(b.getSource(source.id)).toEqual(source);
    b.putSource({ ...source, extraction: { preset: "generic" } });
    await importBackup(b, file);
    expect(b.getSource(source.id)!.extraction).toEqual({ preset: "generic" });
  } finally {
    a.close();
    b.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("selected URL scope and quality survive backup; foreign update URLs are rejected", async () => {
  const root = mkdtempSync(join(tmpdir(), "quality-backup-")),
    a = new LibraryRepository(join(root, "a")),
    b = new LibraryRepository(join(root, "b"));
  try {
    const s = a.addSource("https://example.com/");
    s.selectedUrls = ["https://example.com/docs/a"];
    a.putSource(s);
    const quality = {
      checkedAt: new Date().toISOString(),
      textLength: 2,
      codeBlocks: 0,
      issues: [{ code: "short-text" as const, message: "正文过短" }],
    };
    const v = a.saveArticle(
      {
        candidate: {
          sourceId: s.id,
          canonicalUrl: s.selectedUrls[0],
          title: "短文",
          sectionPath: ["docs"],
        },
        markdown: "短文",
        text: "短文",
        assets: [],
        fetchedAt: quality.checkedAt,
      },
      [],
      "complete",
      quality,
    );
    const file = join(root, "quality.ikb");
    await exportLibrary(a, file);
    await importBackup(b, file);
    expect(b.getSource(s.id)?.selectedUrls).toEqual(s.selectedUrls);
    expect(b.readArticle(v.articleId).version.quality).toEqual(quality);
    b.putSource({ ...s, selectedUrls: ["https://example.com/local"] });
    await importBackup(b, file);
    expect(b.getSource(s.id)?.selectedUrls).toEqual([
      "https://example.com/local",
    ]);
    a.putSource({ ...s, selectedUrls: ["https://foreign.example/a"] });
    await exportLibrary(a, file);
    await expect(importBackup(b, file)).rejects.toThrow("来源范围");
    expect(b.getSource(s.id)?.selectedUrls).toEqual([
      "https://example.com/local",
    ]);
  } finally {
    a.close();
    b.close();
    rmSync(root, { recursive: true, force: true });
  }
});
