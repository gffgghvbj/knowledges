import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
for (const [name, url] of [
  ["xiaolin", "https://xiaolincoding.com/interview/redis.html"],
  [
    "javaguide",
    "https://www.javaguide.cn/java/jvm/jvm-garbage-collection.html",
  ],
]) {
  test(`live representative article: ${name}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "shizhi-live-"));
    const application = await electron.launch({
      args: ["."],
      env: { ...process.env, LIBRARY_DATA_DIR: root },
    });
    try {
      const page = await application.firstWindow();
      const source = await page.evaluate(
        (url) => window.libraryApi.addSource(url),
        url,
      );
      // Seed a completed discovery result to constrain this live check to exactly the user-supplied article.
      const db = new DatabaseSync(join(root, "library", "library.sqlite")),
        scanId = randomUUID();
      const task = {
        id: scanId,
        sourceId: source.id,
        state: "complete",
        items: [
          {
            candidate: {
              sourceId: source.id,
              canonicalUrl: source.entryUrl,
              title: source.label,
              sectionPath: [],
            },
            state: "complete",
          },
        ],
        createdAt: new Date().toISOString(),
        scanComplete: true,
        discovered: 1,
        mode: "scan",
      };
      db.prepare("INSERT INTO tasks VALUES (?,?)").run(
        scanId,
        JSON.stringify(task),
      );
      db.close();
      const taskId = await page.evaluate(
        (id) => window.libraryApi.capture(id, ["其他"]),
        scanId,
      );
      await expect
        .poll(
          () =>
            page.evaluate(async (id) => {
              const t = (await window.libraryApi.state()).tasks.find(
                (t) => t.id === id,
              )!;
              return t.state;
            }, taskId),
          { timeout: 150000, intervals: [1000, 2000, 5000] },
        )
        .toMatch(/^(complete|partial)$/);
      const state = await page.evaluate(() => window.libraryApi.state());
      expect(state.articles).toHaveLength(1);
      const value = await page.evaluate(
        (id) => window.libraryApi.read(id),
        state.articles[0].id,
      );
      expect(value.markdown.length).toBeGreaterThan(10000);
      expect(
        value.version.assets.length,
        JSON.stringify(state.tasks.find((t) => t.id === taskId)),
      ).toBeGreaterThan(0);
      const capturedTask = state.tasks.find((t) => t.id === taskId)!;
      await writeFile(
        `test-results/live-${name}.json`,
        JSON.stringify(
          {
            url,
            title: value.article.title,
            markdownCharacters: value.markdown.length,
            downloadedImages: value.version.assets.length,
            completeness: value.version.completeness,
            taskState: capturedTask.state,
            errors: capturedTask.items
              .filter((i) => i.error)
              .map((i) => i.error),
          },
          null,
          2,
        ),
      );
      await page.getByRole("button", { name: "资料库", exact: true }).click();
      await page
        .getByRole("button", { name: value.article.title, exact: true })
        .click();
      await expect(page.locator(".markdown h1")).toBeVisible();
      await page.screenshot({
        path: `test-results/live-${name}.png`,
        fullPage: true,
      });
    } finally {
      await application.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
