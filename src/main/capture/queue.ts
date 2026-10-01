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
  private source(id: string) {
    const s = this.repo.getSource(id);
    if (!s) throw Error("网站不存在");
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
  ) {
    this.assertAvailable(sourceId);
    this.source(sourceId);
    const task: CaptureTask = {
      id: randomUUID(),
      sourceId,
      state: "queued",
      items: [
        ...new Map(candidates.map((c) => [c.canonicalUrl, c])).values(),
      ].map((candidate) => ({ candidate, state: "queued" })),
      createdAt: new Date().toISOString(),
      scanComplete: mode === "capture",
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
    source.selectedSections = sections;
    this.repo.putSource(source);
    return this.startCapture(
      source.id,
      task.items
        .filter((i) => sections.includes(i.candidate.sectionPath[0] || "其他"))
        .map((i) => i.candidate),
    );
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
        const t = this.task(id);
        t.state = "failed";
        t.error = String(error);
        this.repo.putTask(t);
      })
      .finally(() => {
        this.active.delete(id);
        if (this.task(id).state === "queued") this.kick(id);
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
      if (this.stopped) return result;
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
          if (this.stopped || this.task(taskId).state !== "running")
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
    const source = this.source(task.sourceId),
      adapter = getAdapter(source);
    task.state = "running";
    this.repo.putTask(task);
    while (!this.stopped) {
      task = this.task(id);
      if (task.state !== "running") return;
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
      item.state = "running";
      this.repo.putTask(task);
      const result = await this.load(source, item.candidate.canonicalUrl, id);
      task = this.task(id);
      if (this.stopped || task.state !== "running") {
        task.items[index].state = "queued";
        this.repo.putTask(task);
        return;
      }
      if (result.kind === "login-required") {
        task.items[index].state = "queued";
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
          task.items[index].candidate = adapter.extract(
            result.snapshot,
            item.candidate,
          ).candidate;
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
            this.transport.asset,
          );
          this.repo.saveArticle(
            article,
            assets,
            missing.length ? "assets-pending" : "complete",
          );
          task.items[index].state = missing.length ? "partial" : "complete";
          task.items[index].error = missing.length
            ? `${missing.length} 张图片未下载，可重试。${missing.slice(0, 3).join("；")}`
            : undefined;
        } catch (error) {
          task.items[index].state = "failed";
          task.items[index].error = String(error);
        }
      }
      // A pause may arrive while images are being downloaded; preserve it.
      const current = this.task(id);
      if (current.state !== "running") task.state = current.state;
      this.repo.putTask(task);
      if (this.interval) await new Promise((r) => setTimeout(r, this.interval));
    }
  }
}
