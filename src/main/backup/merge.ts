import { ReviewRepository } from "../interview/reviews";
import { InterviewRepository } from "../interview/repository";
import { recordSchema } from "../../shared/knowledge";
import { existsSync, readFileSync } from "node:fs";
import type { LibraryRepository } from "../library/repository";
import { atomicWrite, hash, safePath } from "../library/files";
import type { BackupPreview, MergeReport } from "../../shared/contracts";
import { validateBackup } from "./validate";
export async function inspectBackup(path: string): Promise<BackupPreview> {
  const backup = await validateBackup(path);
  try {
    return {
      formatVersion: backup.manifest.formatVersion,
      reviewCount: backup.manifest.interviewReviews.length,
      interviewCount: backup.manifest.interviewSessions.length,
      materialCount: backup.manifest.interviewMaterials.length,
      bankCount: backup.manifest.interviewQuestions.length,
      questionCount: backup.manifest.qaRecords.length,
      recordCount: backup.manifest.articles.length,
      totalBytes: backup.manifest.files.reduce((n, f) => n + f.size, 0),
    };
  } finally {
    await backup.dispose();
  }
}
export async function importBackup(
  repo: LibraryRepository,
  path: string,
): Promise<MergeReport> {
  const backup = await validateBackup(path),
    report: MergeReport = {
      added: 0,
      updated: 0,
      duplicates: 0,
      conflicts: 0,
      failed: 0,
    };
  try {
    const m = backup.manifest;
    // Validate all existing immutable files before copying any incoming data.
    for (const f of m.files) {
      const target = repo.resolvePath(f.path);
      if (existsSync(target) && hash(readFileSync(target)) !== f.hash)
        throw Error("现有文件与备份冲突，未导入");
    }
    for (const f of m.files)
      if (!existsSync(repo.resolvePath(f.path)))
        atomicWrite(
          repo.resolvePath(f.path),
          readFileSync(safePath(backup.root, f.path)),
        );
    const changedArticles = new Set<string>();
    repo.transaction(() => {
      const interviews = new InterviewRepository(repo.db);
      report.interviewsAdded = 0;
      report.interviewConflicts = 0;
      const mergeRecords = <T extends { id: string }>(
        incoming: T[],
        existing: T[],
        put: (row: T) => void,
      ) => {
        const byId = new Map(existing.map((r) => [r.id, r]));
        const mapping = new Map<string, string>();
        for (const row of incoming) {
          const old = byId.get(row.id),
            canonical = JSON.stringify(row);
          mapping.set(row.id, row.id);
          if (old && JSON.stringify(old) === canonical) continue;
          const target = old ? { ...row, id: hash(row.id + canonical) } : row;
          mapping.set(row.id, target.id);
          if (byId.has(target.id)) continue;
          put(target);
          byId.set(target.id, target);
          report.interviewsAdded!++;
          if (old) report.interviewConflicts!++;
        }
        return mapping;
      };
      const reviews = new ReviewRepository(repo.db);
      const reviewIds = mergeRecords(m.interviewReviews, reviews.list(), (r) =>
        reviews.put(r),
      );
      mergeRecords(m.interviewMaterials, interviews.listMaterials(), (r) =>
        interviews.putMaterial(r),
      );
      mergeRecords(m.interviewQuestions, interviews.listQuestions(), (r) =>
        interviews.putQuestion(r),
      );
      mergeRecords(
        m.interviewSessions
          .map((s) =>
            s.reviewId
              ? { ...s, reviewId: reviewIds.get(s.reviewId) ?? s.reviewId }
              : s,
          )
          .map((s) =>
            ["preparing", "grading"].includes(s.status)
              ? {
                  ...s,
                  status: "failed" as const,
                  error: "导入的未完成面试，进度已保存，请重试",
                }
              : s,
          ),
        interviews.listSessions(),
        (r) => interviews.putSession(r),
      );
      const categories = new Set(repo.listQaCategories());
      for (const name of m.qaCategories) {
        if (!categories.has(name)) repo.createQaCategory(name);
        categories.add(name);
      }
      for (const s of m.sources) if (!repo.getSource(s.id)) repo.putSource(s);
      const previousCurrent = new Map(
        repo
          .listArticles(true)
          .map((a) => [a.id, repo.getVersion(a.currentVersionId)!]),
      );
      for (const v of m.versions) {
        const old = repo.getVersion(v.id);
        if (!old || Date.parse(v.capturedAt) > Date.parse(old.capturedAt))
          repo.putVersion(v);
      }
      for (const incoming of m.articles) {
        const existing = repo.getArticle(incoming.id);
        if (!existing) {
          repo.putArticle(incoming);
          changedArticles.add(incoming.id);
          report.added++;
          continue;
        }
        if (existing.currentVersionId === incoming.currentVersionId) {
          report.duplicates++;
          continue;
        }
        const old = previousCurrent.get(existing.id)!,
          next = repo.getVersion(incoming.currentVersionId)!;
        const delta = Date.parse(next.capturedAt) - Date.parse(old.capturedAt);
        if (delta > 0) {
          repo.putArticle({ ...incoming, deletedAt: existing.deletedAt });
          changedArticles.add(incoming.id);
          report.updated++;
        } else if (delta === 0) {
          report.conflicts++;
        } else {
          report.duplicates++;
        }
      }
      const existingQuestions = new Map(repo.listQa().map((q) => [q.id, q]));
      report.questionsAdded = 0;
      report.questionConflicts = 0;
      for (const original of m.qaRecords) {
        const incoming =
          original.status === "pending"
            ? {
                ...original,
                status: "failed" as const,
                error: "导入的未完成请求，可以重试",
              }
            : original;
        const existing = existingQuestions.get(incoming.id);
        const canonical = (q: typeof incoming) =>
          JSON.stringify(recordSchema.parse(q));
        if (existing && canonical(existing) === canonical(incoming)) continue;
        const target = existing
          ? { ...incoming, id: hash(incoming.id + canonical(incoming)) }
          : incoming;
        if (existingQuestions.has(target.id)) continue;
        repo.putQa(target);
        existingQuestions.set(target.id, target);
        report.questionsAdded++;
        if (existing) report.questionConflicts++;
      }
      for (const id of changedArticles) {
        const article = repo.getArticle(id)!;
        repo.index(article, repo.readArticle(id).markdown);
      }
    });
    repo.recoverPendingWrites();
    return report;
  } finally {
    await backup.dispose();
  }
}
