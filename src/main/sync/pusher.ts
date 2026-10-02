import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { LibraryRepository } from "../library/repository";
import type { Source, Article, ArticleVersion } from "../../shared/contracts";
import type { InterviewQuestion } from "../../shared/interview";
import type { ReviewItem } from "../../shared/review";
import type { SyncPushResult, SyncSettings } from "../../shared/sync";

interface StateFile {
  lastPushedAt?: string;
  uploadedAssets?: string[];
}

interface PushRow {
  [key: string]: unknown;
}

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

/** 把正文里的相对图片路径改写成 asset:<hash> 标记，由云端替换为存储 URL */
function canonicalize(markdown: string) {
  return markdown.replace(
    /(?:\.\.\/)+assets\/([a-f0-9]{64})\.(png|jpg|webp|gif|avif|svg)/g,
    "asset:$1",
  );
}

export class SyncPusher {
  private state: StateFile = {};
  constructor(
    private readonly repo: LibraryRepository,
    private readonly settings: SyncSettings & { token?: string },
  ) {
    const path = join(repo.root, "sync-state.json");
    try {
      this.state = JSON.parse(readFileSync(path, "utf8")) as StateFile;
    } catch {
      this.state = {};
    }
  }
  private saveState() {
    const path = join(this.repo.root, "sync-state.json");
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, path);
  }
  private requestCount = 0;
  private async call(
    path: string,
    body?: unknown,
    attempt = 0,
  ): Promise<Record<string, unknown>> {
    try {
      const response = await fetch(`${this.settings.endpoint}${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          "content-type": "application/json",
          "x-sync-token": this.settings.token ?? "",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(120000),
      });
      if (response.status === 401) throw Error("同步密钥不正确");
      if (response.status === 413)
        throw Error("云端返回 413（单请求超过网关体积限制），请升级客户端后重试");
      // 5xx/429 视为可重试；其余 4xx 直接失败
      if (!response.ok && response.status < 500 && response.status !== 429)
        throw Error(`云端返回 ${response.status}`);
      if (!response.ok)
        throw Error(`RETRYABLE_${response.status}`);
      const result = (await response.json()) as {
        code?: number;
        msg?: string;
      };
      if (result.code !== 0) throw Error(result.msg ?? "云端处理失败");
      this.requestCount += 1;
      return result as Record<string, unknown>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const nonRetryable =
        /^(同步密钥|云端返回 4)/.test(message) || message.startsWith("云端处理失败");
      if (attempt < 2 && !nonRetryable) {
        await new Promise((resolve) =>
          setTimeout(resolve, 600 * 2 ** attempt),
        );
        return this.call(path, body, attempt + 1);
      }
      throw error instanceof Error && message.startsWith("RETRYABLE_")
        ? Error(`云端返回 ${message.slice("RETRYABLE_".length)}`)
        : error;
    }
  }
  // 网关单请求限制约 100KB（按 UTF-8 字节计）。
  // 统一采用「行级分块」：超过阈值的条目整体序列化为 JSON 后按字节切块（字符边界对齐），
  // 云端拼回 JSON 再处理。中文 3 字节/字符，按字符切会 3 倍超限——必须按字节。
  private static readonly CHUNK_BYTES = 24 * 1024;
  private static readonly SAFE_BATCH = 24 * 1024;

  /** 按 UTF-8 字节切块，回退到字符边界避免拆散多字节字符 */
  private static chunkUtf8(value: string, maxBytes: number): string[] {
    const buf = Buffer.from(value, "utf8");
    const parts: string[] = [];
    let start = 0;
    while (start < buf.length) {
      let end = Math.min(start + maxBytes, buf.length);
      if (end < buf.length)
        while (end > start && (buf[end] & 0xc0) === 0x80) end--;
      parts.push(buf.subarray(start, end).toString("utf8"));
      start = end;
    }
    return parts;
  }

  private async sendItem(
    kind: string,
    item: PushRow,
  ): Promise<Record<string, unknown> | null> {
    const serialized = JSON.stringify(item);
    if (Buffer.byteLength(serialized, "utf8") <= SyncPusher.SAFE_BATCH)
      return this.call("/push", { kind, items: [item] });
    const chunkKey = String(item.id ?? item.hash ?? "");
    if (!chunkKey) throw Error("分块传输缺少条目标识");
    const chunkId = `${kind}:${chunkKey}`;
    const parts = SyncPusher.chunkUtf8(
      serialized,
      SyncPusher.CHUNK_BYTES,
    );
    let last: Record<string, unknown> | null = null;
    for (let i = 0; i < parts.length; i++) {
      last = await this.call("/push", {
        kind,
        items: [
          {
            __chunk: {
              id: chunkId,
              index: i,
              total: parts.length,
              data: parts[i],
            },
          },
        ],
      });
    }
    return last;
  }
  private async batch(kind: string, items: PushRow[]) {
    let buffer: PushRow[] = [];
    let size = 0;
    const flush = async () => {
      if (!buffer.length) return;
      await this.call("/push", { kind, items: buffer });
      buffer = [];
      size = 0;
    };
    for (const item of items) {
      const bytes = Buffer.byteLength(JSON.stringify(item), "utf8");
      if (bytes > SyncPusher.SAFE_BATCH) {
        await flush();
        await this.sendItem(kind, item);
        continue;
      }
      if (size + bytes > SyncPusher.SAFE_BATCH || buffer.length >= 50)
        await flush();
      buffer.push(item);
      size += bytes;
    }
    await flush();
  }
  /** 受限并发执行（保持失败即中断语义） */
  private static readonly CONCURRENCY = 4;
  private static readonly BATCH_ARTICLES = 50;
  private async pool<T>(
    items: T[],
    worker: (item: T) => Promise<void>,
    limit = SyncPusher.CONCURRENCY,
  ): Promise<void> {
    let index = 0;
    const runners = Array.from(
      { length: Math.min(limit, items.length) },
      async () => {
        while (index < items.length) {
          const current = items[index++];
          await worker(current);
        }
      },
    );
    await Promise.all(runners);
  }
  async push(): Promise<SyncPushResult> {
    if (!this.settings.endpoint) throw Error("请先配置云端同步地址");
    if (!this.settings.token) throw Error("请先配置同步密钥");
    await this.call("/status");
    const result: SyncPushResult = {
      sources: 0,
      articles: 0,
      versions: 0,
      questions: 0,
      reviews: 0,
      assets: 0,
      batches: 0,
      finishedAt: "",
    };
    // 1. 来源
    const sources = this.repo.listSources(true);
    await this.batch(
      "sources",
      sources.map((s: Source) => ({
        id: s.id,
        label: s.label,
        entry_url: s.entryUrl,
        adapter_id: s.adapterId,
        deleted_at: s.deletedAt ?? null,
      })),
    );
    result.sources = sources.length;
    // 2. 文章元数据（含回收站）
    const articles = this.repo.listArticles(true);
    await this.batch(
      "articles",
      articles.map((a: Article) => ({
        id: a.id,
        source_id: a.sourceId,
        title: a.title,
        url: a.canonicalUrl,
        section_path: a.sectionPath,
        current_version_id: a.currentVersionId,
        deleted_at: a.deletedAt ?? null,
        last_seen_at: a.lastSeenAt,
      })),
    );
    result.articles = articles.length;
    // 3. 当前版本正文 + 未上传图片：分批（50 篇）+ 4 路并发
    const uploaded = new Set(this.state.uploadedAssets ?? []);
    const jobs: {
      article: Article;
      version: ArticleVersion;
    }[] = [];
    for (const article of articles) {
      const version = this.repo.getVersion(article.currentVersionId);
      if (version) jobs.push({ article, version });
    }
    for (let i = 0; i < jobs.length; i += SyncPusher.BATCH_ARTICLES) {
      const slice = jobs
        .slice(i, i + SyncPusher.BATCH_ARTICLES)
        .map(({ article, version }) => ({
          article,
          version,
          markdown: canonicalize(
            readFileSync(
              this.repo.resolvePath(version.markdownPath),
              "utf8",
            ),
          ),
          assetRefs: (version.assets ?? []).map((asset) => {
            const ext =
              EXT[asset.mimeType] ?? asset.relativePath.split(".").at(-1);
            return { hash: asset.hash, ext };
          }),
        }));
      // a) 并发上传缺失图片（按 hash 去重）
      const missing = new Map<
        string,
        { hash: string; ext: string; path: string }
      >();
      for (const job of slice)
        for (const ref of job.assetRefs) {
          if (uploaded.has(ref.hash) || missing.has(ref.hash)) continue;
          missing.set(ref.hash, {
            hash: ref.hash,
            ext: ref.ext,
            path: `assets/${ref.hash}.${ref.ext}`,
          });
        }
      await this.pool([...missing.values()], async (m) => {
        let bytes: Buffer;
        try {
          bytes = readFileSync(this.repo.resolvePath(m.path));
        } catch {
          return;
        }
        const response = (await this.sendItem("assets", {
          hash: m.hash,
          ext: m.ext,
          mime_type: assetMime(m.ext),
          data_base64: bytes.toString("base64"),
        })) as { urls?: Record<string, string> } | null;
        if (response?.urls) {
          for (const h of Object.keys(response.urls)) uploaded.add(h);
          result.assets += Object.keys(response.urls).length;
        } else {
          // 分块路径：按 hash 记账（云端拼装上传已完成）
          uploaded.add(m.hash);
          result.assets += 1;
        }
      });
      // b) 并发推送版本正文
      await this.pool(slice, async (job) => {
        await this.sendItem("versions", {
          id: job.version.id,
          article_id: job.article.id,
          content_hash: job.version.contentHash,
          captured_at: job.version.capturedAt,
          markdown: job.markdown,
          completeness: job.version.completeness,
          assets: job.assetRefs,
        });
        result.versions += 1;
      });
      // c) 增量保存进度：中断后图片不重传
      this.state.uploadedAssets = [...uploaded];
      this.state.lastPushedAt = new Date().toISOString();
      this.saveState();
    }
    // 4. 题库
    const questions = (
      this.repo.db.prepare("SELECT data FROM interview_questions").all() as {
        data: string;
      }[]
    ).map((row) => JSON.parse(row.data) as InterviewQuestion);
    await this.batch(
      "questions",
      questions.map((q) => ({
        id: q.id,
        topic: q.knowledgePoints.join(" / ").slice(0, 200),
        stem: q.prompt,
        reference_answer: q.referenceAnswer,
        source_refs: q.evidence,
        updated_at: q.updatedAt,
      })),
    );
    result.questions = questions.length;
    // 5. 复习
    const reviews = (
      this.repo.db.prepare("SELECT data FROM interview_reviews").all() as {
        data: string;
      }[]
    ).map((row) => JSON.parse(row.data) as ReviewItem);
    await this.batch(
      "reviews",
      reviews.map((r) => ({
        id: r.id,
        session_id: r.sourceSessionId,
        question_snapshot: {
          question: r.baseline.question,
          config: r.config,
          resume: r.resume,
          jd: r.jd,
        },
        original_answer: r.baseline.answer ?? "",
        practice_snapshots: r.attempts.map((a) => ({
          session_id: a.sessionId,
          turn: a.turn,
        })),
        state: r.state === "mastered" ? "mastered" : "active",
        updated_at: r.updatedAt,
      })),
    );
    result.reviews = reviews.length;
    this.state.uploadedAssets = [...uploaded];
    this.state.lastPushedAt = new Date().toISOString();
    result.finishedAt = this.state.lastPushedAt;
    result.batches = this.requestCount;
    this.saveState();
    return result;
  }
}

function assetMime(ext: string) {
  return (
    Object.entries(EXT).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream"
  );
}
