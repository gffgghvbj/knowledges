import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("select articles, exclude paths, inspect quality and recapture one page preserving versions", async () => {
  let updated = false;
  const calls: string[] = [];
  const server = createServer((req, res) => {
    calls.push(req.url!);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    const body =
      req.url === "/docs/a"
        ? `<h1>缓存笔记</h1><p>${updated ? "更新后的完整正文。".repeat(30) : "简短正文"}</p><pre><code>${updated ? "int x = 1;" : ""}</code></pre>`
        : req.url === "/news/b"
          ? "<h1>新闻笔记</h1><p>新闻内容</p>"
          : '<h1>目录</h1><a href="/docs/a">缓存笔记</a><a href="/news/b">新闻笔记</a>';
    res.end(`<article>${body}</article>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}/`,
    root = await mkdtemp(join(tmpdir(), "selection-ui-"));
  const app = await electron.launch({
    args: process.env.ELECTRON_APP_PATH ? [] : ["."],
    executablePath: process.env.ELECTRON_APP_PATH,
    env: { ...process.env, LIBRARY_DATA_DIR: root },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "添加网站", exact: true }).click();
    await page.getByPlaceholder("https://example.com").fill(url);
    await page.getByRole("button", { name: "保存网站", exact: true }).click();
    await page.getByRole("button", { name: "扫描网站", exact: true }).click();
    const scan = page.locator(".task-card").first();
    await expect(scan.getByText("扫描完成", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await scan.getByLabel("搜索扫描文章").fill("笔记");
    await expect(scan.locator(".capture-row")).toHaveCount(2);
    await scan.getByRole("button", { name: "选择本页", exact: true }).click();
    await scan.getByLabel("排除路径前缀").fill("/news");
    await expect(scan.locator(".capture-row")).toHaveCount(1);
    await expect(scan.getByText(/已选 1 篇/)).toBeVisible();
    calls.length = 0;
    await scan
      .getByRole("button", { name: "采集所选文章", exact: true })
      .click();
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const s = await (window as any).libraryApi.state();
            return s.tasks.find((t: any) => t.mode === "capture")?.state;
          }),
        { timeout: 15000 },
      )
      .toBe("complete");
    expect(calls.filter((p) => p !== "/favicon.ico")).toEqual(["/docs/a"]);
    const captured = page
      .locator(".task-card")
      .filter({ has: page.getByText("正文采集", { exact: true }) });
    await captured.locator(".capture-items summary").click();
    await captured.getByLabel("仅看待检查").check();
    await expect(captured.locator(".quality-notice")).toContainText("空代码块");
    await page.screenshot({
      path: "test-results/capture-quality.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "资料库", exact: true }).click();
    await page.getByRole("button", { name: "缓存笔记", exact: true }).click();
    await expect(page.locator(".reader .quality-notice")).toContainText(
      "正文仅",
    );
    updated = true;
    calls.length = 0;
    await page
      .getByRole("button", { name: "预览 / 单篇重采", exact: true })
      .click();
    const modal = page.getByRole("dialog", { name: "提取规则与预览" });
    await modal.getByRole("button", { name: "预览提取", exact: true }).click();
    await expect(modal.locator(".quality-summary")).toContainText(
      "未发现明显异常",
    );
    await modal
      .getByRole("button", { name: "按当前规则采集此页", exact: true })
      .click();
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const api = (window as any).libraryApi,
              s = await api.state();
            return (await api.versions(s.articles[0].id)).length;
          }),
        { timeout: 15000 },
      )
      .toBe(2);
    expect(calls.filter((p) => p !== "/favicon.ico")).toEqual([
      "/docs/a",
      "/docs/a",
    ]);
    const result = await page.evaluate(async () => {
      const api = (window as any).libraryApi,
        s = await api.state(),
        a = s.articles[0],
        versions = await api.versions(a.id);
      return {
        scope: s.sources[0].selectedUrls,
        current: (await api.read(a.id)).markdown,
        old: (
          await api.read(
            a.id,
            versions.find((v: any) => v.id !== a.currentVersionId).id,
          )
        ).markdown,
      };
    });
    expect(result.scope).toEqual([url + "docs/a"]);
    expect(result.current).toContain("更新后的完整正文");
    expect(result.old).toContain("简短正文");
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
