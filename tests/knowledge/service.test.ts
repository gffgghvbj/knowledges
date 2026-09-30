import { test, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { LibraryRepository } from "../../src/main/library/repository";
import { ModelSettings } from "../../src/main/knowledge/settings";
import { QaService } from "../../src/main/knowledge/service";
const codec = {
  encryptString: (s: string) => Buffer.from(s.split("").reverse().join("")),
  decryptString: (b: Buffer) => b.toString().split("").reverse().join(""),
  isEncryptionAvailable: () => true,
};
test("在线/Ollama 协议、落库、拒绝虚构引用与重试保留", async () => {
  const root = mkdtempSync(join(tmpdir(), "qa-service-")),
    repo = new LibraryRepository(root);
  let bad = false;
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const data = JSON.parse(body);
    requests.push({ url: req.url, key: req.headers.authorization, data });
    const context = JSON.parse(data.messages[1].content).evidence;
    const answer = JSON.stringify({
      paragraphs: [
        {
          text: "AOF 记录写命令",
          sources: [bad ? "a".repeat(64) : context[0].id],
        },
      ],
      insufficient: false,
      supplement: "",
    });
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        req.url === "/api/chat"
          ? { message: { content: answer }, done: true }
          : {
              choices: [
                { message: { content: answer }, finish_reason: "stop" },
              ],
            },
      ),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const port = (server.address() as any).port,
      settings = new ModelSettings(root, codec);
    settings.save({
      provider: "online",
      baseUrl: `http://127.0.0.1:${port}`,
      model: "test-model",
      apiKey: "secret-sentinel",
    });
    expect(
      readFileSync(join(root, "model-settings.json"), "utf8"),
    ).not.toContain("secret-sentinel");
    expect(JSON.stringify(settings.list())).not.toContain("secret-sentinel");
    const s = repo.addSource("https://example.com/redis");
    repo.saveArticle(
      {
        candidate: {
          sourceId: s.id,
          canonicalUrl: s.entryUrl,
          title: "Redis",
          sectionPath: [],
        },
        markdown: "AOF 记录写命令",
        text: "AOF",
        assets: [],
        fetchedAt: new Date().toISOString(),
      },
      [],
    );
    const service = new QaService(repo, settings);
    const first = service.ask("AOF 是什么？", {}, "online", false);
    await service.waitForIdle();
    expect(repo.listQa().find((r) => r.id === first)?.status).toBe("complete");
    expect(requests[0].url).toBe("/chat/completions");
    expect(requests[0].key).toBe("Bearer secret-sentinel");
    settings.save({
      provider: "ollama",
      baseUrl: `http://127.0.0.1:${port}`,
      model: "local",
    });
    const second = service.ask("AOF", {}, "ollama", false);
    await service.waitForIdle();
    expect(requests[1].url).toBe("/api/chat");
    expect(requests[1].key).toBeUndefined();
    expect(repo.listQa().find((r) => r.id === second)?.status).toBe("complete");
    bad = true;
    service.ask("AOF", {}, "online", false);
    await service.waitForIdle();
    expect(repo.listQa().some((r) => r.status === "failed")).toBe(true);
    expect(repo.listQa()).toHaveLength(3);
    settings.save({
      provider: "online",
      baseUrl: "https://different.example",
      model: "other",
    });
    expect(settings.list()[0].hasKey).toBe(false);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    repo.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("立即取消和缺少密钥仍保留可重试的问题", async () => {
  const root = mkdtempSync(join(tmpdir(), "qa-cancel-")),
    repo = new LibraryRepository(root);
  try {
    const settings = new ModelSettings(root, codec),
      service = new QaService(repo, settings, 10);
    const id = service.ask("Redis", {}, "online", true);
    service.cancel(id);
    await service.waitForIdle();
    expect(repo.listQa()[0].status).toBe("cancelled");
    const failedId = service.ask("Redis", {}, "online", true);
    await service.waitForIdle();
    expect(repo.listQa().find((r) => r.id === failedId)?.status).toBe("failed");
    expect(repo.listQa().find((r) => r.id === failedId)?.error).toContain(
      "API Key",
    );
  } finally {
    repo.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("没有资料时直接说明不足；重启将未完成问题变为可重试", async () => {
  const root = mkdtempSync(join(tmpdir(), "qa-recovery-")),
    repo = new LibraryRepository(root);
  try {
    const settings = new ModelSettings(root, codec),
      service = new QaService(repo, settings);
    service.ask("完全不相关的问题", {}, "online", false);
    await service.waitForIdle();
    const record = repo.listQa()[0];
    expect(record.status).toBe("complete");
    expect(record.answer?.insufficient).toBe(true);
    repo.putQa({ ...record, status: "pending", answer: undefined });
    new QaService(repo, settings);
    expect(repo.listQa()[0].status).toBe("failed");
    expect(repo.listQa()[0].question).toBe(record.question);
  } finally {
    repo.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("模型超时不丢失问题，敏感设置不允许不安全地址", async () => {
  const root = mkdtempSync(join(tmpdir(), "qa-timeout-")),
    repo = new LibraryRepository(root),
    settings = new ModelSettings(root, codec);
  const server = createServer((_req, _res) => {});
  await new Promise<void>((r, j) => {
    server.once("error", j);
    server.listen(0, "127.0.0.1", r);
  });
  try {
    expect(() =>
      settings.save({
        provider: "online",
        baseUrl: "http://remote.example",
        model: "x",
        apiKey: "secret",
      }),
    ).toThrow("HTTPS");
    expect(() =>
      settings.save({
        provider: "online",
        baseUrl: "https://user:secret@example.com",
        model: "x",
      }),
    ).toThrow();
    settings.save({
      provider: "ollama",
      baseUrl: `http://127.0.0.1:${(server.address() as any).port}`,
      model: "slow",
    });
    const service = new QaService(repo, settings, 25);
    service.ask("超时问题", {}, "ollama", true);
    await service.waitForIdle();
    expect(repo.listQa()[0].error).toContain("超时");
    expect(repo.listQa()[0].question).toBe("超时问题");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    repo.close();
    rmSync(root, { recursive: true, force: true });
  }
});
