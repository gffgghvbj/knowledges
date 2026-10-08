import { beforeEach, afterEach, test, expect, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LibraryRepository } from "../../src/main/library/repository";
import { SyncPusher } from "../../src/main/sync/pusher";
import { hash } from "../../src/main/library/files";
let repo: LibraryRepository, root: string, version: string;
let requests: { url: string; kind: string; items: any[] }[];
let fail = false;
const chunks = [
  { id: "c1", title: "Redis", quote: "one" },
  { id: "c2", title: "Redis", quote: "two" },
];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sync-test-"));
  repo = new LibraryRepository(root);
  requests = [];
  fail = false;
  const source = repo.addSource("https://example.com/");
  const bytes = Buffer.from("image"),
    h = hash(bytes);
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(join(root, "assets", h + ".png"), bytes);
  const v = repo.saveArticle(
    {
      candidate: {
        sourceId: source.id,
        canonicalUrl: source.entryUrl,
        title: "Redis",
        sectionPath: [],
      },
      markdown: "Redis",
      text: "Redis",
      assets: [],
      fetchedAt: new Date().toISOString(),
    },
    [
      {
        hash: h,
        relativePath: `assets/${h}.png`,
        mimeType: "image/png",
        size: bytes.length,
      },
    ],
  );
  version = v.id;
  repo.db.prepare("DELETE FROM knowledge_chunks").run();
  for (const c of chunks)
    repo.db
      .prepare("INSERT INTO knowledge_chunks VALUES (?,?,?)")
      .run(
        c.id,
        v.articleId,
        JSON.stringify({ ...c, articleId: v.articleId, versionId: v.id }),
      );
  vi.stubGlobal("fetch", async (url: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body || "{}"));
    requests.push({ url, ...body });
    if (fail && body.kind === "chunks")
      return new Response("{}", { status: 400 });
    return new Response(JSON.stringify({ code: 0 }), { status: 200 });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  repo.close();
  rmSync(root, { recursive: true, force: true });
});
function vector(index: number, fingerprint = "model-a", value = 1) {
  const c = chunks[index],
    b = Buffer.alloc(8);
  b.writeFloatLE(value);
  repo.db
    .prepare("INSERT OR REPLACE INTO vector_embeddings VALUES (?,?,?,?)")
    .run(fingerprint, c.id, hash(c.title + "\n" + c.quote), b);
}
function push(
  endpoint = "https://first.example/sync",
  token = "secret-a",
  fingerprint = "model-a",
) {
  return new SyncPusher(repo, {
    endpoint,
    token,
    embeddingFingerprint: fingerprint,
  }).push();
}
const sent = (kind: string) => requests.filter((r) => r.kind === kind);
test("missing and partial vectors are deferred until complete, then remain incremental", async () => {
  await push();
  expect(sent("chunks_reset")).toHaveLength(0);
  vector(0);
  requests = [];
  await push();
  expect(sent("chunks_reset")).toHaveLength(0);
  vector(1);
  requests = [];
  await push();
  expect(
    sent("chunks")
      .flatMap((r) => r.items)
      .map((i) => i.id),
  ).toEqual(["c1", "c2"]);
  requests = [];
  await push();
  expect(sent("chunks_reset")).toHaveLength(0);
  expect(sent("assets")).toHaveLength(0);
});
test.each(["endpoint", "token"])(
  "changing %s resends images and vectors",
  async (change) => {
    vector(0);
    vector(1);
    await push();
    requests = [];
    await push(
      change === "endpoint" ? "https://second.example/sync" : undefined,
      change === "token" ? "secret-b" : undefined,
    );
    expect(sent("assets")).toHaveLength(1);
    expect(sent("chunks").flatMap((r) => r.items)).toHaveLength(2);
  },
);
test("legacy completion markers cannot suppress repairing previously missed vectors", async () => {
  writeFileSync(
    join(root, "sync-state.json"),
    JSON.stringify({ chunkVersions: { [version]: true } }),
  );
  vector(0);
  vector(1);
  await push();
  expect(sent("chunks").flatMap((r) => r.items)).toHaveLength(2);
});
test("model changes never mix fingerprints and rebuilt vectors are repushed", async () => {
  vector(0);
  vector(1);
  await push();
  requests = [];
  vector(0, "model-b");
  await push(undefined, undefined, "model-b");
  expect(sent("chunks_reset")).toHaveLength(0);
  vector(1, "model-b");
  requests = [];
  await push(undefined, undefined, "model-b");
  expect(sent("chunks").flatMap((r) => r.items)).toHaveLength(2);
  vector(1, "model-b", 0.5);
  requests = [];
  await push(undefined, undefined, "model-b");
  expect(sent("chunks").flatMap((r) => r.items)).toHaveLength(2);
});
test("failed vector upload is retried on next push without a completion marker", async () => {
  vector(0);
  vector(1);
  fail = true;
  await expect(push()).rejects.toThrow("400");
  fail = false;
  requests = [];
  await push();
  expect(sent("chunks").flatMap((r) => r.items)).toHaveLength(2);
});

test("stale vector input hashes defer uploads until refreshed", async () => {
  vector(0);
  vector(1);
  repo.db
    .prepare(
      "UPDATE vector_embeddings SET input_hash='stale' WHERE chunk_id='c1'",
    )
    .run();
  expect((await push()).pendingVectors).toBe(1);
  expect(sent("chunks_reset")).toHaveLength(0);
  vector(0);
  requests = [];
  expect((await push()).pendingVectors ?? 0).toBe(0);
  expect(sent("chunks").flatMap((r) => r.items)).toHaveLength(2);
});
test("canonical trailing slash retains target progress and does not persist token", async () => {
  vector(0);
  vector(1);
  await push();
  requests = [];
  await push("https://first.example/sync/");
  expect(sent("assets")).toHaveLength(0);
  expect(sent("chunks_reset")).toHaveLength(0);
  const { readFileSync } = await import("node:fs");
  expect(readFileSync(join(root, "sync-state.json"), "utf8")).not.toContain(
    "secret-a",
  );
});

test("failed replacement invalidates old completion so reverting vectors repairs cloud index", async () => {
  vector(0);
  vector(1);
  await push();
  vector(1, "model-a", 0.5);
  fail = true;
  await expect(push()).rejects.toThrow("400");
  vector(1, "model-a", 1);
  fail = false;
  requests = [];
  await push();
  expect(sent("chunks").flatMap((r) => r.items)).toHaveLength(2);
});
