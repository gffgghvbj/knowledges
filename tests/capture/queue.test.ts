import { beforeEach, afterEach, test, expect, vi } from "vitest";
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
for (const during of ["page", "image"] as const)
  for (const remove of ["task", "source"] as const)
    test(`deleting ${remove} during ${during} fetch prevents late writes and further requests`, async () => {
      const s = repo.addSource("https://example.com/");
      let release!: () => void, entered!: () => void;
      const pending = new Promise<void>((r) => {
        release = r;
      });
      const started = new Promise<void>((r) => {
        entered = r;
      });
      let images = 0;
      const q = new CaptureQueue(
        repo,
        {
          load: async (_s, url) => {
            if (during === "page") {
              entered();
              await pending;
            }
            return page(
              url,
              '<h1>Redis</h1><img src="/a.png"><img src="/b.png">',
            );
          },
          asset: async () => {
            images++;
            entered();
            await pending;
            return { bytes: Buffer.from("image"), mimeType: "image/png" };
          },
        },
        0,
      );
      const id = q.startCapture(s.id, candidates(s));
      await started;
      if (remove === "task") repo.deleteTasks([id]);
      else repo.deleteSource(s.id);
      release();
      await q.waitForIdle();
      expect(repo.listTasks()).toHaveLength(0);
      expect(repo.listArticles()).toHaveLength(0);
      expect(images).toBe(during === "image" ? 1 : 0);
      if (remove === "source") expect(() => q.scan(s.id)).toThrow("已移除");
    });
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

test("retrying failed discovery discovers descendants instead of saving the navigation page", async () => {
  const s = repo.addSource("https://example.com/");
  let recovered = false;
  const q = new CaptureQueue(
    repo,
    {
      load: async (_s, u) =>
        u.endsWith("/b") && !recovered
          ? { kind: "failed", reason: "timeout" }
          : page(
              u,
              u.endsWith("/b")
                ? '<h1>B</h1><a href="/c">C</a>'
                : u.endsWith("/c")
                  ? "<h1>C</h1>"
                  : '<h1>Index</h1><a href="/b">B</a>',
            ),
      asset: async () => {
        throw Error("unused");
      },
    },
    0,
  );
  const id = q.scan(s.id);
  await q.waitForIdle();
  expect(repo.getTask(id)?.state).toBe("partial");
  recovered = true;
  q.retryFailed(id);
  await q.waitForIdle();
  expect(
    repo
      .getTask(id)
      ?.items.some((i) => i.candidate.canonicalUrl.endsWith("/c")),
  ).toBe(true);
  expect(repo.listArticles()).toHaveLength(0);
});

test("manual update revisits saved articles no longer linked by the site", async () => {
  const s = repo.addSource("https://example.com/");
  const v = repo.saveArticle(
    {
      candidate: {
        sourceId: s.id,
        canonicalUrl: "https://example.com/orphan",
        title: "旧文章",
        sectionPath: [],
      },
      markdown: "保存的原文",
      text: "保存的原文",
      fetchedAt: "2026-09-30T00:00:00Z",
      assets: [],
    },
    [],
  );
  const q = new CaptureQueue(
    repo,
    {
      load: async (_s, u) =>
        u.endsWith("/orphan")
          ? { kind: "unavailable", reason: "404", statusCode: 404 }
          : page(u),
      asset: async () => {
        throw Error("unused");
      },
    },
    0,
  );
  q.scan(s.id, "update");
  await q.waitForIdle();
  expect(repo.getArticle(v.articleId)?.sourceStatus).toBe("removed");
  expect(repo.readArticle(v.articleId).markdown).toBe("保存的原文");
});
test("server retry-after is honored even when longer than one minute", async () => {
  vi.useFakeTimers();
  try {
    const s = repo.addSource("https://example.com/");
    let calls = 0;
    const q = new CaptureQueue(
      repo,
      {
        load: async (_s, u) =>
          ++calls === 1
            ? {
                kind: "unavailable",
                reason: "limited",
                statusCode: 429,
                retryAfterMs: 120000,
              }
            : page(u),
        asset: async () => {
          throw Error("unused");
        },
      },
      0,
    );
    q.startCapture(s.id, candidates(s));
    await vi.advanceTimersByTimeAsync(60001);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(59999);
    await q.waitForIdle();
    expect(calls).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

test("article selection restricts capture and later updates; section selection resets scope", async () => {
  const s = repo.addSource("https://example.com/");
  const calls: string[] = [];
  const q = new CaptureQueue(
    repo,
    {
      load: async (_s, u) => {
        calls.push(u);
        return page(
          u,
          '<h1>文章</h1><a href="/docs/a">A</a><a href="/docs/b">B</a>',
        );
      },
      asset: async () => {
        throw Error("unused");
      },
    },
    0,
  );
  const scan = q.scan(s.id);
  await q.waitForIdle();
  calls.length = 0;
  expect(() => q.captureArticles(scan, ["https://other.com/a"])).toThrow(
    "扫描结果",
  );
  const capture = q.captureArticles(scan, [
    "https://example.com/docs/a#anchor",
  ]);
  await q.waitForIdle();
  expect(calls).toEqual(["https://example.com/docs/a"]);
  expect(repo.getTask(capture)?.items[0].quality?.issues[0].code).toBe(
    "short-text",
  );
  expect(
    repo.readArticle(repo.listArticles()[0].id).version.quality,
  ).toBeDefined();
  calls.length = 0;
  q.scan(s.id, "update");
  await q.waitForIdle();
  expect(calls).toEqual(["https://example.com/docs/a"]);
  q.captureSelection(scan, ["docs"]);
  await q.waitForIdle();
  expect(repo.getSource(s.id)?.selectedUrls).toBeUndefined();
  expect(repo.listArticles()).toHaveLength(2);
});

test("one-page rule is task scoped, keeps history and never restores trashed articles", async () => {
  const s = repo.addSource("https://example.com/");
  const calls: string[] = [];
  let body = "<h1>旧内容</h1><p>first</p>";
  const q = new CaptureQueue(
    repo,
    {
      load: async (_s, u) => {
        calls.push(u);
        return page(u, body);
      },
      asset: async () => {
        throw Error("unused");
      },
    },
    0,
  );
  expect(() => q.captureUrl(s.id, "https://other.com/a")).toThrow("当前网站");
  q.captureUrl(s.id, "https://example.com/a");
  await q.waitForIdle();
  const a = repo.listArticles()[0],
    before = repo.readArticle(a.id);
  const { extractionPresets } = await import("../../src/shared/extraction");
  body =
    '<h1>新内容</h1><p class="promo">去掉广告</p><p>second</p><a href="/b">不要跟随</a>';
  q.captureUrl(s.id, a.canonicalUrl, {
    preset: "custom",
    rule: { ...extractionPresets.generic, removeSelectors: [".promo"] },
  });
  await q.waitForIdle();
  expect(calls).toEqual([a.canonicalUrl, a.canonicalUrl]);
  expect(repo.listVersions(a.id)).toHaveLength(2);
  expect(repo.readArticle(a.id, before.version.id).markdown).toBe(
    before.markdown,
  );
  expect(repo.readArticle(a.id).markdown).not.toContain("去掉广告");
  expect(repo.getSource(s.id)).toEqual(s);
  repo.trashArticles([a.id]);
  expect(() => q.captureUrl(s.id, a.canonicalUrl)).toThrow("回收站");
  calls.length = 0;
  const skipped = q.startCapture(s.id, [a]);
  await q.waitForIdle();
  expect(calls).toEqual([]);
  expect(repo.getTask(skipped)?.items[0].state).toBe("skipped");
  expect(repo.getArticle(a.id)?.deletedAt).toBeDefined();
});
