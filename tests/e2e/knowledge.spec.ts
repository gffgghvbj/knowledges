import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryRepository } from "../../src/main/library/repository";
test("设置模型、提问、查看历史版本引用，重启保留问答", async () => {
  const root = await mkdtemp(join(tmpdir(), "qa-ui-"));
  const repo = new LibraryRepository(join(root, "library"));
  const s = repo.addSource("https://example.com/redis");
  const oldVersion = repo.saveArticle(
    {
      candidate: {
        sourceId: s.id,
        canonicalUrl: s.entryUrl,
        title: "Redis 持久化",
        sectionPath: ["数据库"],
      },
      markdown:
        "# Redis 持久化\n\nAOF 通过追加写命令保存数据。RDB 保存内存快照。",
      text: "Redis AOF RDB",
      assets: [],
      fetchedAt: new Date().toISOString(),
    },
    [],
  );
  const article = repo.getArticle(oldVersion.articleId)!;
  const newVersion = repo.saveArticle(
    {
      candidate: article,
      markdown: "# 新版本\n\n更新后正文",
      text: "更新后正文",
      assets: [],
      fetchedAt: new Date().toISOString(),
    },
    [],
  );
  repo.restoreVersion(article.id, oldVersion.id);
  repo.close();
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw),
      context =
        body.messages.length > 1 ? JSON.parse(body.messages[1].content) : null;
    const answer = context
      ? {
          paragraphs: [
            {
              text: "AOF 保存写命令，RDB 保存内存快照。",
              sources: [context.evidence[0].id],
            },
          ],
          insufficient: false,
          supplement: "",
        }
      : { ok: true };
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        message: { content: JSON.stringify(answer) },
        done: true,
      }),
    );
  });
  await new Promise<void>((r, j) => {
    server.once("error", j);
    server.listen(0, "127.0.0.1", r);
  });
  const port = (server.address() as any).port;
  const launch = () =>
    electron.launch({
      args: process.env.ELECTRON_APP_PATH ? [] : ["."],
      executablePath: process.env.ELECTRON_APP_PATH,
      env: { ...process.env, LIBRARY_DATA_DIR: root },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.getByRole("button", { name: "模型设置", exact: true }).click();
    await page
      .getByRole("button", { name: "Ollama 本地模型", exact: true })
      .click();
    await page.getByLabel("服务地址").fill(`http://127.0.0.1:${port}`);
    await page.getByLabel("模型名称").fill("local-test");
    await page
      .getByRole("button", { name: "保存并测试连接", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("连接成功");
    await page.getByRole("button", { name: "知识库问答", exact: true }).click();
    await page.getByLabel("问答模型").selectOption("ollama");
    await page
      .getByLabel("输入问题", { exact: true })
      .fill("Redis 的 AOF 和 RDB 有什么区别？");
    await page.getByRole("button", { name: "发送问题 ↑", exact: true }).click();
    await expect(page.locator(".answer-paragraph")).toContainText(
      "AOF 保存写命令",
    );
    await page.evaluate(
      ({ articleId, versionId }) =>
        (window as any).libraryApi.restore(articleId, versionId),
      { articleId: article.id, versionId: newVersion.id },
    );
    await app.evaluate(({ shell }) => {
      shell.openPath = async (path: string) => {
        (globalThis as any).__openedMarkdown = path;
        return "";
      };
    });
    await page.locator(".citation-links button").first().click();
    await expect(page.getByRole("dialog")).toContainText(
      "AOF 通过追加写命令保存数据",
    );
    await page.getByText("查看这个版本的完整文章", { exact: true }).click();
    await page
      .getByRole("button", { name: "打开 Markdown", exact: true })
      .click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__openedMarkdown))
      .toBe(join(root, "library", oldVersion.markdownPath));
    await page.getByRole("button", { name: "关闭引用", exact: true }).click();
    await page.screenshot({
      path: "test-results/knowledge-desktop.png",
      fullPage: true,
    });
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole("button", { name: "知识库问答", exact: true }).click();
    await page.locator(".qa-history .article-item").first().click();
    await expect(page.locator(".answer-paragraph")).toContainText(
      "AOF 保存写命令",
    );
    await page
      .getByLabel("输入问题", { exact: true })
      .fill("火星上怎么种西红柿");
    await page.getByRole("button", { name: "发送问题 ↑", exact: true }).click();
    await expect(page.locator(".insufficient")).toBeVisible();
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
