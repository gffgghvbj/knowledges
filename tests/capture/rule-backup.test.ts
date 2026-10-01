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
