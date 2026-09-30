import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LibraryRepository } from "../../src/main/library/repository";
import { exportLibrary } from "../../src/main/backup/export";
import { importBackup } from "../../src/main/backup/merge";
import { retrieve } from "../../src/main/knowledge/index";
test("问答随备份迁移，冲突保留双方且重复导入幂等", async () => {
  const root = mkdtempSync(join(tmpdir(), "qa-backup-")),
    a = new LibraryRepository(join(root, "a")),
    b = new LibraryRepository(join(root, "b"));
  try {
    const s = a.addSource("https://example.com/redis");
    a.saveArticle(
      {
        candidate: {
          sourceId: s.id,
          canonicalUrl: s.entryUrl,
          title: "Redis",
          sectionPath: [],
        },
        markdown: "AOF 记录写命令。",
        text: "AOF",
        assets: [],
        fetchedAt: new Date().toISOString(),
      },
      [],
    );
    const evidence = retrieve(a, "AOF", {});
    const record = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      question: "AOF?",
      scope: {},
      allowSupplement: false,
      provider: "online" as const,
      model: "deepseek-flash",
      status: "complete" as const,
      evidence,
      answer: {
        paragraphs: [{ text: "记录写命令", sources: [evidence[0].id] }],
        insufficient: false,
        supplement: "",
      },
    };
    a.putQa(record);
    const file = join(root, "backup.ikb");
    await exportLibrary(a, file);
    await importBackup(b, file);
    expect(b.listQa()).toEqual([record]);
    b.putQa({ ...record, question: "本机修改" });
    await importBackup(b, file);
    expect(b.listQa()).toHaveLength(2);
    await importBackup(b, file);
    expect(b.listQa()).toHaveLength(2);
  } finally {
    a.close();
    b.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("v1 备份可导入，篡改问答摘录被拒绝且目标库不变", async () => {
  const { validateBackup } = await import("../../src/main/backup/validate");
  const { ZipFile } = await import("yazl");
  const { createWriteStream } = await import("node:fs");
  const { pipeline } = await import("node:stream/promises");
  const root = mkdtempSync(join(tmpdir(), "qa-backup-validate-")),
    a = new LibraryRepository(join(root, "a")),
    b = new LibraryRepository(join(root, "b"));
  try {
    const s = a.addSource("https://example.com");
    a.saveArticle(
      {
        candidate: {
          sourceId: s.id,
          canonicalUrl: s.entryUrl,
          title: "AOF",
          sectionPath: [],
        },
        markdown: "AOF 记录写命令。",
        text: "AOF",
        assets: [],
        fetchedAt: new Date().toISOString(),
      },
      [],
    );
    const evidence = retrieve(a, "AOF", {});
    a.putQa({
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      question: "AOF?",
      scope: {},
      allowSupplement: false,
      provider: "online",
      model: "test",
      status: "complete",
      evidence,
      answer: { paragraphs: [], insufficient: true, supplement: "" },
    });
    const file = join(root, "original.ikb");
    await exportLibrary(a, file);
    const validated = await validateBackup(file);
    try {
      const write = async (path: string, m: any) => {
        const zip = new ZipFile(),
          done = pipeline(zip.outputStream, createWriteStream(path));
        zip.addBuffer(Buffer.from(JSON.stringify(m)), "manifest.json");
        for (const f of m.files)
          zip.addFile(join(validated.root, f.path), f.path);
        zip.end();
        await done;
      };
      const legacy = {
        ...validated.manifest,
        formatVersion: 1,
        qaRecords: undefined,
      };
      const old = join(root, "old.ikb");
      await write(old, legacy);
      await importBackup(b, old);
      expect(b.listArticles()).toHaveLength(1);
      expect(b.listQa()).toHaveLength(0);
      validated.manifest.qaRecords[0].evidence[0].quote = "伪造的引文";
      const bad = join(root, "bad.ikb");
      await write(bad, validated.manifest);
      await expect(importBackup(b, bad)).rejects.toThrow(
        "问答引用与原文不一致",
      );
      expect(b.listQa()).toHaveLength(0);
    } finally {
      await validated.dispose();
    }
  } finally {
    a.close();
    b.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("超长段落的问答备份仍可往返，超出上下文的段落不阻塞其他结果", async () => {
  const root = mkdtempSync(join(tmpdir(), "qa-long-")),
    a = new LibraryRepository(join(root, "a")),
    b = new LibraryRepository(join(root, "b"));
  try {
    const s = a.addSource("https://example.com/long"),
      candidate = {
        sourceId: s.id,
        canonicalUrl: s.entryUrl,
        title: "资料",
        sectionPath: [],
      };
    const save = (markdown: string) =>
      a.saveArticle(
        {
          candidate,
          markdown,
          text: markdown,
          assets: [],
          fetchedAt: new Date().toISOString(),
        },
        [],
      );
    save("AOF " + "x".repeat(13000));
    const evidence = retrieve(a, "AOF", {});
    expect(evidence).toHaveLength(1);
    a.putQa({
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      question: "AOF?",
      scope: {},
      allowSupplement: false,
      provider: "online",
      model: "test",
      status: "failed",
      evidence,
      error: "无密钥",
    });
    const file = join(root, "long.ikb");
    await exportLibrary(a, file);
    await importBackup(b, file);
    expect(b.listQa()).toHaveLength(1);
    save("AOF Redis " + "x".repeat(20000) + "\n\nAOF 记录写命令。");
    expect(
      retrieve(a, "AOF Redis", {}).some((e) => e.quote.includes("记录写命令")),
    ).toBe(true);
  } finally {
    a.close();
    b.close();
    rmSync(root, { recursive: true, force: true });
  }
});
