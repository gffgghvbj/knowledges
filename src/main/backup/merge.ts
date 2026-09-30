import { existsSync, readFileSync } from "node:fs";
import type { LibraryRepository } from "../library/repository";
import { atomicWrite, hash, safePath } from "../library/files";
import type { BackupPreview, MergeReport } from "../../shared/contracts";
import { validateBackup } from "./validate";
export async function inspectBackup(path: string): Promise<BackupPreview> {
  const backup = await validateBackup(path);
  try {
    return {
      formatVersion: 1,
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
    repo.transaction(() => {
      for (const s of m.sources) if (!repo.getSource(s.id)) repo.putSource(s);
      const previousCurrent = new Map(
        repo
          .listArticles()
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
          repo.putArticle(incoming);
          report.updated++;
        } else if (delta === 0) {
          report.conflicts++;
        } else {
          report.duplicates++;
        }
      }
      for (const a of repo.listArticles())
        repo.index(a, repo.readArticle(a.id).markdown);
    });
    repo.recoverPendingWrites();
    return report;
  } finally {
    await backup.dispose();
  }
}
