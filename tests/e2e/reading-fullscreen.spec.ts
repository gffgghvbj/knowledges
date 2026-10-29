import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LibraryRepository } from "../../src/main/library/repository";
test("fullscreen reading hides navigation, retains content and restores position with either exit", async () => {
  const root = await mkdtemp(join(tmpdir(), "reading-fullscreen-"));
  const repo = new LibraryRepository(join(root, "library")),
    s = repo.addSource("https://example.com/");
  const markdown =
    "# 面试笔记\n\n```java\nreturn 1;\n```\n\n" +
    Array.from(
      { length: 80 },
      (_, i) => `## 知识点 ${i}\n\nRedis 持久化与面试回答。`,
    ).join("\n\n");
  repo.saveArticle(
    {
      candidate: {
        sourceId: s.id,
        canonicalUrl: s.entryUrl,
        title: "面试笔记",
        sectionPath: [],
      },
      markdown,
      text: markdown,
      assets: [],
      fetchedAt: new Date().toISOString(),
    },
    [],
  );
  repo.close();
  const app = await electron.launch({
    args: process.env.ELECTRON_APP_PATH ? [] : ["."],
    executablePath: process.env.ELECTRON_APP_PATH,
    env: { ...process.env, LIBRARY_DATA_DIR: root },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "资料库", exact: true }).click();
    await page.getByRole("button", { name: "面试笔记", exact: true }).click();
    const reader = page.locator(".reader");
    await expect(reader.locator(".markdown h1")).toHaveText("面试笔记");
    await reader.evaluate((e) => (e.scrollTop = 400));
    await expect.poll(() => reader.evaluate((e) => e.scrollTop)).toBe(400);
    await page.getByRole("button", { name: "全屏阅读", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "退出全屏", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".sidebar")).not.toBeVisible();
    await expect(page.locator(".article-list")).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "删除文章", exact: true }),
    ).not.toBeVisible();
    await expect(reader.locator("code.language-java")).toContainText(
      "return 1;",
    );
    await expect.poll(() => reader.evaluate((e) => e.scrollTop)).toBe(400);
    await page.screenshot({
      path: "test-results/reading-fullscreen.png",
      fullPage: true,
    });
    await reader.evaluate((e) => (e.scrollTop = 800));
    await page.keyboard.press("Escape");
    await expect(page.locator(".sidebar")).toBeVisible();
    await expect.poll(() => reader.evaluate((e) => e.scrollTop)).toBe(800);
    await page.getByRole("button", { name: "全屏阅读", exact: true }).click();
    await page.getByRole("button", { name: "退出全屏", exact: true }).click();
    await expect(page.locator(".article-list")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "全屏阅读", exact: true }),
    ).toBeFocused();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
