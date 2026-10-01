import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

test("startup failures stay visible and do not expose partially initialized operations", async () => {
  const root = await mkdtemp(join(tmpdir(), "startup-error-"));
  await mkdir(join(root, "library"));
  const db = new DatabaseSync(join(root, "library/library.sqlite"));
  db.exec("PRAGMA user_version=999;");
  db.close();
  const app = await electron.launch({
    args: process.env.ELECTRON_APP_PATH ? [] : ["."],
    executablePath: process.env.ELECTRON_APP_PATH,
    env: { ...process.env, LIBRARY_DATA_DIR: root },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByLabel("启动状态")).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("请升级应用");
    const failure = await page.evaluate(async () => {
      try {
        await (window as any).libraryApi.state();
        return "unexpected success";
      } catch (e) {
        return String(e);
      }
    });
    expect(failure).toContain("请升级应用");
    await page.screenshot({ path: "test-results/startup-error.png" });
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
