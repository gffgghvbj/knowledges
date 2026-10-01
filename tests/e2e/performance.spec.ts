import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("large lists stay bounded; IME drafts survive navigation and immediate window close", async () => {
  const root = await mkdtemp(join(tmpdir(), "ui-performance-"));
  const launch = () =>
    electron.launch({
      args: process.env.ELECTRON_APP_PATH ? [] : ["."],
      executablePath: process.env.ELECTRON_APP_PATH,
      env: { ...process.env, LIBRARY_DATA_DIR: root },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.evaluate(async () => {
      const api = (window as any).libraryApi;
      for (let i = 0; i < 120; i++)
        await api.saveInterviewQuestion({
          prompt: `题目 ${i}`,
          referenceAnswer: "答案".repeat(2000),
          knowledgePoints: [i === 0 ? "唯一知识点" : "Redis"],
          difficulty: "medium",
          kind: "technical",
        });
      const first = await api.stateUpdate();
      const second = await api.stateUpdate(first.revision);
      if (Object.keys(second.patch).length)
        throw Error("Unchanged state must not resend lists");
      await api.createInterview({
        scope: "topic",
        mode: "bank",
        feedback: "formal",
        provider: "ollama",
        difficulty: "medium",
        questionCount: 1,
        topic: "",
        knowledgePoints: [],
      });
    });
    await page.getByRole("button", { name: "题库", exact: true }).click();
    await expect(page.locator(".bank-item")).toHaveCount(50);
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await expect(page.locator(".bank-item")).toHaveCount(50);
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await expect(page.locator(".bank-item")).toHaveCount(20);
    await page.getByLabel("筛选知识点").fill("唯一知识点");
    await expect(page.locator(".bank-item")).toHaveCount(1);
    await page.locator(".bank-item").click();
    await expect(page.getByLabel("参考答案")).toHaveValue("答案".repeat(2000));
    await page.getByRole("button", { name: "模拟面试", exact: true }).click();
    await page.locator(".session-item").first().click();
    const input = page.getByLabel("本题回答");
    await input.focus();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", {
      text: "中",
      selectionStart: 1,
      selectionEnd: 1,
    });
    await cdp.send("Input.insertText", { text: "中文输入不能丢字" });
    await expect(input).toHaveValue("中文输入不能丢字");
    await page.getByRole("button", { name: "题库", exact: true }).click();
    await page.getByRole("button", { name: "模拟面试", exact: true }).click();
    await page.locator(".session-item").first().click();
    await expect(page.getByLabel("本题回答")).toHaveValue("中文输入不能丢字");
    // Queue a final accepted IPC edit and close the native window before its 400ms timer.
    await page.evaluate(async () => {
      const api = (window as any).libraryApi,
        rows = await api.interviewSessionSummaries();
      await api.saveInterviewDraft(rows[0].id, 0, "关闭前最后几个字");
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole("button", { name: "模拟面试", exact: true }).click();
    await page.locator(".session-item").first().click();
    await expect(page.getByLabel("本题回答")).toHaveValue("关闭前最后几个字");
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
