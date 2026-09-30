import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LibraryRepository } from "../../src/main/library/repository";
import { QaService } from "../../src/main/knowledge/service";
import { ModelSettings } from "../../src/main/knowledge/settings";
import { exportLibrary } from "../../src/main/backup/export";
import { importBackup } from "../../src/main/backup/merge";
import type { QaRecord } from "../../src/shared/knowledge";
const record = (): QaRecord => ({
  id: randomUUID(),
  createdAt: new Date().toISOString(),
  question: "question",
  scope: {},
  provider: "online",
  model: "test",
  allowSupplement: false,
  status: "failed",
  evidence: [],
});
const codec = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString(),
};
test("categories move, rename, delete and record deletion persist across reopen", () => {
  const root = mkdtempSync(join(tmpdir(), "qa-manage-"));
  let repo = new LibraryRepository(root);
  try {
    const a = record(),
      b = record();
    repo.putQa(a);
    repo.putQa(b);
    repo.createQaCategory(" Redis ");
    repo.createQaCategory("JVM");
    expect(() => repo.createQaCategory("Redis")).toThrow();
    expect(() => repo.createQaCategory("  ")).toThrow();
    repo.moveQa([a.id, b.id], "Redis");
    expect(repo.listQa().every((q) => q.category === "Redis")).toBe(true);
    expect(() => repo.moveQa([a.id], "missing")).toThrow();
    expect(() => repo.renameQaCategory("Redis", "JVM")).toThrow();
    repo.renameQaCategory("Redis", "Database");
    expect(repo.listQa().every((q) => q.category === "Database")).toBe(true);
    repo.deleteQaCategory("Database");
    expect(repo.listQa().every((q) => !q.category)).toBe(true);
    repo.deleteQa([a.id]);
    repo.close();
    repo = new LibraryRepository(root);
    expect(repo.listQa().map((q) => q.id)).toEqual([b.id]);
    expect(repo.listQaCategories()).toEqual(["JVM"]);
  } finally {
    repo.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("late generation cannot resurrect deleted records or overwrite a moved category", async () => {
  const root = mkdtempSync(join(tmpdir(), "qa-race-")),
    repo = new LibraryRepository(root);
  let release!: () => void;
  const pending = new Promise<void>((r) => {
    release = r;
  });
  const service = new QaService(repo, new ModelSettings(root, codec), 5000, {
    retrieve: async () => {
      await pending;
      return { evidence: [], trace: { mode: "keyword" as const } };
    },
  });
  try {
    repo.createQaCategory("Redis");
    const a = service.ask("a", {}, "online", false),
      b = service.ask("b", {}, "online", false);
    await new Promise((r) => setImmediate(r));
    service.delete([a]);
    repo.moveQa([b], "Redis");
    release();
    await service.waitForIdle();
    expect(repo.listQa()).toHaveLength(1);
    expect(repo.listQa()[0]).toMatchObject({
      id: b,
      category: "Redis",
      status: "complete",
    });
  } finally {
    release();
    await service.waitForIdle();
    repo.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("backup merges same-name categories and preserves empty categories and assignments", async () => {
  const root = mkdtempSync(join(tmpdir(), "qa-category-backup-")),
    a = new LibraryRepository(join(root, "a")),
    b = new LibraryRepository(join(root, "b"));
  try {
    a.createQaCategory("Redis");
    a.createQaCategory("Empty");
    b.createQaCategory("Redis");
    const q = record();
    a.putQa(q);
    a.moveQa([q.id], "Redis");
    const path = join(root, "backup.ikb");
    await exportLibrary(a, path);
    await importBackup(b, path);
    await importBackup(b, path);
    expect(b.listQaCategories().sort()).toEqual(["Empty", "Redis"]);
    expect(b.listQa()).toHaveLength(1);
    expect(b.listQa()[0].category).toBe("Redis");
  } finally {
    a.close();
    b.close();
    rmSync(root, { recursive: true, force: true });
  }
});
