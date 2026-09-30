import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("desktop starts with a usable, isolated local bridge", async () => {
  const root = await mkdtemp(join(tmpdir(), "library-e2e-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, LIBRARY_DATA_DIR: root },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText("拾知", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => (window as any).libraryApi.getStatus()),
    ).toEqual({ ready: true });
    expect(await page.evaluate(() => typeof (window as any).require)).toBe(
      "undefined",
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
