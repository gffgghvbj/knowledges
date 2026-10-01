import { revision } from "../library/revision";
import type { LibraryRepository } from "../library/repository";
import { MAX_CONTEXT_CHARS, type Evidence } from "../../shared/knowledge";
import type { VectorStatus } from "../../shared/retrieval";
import { hash } from "../library/files";
import { RetrievalSettings, embeddingFingerprint } from "./retrieval-settings";
import { embed, normalize, retrievalError } from "./retrieval-api";
export const embeddingText = (chunk: Evidence) =>
  chunk.title + "\n" + chunk.quote;
export function currentChunks(repo: LibraryRepository): Evidence[] {
  const versions = new Map(
    repo.listArticles().map((a) => [a.id, a.currentVersionId]),
  );
  return repo.db
    .prepare("SELECT data FROM knowledge_chunks")
    .all()
    .map((r) => JSON.parse(r.data as string) as Evidence)
    .filter((c) => versions.get(c.articleId) === c.versionId);
}
export class VectorIndex {
  private work?: Promise<void>;
  private counts?: {
    key: string;
    ready: number;
    total: number;
    excluded: number;
  };
  private settledKey?: string;
  private indexKey() {
    return (
      revision(this.repo.db, [
        "articles",
        "knowledge_chunks",
        "vector_embeddings",
      ]) + JSON.stringify(this.settings.get())
    );
  }
  private controller?: AbortController;
  private timer?: ReturnType<typeof setInterval>;
  private epoch = 0;
  private closed = false;
  constructor(
    private repo: LibraryRepository,
    readonly settings: RetrievalSettings,
    private embedder: typeof embed = embed,
  ) {}
  watch() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 1500);
    this.timer.unref();
    void this.tick();
  }
  private control() {
    return this.repo.db
      .prepare("SELECT paused,error FROM vector_control WHERE id=1")
      .get() as { paused: number; error: string };
  }
  private setControl(paused: boolean, error = "") {
    this.repo.db
      .prepare("UPDATE vector_control SET paused=?,error=? WHERE id=1")
      .run(paused ? 1 : 0, error);
  }
  eligible() {
    return currentChunks(this.repo).filter(
      (c) => c.quote.length <= MAX_CONTEXT_CHARS,
    );
  }
  readyIds(fingerprint = embeddingFingerprint(this.settings.get().embedding)) {
    return new Map(
      this.repo.db
        .prepare(
          "SELECT chunk_id,input_hash FROM vector_embeddings WHERE fingerprint=?",
        )
        .all(fingerprint)
        .map((r) => [r.chunk_id as string, r.input_hash as string]),
    );
  }
  status(): VectorStatus {
    const cfg = this.settings.get(),
      key = this.indexKey(),
      control = this.control();
    if (this.counts?.key !== key) {
      const all = currentChunks(this.repo),
        chunks = all.filter((c) => c.quote.length <= MAX_CONTEXT_CHARS),
        cached = this.readyIds();
      this.counts = {
        key,
        ready: chunks.filter((c) => cached.get(c.id) === hash(embeddingText(c)))
          .length,
        total: chunks.length,
        excluded: all.length - chunks.length,
      };
    }
    const { ready, total, excluded } = this.counts;
    return {
      state: !cfg.enabled
        ? "disabled"
        : control.error
          ? "failed"
          : control.paused
            ? "paused"
            : this.work
              ? "running"
              : ready === total
                ? "ready"
                : "running",
      ready,
      total,
      excluded,
      error: control.error || undefined,
      model: cfg.embedding.model,
    };
  }
  start() {
    if (this.closed) throw Error("索引服务已关闭");
    if (!this.settings.get().enabled) throw Error("请先启用混合检索并保存设置");
    this.settledKey = undefined;
    this.setControl(false);
    void this.tick();
  }
  pause() {
    this.epoch++;
    this.setControl(true);
    this.controller?.abort();
  }
  rebuild() {
    this.pause();
    const fingerprint = embeddingFingerprint(this.settings.get().embedding);
    this.repo.db
      .prepare("DELETE FROM vector_embeddings WHERE fingerprint=?")
      .run(fingerprint);
    this.start();
  }
  async tick() {
    if (this.work) return this.work;
    if (this.closed || this.control().paused || !this.settings.get().enabled)
      return;
    if (this.settledKey === this.indexKey()) return;
    const controller = new AbortController(),
      epoch = this.epoch;
    this.controller = controller;
    this.work = Promise.resolve()
      .then(() => this.process(controller, epoch))
      .finally(() => {
        this.work = undefined;
        this.controller = undefined;
      });
    return this.work;
  }
  private async process(controller: AbortController, epoch: number) {
    try {
      const publicConfig = this.settings.get(),
        fingerprint = embeddingFingerprint(publicConfig.embedding);
      this.repo.db
        .prepare(
          "DELETE FROM vector_embeddings WHERE chunk_id NOT IN (SELECT id FROM knowledge_chunks)",
        )
        .run();
      while (!controller.signal.aborted && epoch === this.epoch) {
        if (
          embeddingFingerprint(this.settings.get().embedding) !== fingerprint ||
          !this.settings.get().enabled
        )
          return;
        const ready = this.readyIds(fingerprint),
          pending = this.eligible().filter(
            (c) => ready.get(c.id) !== hash(embeddingText(c)),
          );
        if (!pending.length) {
          this.settledKey = this.indexKey();
          return;
        }
        const batch: Evidence[] = [];
        let chars = 0;
        for (const c of pending) {
          const n = embeddingText(c).length;
          if (batch.length && (batch.length >= 8 || chars + n > 24000)) break;
          batch.push(c);
          chars += n;
        }
        const cfg = this.settings.resolve();
        const vectors = await this.embedder(
          cfg.embedding,
          batch.map(embeddingText),
          "document",
          AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
        );
        if (
          controller.signal.aborted ||
          epoch !== this.epoch ||
          embeddingFingerprint(this.settings.get().embedding) !== fingerprint
        )
          return;
        if (vectors.length !== batch.length) throw Error("向量返回数量不一致");
        const normalized = vectors.map((v) =>
          normalize(v, cfg.embedding.dimensions),
        );
        const current = new Map(
          this.eligible().map((c) => [c.id, hash(embeddingText(c))]),
        );
        this.repo.transaction(() =>
          batch.forEach((c, i) => {
            const inputHash = hash(embeddingText(c));
            if (current.get(c.id) !== inputHash) return;
            const bytes = Buffer.alloc(normalized[i].length * 4);
            normalized[i].forEach((n, j) => bytes.writeFloatLE(n, j * 4));
            this.repo.db
              .prepare(
                "INSERT OR REPLACE INTO vector_embeddings VALUES (?,?,?,?)",
              )
              .run(fingerprint, c.id, inputHash, bytes);
          }),
        );
        await new Promise<void>((r) => setImmediate(r));
      }
    } catch (e) {
      if (!controller.signal.aborted && epoch === this.epoch)
        this.setControl(true, retrievalError(e));
    }
  }
  async waitForIdle() {
    await this.work;
  }
  close() {
    this.closed = true;
    this.epoch++;
    this.controller?.abort();
    if (this.timer) clearInterval(this.timer);
  }
}
