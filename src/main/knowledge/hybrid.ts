import type { LibraryRepository } from "../library/repository";
import type { Evidence, QaScope } from "../../shared/knowledge";
import type { RetrievalTrace } from "../../shared/retrieval";
import { RetrievalSettings, embeddingFingerprint } from "./retrieval-settings";
import { VectorIndex, embeddingText } from "./vector-index";
import { keywordCandidates, packEvidence } from "./index";
import { embed, rerank, retrievalError, normalize } from "./retrieval-api";
import { hash } from "../library/files";
export interface RetrievalResult {
  evidence: Evidence[];
  trace: RetrievalTrace;
}
export interface Retriever {
  retrieve(
    question: string,
    scope: QaScope,
    signal: AbortSignal,
  ): Promise<RetrievalResult>;
}
export class HybridRetriever implements Retriever {
  constructor(
    private repo: LibraryRepository,
    private settings: RetrievalSettings,
    private index: VectorIndex,
    private adapters = { embed, rerank },
  ) {}
  async retrieve(
    question: string,
    scope: QaScope,
    signal: AbortSignal,
  ): Promise<RetrievalResult> {
    signal.throwIfAborted();
    const publicConfig = this.settings.get(),
      snapshot = JSON.stringify(publicConfig),
      fingerprint = embeddingFingerprint(publicConfig.embedding);
    const lexical = keywordCandidates(this.repo, question, scope),
      warnings: string[] = [];
    const trace: RetrievalTrace = { mode: "keyword" };
    if (!publicConfig.enabled)
      return { evidence: packEvidence(lexical), trace };
    const check = () => {
      signal.throwIfAborted();
      if (JSON.stringify(this.settings.get()) !== snapshot)
        throw Error("检索设置已改变，请重新提问");
    };
    const sourceArticles = new Set(
      this.repo
        .listArticles()
        .filter(
          (a) =>
            (!scope.sourceId || a.sourceId === scope.sourceId) &&
            (!scope.section || a.sectionPath.includes(scope.section)),
        )
        .map((a) => a.id),
    );
    const chunks = this.index
        .eligible()
        .filter(
          (c) =>
            sourceArticles.has(c.articleId) &&
            (!scope.topic ||
              embeddingText(c)
                .toLowerCase()
                .includes(scope.topic.toLowerCase())),
        ),
      byId = new Map(chunks.map((c) => [c.id, c]));
    let vectorHits: Evidence[] = [];
    try {
      const rows = this.repo.db
        .prepare(
          "SELECT chunk_id,input_hash,vector FROM vector_embeddings WHERE fingerprint=?",
        )
        .all(fingerprint)
        .filter((r) => {
          const c = byId.get(r.chunk_id as string);
          return c && r.input_hash === hash(embeddingText(c));
        });
      if (rows.length) {
        const cfg = this.settings.resolve();
        const query = normalize(
          (
            await this.adapters.embed(
              cfg.embedding,
              [question],
              "query",
              AbortSignal.any([signal, AbortSignal.timeout(30000)]),
            )
          )[0],
          cfg.embedding.dimensions,
        );
        check();
        const scores: { c: Evidence; score: number }[] = [];
        for (let i = 0; i < rows.length; i++) {
          if (i % 256 === 0) {
            await new Promise<void>((r) => setImmediate(r));
            check();
          }
          const row = rows[i],
            bytes = Buffer.from(row.vector as Uint8Array);
          if (bytes.length !== query.length * 4) continue;
          let score = 0;
          for (let j = 0; j < query.length; j++)
            score += query[j] * bytes.readFloatLE(j * 4);
          if (Number.isFinite(score) && score >= publicConfig.minSimilarity)
            scores.push({ c: byId.get(row.chunk_id as string)!, score });
        }
        vectorHits = scores
          .sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id))
          .slice(0, 24)
          .map((r) => r.c);
        trace.mode = "hybrid";
        trace.embeddingModel = cfg.embedding.model;
      }
      if (rows.length < chunks.length)
        warnings.push(
          `向量索引尚未完整覆盖当前范围（${rows.length}/${chunks.length}），同时使用关键词召回`,
        );
      if (!rows.length && chunks.length)
        warnings.push("当前范围暂无可用向量，已使用关键词检索");
    } catch (e) {
      check();
      warnings.push(retrievalError(e) + "；已降级为关键词检索");
    }
    check();
    const fused = new Map<string, { c: Evidence; score: number }>();
    for (const list of [lexical, vectorHits])
      list.forEach((c, i) => {
        const found = fused.get(c.id) ?? { c, score: 0 };
        found.score += 1 / (60 + i + 1);
        fused.set(c.id, found);
      });
    // Bound rerank payload independently of the final answer context.
    let chars = 0;
    let candidates = [...fused.values()]
      .sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id))
      .map((r) => r.c)
      .filter((c) => {
        const n = embeddingText(c).length;
        if (chars + n > 48000) return false;
        chars += n;
        return true;
      })
      .slice(0, 24);
    if (publicConfig.rerank.enabled && candidates.length) {
      try {
        const cfg = this.settings.resolve(),
          order = await this.adapters.rerank(
            cfg.rerank,
            question,
            candidates.map(embeddingText),
            AbortSignal.any([signal, AbortSignal.timeout(30000)]),
          );
        check();
        candidates = order.map((i) => candidates[i]);
        trace.mode =
          trace.mode === "hybrid" ? "hybrid-rerank" : "keyword-rerank";
        trace.rerankModel = cfg.rerank.model;
      } catch (e) {
        check();
        warnings.push(retrievalError(e) + "；已使用召回顺序");
      }
    }
    check();
    const current = new Map(
      this.index.eligible().map((c) => [c.id, hash(embeddingText(c))]),
    );
    const valid = candidates.filter(
      (c) => current.get(c.id) === hash(embeddingText(c)),
    );
    if (valid.length !== candidates.length)
      warnings.push(
        "检索期间资料发生更新，已排除旧版本片段；可重新提问获取最新索引结果",
      );
    if (warnings.length) trace.warning = warnings.join("；").slice(0, 1500);
    return { evidence: packEvidence(valid), trace };
  }
}
