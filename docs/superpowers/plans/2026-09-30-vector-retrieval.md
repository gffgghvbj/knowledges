# Vector Retrieval Implementation Plan

> Use superpowers:executing-plans for inline implementation and one final independent review.

**Goal:** Add the user-selected Qwen embedding and rerank models to local knowledge Q&A.
**Architecture:** Independent encrypted retrieval settings, validated HTTP adapters, SQLite normalized vectors, resumable incremental index, cosine + keyword RRF retrieval with explicit fallback, existing version-pinned citations.
**Spec:** docs/superpowers/specs/2026-09-30-vector-retrieval-design.md
**Tech stack:** Existing Electron, TypeScript, React, node:sqlite; no new native dependency.

## Global constraints
- Preserve v1/v2 library and backup data; configurations/secrets/vectors excluded from backup.
- Embedding default qwen3.7-text-embedding-flash, 1024 dimensions; rerank qwen3.7-text-rerank.
- Keep question persistence before asynchronous work and abort propagation.
- Native execution in current feature workspace, user already selected execution method.

## Review focus
- Credential forwarding, response parsing and rejection of redirects/oversized responses.
- Model or document changes during pending indexing/query/rerank requests.
- Missing/partial indexes, pause/restart/failed tasks, no silent network loops.
- Backup import compatibility and citation version isolation.
- Unexpected dimensions, response ordering, invalid scores and zero vectors.

### Task 1: Settings and model adapters
Files: shared/retrieval.ts; main/knowledge/retrieval-settings.ts, retrieval-api.ts; tests/knowledge/retrieval-api.test.ts.
Interfaces: RetrievalSettings.get/save/resolve; embed(config,texts,kind,signal):Promise<number[][]>; rerank(config,query,documents,signal):Promise<number[]>.
- [ ] Write protocol/key/invalid-vector/invalid-ranking tests; run RED.
- [ ] Implement bounded requests, settings and normalization; run GREEN.

### Task 2: Vector index and hybrid retrieval
Files: main/library/schema.ts; main/knowledge/vector-index.ts, hybrid.ts; main/knowledge/index.ts; tests/knowledge/vector.test.ts.
Interfaces: VectorIndex.status/start/pause/rebuild/tick/waitForIdle; HybridRetriever.retrieve(question,scope,signal).
- [ ] Write semantic-only recall, filtering, model switch, stale-request, resumability and failure tests; run RED.
- [ ] Implement fingerprinted cache and resumable task, cosine scoring, RRF and rerank; run GREEN.

### Task 3: Application integration
Files: shared/contracts.ts, shared/knowledge.ts; main/ipc.ts, knowledge/service.ts; preload/index.ts; renderer/RetrievalPanel.tsx, ModelPage.tsx, KnowledgePage.tsx; tests/e2e/vector.spec.ts.
- [ ] Write desktop configuration/index/query flow and saved retrieval metadata assertions; run RED.
- [ ] Wire configuration, lifecycle, status and question trace; run GREEN.
- [ ] Confirm existing backups remain compatible and trace round-trip retains no secrets/vectors.

### Task 4: Delivery
- [ ] Typecheck, full unit suite, desktop E2E; inspect screenshot.
- [ ] One independent read-only review, fix important issues with regressions.
- [ ] Version 0.3.0, macOS/Windows builds, packaged E2E, release verification notes and local commit.
