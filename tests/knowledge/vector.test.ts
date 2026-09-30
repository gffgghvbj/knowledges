import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LibraryRepository } from "../../src/main/library/repository";
import { RetrievalSettings } from "../../src/main/knowledge/retrieval-settings";
import { VectorIndex } from "../../src/main/knowledge/vector-index";
import { HybridRetriever } from "../../src/main/knowledge/hybrid";
import { retrieve } from "../../src/main/knowledge/index";
const codec = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString(),
};
function setup() {
  const root = mkdtempSync(join(tmpdir(), "vector-")),
    repo = new LibraryRepository(root),
    settings = new RetrievalSettings(root, codec);
  settings.save({
    ...settings.get(),
    enabled: true,
    embedding: {
      ...settings.get().embedding,
      url: "https://example.com/embed",
      dimensions: 3,
      apiKey: "test",
    },
    rerank: { ...settings.get().rerank, enabled: false },
  });
  const source = repo.addSource("https://docs.example.com/");
  const save = (path: string, markdown: string, section = "数据库") =>
    repo.saveArticle(
      {
        candidate: {
          sourceId: source.id,
          canonicalUrl: source.entryUrl + path,
          title: path,
          sectionPath: [section],
        },
        markdown,
        text: markdown,
        assets: [],
        fetchedAt: new Date().toISOString(),
      },
      [],
    );
  return {
    root,
    repo,
    settings,
    source,
    save,
    dispose: () => {
      repo.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
const embedder = async (_config: any, texts: string[]) =>
  texts.map((text) => (text.includes("垃圾") ? [0, 1, 0] : [1, 0, 0]));
test("document updates reject stale vectors without pausing", async () => {
  const f = setup();
  let release!: (vectors: number[][]) => void;
  let calls = 0;
  const pending = new Promise<number[][]>((resolve) => {
    release = resolve;
  });
  const index = new VectorIndex(f.repo, f.settings, async () => {
    if (++calls === 1) return pending;
    return [[0, 1, 0]];
  });
  try {
    f.save("article", "old body");
    index.start();
    await new Promise((resolve) => setImmediate(resolve));
    f.save("article", "updated body");
    release([[1, 0, 0]]);
    await index.waitForIdle();
    expect(calls).toBe(2);
    const rows = f.repo.db
      .prepare("SELECT vector FROM vector_embeddings")
      .all();
    expect(rows).toHaveLength(1);
    expect(Buffer.from(rows[0].vector as Uint8Array).readFloatLE(4)).toBe(1);
  } finally {
    index.close();
    await index.waitForIdle();
    f.dispose();
  }
});
test("reopening the database resumes pending work and preserves failures", async () => {
  const f = setup();
  let repo = f.repo;
  let settings = f.settings;
  let index = new VectorIndex(repo, settings, embedder);
  const reopen = (adapter: typeof embedder) => {
    index.close();
    repo.close();
    repo = new LibraryRepository(f.root);
    settings = new RetrievalSettings(f.root, codec);
    index = new VectorIndex(repo, settings, adapter);
  };
  try {
    f.save("first", "first body");
    index.start();
    await index.waitForIdle();
    f.save("second", "pending body");
    let requested = 0;
    reopen(async (c, t) => {
      requested += t.length;
      return embedder(c, t);
    });
    await index.tick();
    expect(requested).toBe(1);
    expect(index.status().ready).toBe(2);
    reopen(async () => {
      throw Error("network failure");
    });
    index.rebuild();
    await index.waitForIdle();
    expect(index.status().state).toBe("failed");
    reopen(async (c, t) => {
      requested += t.length;
      return embedder(c, t);
    });
    await index.tick();
    expect(index.status().state).toBe("failed");
    expect(requested).toBe(1);
    index.start();
    await index.waitForIdle();
    expect(index.status().ready).toBe(2);
  } finally {
    index.close();
    await index.waitForIdle();
    repo.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
test("语义召回没有共同词的资料，范围、版本、持久化缓存与模型空间隔离", async () => {
  const f = setup();
  let calls = 0;
  const counting = async (c: any, t: string[]) => {
    calls++;
    return embedder(c, t);
  };
  const index = new VectorIndex(f.repo, f.settings, counting);
  try {
    const old = f.save("持久化", "AOF 将写命令追加到日志文件。"),
      other = f.save("垃圾回收", "垃圾回收采用分代策略。", "Java");
    const query = "怎样在宕机以后找回信息？";
    expect(retrieve(f.repo, query, {})).toEqual([]);
    index.start();
    await index.waitForIdle();
    expect(index.status().ready).toBe(2);
    const originalCalls = calls;
    await index.tick();
    expect(calls).toBe(originalCalls);
    const hybrid = new HybridRetriever(f.repo, f.settings, index, {
      embed: counting,
      rerank: async () => [],
    });
    const result = await hybrid.retrieve(
      query,
      {},
      new AbortController().signal,
    );
    expect(result.evidence[0].versionId).toBe(old.id);
    expect(result.trace.mode).toBe("hybrid");
    expect(
      (
        await hybrid.retrieve(
          query,
          { section: "Java" },
          new AbortController().signal,
        )
      ).evidence,
    ).toEqual([]);
    f.save("持久化", "替换后的正文。");
    expect(index.status().ready).toBe(1);
    f.repo.restoreVersion(old.articleId, old.id);
    expect(index.status().ready).toBe(2);
    f.settings.save({
      ...f.settings.get(),
      embedding: { ...f.settings.get().embedding, model: "different-model" },
    });
    expect(index.status().ready).toBe(0);
    index.start();
    await index.waitForIdle();
    expect(index.status().ready).toBe(2);
    const restarted = new VectorIndex(f.repo, f.settings, counting);
    await restarted.tick();
    expect(restarted.status().ready).toBe(2);
    restarted.close();
  } finally {
    index.close();
    await index.waitForIdle();
    f.dispose();
  }
});
test("请求期间更新原文或暂停不会写入过期向量，失败暂停且可恢复", async () => {
  const f = setup();
  let release: (v: number[][]) => void = () => {};
  const pending = new Promise<number[][]>((r) => (release = r));
  let delayed = true;
  const index = new VectorIndex(f.repo, f.settings, async (c, t) =>
    delayed ? pending : embedder(c, t),
  );
  try {
    f.save("文章", "旧资料");
    index.start();
    await new Promise((r) => setImmediate(r));
    f.save("文章", "新资料");
    index.pause();
    release([[1, 0, 0]]);
    await index.waitForIdle();
    expect(index.status().ready).toBe(0);
    expect(index.status().state).toBe("paused");
    delayed = false;
    index.start();
    await index.waitForIdle();
    expect(index.status().ready).toBe(1);
    const failed = new VectorIndex(f.repo, f.settings, async () => {
      throw Error("network secret should not leak");
    });
    f.save("第二篇", "额外资料");
    failed.start();
    await failed.waitForIdle();
    expect(failed.status().state).toBe("failed");
    expect(failed.status().error).not.toContain("secret");
    failed.close();
  } finally {
    index.close();
    await index.waitForIdle();
    f.dispose();
  }
});

test("精排使用候选索引，异常降级可见，取消不会继续精排", async () => {
  const f = setup(),
    index = new VectorIndex(f.repo, f.settings, embedder);
  try {
    f.save("a", "AOF 写日志。");
    f.save("b", "RDB 内存快照。");
    index.start();
    await index.waitForIdle();
    f.settings.save({
      ...f.settings.get(),
      rerank: {
        ...f.settings.get().rerank,
        enabled: true,
        url: "https://example.com/rerank",
        apiKey: "test",
      },
    });
    let rerankCalls = 0;
    const hybrid = new HybridRetriever(f.repo, f.settings, index, {
      embed: embedder,
      rerank: async (_c, _q, docs) => {
        rerankCalls++;
        return docs
          .map((_, i) => i)
          .sort(
            (a, b) =>
              Number(docs[b].includes("RDB")) - Number(docs[a].includes("RDB")),
          );
      },
    });
    const result = await hybrid.retrieve(
      "宕机时如何找回信息",
      {},
      new AbortController().signal,
    );
    expect(result.evidence[0].quote).toContain("RDB");
    expect(result.trace.mode).toBe("hybrid-rerank");
    const failed = new HybridRetriever(f.repo, f.settings, index, {
      embed: embedder,
      rerank: async () => {
        throw Error("secret from remote");
      },
    });
    const fallback = await failed.retrieve(
      "AOF",
      {},
      new AbortController().signal,
    );
    expect(fallback.trace.mode).toBe("hybrid");
    expect(fallback.trace.warning).toContain("已使用召回顺序");
    expect(fallback.trace.warning).not.toContain("secret");
    const abort = new AbortController();
    abort.abort();
    await expect(hybrid.retrieve("AOF", {}, abort.signal)).rejects.toThrow();
    expect(rerankCalls).toBe(1);
  } finally {
    index.close();
    await index.waitForIdle();
    f.dispose();
  }
});

test("备份保留检索记录，不迁移向量和密钥，导入后可重建", async () => {
  const { exportLibrary } = await import("../../src/main/backup/export"),
    { importBackup } = await import("../../src/main/backup/merge"),
    { validateBackup } = await import("../../src/main/backup/validate");
  const { randomUUID } = await import("node:crypto");
  const a = setup(),
    b = setup(),
    index = new VectorIndex(a.repo, a.settings, embedder),
    target = new VectorIndex(b.repo, b.settings, embedder);
  try {
    a.save("资料", "AOF 写命令日志。");
    index.start();
    await index.waitForIdle();
    const hybrid = new HybridRetriever(a.repo, a.settings, index, {
      embed: embedder,
      rerank: async () => [],
    });
    const result = await hybrid.retrieve(
      "宕机以后找回信息",
      {},
      new AbortController().signal,
    );
    a.repo.putQa({
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      question: "宕机以后找回信息",
      scope: {},
      allowSupplement: false,
      provider: "online",
      model: "chat",
      status: "complete",
      evidence: result.evidence,
      retrieval: result.trace,
      answer: {
        paragraphs: [{ text: "保存写日志", sources: [result.evidence[0].id] }],
        insufficient: false,
        supplement: "",
      },
    });
    const file = join(a.root, "portable.ikb");
    await exportLibrary(a.repo, file);
    const backup = await validateBackup(file);
    try {
      expect(
        backup.manifest.files.some((f) =>
          /settings|sqlite|vector/.test(f.path),
        ),
      ).toBe(false);
    } finally {
      await backup.dispose();
    }
    await importBackup(b.repo, file);
    expect(b.repo.listQa()[0].retrieval?.mode).toBe("hybrid");
    expect(target.status().ready).toBe(0);
    expect(target.status().total).toBe(1);
    target.start();
    await target.waitForIdle();
    expect(target.status().ready).toBe(1);
  } finally {
    index.close();
    target.close();
    await index.waitForIdle();
    await target.waitForIdle();
    a.dispose();
    b.dispose();
  }
});

test("异步检索前已保存问题，取消保持取消状态且不生成回答", async () => {
  const { QaService } = await import("../../src/main/knowledge/service"),
    { ModelSettings } = await import("../../src/main/knowledge/settings");
  const f = setup();
  let release: () => void = () => {};
  const wait = new Promise<void>((r) => (release = r));
  let signal: AbortSignal | undefined;
  const service = new QaService(
    f.repo,
    new ModelSettings(f.root, codec),
    5000,
    {
      retrieve: async (_q, _s, s) => {
        signal = s;
        await wait;
        s.throwIfAborted();
        return { evidence: [], trace: { mode: "hybrid" } };
      },
    },
  );
  try {
    const id = service.ask("等待检索", {}, "online", false);
    expect(f.repo.listQa()[0].status).toBe("pending");
    await new Promise((r) => setImmediate(r));
    service.cancel(id);
    expect(signal?.aborted).toBe(true);
    release();
    await service.waitForIdle();
    expect(f.repo.listQa()[0].status).toBe("cancelled");
    expect(f.repo.listQa()[0].answer).toBeUndefined();
  } finally {
    release();
    await service.waitForIdle();
    f.dispose();
  }
});
