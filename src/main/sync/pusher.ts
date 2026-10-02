import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
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
  private async call(
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
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
    if (!response.ok) throw Error(`云端返回 ${response.status}`);
    const result = (await response.json()) as { code?: number; msg?: string };
    if (result.code !== 0) throw Error(result.msg ?? "云端处理失败");
    return result as Record<string, unknown>;
  }
  private async batch(kind: string, items: PushRow[]) {
    for (let i = 0; i < items.length; i += 50) {
      await this.call("/push", { kind, items: items.slice(i, i + 50) });
    }
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
    // 3. 当前版本正文 + 未上传图片
    const uploaded = new Set(this.state.uploadedAssets ?? []);
    for (const article of articles) {
      const version = this.repo.getVersion(article.currentVersionId);
      if (!version) continue;
      const markdown = canonicalize(
        readFileSync(this.repo.resolvePath(version.markdownPath), "utf8"),
      );
      const assetRefs = (version.assets ?? []).map((asset) => {
        const ext = EXT[asset.mimeType] ?? asset.relativePath.split(".").at(-1);
        return { hash: asset.hash, ext };
      });
      for (const ref of assetRefs) {
        if (uploaded.has(ref.hash)) continue;
        const file = this.repo
          .resolvePath(`assets/${ref.hash}.${ref.ext}`)
          .toString();
        let bytes: Buffer;
        try {
          bytes = readFileSync(file);
        } catch {
          continue;
        }
        const response = (await this.call("/push", {
          kind: "assets",
          items: [
            {
              hash: ref.hash,
              ext: ref.ext,
              mime_type: assetMime(ref.ext),
              data_base64: bytes.toString("base64"),
            },
          ],
        })) as { urls?: Record<string, string> };
        if (response.urls) {
          for (const h of Object.keys(response.urls)) uploaded.add(h);
          result.assets += Object.keys(response.urls).length;
        }
      }
      await this.call("/push", {
        kind: "versions",
        items: [
          {
            id: version.id,
            article_id: article.id,
            content_hash: version.contentHash,
            captured_at: version.capturedAt,
            markdown,
            completeness: version.completeness,
            assets: assetRefs,
          },
        ],
      });
      result.versions += 1;
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
    this.saveState();
    return result;
  }
}

function assetMime(ext: string) {
  return (
    Object.entries(EXT).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream"
  );
}
