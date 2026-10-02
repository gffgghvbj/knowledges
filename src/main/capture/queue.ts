import { inspectQuality } from "./quality";
import { hash, normalizeUrl } from "../library/files";
import {
  resolveExtractionRule,
  type ExtractionSelection,
} from "../../shared/extraction";
import { validateSelection } from "./adapters/rules";
import { randomUUID } from "node:crypto";
import type {
  Source,
  PageResult,
  CaptureTask,
  Candidate,
} from "../../shared/contracts";
import { LibraryRepository } from "../library/repository";
import { getAdapter } from "./adapters/types";
import { downloadAssets } from "./assets";
export interface CaptureTransport {
  load(source: Source, url: string): Promise<PageResult>;
  asset(
    source: Source,
    url: string,
  ): Promise<{ bytes: Buffer; mimeType: string }>;
}
export class CaptureQueue {
  private active = new Map<string, Promise<void>>();
  private stopped = false;
  constructor(
    private repo: LibraryRepository,
    private transport: CaptureTransport,
    private interval = 1000,
  ) {
    for (const task of repo.interruptedTasks())
      if (["running", "queued"].includes(task.state)) {
        task.state = "paused";
        for (const i of task.items)
          if (i.state === "running") i.state = "queued";
        repo.putTask(task);
      }
  }
  isActive(sourceId: string) {
    return [...this.active.keys()].some(
      (id) => this.repo.getTask(id)?.sourceId === sourceId,
    );
  }
  private source(id: string) {
    const s = this.repo.getSource(id);
    if (!s || s.deletedAt) throw Error("网站不存在或已移除");
    return s;
  }
  private task(id: string) {
    const t = this.repo.getTask(id);
    if (!t) throw Error("任务不存在");
    return t;
  }
  private assertAvailable(sourceId: string) {
    if (
      this.repo
        .listTasks()
        .some(
          (t) =>
            t.sourceId === sourceId && ["queued", "running"].includes(t.state),
        )
    )
      throw Error("该网站已有任务，请先暂停或等待完成");
  }
  private create(
    sourceId: string,
    candidates: Candidate[],
    mode: CaptureTask["mode"],
    skipDiscovery = false,
    extraction?: ExtractionSelection,
  ) {
    this.assertAvailable(sourceId);
    const source = this.source(sourceId);
    if (!candidates.length) throw Error("请选择至少一篇文章");
    for (const c of candidates) {
      if (
        c.sourceId !== sourceId ||
        !source.allowedOrigins.includes(
          new URL(normalizeUrl(c.canonicalUrl)).origin,
        )
      )
        throw Error("文章地址不在当前网站范围内");
    }
    const task: CaptureTask = {
      id: randomUUID(),
      sourceId,
      extraction: validateSelection(
        extraction ?? { preset: "custom", rule: resolveExtractionRule(source) },
      ),
      state: "queued",
      items: [
        ...new Map(candidates.map((c) => [c.canonicalUrl, c])).values(),
      ].map((candidate) => ({ candidate, state: "queued" })),
      createdAt: new Date().toISOString(),
      scanComplete: mode === "capture" || skipDiscovery,
      discovered: candidates.length,
      mode,
    };
    this.repo.putTask(task);
    this.kick(task.id);
    return task.id;
  }
  startCapture(sourceId: string, candidates: Candidate[]) {
    return this.create(sourceId, candidates, "capture");
  }
  scan(sourceId: string, mode: "scan" | "update" = "scan") {
    const s = this.source(sourceId);
    if (mode === "update" && s.selectedUrls?.length) {
      const candidates = s.selectedUrls
        .map((url) => this.candidateFor(sourceId, url))
        .filter((c) => !this.repo.getArticle(hash(c.canonicalUrl))?.deletedAt);
      if (!candidates.length)
        throw Error("已选文章均在回收站，请恢复文章或重新选择采集范围");
      return this.create(sourceId, candidates, "update", true);
    }
    const saved =
      mode === "update"
        ? this.repo
            .listArticles()
            .filter(
              (a) =>
                a.sourceId === sourceId &&
                (!s.selectedSections ||
                  s.selectedSections.includes(a.sectionPath[0] || "其他")),
            )
        : [];
    return this.create(
      sourceId,
      [
        ...[...new Set([s.entryUrl, new URL(s.entryUrl).origin + "/"])].map(
          (url) => ({
            sourceId,
            canonicalUrl: url,
            title: s.label,
            sectionPath: [],
          }),
        ),
        ...saved,
      ],
      mode,
    );
  }
  captureSelection(taskId: string, sections: string[]) {
    const task = this.task(taskId);
    if (!task.scanComplete || task.mode !== "scan")
      throw Error("请等待扫描结束");
    if (!sections.length) throw Error("请选择至少一个栏目");
    const source = this.source(task.sourceId);
    this.assertAvailable(source.id);
    const candidates = task.items
      .filter((i) => sections.includes(i.candidate.sectionPath[0] || "其他"))
      .map((i) => i.candidate);
    if (!candidates.length) throw Error("所选栏目没有文章");
    source.selectedUrls = undefined;
    source.selectedSections = sections;
    this.repo.putSource(source);
    return this.startCapture(
      source.id,
      task.items
        .filter((i) => sections.includes(i.candidate.sectionPath[0] || "其他"))
        .map((i) => i.candidate),
    );
  }
  private candidateFor(sourceId: string, input: string): Candidate {
    const source = this.source(sourceId),
      url = normalizeUrl(input);
    if (!source.allowedOrigins.includes(new URL(url).origin))
      throw Error("文章地址不在当前网站范围内");
    const existing = this.repo.getArticle(hash(url));
    return {
      sourceId,
      canonicalUrl: url,
      title: existing?.title ?? url,
      sectionPath:
        existing?.sectionPath ??
        new URL(url).pathname.split("/").filter(Boolean).slice(0, -1),
    };
  }
  captureUrl(sourceId: string, url: string, selection?: ExtractionSelection) {
    const candidate = this.candidateFor(sourceId, url);
    if (this.repo.getArticle(hash(candidate.canonicalUrl))?.deletedAt)
      throw Error("文章在回收站，请先恢复后再重采");
    return this.create(sourceId, [candidate], "capture", true, selection);
  }
  captureArticles(taskId: string, urls: string[]) {
    const task = this.task(taskId);
    if (!task.scanComplete || task.mode !== "scan")
      throw Error("请等待扫描结束");
    const selected = new Set(urls.map(normalizeUrl));
    if (!selected.size) throw Error("请选择至少一篇文章");
    const candidates = task.items
      .filter((i) => selected.has(i.candidate.canonicalUrl))
      .map((i) => i.candidate);
    if (candidates.length !== selected.size)
      throw Error("所选文章不在扫描结果中");
    const source = this.source(task.sourceId);
    this.assertAvailable(source.id);
    source.selectedUrls = [...selected];
    source.selectedSections = undefined;
    this.repo.putSource(source);
    return this.startCapture(source.id, candidates);
  }
  pauseTask(id: string) {
    const t = this.task(id);
    if (["running", "queued"].includes(t.state)) {
      t.state = "paused";
      this.repo.putTask(t);
    }
  }
  resumeTask(id: string) {
    const t = this.task(id);
    if (["running", "queued"].includes(t.state)) return;
    this.assertAvailable(t.sourceId);
    t.state = "queued";
    t.error = undefined;
    for (const i of t.items) if (i.state === "running") i.state = "queued";
    this.repo.putTask(t);
    this.kick(id);
  }
  retryFailed(id: string) {
    const t = this.task(id);
    if (t.mode === "scan") t.scanComplete = false;
    for (const i of t.items)
      if (["partial", "failed"].includes(i.state)) {
        i.state = "queued";
        i.error = undefined;
      }
    this.repo.putTask(t);
    this.resumeTask(id);
  }
  async waitForIdle() {
    while (this.active.size) await Promise.all([...this.active.values()]);
  }
  stop() {
    this.stopped = true;
    for (const t of this.repo.listTasks()) this.pauseTask(t.id);
  }
  private kick(id: string) {
    if (this.active.has(id) || this.stopped) return;
    const promise = this.run(id)
      .catch((error) => {
        const t = this.repo.getTask(id);
        if (!t) return;
        t.state = "failed";
        t.error = String(error);
        this.repo.putTask(t);
      })
      .finally(() => {
        this.active.delete(id);
        if (this.repo.getTask(id)?.state === "queued") this.kick(id);
      });
    this.active.set(id, promise);
  }
  private async load(
    source: Source,
    url: string,
    taskId: string,
  ): Promise<PageResult> {
    let result: PageResult = { kind: "failed", reason: "加载失败" };
    for (let attempt = 0; attempt < 4; attempt++) {
      if (this.stopped || !this.repo.getTask(taskId)) return result;
      try {
        result = await this.transport.load(source, url);
      } catch (error) {
        result = { kind: "failed", reason: String(error) };
      }
      if (result.kind === "article" || result.kind === "login-required")
        return result;
      if (
        result.statusCode &&
        result.statusCode < 500 &&
        result.statusCode !== 429
      )
        return result;
      let remaining = Math.max(
        this.interval * 2 ** attempt,
        result.retryAfterMs || 0,
      );
      if (attempt < 3)
        while (remaining > 0) {
          if (this.stopped || this.repo.getTask(taskId)?.state !== "running")
            return result;
          const chunk = Math.min(1000, remaining);
          await new Promise((r) => setTimeout(r, chunk));
          remaining -= chunk;
        }
    }
    return result;
  }
  private async run(id: string) {
    let task = this.task(id);
    const original = this.source(task.sourceId);
    const source = {
        ...original,
        extraction: task.extraction ?? original.extraction,
      },
      adapter = getAdapter(source);
    task.state = "running";
    this.repo.putTask(task);
    while (!this.stopped) {
      const activeTask = this.repo.getTask(id);
      if (!activeTask || activeTask.state !== "running") return;
      task = activeTask;
      const index = task.items.findIndex((i) => i.state === "queued");
      if (index < 0) {
        if (!task.scanComplete) {
          task.scanComplete = true;
          if (task.mode === "update") {
            task.items = task.items.filter(
              (i) =>
                !source.selectedSections ||
                source.selectedSections.includes(
                  i.candidate.sectionPath[0] || "其他",
                ),
            );
            for (const item of task.items) {
              item.state = "queued";
              item.error = undefined;
            }
            this.repo.putTask(task);
            continue;
          }
        }
        const failures = task.items.filter((i) => i.state === "failed").length;
        task.state =
          task.items.some((i) => i.state === "partial") ||
          (failures && failures < task.items.length)
            ? "partial"
            : failures
              ? "failed"
              : "complete";
        this.repo.putTask(task);
        return;
      }
      const item = task.items[index];
      if (
        task.scanComplete &&
        this.repo.getArticle(hash(item.candidate.canonicalUrl))?.deletedAt
      ) {
        item.state = "skipped";
        item.note = "文章在回收站，已跳过。";
        this.repo.putTask(task);
        continue;
      }
      item.error = undefined;
      item.note = undefined;
      item.quality = undefined;
      item.state = "running";
      this.repo.putTask(task);
      const result = await this.load(source, item.candidate.canonicalUrl, id);
      const loadedTask = this.repo.getTask(id);
      if (!loadedTask) return;
      task = loadedTask;
      if (this.stopped || task.state !== "running") {
        task.items[index].state = "queued";
        this.repo.putTask(task);
        return;
      }
      if (result.kind === "login-required") {
        task.items[index].state = "queued";
        task.items[index].quality = {
          checkedAt: new Date().toISOString(),
          textLength: 0,
          codeBlocks: 0,
          issues: [
            {
              code: "login-prompt",
              message: "网站要求登录，请先登录后继续任务。",
            },
          ],
        };
        task.state = "login-required";
        this.repo.putTask(task);
        return;
      }
      if (result.kind !== "article") {
        task.items[index].state = "failed";
        task.items[index].error = result.reason;
        this.repo.markStatus(
          item.candidate,
          [404, 410].includes(result.statusCode || 0)
            ? "removed"
            : "unavailable",
        );
      } else if (!task.scanComplete) {
        const seen = new Set(task.items.map((i) => i.candidate.canonicalUrl));
        for (const c of adapter.discover(result.snapshot))
          if (!seen.has(c.canonicalUrl)) {
            seen.add(c.canonicalUrl);
            task.items.push({ candidate: c, state: "queued" });
          }
        try {
          const extracted = adapter.extract(result.snapshot, item.candidate);
          task.items[index].candidate = extracted.candidate;
          task.items[index].quality = inspectQuality(extracted);
        } catch {
          /* Navigation-only pages still discover links. */
        }
        task.items[index].state = "complete";
        task.discovered = task.items.length;
      } else {
        try {
          const article = adapter.extract(result.snapshot, item.candidate);
          const { assets, missing } = await downloadAssets(
            this.repo,
            source,
            article,
            async (source, url) => {
              if (!this.repo.getTask(id)) throw Error("任务已删除");
              const result = await this.transport.asset(source, url);
              if (!this.repo.getTask(id)) throw Error("任务已删除");
              return result;
            },
          );
          if (!this.repo.getTask(id)) return;
          if (
            this.repo.getArticle(hash(article.candidate.canonicalUrl))
              ?.deletedAt
          ) {
            task.items[index].state = "skipped";
            task.items[index].note = "文章在回收站，已跳过。";
          } else {
            const quality = inspectQuality(article, missing.length);
            this.repo.saveArticle(
              article,
              assets,
              missing.length ? "assets-pending" : "complete",
              quality,
            );
            task.items[index].quality = quality;
            task.items[index].state = missing.length ? "partial" : "complete";
          }
          task.items[index].candidate = article.candidate;
          task.items[index].error =
            task.items[index].state !== "skipped" && missing.length
              ? `${missing.length} 张图片未下载，可重试。${missing.slice(0, 3).join("；")}`
              : undefined;
        } catch (error) {
          task.items[index].state = "failed";
          task.items[index].error = String(error);
        }
      }
      // A pause may arrive while images are being downloaded; preserve it.
      const current = this.repo.getTask(id);
      if (!current) return;
      if (current.state !== "running") task.state = current.state;
      this.repo.putTask(task);
      if (this.interval) await new Promise((r) => setTimeout(r, this.interval));
    }
  }
}
