import { test, expect } from "vitest";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RetrievalSettings } from "../../src/main/knowledge/retrieval-settings";
import { embed, rerank } from "../../src/main/knowledge/retrieval-api";
const codec = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s.split("").reverse().join("")),
  decryptString: (b: Buffer) => b.toString().split("").reverse().join(""),
};
test("Qwen 原生/兼容/Ollama 请求、索引乱序映射和独立密钥", async () => {
  const requests: any[] = [];
  let mode = "embed";
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const c of req) text += c;
    const body = JSON.parse(text);
    requests.push({ body, key: req.headers.authorization });
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        mode === "rerank"
          ? {
              output: {
                results: [
                  { index: 1, relevance_score: 0.9 },
                  { index: 0, relevance_score: 0.2 },
                ],
              },
            }
          : mode === "ollama"
            ? {
                embeddings: [
                  [3, 4, 0],
                  [0, 0, 1],
                ],
              }
            : mode === "compatible"
              ? {
                  data: [
                    { index: 1, embedding: [0, 0, 1] },
                    { index: 0, embedding: [3, 4, 0] },
                  ],
                }
              : {
                  output: {
                    embeddings: [
                      { text_index: 1, embedding: [0, 0, 1] },
                      { text_index: 0, embedding: [3, 4, 0] },
                    ],
                  },
                },
      ),
    );
  });
  await new Promise<void>((r, j) => {
    server.once("error", j);
    server.listen(0, "127.0.0.1", r);
  });
  const root = mkdtempSync(join(tmpdir(), "retrieval-api-"));
  try {
    const url = `http://127.0.0.1:${(server.address() as any).port}`,
      settings = new RetrievalSettings(root, codec),
      input = {
        ...settings.get(),
        enabled: true,
        embedding: {
          ...settings.get().embedding,
          url,
          dimensions: 3,
          apiKey: "embedding-secret",
        },
        rerank: { ...settings.get().rerank, url, apiKey: "rerank-secret" },
      };
    settings.save(input);
    expect(
      readFileSync(join(root, "retrieval-settings.json"), "utf8"),
    ).not.toContain("embedding-secret");
    expect(JSON.stringify(settings.get())).not.toContain("rerank-secret");
    let config = settings.resolve();
    let result = await embed(
      config.embedding,
      ["文档一", "文档二"],
      "document",
      AbortSignal.timeout(3000),
    );
    expect(result[0]).toEqual([0.6, 0.8, 0]);
    expect(result[1]).toEqual([0, 0, 1]);
    expect(requests[0].body.input.texts).toEqual(["文档一", "文档二"]);
    expect(requests[0].body.parameters.text_type).toBe("document");
    expect(requests[0].key).toBe("Bearer embedding-secret");
    mode = "rerank";
    expect(
      await rerank(
        config.rerank,
        "问题",
        ["一", "二"],
        AbortSignal.timeout(3000),
      ),
    ).toEqual([1, 0]);
    expect(requests[1].body.input.query).toBe("问题");
    expect(requests[1].key).toBe("Bearer rerank-secret");
    mode = "compatible";
    await embed(
      { ...config.embedding, protocol: "openai" },
      ["a", "b"],
      "query",
      AbortSignal.timeout(3000),
    );
    expect(requests[2].body.input).toEqual(["a", "b"]);
    mode = "ollama";
    await embed(
      { ...config.embedding, protocol: "ollama", apiKey: "" },
      ["a", "b"],
      "query",
      AbortSignal.timeout(3000),
    );
    expect(requests[3].key).toBeUndefined();
    expect(requests[3].body.truncate).toBe(false);
    settings.save({
      ...settings.get(),
      embedding: { ...settings.get().embedding, url: url + "/new" },
    });
    expect(settings.get().embedding.hasKey).toBe(false);
    expect(settings.get().rerank.hasKey).toBe(true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(root, { recursive: true, force: true });
  }
});

test("拒绝维度、重复索引、零向量和精排越界，不跟随重定向", async () => {
  let response: any = {
    output: { embeddings: [{ text_index: 0, embedding: [0, 0, 0] }] },
  };
  let redirect = false;
  const server = createServer((_req, res) => {
    if (redirect) {
      res.writeHead(302, { Location: "http://127.0.0.1:1/leak" });
      res.end();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(response));
  });
  await new Promise<void>((r, j) => {
    server.once("error", j);
    server.listen(0, "127.0.0.1", r);
  });
  try {
    const config = {
      url: `http://127.0.0.1:${(server.address() as any).port}`,
      model: "test",
      protocol: "dashscope" as const,
      dimensions: 3,
      apiKey: "sentinel",
    };
    await expect(
      embed(config, ["a"], "document", AbortSignal.timeout(1000)),
    ).rejects.toThrow("向量为空");
    response = {
      output: { embeddings: [{ text_index: 0, embedding: [1, 0] }] },
    };
    await expect(
      embed(config, ["a"], "document", AbortSignal.timeout(1000)),
    ).rejects.toThrow("维度");
    response = {
      output: {
        embeddings: [
          { text_index: 0, embedding: [1, 0, 0] },
          { text_index: 0, embedding: [1, 0, 0] },
        ],
      },
    };
    await expect(
      embed(config, ["a", "b"], "document", AbortSignal.timeout(1000)),
    ).rejects.toThrow("索引");
    response = { output: { results: [{ index: 7, relevance_score: 1 }] } };
    await expect(
      rerank(
        { ...config, enabled: true },
        "q",
        ["a"],
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("索引");
    redirect = true;
    await expect(
      embed(config, ["a"], "document", AbortSignal.timeout(1000)),
    ).rejects.toThrow();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
