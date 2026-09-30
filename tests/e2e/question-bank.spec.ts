import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("question bank saves manual questions and filters by knowledge and difficulty", async () => {
  const root = await mkdtemp(join(tmpdir(), "bank-ui-")),
    app = await electron.launch({
      args: process.env.ELECTRON_APP_PATH ? [] : ["."],
      executablePath: process.env.ELECTRON_APP_PATH,
      env: { ...process.env, LIBRARY_DATA_DIR: root },
    });
  try {
    const page = await app.firstWindow();
    await expect(
      page.getByRole("button", { name: "题库", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "题库", exact: true }).click();
    await page.getByLabel("题目内容").fill("What is AOF?");
    await page.getByLabel("参考答案").fill("A log of commands");
    await page.getByLabel("知识点", { exact: true }).fill("Redis, persistence");
    await page.getByRole("button", { name: "保存题目", exact: true }).click();
    await expect(page.locator(".bank-item")).toHaveCount(1);
    await page.getByLabel("筛选知识点").fill("JVM");
    await expect(page.locator(".bank-item")).toHaveCount(0);
    await page.getByLabel("筛选知识点").fill("Redis");
    await expect(page.locator(".bank-item")).toHaveCount(1);
    await page.getByLabel("筛选类型").selectOption("project");
    await expect(page.locator(".bank-item")).toHaveCount(0);
    await page.getByLabel("筛选类型").selectOption("technical");
    await expect(page.locator(".bank-item")).toHaveCount(1);
    await page.locator(".bank-item").click();
    await expect(page.getByLabel("参考答案")).toHaveValue("A log of commands");
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
