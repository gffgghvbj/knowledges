import type { ExtractionSelection } from "../../shared/extraction";
import { validateSelection } from "../capture/adapters/rules";
import type { QaSummary } from "../../shared/lists";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, statSync } from "node:fs";
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
import { categoryNameSchema, type QaRecord } from "../../shared/knowledge";
import { migrate } from "./schema";

export class LibraryRepository {
  readonly db: DatabaseSync;
  constructor(
    readonly root: string,
    options: { deferMaintenance?: boolean } = {},
  ) {
    mkdirSync(root, { recursive: true });
    this.db = new DatabaseSync(join(root, "library.sqlite"));
    try {
      migrate(this.db);
      if (!options.deferMaintenance) this.repairDerivedData();
    } catch (error) {
      this.db.close();
      throw error;
    }
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
    table: "sources" | "articles" | "versions" | "tasks" | "qa_records",
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
  addSource(input: string, extraction?: ExtractionSelection): Source {
    const selection = validateSelection(extraction ?? { preset: "auto" });
    const entryUrl = normalizeUrl(input),
      url = new URL(entryUrl),
      id = hash(url.origin);
    const existing = this.getSource(id);
    if (existing) {
      if (existing.deletedAt) {
        const restored = { ...existing, entryUrl, deletedAt: undefined };
        this.putSource(restored);
        return restored;
      }
      return existing;
    }
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
      extraction: selection,
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
  listSources(includeDeleted = false) {
    return this.all<Source>("sources").filter(
      (s) => includeDeleted || !s.deletedAt,
    );
  }
  deleteSource(id: string) {
    const source = this.getSource(id);
    if (!source) return;
    this.transaction(() => {
      this.putSource({ ...source, deletedAt: new Date().toISOString() });
      this.db
        .prepare("DELETE FROM tasks WHERE json_extract(data,'$.sourceId')=?")
        .run(id);
    });
  }
  deleteTasks(ids: string[]) {
    this.transaction(() => {
      const remove = this.db.prepare("DELETE FROM tasks WHERE id=?");
      for (const id of new Set(ids)) remove.run(id);
    });
  }
  getSource(id: string) {
    return this.get<Source>("sources", id);
  }
  listArticles(includeDeleted = false) {
    return this.db
      .prepare(
        "SELECT data FROM articles" +
          (includeDeleted
            ? ""
            : " WHERE json_extract(data,'$.deletedAt') IS NULL"),
      )
      .all()
      .map((r) => JSON.parse(r.data as string) as Article);
  }
  trashedArticles() {
    return this.db
      .prepare(
        "SELECT data FROM articles WHERE json_extract(data,'$.deletedAt') IS NOT NULL ORDER BY json_extract(data,'$.deletedAt') DESC",
      )
      .all()
      .map((r) => JSON.parse(r.data as string) as Article);
  }
  trashArticles(ids: string[]) {
    this.transaction(() => {
      for (const id of new Set(ids)) {
        const article = this.getArticle(id);
        if (!article || article.deletedAt) continue;
        this.putArticle({ ...article, deletedAt: new Date().toISOString() });
        this.removeIndex(id);
      }
    });
  }
  restoreArticles(ids: string[]) {
    this.transaction(() => {
      for (const id of new Set(ids)) {
        const article = this.getArticle(id);
        if (!article?.deletedAt) continue;
        const restored = { ...article, deletedAt: undefined };
        this.putArticle(restored);
        this.index(restored, this.readArticle(id).markdown);
      }
    });
  }
  private removeIndex(id: string) {
    this.db
      .prepare(
        "DELETE FROM vector_embeddings WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE article_id=?)",
      )
      .run(id);
    this.db.prepare("DELETE FROM knowledge_chunks WHERE article_id=?").run(id);
    this.db.prepare("DELETE FROM search_docs WHERE id=?").run(id);
    this.db.prepare("DELETE FROM search_fts WHERE id=?").run(id);
    this.db
      .prepare("DELETE FROM article_maintenance WHERE article_id=?")
      .run(id);
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
    const deleted = this.getArticle(articleId);
    if (deleted?.deletedAt) return this.getVersion(deleted.currentVersionId)!;
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
    const path = this.resolvePath(target);
    atomicWrite(path, markdown);
    const file = statSync(path);
    this.db
      .prepare(
        `INSERT INTO article_maintenance (article_id,materialized_version,materialized_mtime,materialized_size)
      VALUES (?,?,?,?) ON CONFLICT(article_id) DO UPDATE SET materialized_version=excluded.materialized_version,
      materialized_mtime=excluded.materialized_mtime,materialized_size=excluded.materialized_size`,
      )
      .run(article.id, article.currentVersionId, file.mtimeMs, file.size);
  }
  private maintenanceRows() {
    return this.db
      .prepare(
        `SELECT a.data, m.*,
      coalesce(k.n,0) actual_chunks, coalesce(f.n,0) fts_rows, d.id doc_id
      FROM articles a LEFT JOIN article_maintenance m ON a.id=m.article_id
      LEFT JOIN (SELECT article_id,count(*) n FROM knowledge_chunks GROUP BY article_id) k ON k.article_id=a.id
      LEFT JOIN (SELECT id,count(*) n FROM search_fts GROUP BY id) f ON f.id=a.id
      LEFT JOIN search_docs d ON d.id=a.id WHERE json_extract(a.data,'$.deletedAt') IS NULL`,
      )
      .all();
  }
  private repairRow(
    row: ReturnType<LibraryRepository["maintenanceRows"]>[number],
    filesOnly = false,
  ) {
    const article = JSON.parse(row.data as string) as Article;
    let file: ReturnType<typeof statSync> | undefined;
    try {
      file = statSync(this.resolvePath(`articles/${article.id}/current.md`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (
      !file ||
      row.materialized_version !== article.currentVersionId ||
      row.materialized_mtime !== file.mtimeMs ||
      row.materialized_size !== file.size
    )
      this.materialize(article);
    if (
      !filesOnly &&
      (row.indexed_version !== article.currentVersionId ||
        row.indexed_title !== article.title ||
        row.index_revision !== 1 ||
        row.chunk_count !== row.actual_chunks ||
        row.fts_rows !== 1 ||
        !row.doc_id)
    )
      this.transaction(() =>
        this.index(article, this.readArticle(article.id).markdown),
      );
  }
  repairDerivedData() {
    for (const row of this.maintenanceRows()) this.repairRow(row);
  }
  async prepare(
    progress: (completed: number, total: number) => void = () => {},
  ) {
    const rows = this.maintenanceRows();
    progress(0, rows.length);
    for (let i = 0; i < rows.length; i++) {
      this.repairRow(rows[i]);
      if ((i + 1) % 20 === 0 || i + 1 === rows.length) {
        progress(i + 1, rows.length);
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
  }
  recoverPendingWrites() {
    for (const row of this.maintenanceRows()) this.repairRow(row, true);
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
    if (article.deletedAt) {
      this.removeIndex(article.id);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO article_maintenance (article_id) VALUES (?)
      ON CONFLICT(article_id) DO UPDATE SET indexed_version=NULL`,
      )
      .run(article.id);
    indexKnowledge(this.db, article, this.readArticle(article.id).markdown);
    this.db
      .prepare("INSERT OR REPLACE INTO search_docs VALUES (?,?,?)")
      .run(article.id, article.title, text);
    this.db.prepare("DELETE FROM search_fts WHERE id=?").run(article.id);
    this.db
      .prepare("INSERT INTO search_fts VALUES (?,?,?)")
      .run(article.id, article.title, text);
    const chunks = this.db
      .prepare("SELECT count(*) n FROM knowledge_chunks WHERE article_id=?")
      .get(article.id)!.n;
    this.db
      .prepare(
        `UPDATE article_maintenance SET indexed_version=?,indexed_title=?,index_revision=1,chunk_count=? WHERE article_id=?`,
      )
      .run(article.currentVersionId, article.title, chunks, article.id);
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
  updateQaGeneration(record: QaRecord) {
    const existing = this.get<QaRecord>("qa_records", record.id);
    if (existing) this.putQa({ ...record, category: existing.category });
  }
  deleteQa(ids: string[]) {
    this.transaction(() => {
      const statement = this.db.prepare("DELETE FROM qa_records WHERE id=?");
      for (const id of new Set(ids)) statement.run(id);
    });
  }
  listQaCategories(): string[] {
    return this.db
      .prepare("SELECT name FROM qa_categories ORDER BY name")
      .all()
      .map((row) => row.name as string);
  }
  createQaCategory(raw: string) {
    const name = categoryNameSchema.parse(raw);
    if (this.listQaCategories().includes(name)) throw Error("分类名称已存在");
    this.db.prepare("INSERT INTO qa_categories VALUES (?)").run(name);
    return name;
  }
  moveQa(ids: string[], category: string | null) {
    if (category !== null && !this.listQaCategories().includes(category))
      throw Error("分类不存在，请刷新后重试");
    const selected = new Set(ids);
    this.transaction(() => {
      for (const record of this.listQa())
        if (selected.has(record.id))
          this.putQa({ ...record, category: category ?? undefined });
    });
  }
  renameQaCategory(old: string, raw: string) {
    const name = categoryNameSchema.parse(raw),
      categories = this.listQaCategories();
    if (!categories.includes(old)) throw Error("分类不存在");
    if (old === name) return name;
    if (categories.includes(name)) throw Error("分类名称已存在");
    this.transaction(() => {
      this.db
        .prepare("UPDATE qa_categories SET name=? WHERE name=?")
        .run(name, old);
      for (const record of this.listQa())
        if (record.category === old) this.putQa({ ...record, category: name });
    });
    return name;
  }
  deleteQaCategory(name: string) {
    this.transaction(() => {
      for (const record of this.listQa())
        if (record.category === name)
          this.putQa({ ...record, category: undefined });
      this.db.prepare("DELETE FROM qa_categories WHERE name=?").run(name);
    });
  }
  getQa(id: string): QaRecord | undefined {
    return this.get<QaRecord>("qa_records", id);
  }
  qaSummaries(): QaSummary[] {
    return this.db
      .prepare(
        `SELECT id, substr(json_extract(data,'$.question'),1,200) question,
      json_extract(data,'$.status') status, json_extract(data,'$.createdAt') createdAt,
      json_extract(data,'$.category') category FROM qa_records ORDER BY json_extract(data,'$.createdAt') DESC, id DESC`,
      )
      .all() as QaSummary[];
  }
  pendingQa(): QaRecord[] {
    return this.db
      .prepare(
        "SELECT data FROM qa_records WHERE json_extract(data,'$.status')='pending'",
      )
      .all()
      .map((row) => JSON.parse(row.data as string));
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
  interruptedTasks(): CaptureTask[] {
    return this.db
      .prepare(
        "SELECT data FROM tasks WHERE json_extract(data,'$.state') IN ('running','queued')",
      )
      .all()
      .map((row) => JSON.parse(row.data as string));
  }
  listTasks() {
    return this.all<CaptureTask>("tasks").sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }
}
