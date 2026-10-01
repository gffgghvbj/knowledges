import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("select, preview, import and export extraction rules without changing articles until capture", async () => {
  let images = 0;
  const server = createServer((req, res) => {
    if (req.url === "/diagram.png") images++;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      '<main><nav>无关导航</nav><div class="theme-default-content"><h1>两数之和规则样例</h1><p class="promo">待清理内容</p><div class="language-java"><pre class="language-java"><code><span>class Demo {\n    int answer = 2;\n}\n</span></code></pre><div class="line-numbers-wrapper">1<br>2<br>3</div></div><img src="/diagram.png"><details><summary>补充说明</summary><p>折叠内容保留</p></details></div></main>',
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}/article.html`;
  const root = await mkdtemp(join(tmpdir(), "rule-ui-"));
  const app = await electron.launch({
    args: process.env.ELECTRON_APP_PATH ? [] : ["."],
    executablePath: process.env.ELECTRON_APP_PATH,
    env: { ...process.env, LIBRARY_DATA_DIR: root },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "添加网站", exact: true }).click();
    await page.getByPlaceholder("https://example.com").fill(url);
    await page.getByLabel("新网站提取规则").selectOption("carl");
    await page.getByRole("button", { name: "保存网站", exact: true }).click();
    await page.getByRole("button", { name: "提取规则", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "提取规则与预览" });
    await modal.getByRole("button", { name: "预览提取", exact: true }).click();
    await expect(
      modal.locator(".markdown pre code.language-java"),
    ).toContainText("    int answer = 2;");
    await expect(modal.locator(".markdown")).not.toContainText("无关导航");
    await expect(modal.locator(".markdown")).toContainText("折叠内容保留");
    expect(images).toBe(0);
    expect(
      await page.evaluate(
        async () => (await (window as any).libraryApi.state()).articles.length,
      ),
    ).toBe(0);
    await modal.getByLabel("提取规则", { exact: true }).selectOption("custom");
    const rule = JSON.parse(await modal.getByLabel("规则 JSON").inputValue());
    rule.name = "我的代码规则";
    rule.removeSelectors.push(".promo");
    await modal
      .getByLabel("导入 JSON 规则")
      .setInputFiles({
        name: "custom.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(rule)),
      });
    await expect(modal.getByRole("status")).toContainText("已导入");
    await modal.getByRole("button", { name: "预览提取", exact: true }).click();
    await expect(modal.locator(".markdown")).not.toContainText("待清理内容");
    await modal
      .getByRole("button", { name: "Markdown 源文", exact: true })
      .click();
    await expect(modal.locator(".rule-markdown")).toContainText("```java");
    await expect(modal.locator(".rule-markdown")).not.toContainText("1\n2\n3");
    const exported = join(root, "export.json");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, exported);
    await modal
      .getByRole("button", { name: "导出当前规则", exact: true })
      .click();
    await expect(modal.getByRole("status")).toContainText("规则已导出");
    expect(JSON.parse(await readFile(exported, "utf8"))).toEqual(rule);
    await modal
      .getByRole("button", { name: "保存到此网站", exact: true })
      .click();
    await expect(modal.getByRole("status")).toContainText("规则已保存");
    await modal.getByRole("button", { name: "阅读效果", exact: true }).click();
    await page.screenshot({
      path: "test-results/extraction-preview.png",
      fullPage: true,
    });
    await modal.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "提取规则", exact: true }).click();
    await expect(modal.getByLabel("提取规则", { exact: true })).toHaveValue(
      "custom",
    );
    await expect(modal.getByLabel("规则 JSON")).toHaveValue(/我的代码规则/);
    await modal
      .getByLabel("规则 JSON")
      .fill(JSON.stringify({ ...rule, bodySelector: "[" }));
    await modal
      .getByRole("button", { name: "保存到此网站", exact: true })
      .click();
    await expect(modal.getByRole("alert")).toContainText("CSS");
    await modal.getByRole("button", { name: "关闭", exact: true }).click();
    const id = await page.evaluate(
      async () => (await (window as any).libraryApi.state()).sources[0].id,
    );
    await page.evaluate(async (id) => {
      const api = (window as any).libraryApi;
      try {
        await api.previewExtraction(id, "https://example.invalid/", {
          preset: "generic",
        });
        throw Error("unexpected success");
      } catch (e) {
        if (!String(e).includes("当前网站")) throw e;
      }
      await api.scan(id);
    }, id);
    await expect
      .poll(async () =>
        page.evaluate(
          async () => (await (window as any).libraryApi.state()).tasks[0].state,
        ),
      )
      .toBe("complete");
    await page.evaluate(async () => {
      const api = (window as any).libraryApi;
      const task = (await api.state()).tasks[0];
      await api.capture(task.id, ["其他"]);
    });
    await expect
      .poll(
        async () =>
          page.evaluate(
            async () =>
              (await (window as any).libraryApi.state()).articles.length,
          ),
        { timeout: 15000 },
      )
      .toBeGreaterThan(0);
    const markdown = await page.evaluate(async () => {
      const api = (window as any).libraryApi;
      const a = (await api.state()).articles[0];
      return (await api.read(a.id)).markdown;
    });
    expect(markdown).toContain("```java");
    expect(markdown).not.toContain("待清理内容");
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
