import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("delete sources, tasks and articles with confirmation and recover articles from trash", async () => {
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      `<article><h1>${req.url === "/" ? "网站导读" : "Redis 持久化"}</h1><p>用于验证删除和恢复的本地资料。</p></article>`,
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}/redis`;
  const root = await mkdtemp(join(tmpdir(), "delete-ui-"));
  const app = await electron.launch({
    args: process.env.ELECTRON_APP_PATH ? [] : ["."],
    executablePath: process.env.ELECTRON_APP_PATH,
    env: { ...process.env, LIBRARY_DATA_DIR: root },
  });
  try {
    const page = await app.firstWindow();
    const scan = await page.evaluate(async (url) => {
      const api = (window as any).libraryApi;
      const s = await api.addSource(url);
      return api.scan(s.id);
    }, url);
    await expect
      .poll(async () =>
        page.evaluate(
          async (id) =>
            (await (window as any).libraryApi.state()).tasks.find(
              (t: any) => t.id === id,
            ).state,
          scan,
        ),
      )
      .toBe("complete");
    await page.evaluate(
      async (scan) => (window as any).libraryApi.capture(scan, ["其他"]),
      scan,
    );
    await expect
      .poll(
        async () =>
          page.evaluate(
            async () =>
              (await (window as any).libraryApi.state()).articles.length,
          ),
        { timeout: 15000 },
      )
      .toBe(2);
    await page.getByRole("button", { name: "资料库", exact: true }).click();
    await expect(page.locator(".article-select-row")).toHaveCount(2);
    await page.getByLabel("全选本页文章").check();
    await page.getByRole("button", { name: /删除所选/ }).click();
    const confirmation = page.getByRole("dialog", {
      name: "将文章移入回收站？",
    });
    await confirmation
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await expect(page.locator(".article-select-row")).toHaveCount(2);
    await page.getByRole("button", { name: /删除所选/ }).click();
    await confirmation
      .getByRole("button", { name: "确认移入回收站", exact: true })
      .click();
    await expect(page.locator(".article-select-row")).toHaveCount(0);
    await page.getByRole("button", { name: "回收站", exact: true }).click();
    await expect(page.locator(".article-select-row")).toHaveCount(2);
    await page
      .getByRole("button", { name: "Redis 持久化", exact: true })
      .click();
    await expect(page.locator(".markdown")).toContainText("本地资料");
    await page.screenshot({
      path: "test-results/article-trash.png",
      fullPage: true,
    });
    await page.getByLabel("全选本页文章").check();
    await page.getByRole("button", { name: /恢复所选/ }).click();
    await expect(page.locator(".article-select-row")).toHaveCount(0);
    await page.getByRole("button", { name: "全部资料", exact: true }).click();
    await expect(page.locator(".article-select-row")).toHaveCount(2);
    await page
      .getByRole("button", { name: "Redis 持久化", exact: true })
      .click();
    await page.getByRole("button", { name: "删除文章", exact: true }).click();
    await confirmation
      .getByRole("button", { name: "确认移入回收站", exact: true })
      .click();
    await expect(page.locator(".article-select-row")).toHaveCount(1);
    await page.getByRole("button", { name: "回收站", exact: true }).click();
    await page
      .getByRole("button", { name: "Redis 持久化", exact: true })
      .click();
    await page.getByRole("button", { name: "恢复文章", exact: true }).click();
    await expect(page.locator(".article-select-row")).toHaveCount(0);
    await page.getByRole("button", { name: "采集任务", exact: true }).click();
    await page
      .locator(".task-card")
      .first()
      .getByRole("button", { name: "删除任务", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "删除采集任务？" })
      .getByRole("button", { name: "确认删除", exact: true })
      .click();
    await expect(page.locator(".task-card")).toHaveCount(1);
    await page
      .getByRole("button", { name: "清理已完成任务", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "删除采集任务？" })
      .getByRole("button", { name: "确认删除", exact: true })
      .click();
    await expect(page.locator(".task-card")).toHaveCount(0);
    await page.getByRole("button", { name: "网站来源", exact: true }).click();
    await page.getByRole("button", { name: "删除来源", exact: true }).click();
    const sourceDialog = page.getByRole("dialog", { name: "删除网站来源？" });
    await sourceDialog
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "删除来源", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "删除来源", exact: true }).click();
    await sourceDialog
      .getByRole("button", { name: "确认删除", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "删除来源", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "资料库", exact: true }).click();
    await expect(page.locator(".article-select-row")).toHaveCount(2);
    await page
      .getByRole("button", { name: "Redis 持久化", exact: true })
      .click();
    await expect(page.locator(".markdown")).toContainText("本地资料");
    await page.getByRole("button", { name: "网站来源", exact: true }).click();
    await page.getByRole("button", { name: "添加网站", exact: true }).click();
    await page.getByPlaceholder("https://example.com").fill(url);
    await page.getByRole("button", { name: "保存网站", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "删除来源", exact: true }),
    ).toBeVisible();
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
