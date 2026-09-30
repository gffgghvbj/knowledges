import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import type {
  Source,
  Candidate,
  Article,
  ArticleVersion,
  Asset,
  ExtractedArticle,
  CaptureTask,
} from "../../shared/contracts";
import { atomicWrite, hash, normalizeUrl, safePath } from "./files";
import { indexKnowledge } from "../knowledge/index";
import type { QaRecord } from "../../shared/knowledge";
import { migrate } from "./schema";

export class LibraryRepository {
  readonly db: DatabaseSync;
  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true });
    this.db = new DatabaseSync(join(root, "library.sqlite"));
    migrate(this.db);
    this.recoverPendingWrites();
    this.rebuildIndex();
  }
  close() {
    this.db.close();
  }
  resolvePath(path: string) {
    return safePath(this.root, path);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private all<T>(table: "sources" | "articles" | "versions" | "tasks"): T[] {
    return this.db
      .prepare(`SELECT data FROM ${table}`)
      .all()
      .map((row) => JSON.parse(row.data as string));
  }
  private get<T>(
    table: "sources" | "articles" | "versions" | "tasks",
    id: string,
  ): T | undefined {
    const row = this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id);
    return row ? JSON.parse(row.data as string) : undefined;
  }
  putSource(source: Source) {
    this.db
      .prepare("INSERT OR REPLACE INTO sources VALUES (?,?)")
      .run(source.id, JSON.stringify(source));
  }
  addSource(input: string): Source {
    const entryUrl = normalizeUrl(input),
      url = new URL(entryUrl),
      id = hash(url.origin);
    const existing = this.getSource(id);
    if (existing) return existing;
    const adapterId =
      url.hostname === "xiaolincoding.com"
        ? "xiaolin"
        : /(^|\.)javaguide\.cn$/.test(url.hostname)
          ? "javaguide"
          : "generic";
    const source: Source = {
      id,
      entryUrl,
      allowedOrigins: [url.origin],
      adapterId,
      label:
        adapterId === "xiaolin"
          ? "小林 coding"
          : adapterId === "javaguide"
            ? "JavaGuide"
            : url.hostname,
    };
    this.putSource(source);
    return source;
  }
  listSources() {
    return this.all<Source>("sources");
  }
  getSource(id: string) {
    return this.get<Source>("sources", id);
  }
  listArticles() {
    return this.all<Article>("articles");
  }
  getArticle(id: string) {
    return this.get<Article>("articles", id);
  }
  getVersion(id: string) {
    return this.get<ArticleVersion>("versions", id);
  }
  listVersions(id: string): ArticleVersion[] {
    return this.db
      .prepare("SELECT data FROM versions WHERE article_id=?")
      .all(id)
      .map((r) => JSON.parse(r.data as string))
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  }
  putArticle(article: Article) {
    this.db
      .prepare("INSERT OR REPLACE INTO articles VALUES (?,?)")
      .run(article.id, JSON.stringify(article));
  }
  putVersion(v: ArticleVersion) {
    this.db
      .prepare("INSERT OR REPLACE INTO versions VALUES (?,?,?)")
      .run(v.id, v.articleId, JSON.stringify(v));
  }
  writeAsset(bytes: Buffer, mimeType: string): Asset {
    const ext = (
      {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "image/gif": "gif",
        "image/avif": "avif",
        "image/svg+xml": "svg",
      } as Record<string, string>
    )[mimeType];
    if (!ext) throw new Error("不支持的图片类型");
    const digest = hash(bytes),
      relativePath = `assets/${digest}.${ext}`;
    atomicWrite(this.resolvePath(relativePath), bytes);
    return { hash: digest, relativePath, mimeType, size: bytes.length };
  }
  saveArticle(
    input: ExtractedArticle,
    assets: Asset[],
    completeness: ArticleVersion["completeness"] = "complete",
  ): ArticleVersion {
    const canonicalUrl = normalizeUrl(input.candidate.canonicalUrl),
      articleId = hash(canonicalUrl);
    const contentHash = hash(
      input.markdown +
        "\n" +
        [...assets]
          .map((a) => a.hash)
          .sort()
          .join("\n"),
    );
    const id = hash(articleId + contentHash),
      markdownPath = `articles/${articleId}/versions/${id}.md`;
    const previous = this.getVersion(id);
    const version: ArticleVersion = {
      id,
      articleId,
      contentHash,
      capturedAt:
        previous && previous.capturedAt > input.fetchedAt
          ? previous.capturedAt
          : input.fetchedAt,
      markdownPath,
      assets,
      completeness,
    };
    const markdown = this.renderAssets(input.markdown, assets, markdownPath);
    atomicWrite(this.resolvePath(markdownPath), markdown);
    const article: Article = {
      ...input.candidate,
      canonicalUrl,
      id: articleId,
      currentVersionId: id,
      sourceStatus: "available",
      lastSeenAt: input.fetchedAt,
    };
    this.transaction(() => {
      this.putVersion(version);
      this.putArticle(article);
      this.index(article, input.text);
    });
    this.materialize(article);
    return version;
  }
  private renderAssets(markdown: string, assets: Asset[], target: string) {
    for (const asset of assets)
      markdown = markdown
        .split(`asset:${asset.hash}`)
        .join(
          relative(dirname(target), asset.relativePath).split("\\").join("/"),
        );
    return markdown;
  }
  materialize(article: Article) {
    const version = this.getVersion(article.currentVersionId);
    if (!version) throw new Error("文章版本缺失");
    let markdown = readFileSync(this.resolvePath(version.markdownPath), "utf8");
    const target = `articles/${article.id}/current.md`;
    for (const asset of version.assets)
      markdown = markdown
        .split(
          relative(dirname(version.markdownPath), asset.relativePath)
            .split("\\")
            .join("/"),
        )
        .join(
          relative(dirname(target), asset.relativePath).split("\\").join("/"),
        );
    atomicWrite(this.resolvePath(target), markdown);
  }
  recoverPendingWrites() {
    for (const a of this.listArticles()) this.materialize(a);
  }
  readArticle(id: string, versionId?: string) {
    const article = this.getArticle(id);
    if (!article) throw new Error("文章不存在");
    const version = this.getVersion(versionId ?? article.currentVersionId);
    if (!version || version.articleId !== id) throw new Error("版本不存在");
    return {
      article,
      version,
      markdown: readFileSync(this.resolvePath(version.markdownPath), "utf8"),
    };
  }
  restoreVersion(id: string, versionId: string) {
    const { article, version, markdown } = this.readArticle(id, versionId);
    article.currentVersionId = version.id;
    this.transaction(() => {
      this.putArticle(article);
      this.index(article, markdown);
    });
    this.materialize(article);
  }
  markStatus(candidate: Candidate, status: Article["sourceStatus"]) {
    const article = this.getArticle(hash(normalizeUrl(candidate.canonicalUrl)));
    if (article) this.putArticle({ ...article, sourceStatus: status });
  }
  index(article: Article, text: string) {
    indexKnowledge(this.db, article, this.readArticle(article.id).markdown);
    this.db
      .prepare("INSERT OR REPLACE INTO search_docs VALUES (?,?,?)")
      .run(article.id, article.title, text);
    this.db.prepare("DELETE FROM search_fts WHERE id=?").run(article.id);
    this.db
      .prepare("INSERT INTO search_fts VALUES (?,?,?)")
      .run(article.id, article.title, text);
  }
  rebuildIndex() {
    this.transaction(() => {
      this.db.exec("DELETE FROM search_docs; DELETE FROM search_fts;");
      for (const a of this.listArticles())
        this.index(a, this.readArticle(a.id).markdown);
    });
  }
  putQa(record: QaRecord) {
    this.db
      .prepare("INSERT OR REPLACE INTO qa_records VALUES (?,?)")
      .run(record.id, JSON.stringify(record));
  }
  listQa(): QaRecord[] {
    return this.db
      .prepare("SELECT data FROM qa_records ORDER BY rowid DESC")
      .all()
      .map((r) => JSON.parse(r.data as string))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  putTask(task: CaptureTask) {
    this.db
      .prepare("INSERT OR REPLACE INTO tasks VALUES (?,?)")
      .run(task.id, JSON.stringify(task));
  }
  getTask(id: string) {
    return this.get<CaptureTask>("tasks", id);
  }
  listTasks() {
    return this.all<CaptureTask>("tasks").sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }
}
