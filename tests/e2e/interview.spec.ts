import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("formal mock interview saves drafts, hides feedback until completion and displays report", async () => {
  const root = await mkdtemp(join(tmpdir(), "mock-ui-"));
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw),
      d = JSON.parse(body.messages[1].content);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        done: true,
        message: {
          content: JSON.stringify({
            dimensions: d.dimensions.map((v: any) => ({
              name: v.name,
              score: 80,
              reason: "Specific feedback on submitted answer",
            })),
            omissions: ["Missing detail"],
            suggestions: ["Review Redis"],
            referenceAnswer: "PRIVATE ANALYSIS",
            uncertainty: "Model feedback",
            evidenceIds: [],
          }),
        },
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const launch = () =>
    electron.launch({
      args: process.env.ELECTRON_APP_PATH ? [] : ["."],
      executablePath: process.env.ELECTRON_APP_PATH,
      env: { ...process.env, LIBRARY_DATA_DIR: root },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.evaluate(
      async (port) => {
        const a = (window as any).libraryApi;
        await a.saveModel({
          provider: "ollama",
          baseUrl: `http://127.0.0.1:${port}`,
          model: "fixture",
        });
        for (let i = 1; i <= 2; i++)
          await a.saveInterviewQuestion({
            prompt: `Redis question ${i}`,
            referenceAnswer: "PRIVATE REFERENCE",
            knowledgePoints: ["Redis"],
            difficulty: "medium",
            kind: "technical",
          });
      },
      (server.address() as any).port,
    );
    await expect(
      page.getByRole("button", { name: "模拟面试", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "模拟面试", exact: true }).click();
    await page.getByLabel("面试模型").selectOption("ollama");
    await page.getByLabel("反馈时机").selectOption("formal");
    await page.getByLabel("总题量").fill("2");
    await page.getByRole("button", { name: "开始面试", exact: true }).click();
    await expect(page.getByLabel("本题回答")).toBeVisible();
    await page.getByLabel("本题回答").fill("Draft Redis answer");
    await expect
      .poll(async () => {
        const s = await page.evaluate(() =>
          (window as any).libraryApi.interviewSessions(),
        );
        return s[0]?.turns[0]?.draft;
      })
      .toBe("Draft Redis answer");
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole("button", { name: "模拟面试", exact: true }).click();
    await page.locator(".session-item").first().click();
    await expect(page.getByLabel("本题回答")).toHaveValue("Draft Redis answer");
    for (let i = 0; i < 2; i++) {
      await page.getByLabel("本题回答").fill("My Redis answer");
      await page.getByRole("button", { name: "提交回答", exact: true }).click();
      if (i === 0) {
        await expect(
          page.getByRole("button", { name: "下一题", exact: true }),
        ).toBeVisible();
        await expect(page.locator(".page")).not.toContainText("PRIVATE");
        const data = await page.evaluate(() =>
          (window as any).libraryApi.interviewSessions(),
        );
        expect(JSON.stringify(data)).not.toContain("PRIVATE");
        await page.getByRole("button", { name: "下一题", exact: true }).click();
      }
    }
    await expect(
      page.getByRole("heading", { name: "面试复盘", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".interview-report")).toContainText("80");
    await expect(page.locator(".interview-report")).toContainText(
      "PRIVATE ANALYSIS",
    );
    await page.screenshot({
      path: "test-results/interview-report.png",
      fullPage: true,
    });
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
