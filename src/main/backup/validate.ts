import { validateSession } from "../interview/scoring";
import type { Evidence } from "../../shared/knowledge";
import { open, type ZipFile, type Entry } from "yauzl";
import { createWriteStream, readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { hash, safePath, normalizeUrl } from "../library/files";
import { manifestSchema, type Manifest } from "./manifest";

export async function validateBackup(
  path: string,
): Promise<{ root: string; manifest: Manifest; dispose: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "shizhi-import-"));
  try {
    const zip = await new Promise<ZipFile>((resolve, reject) =>
      open(
        path,
        { lazyEntries: true, autoClose: true, validateEntrySizes: true },
        (e, z) => (e ? reject(e) : resolve(z!)),
      ),
    );
    const names = new Set<string>();
    let count = 0,
      total = 0;
    await new Promise<void>((resolve, reject) => {
      let failed = false;
      const fail = (e: unknown) => {
        if (!failed) {
          failed = true;
          zip.close();
          reject(e);
        }
      };
      zip.on("error", fail);
      zip.on("end", resolve);
      zip.on("entry", (entry: Entry) => {
        void (async () => {
          if (
            ++count > 100000 ||
            entry.uncompressedSize > 256 * 1024 * 1024 ||
            (total += entry.uncompressedSize) > 20 * 1024 ** 3
          )
            throw Error("备份超过大小限制");
          const name = entry.fileName;
          if (
            name.endsWith("/") ||
            names.has(name.toLowerCase()) ||
            ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000
          )
            throw Error("备份含重复路径或非法文件类型");
          names.add(name.toLowerCase());
          const target = safePath(root, name);
          await mkdir(dirname(target), { recursive: true });
          const stream = await new Promise<NodeJS.ReadableStream>((r, j) =>
            zip.openReadStream(entry, (e, s) => (e ? j(e) : r(s!))),
          );
          let written = 0;
          const limiter = new Transform({
            transform(chunk, _encoding, done) {
              written += chunk.length;
              done(
                written > entry.uncompressedSize
                  ? Error("解压大小不一致")
                  : null,
                chunk,
              );
            },
          });
          await pipeline(
            stream,
            limiter,
            createWriteStream(target, { flags: "wx" }),
          );
          if (written !== entry.uncompressedSize) throw Error("备份文件不完整");
          zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
    const manifestBytes = readFileSync(safePath(root, "manifest.json"));
    if (manifestBytes.length > 32 * 1024 * 1024) throw Error("备份清单过大");
    const manifest = manifestSchema.parse(
      JSON.parse(manifestBytes.toString("utf8")),
    );
    const expected = new Set(["manifest.json"]);
    for (const file of manifest.files) {
      if (expected.has(file.path)) throw Error("清单路径重复");
      expected.add(file.path);
      const bytes = readFileSync(safePath(root, file.path));
      if (bytes.length !== file.size || hash(bytes) !== file.hash)
        throw Error("备份校验失败");
    }
    if (
      expected.size !== names.size ||
      [...expected].some((p) => !names.has(p.toLowerCase()))
    )
      throw Error("备份包含未声明文件");
    validateRelations(manifest, expected);
    const qaIds = new Set<string>();
    const categories = new Set(manifest.qaCategories);
    if (categories.size !== manifest.qaCategories.length)
      throw Error("备份分类重复");
    for (const record of manifest.qaRecords) {
      if (record.category && !categories.has(record.category))
        throw Error("问答分类不存在");
      if (qaIds.has(record.id)) throw Error("问答标识重复");
      qaIds.add(record.id);
      const ids = new Set(record.evidence.map((e) => e.id));
      if (record.status === "complete" && !record.answer)
        throw Error("问答答案缺失");
      if (
        record.answer?.paragraphs.some((p) =>
          p.sources.some((id) => !ids.has(id)),
        )
      )
        throw Error("问答引用无效");
      validateEvidence(record.evidence);
    }
    function validateEvidence(evidence: Evidence[]) {
      for (const e of evidence) {
        const version = manifest.versions.find(
          (v) => v.id === e.versionId && v.articleId === e.articleId,
        );
        if (!version) throw Error("问答引用版本缺失");
        const lines = readFileSync(
          safePath(root, version.markdownPath),
          "utf8",
        ).split("\n");
        if (
          e.lineEnd > lines.length ||
          e.quote !== lines.slice(e.lineStart - 1, e.lineEnd).join("\n") ||
          e.id !== hash(e.versionId + ":" + (e.lineStart - 1) + ":" + e.lineEnd)
        )
          throw Error("问答引用与原文不一致");
      }
    }
    for (const collection of [
      manifest.interviewMaterials,
      manifest.interviewQuestions,
      manifest.interviewSessions,
    ]) {
      if (new Set(collection.map((r) => r.id)).size !== collection.length)
        throw Error("面试备份标识重复");
    }
    for (const question of manifest.interviewQuestions)
      validateEvidence(question.evidence);
    for (const session of manifest.interviewSessions) {
      validateSession(session);
      for (const question of [
        ...session.bankQueue,
        ...session.turns.map((t) => t.question),
      ])
        validateEvidence(question.evidence);
    }

    return {
      root,
      manifest,
      dispose: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
function validateRelations(m: Manifest, files: Set<string>) {
  const referenced = new Set([
    "manifest.json",
    ...m.versions.flatMap((v) => [
      v.markdownPath,
      ...v.assets.map((a) => a.relativePath),
    ]),
  ]);
  if (
    files.size !== referenced.size ||
    [...files].some((path) => !referenced.has(path))
  )
    throw Error("备份包含未被文章引用的文件");
  const sources = new Map(m.sources.map((s) => [s.id, s])),
    articles = new Map(m.articles.map((a) => [a.id, a])),
    versions = new Map(m.versions.map((v) => [v.id, v]));
  if (
    sources.size !== m.sources.length ||
    articles.size !== m.articles.length ||
    versions.size !== m.versions.length
  )
    throw Error("备份标识重复");
  for (const s of m.sources)
    if (
      s.id !== hash(new URL(s.entryUrl).origin) ||
      s.allowedOrigins.some((o) => o !== new URL(s.entryUrl).origin)
    )
      throw Error("备份来源范围无效");
  for (const a of m.articles)
    if (
      a.id !== hash(normalizeUrl(a.canonicalUrl)) ||
      !sources.has(a.sourceId) ||
      versions.get(a.currentVersionId)?.articleId !== a.id ||
      !sources
        .get(a.sourceId)!
        .allowedOrigins.includes(new URL(a.canonicalUrl).origin)
    )
      throw Error("文章关联无效");
  for (const v of m.versions) {
    if (
      !articles.has(v.articleId) ||
      v.id !== hash(v.articleId + v.contentHash) ||
      v.markdownPath !== `articles/${v.articleId}/versions/${v.id}.md` ||
      !files.has(v.markdownPath)
    )
      throw Error("版本关联无效");
    for (const a of v.assets)
      if (
        !new RegExp(`^assets/${a.hash}\\.(png|jpg|webp|gif|avif|svg)$`).test(
          a.relativePath,
        ) ||
        !files.has(a.relativePath) ||
        m.files.find((f) => f.path === a.relativePath)?.hash !== a.hash
      )
        throw Error("图片关联无效");
  }
}
