import { test, expect } from "vitest";
import {
  mkdtempSync,
  rmSync,
  createWriteStream,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import { LibraryRepository } from "../../src/main/library/repository";
import { exportLibrary } from "../../src/main/backup/export";
import { validateBackup } from "../../src/main/backup/validate";
import { importBackup } from "../../src/main/backup/merge";
test("rejects unsupported versions and path traversal before touching the target library", async () => {
  const root = mkdtempSync(join(tmpdir(), "invalid-backup-"));
  try {
    const zip = new ZipFile(),
      path = join(root, "invalid.ikb"),
      done = pipeline(zip.outputStream, createWriteStream(path));
    zip.addBuffer(Buffer.from("{}"), "xx/escape");
    zip.end();
    await done;
    const bytes = readFileSync(path);
    for (
      let offset = 0;
      (offset = bytes.indexOf("xx/escape", offset)) !== -1;
      offset += 9
    )
      bytes.write("../escape", offset);
    writeFileSync(path, bytes);
    await expect(validateBackup(path)).rejects.toThrow();
    const z = new ZipFile(),
      other = join(root, "future.ikb"),
      done2 = pipeline(z.outputStream, createWriteStream(other));
    z.addBuffer(
      Buffer.from(JSON.stringify({ formatVersion: 99 })),
      "manifest.json",
    );
    z.end();
    await done2;
    await expect(validateBackup(other)).rejects.toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("tampered resource digest fails without mutating an existing library", async () => {
  const root = mkdtempSync(join(tmpdir(), "tampered-")),
    repo = new LibraryRepository(join(root, "library"));
  try {
    const s = repo.addSource("https://example.com/");
    repo.saveArticle(
      {
        candidate: {
          sourceId: s.id,
          canonicalUrl: s.entryUrl,
          title: "保留",
          sectionPath: [],
        },
        markdown: "原文",
        text: "原文",
        assets: [],
        fetchedAt: "2026-09-30T00:00:00Z",
      },
      [],
    );
    const good = join(root, "good.ikb");
    await exportLibrary(repo, good);
    const validated = await validateBackup(good);
    try {
      const m = validated.manifest;
      m.files[0].hash = "0".repeat(64);
      const bad = join(root, "bad.ikb"),
        zip = new ZipFile(),
        done = pipeline(zip.outputStream, createWriteStream(bad));
      zip.addBuffer(Buffer.from(JSON.stringify(m)), "manifest.json");
      for (const f of m.files)
        zip.addFile(join(validated.root, f.path), f.path);
      zip.end();
      await done;
      await expect(importBackup(repo, bad)).rejects.toThrow("备份校验失败");
      expect(repo.listArticles()).toHaveLength(1);
      expect(repo.readArticle(repo.listArticles()[0].id).markdown).toBe("原文");
    } finally {
      await validated.dispose();
    }
  } finally {
    repo.close();
    rmSync(root, { recursive: true, force: true });
  }
});
