import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("manage categories, batch move and confirmed deletion persist", async () => {
  const root = await mkdtemp(join(tmpdir(), "history-ui-"));
  const launch = () =>
    electron.launch({
      args: process.env.ELECTRON_APP_PATH ? [] : ["."],
      executablePath: process.env.ELECTRON_APP_PATH,
      env: { ...process.env, LIBRARY_DATA_DIR: root },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.getByRole("button", { name: "知识库问答", exact: true }).click();
    for (const q of ["Redis question", "JVM question"]) {
      await page.getByLabel("输入问题", { exact: true }).fill(q);
      await page.getByRole("button", { name: "发送问题 ↑" }).click();
      await expect(page.locator(".insufficient")).toBeVisible();
    }
    await page.getByRole("button", { name: "新建分类", exact: true }).click();
    await page.getByLabel("分类名称", { exact: true }).fill("Redis");
    await page.getByRole("button", { name: "保存分类", exact: true }).click();
    await page.getByRole("button", { name: "新建分类", exact: true }).click();
    await page.getByLabel("分类名称", { exact: true }).fill("Redis");
    await page.getByRole("button", { name: "保存分类", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "分类名称已存在",
    );
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByLabel("选择记录 Redis question", { exact: true }).check();
    await page.getByLabel("选择记录 JVM question", { exact: true }).check();
    await page.getByLabel("移动到分类", { exact: true }).selectOption("Redis");
    await page.getByRole("button", { name: "移动所选", exact: true }).click();
    await page
      .getByLabel("筛选提问分类", { exact: true })
      .selectOption("cat:Redis");
    await expect(page.locator(".qa-history .article-item")).toHaveCount(2);
    await page.getByRole("button", { name: "重命名分类", exact: true }).click();
    await page.getByLabel("分类名称", { exact: true }).fill("Database");
    await page.getByRole("button", { name: "保存分类", exact: true }).click();
    await expect(page.getByLabel("筛选提问分类")).toHaveValue("cat:Database");
    await page
      .getByRole("button", { name: "删除记录 Redis question", exact: true })
      .click();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.locator(".qa-history .article-item")).toHaveCount(2);
    await page
      .getByRole("button", { name: "删除记录 Redis question", exact: true })
      .click();
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(page.locator(".qa-history .article-item")).toHaveCount(1);
    await page.getByRole("button", { name: "删除分类", exact: true }).click();
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    await page.getByLabel("筛选提问分类").selectOption("");
    await expect(page.locator(".qa-history .article-item")).toHaveCount(1);
    await page.screenshot({
      path: "test-results/history-management.png",
      fullPage: true,
    });
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole("button", { name: "知识库问答", exact: true }).click();
    await expect(page.locator(".qa-history .article-item")).toHaveCount(1);
    await page.getByLabel("选择本页记录").check();
    await page.getByRole("button", { name: "删除所选", exact: true }).click();
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(page.locator(".qa-history .article-item")).toHaveCount(0);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
