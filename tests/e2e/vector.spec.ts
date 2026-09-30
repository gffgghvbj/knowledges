import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryRepository } from "../../src/main/library/repository";
test("Qwen 向量和精排设置到无关键词问答的完整流程", async () => {
  const root = await mkdtemp(join(tmpdir(), "vector-ui-")),
    repo = new LibraryRepository(join(root, "library")),
    s = repo.addSource("https://example.com/redis");
  repo.saveArticle(
    {
      candidate: {
        sourceId: s.id,
        canonicalUrl: s.entryUrl,
        title: "持久化",
        sectionPath: ["数据库"],
      },
      markdown: "AOF 将写命令追加到日志文件。",
      text: "AOF",
      assets: [],
      fetchedAt: new Date().toISOString(),
    },
    [],
  );
  repo.close();
  const calls: string[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const b = JSON.parse(raw);
    calls.push(req.url!);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/embed")
      res.end(
        JSON.stringify({
          output: {
            embeddings: b.input.texts.map((_t: string, i: number) => ({
              text_index: i,
              embedding: [1, 0, 0],
            })),
          },
        }),
      );
    else if (req.url === "/rank")
      res.end(
        JSON.stringify({
          output: {
            results: b.input.documents.map((_t: string, i: number) => ({
              index: i,
              relevance_score: 1 / (i + 1),
            })),
          },
        }),
      );
    else {
      const context = JSON.parse(b.messages[1].content);
      res.end(
        JSON.stringify({
          done: true,
          message: {
            content: JSON.stringify({
              paragraphs: [
                {
                  text: "通过 AOF 日志恢复写入的数据。",
                  sources: [context.evidence[0].id],
                },
              ],
              insufficient: false,
              supplement: "",
            }),
          },
        }),
      );
    }
  });
  await new Promise<void>((r, j) => {
    server.once("error", j);
    server.listen(0, "127.0.0.1", r);
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}`,
    app = await electron.launch({
      args: process.env.ELECTRON_APP_PATH ? [] : ["."],
      executablePath: process.env.ELECTRON_APP_PATH,
      env: { ...process.env, LIBRARY_DATA_DIR: root },
    });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "模型设置", exact: true }).click();
    await page.getByLabel("启用混合检索", { exact: true }).check();
    await page
      .getByLabel("Embedding 接口地址", { exact: true })
      .fill(base + "/embed");
    await page.getByLabel("向量维度", { exact: true }).fill("3");
    await page
      .getByLabel("Rerank 接口地址", { exact: true })
      .fill(base + "/rank");
    await page
      .getByRole("button", { name: "保存并测试检索", exact: true })
      .click();
    await expect(
      page.getByText("检索连接成功 · 3 维", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "建立 / 继续索引", exact: true })
      .click();
    await expect(
      page.getByText("向量索引已就绪", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/vector-settings.png",
      fullPage: true,
    });
    await page.evaluate(async (base) => {
      await (window as any).libraryApi.saveModel({
        provider: "ollama",
        baseUrl: base,
        model: "test-chat",
      });
    }, base);
    await page.getByRole("button", { name: "知识库问答", exact: true }).click();
    await page.getByLabel("问答模型", { exact: true }).selectOption("ollama");
    await page
      .getByLabel("输入问题", { exact: true })
      .fill("怎样在宕机以后找回信息？");
    await page.getByRole("button", { name: "发送问题 ↑", exact: true }).click();
    await expect(page.locator(".answer-paragraph")).toContainText(
      "通过 AOF 日志恢复",
    );
    await expect(page.locator(".retrieval-trace")).toContainText(
      "混合检索 + 精排",
    );
    const records = await page.evaluate(() =>
      (window as any).libraryApi.qaHistory(),
    );
    expect(records[0].retrieval.embeddingModel).toBe(
      "qwen3.7-text-embedding-flash",
    );
    expect(records[0].retrieval.rerankModel).toBe("qwen3.7-text-rerank");
    expect(calls).toContain("/embed");
    expect(calls).toContain("/rank");
    await page.screenshot({
      path: "test-results/vector-desktop.png",
      fullPage: true,
    });
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
