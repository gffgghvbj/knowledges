import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docx, pdf } from "../interview/fixtures";
test("import PDF and DOCX locally, preview before save and edit confirmed material", async () => {
  const root = await mkdtemp(join(tmpdir(), "materials-ui-")),
    p = join(root, "resume.pdf"),
    d = join(root, "job.docx");
  await writeFile(p, pdf("Java engineer"));
  await docx(d, "Redis developer");
  const app = await electron.launch({
    args: process.env.ELECTRON_APP_PATH ? [] : ["."],
    executablePath: process.env.ELECTRON_APP_PATH,
    env: { ...process.env, LIBRARY_DATA_DIR: root },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "面试资料", exact: true }).click();
    for (const [file, kind, text] of [
      [p, "resume", "Java engineer"],
      [d, "jd", "Redis developer"],
    ]) {
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [path],
        });
      }, file);
      await page.getByLabel("资料类型").selectOption(kind);
      await page.getByRole("button", { name: "导入 PDF / DOCX" }).click();
      await expect(page.getByLabel("资料正文")).toContainText(text);
      expect(
        await page.evaluate(() =>
          (window as any).libraryApi.interviewMaterials(),
        ),
      ).toHaveLength(kind === "resume" ? 0 : 1);
      await page.getByRole("button", { name: "确认保存资料" }).click();
    }
    await expect(page.locator(".material-item")).toHaveCount(2);
    await page.locator(".material-item").first().click();
    await page.getByLabel("资料正文").fill("Edited JD");
    await page.getByRole("button", { name: "确认保存资料" }).click();
    expect(
      (
        await page.evaluate(() =>
          (window as any).libraryApi.interviewMaterials(),
        )
      )[0].text,
    ).toBe("Edited JD");
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
