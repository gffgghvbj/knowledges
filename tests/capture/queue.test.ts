import { beforeEach, afterEach, test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LibraryRepository } from "../../src/main/library/repository";
import { CaptureQueue } from "../../src/main/capture/queue";
import type { PageResult, Source } from "../../src/shared/contracts";
let root: string, repo: LibraryRepository;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "queue-"));
  repo = new LibraryRepository(root);
});
afterEach(() => {
  repo.close();
  rmSync(root, { recursive: true, force: true });
});
const page = (url: string, body = "<h1>Redis</h1><p>内容</p>"): PageResult => ({
  kind: "article",
  snapshot: {
    finalUrl: url,
    html: `<article>${body}</article>`,
    statusCode: 200,
    fetchedAt: "2026-09-30T00:00:00Z",
  },
});
const candidates = (source: Source) => [
  {
    sourceId: source.id,
    canonicalUrl: "https://example.com/a",
    title: "a",
    sectionPath: ["docs"],
  },
];
test("missing images remain partial and retry fills assets without duplicate articles", async () => {
  const source = repo.addSource("https://example.com/");
  let imageAvailable = false;
  const q = new CaptureQueue(
    repo,
    {
      load: async (_s, u) => page(u, '<h1>Redis</h1><img src="/a.png">'),
      asset: async () => {
        if (!imageAvailable) throw Error("missing");
        return { bytes: Buffer.from("picture"), mimeType: "image/png" };
      },
    },
    0,
  );
  const id = q.startCapture(source.id, candidates(source));
  await q.waitForIdle();
  expect(repo.getTask(id)?.state).toBe("partial");
  expect(repo.listArticles()).toHaveLength(1);
  imageAvailable = true;
  q.retryFailed(id);
  await q.waitForIdle();
  expect(repo.getTask(id)?.state).toBe("complete");
  expect(repo.listArticles()).toHaveLength(1);
});
test("expired login preserves queued work for manual resume", async () => {
  const s = repo.addSource("https://example.com/");
  let logged = false;
  const q = new CaptureQueue(
    repo,
    {
      load: async (_s, u) => (logged ? page(u) : { kind: "login-required" }),
      asset: async () => {
        throw Error("unused");
      },
    },
    0,
  );
  const id = q.startCapture(s.id, candidates(s));
  await q.waitForIdle();
  expect(repo.getTask(id)?.state).toBe("login-required");
  expect(repo.listArticles()).toHaveLength(0);
  logged = true;
  q.resumeTask(id);
  await q.waitForIdle();
  expect(repo.listArticles()).toHaveLength(1);
});
test("failed transient requests retry finitely and keep old content on failure", async () => {
  const s = repo.addSource("https://example.com/");
  let calls = 0;
  const q = new CaptureQueue(
    repo,
    {
      load: async () => {
        calls++;
        return { kind: "failed", reason: "timeout" };
      },
      asset: async () => {
        throw Error("unused");
      },
    },
    0,
  );
  const id = q.startCapture(s.id, candidates(s));
  await q.waitForIdle();
  expect(calls).toBe(4);
  expect(repo.getTask(id)?.state).toBe("failed");
});
test("scan discovers root-linked articles, deduplicates and respects origin boundary", async () => {
  const s = repo.addSource("https://example.com/a");
  const q = new CaptureQueue(
    repo,
    {
      load: async (_s, u) =>
        page(
          u,
          '<h1>文章</h1><a href="/b#one">b</a><a href="https://other.com/c">c</a>',
        ),
      asset: async () => {
        throw Error("unused");
      },
    },
    0,
  );
  const id = q.scan(s.id);
  await q.waitForIdle();
  expect(repo.getTask(id)?.scanComplete).toBe(true);
  expect(
    repo
      .getTask(id)
      ?.items.map((i) => i.candidate.canonicalUrl)
      .sort(),
  ).toEqual([
    "https://example.com/",
    "https://example.com/a",
    "https://example.com/b",
  ]);
});
test("pause followed by immediate resume cannot strand a queued task", async () => {
  const s = repo.addSource("https://example.com/");
  let release!: () => void;
  let first = true;
  const q = new CaptureQueue(
    repo,
    {
      load: async (_s, u) => {
        if (first) {
          first = false;
          await new Promise<void>((r) => (release = r));
        }
        return page(u);
      },
      asset: async () => {
        throw Error("unused");
      },
    },
    0,
  );
  const id = q.startCapture(s.id, candidates(s));
  q.pauseTask(id);
  q.resumeTask(id);
  release();
  await q.waitForIdle();
  expect(repo.getTask(id)?.state).toBe("complete");
});
