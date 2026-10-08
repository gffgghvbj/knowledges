import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { LibraryRepository } from "../../src/main/library/repository";
import { hash } from "../../src/main/library/files";
import { embeddingFingerprint } from "../../src/main/knowledge/retrieval-settings";
test("packaged sync defers missing vectors then uploads them and resends to a changed target", async () => {
  const root = await mkdtemp(join(tmpdir(), "sync-ui-"));
  const repo = new LibraryRepository(join(root, "library")),
    source = repo.addSource("https://example.com/");
  repo.saveArticle(
    {
      candidate: {
        sourceId: source.id,
        canonicalUrl: source.entryUrl,
        title: "Redis",
        sectionPath: [],
      },
      markdown: "# Redis\n\nRedis 保存持久化数据。",
      text: "Redis 保存持久化数据。",
      assets: [],
      fetchedAt: new Date().toISOString(),
    },
    [],
  );
  repo.close();
  const received: { url: string; kind: string; items: any[] }[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const b of req) body += b;
    received.push({ url: req.url!, ...JSON.parse(body || "{}") });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ code: 0 }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const app = await electron.launch({
    args: process.env.ELECTRON_APP_PATH ? [] : ["."],
    executablePath: process.env.ELECTRON_APP_PATH,
    env: { ...process.env, LIBRARY_DATA_DIR: root },
  });
  try {
    await app.evaluate(({ safeStorage }) => {
      safeStorage.isEncryptionAvailable = () => true;
      safeStorage.encryptString = (s) => Buffer.from(s);
      safeStorage.decryptString = (b) => b.toString();
    });
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "云同步", exact: true }).click();
    await page.evaluate(async (url) => {
      await (window as any).libraryApi.saveSyncSettings(url, "fixture-secret");
    }, base + "/first");
    await page.getByRole("button", { name: "开始同步", exact: true }).click();
    await expect(page.locator(".success-text")).toContainText("向量尚未齐全");
    expect(received.filter((r) => r.kind === "chunks_reset")).toHaveLength(0);
    const fingerprint = await page.evaluate(async () => {
      return (await (window as any).libraryApi.retrievalConfig()).embedding;
    });
    const db = new DatabaseSync(join(root, "library", "library.sqlite"));
    try {
      for (const row of db.prepare("SELECT data FROM knowledge_chunks").all()) {
        const c = JSON.parse(row.data as string),
          bytes = Buffer.alloc(fingerprint.dimensions * 4);
        bytes.writeFloatLE(1);
        db.prepare("INSERT INTO vector_embeddings VALUES (?,?,?,?)").run(
          embeddingFingerprint(fingerprint),
          c.id,
          hash(c.title + "\n" + c.quote),
          bytes,
        );
      }
    } finally {
      db.close();
    }
    await page.getByRole("button", { name: "开始同步", exact: true }).click();
    await expect(page.locator(".success-text")).not.toContainText(
      "向量尚未齐全",
    );
    expect(
      received.filter((r) => r.kind === "chunks").flatMap((r) => r.items)
        .length,
    ).toBeGreaterThan(0);
    received.length = 0;
    await page.evaluate(async (url) => {
      await (window as any).libraryApi.saveSyncSettings(url, "fixture-secret");
    }, base + "/second");
    await page.getByRole("button", { name: "开始同步", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "开始同步", exact: true }),
    ).toBeEnabled();
    expect(
      received
        .filter((r) => r.kind === "chunks")
        .every((r) => r.url === "/second/push"),
    ).toBe(true);
    expect(received.filter((r) => r.kind === "chunks")).toHaveLength(1);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
