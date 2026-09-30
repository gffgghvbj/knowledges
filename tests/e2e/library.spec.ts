import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("collects, reads and searches an article through the desktop UI", async () => {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      '<article><h1>Redis 内存回收</h1><p>C++ 与垃圾回收测试资料。</p><pre><code class="language-java">return 1;</code></pre><a href="/">首页</a></article>',
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  const root = await mkdtemp(join(tmpdir(), "library-flow-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, LIBRARY_DATA_DIR: root },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "添加网站", exact: true }).click();
    await page
      .getByPlaceholder("https://example.com")
      .fill(`http://127.0.0.1:${port}/`);
    await page.getByRole("button", { name: "保存网站", exact: true }).click();
    await page.getByRole("button", { name: "扫描网站", exact: true }).click();
    await page
      .getByRole("button", { name: "采集所选栏目", exact: true })
      .click();
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const t = (await (window as any).libraryApi.state()).tasks[0];
            return t.state === "failed" ? JSON.stringify(t.items) : t.state;
          }),
        { timeout: 15000 },
      )
      .toBe("complete");
    await expect(page.getByText("采集完成", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole("button", { name: "资料库", exact: true }).click();
    await page.getByPlaceholder("搜索标题或正文…").fill("回收");
    await page
      .getByRole("button", { name: "Redis 内存回收", exact: true })
      .click();
    await expect(page.locator(".markdown")).toContainText(
      "C++ 与垃圾回收测试资料。",
    );
    await page.screenshot({
      path: "test-results/library-desktop.png",
      fullPage: true,
    });
  } finally {
    await app.close();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});

test("login cookie is reused for capture and remote login window has no local bridge", async () => {
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (req.url === "/login") {
      res.setHeader("Set-Cookie", "session=yes; HttpOnly; Path=/");
      res.end("<p>已登录</p>");
      return;
    }
    if (!req.headers.cookie?.includes("session=yes")) {
      res.end(
        '<form><input type="password"><a href="/login">测试登录</a></form>',
      );
      return;
    }
    res.end("<article><h1>受保护资料</h1><p>登录后正文。</p></article>");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  const root = await mkdtemp(join(tmpdir(), "library-login-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, LIBRARY_DATA_DIR: root },
  });
  try {
    const page = await app.firstWindow();
    const source = await page.evaluate(
      (url) => (window as any).libraryApi.addSource(url),
      `http://127.0.0.1:${port}/`,
    );
    await page.evaluate((id) => (window as any).libraryApi.scan(id), source.id);
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await (window as any).libraryApi.state()).tasks[0].state,
        ),
      )
      .toBe("login-required");
    const loginPromise = app.waitForEvent("window");
    await page.evaluate(
      (id) => (window as any).libraryApi.login(id),
      source.id,
    );
    const login = await loginPromise;
    await login.getByText("测试登录").click();
    await expect(login.getByText("已登录")).toBeVisible();
    expect(await login.evaluate(() => typeof (window as any).libraryApi)).toBe(
      "undefined",
    );
    await page.evaluate(async () => {
      const api = (window as any).libraryApi;
      await api.control((await api.state()).tasks[0].id, "resume");
    });
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const t = (await (window as any).libraryApi.state()).tasks[0];
            return t.state === "failed" ? JSON.stringify(t.items) : t.state;
          }),
        { timeout: 15000 },
      )
      .toBe("complete");
  } finally {
    await app.close();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
