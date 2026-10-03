import { ReviewRepository } from "../interview/reviews";
import { InterviewRepository } from "../interview/repository";
import { ZipFile } from "yazl";
import { createWriteStream, readFileSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import type { LibraryRepository } from "../library/repository";
import { hash } from "../library/files";
import type { Manifest } from "./manifest";

export async function exportLibrary(
  repo: LibraryRepository,
  destination: string,
  onProgress?: (label: string, completed: number, total: number) => void,
) {
  const progress = onProgress ?? (() => {});
  const articles = repo.listArticles(true),
    versions = articles.flatMap((a) => repo.listVersions(a.id)),
    paths = [
      ...new Set(
        versions.flatMap((v) => [
          v.markdownPath,
          ...v.assets.map((a) => a.relativePath),
        ]),
      ),
    ];
  const interviews = new InterviewRepository(repo.db);
  const manifest: Manifest = {
    formatVersion: 8,
    interviewReviews: new ReviewRepository(repo.db).list(),
    interviewMaterials: interviews.listMaterials(),
    interviewQuestions: interviews.listQuestions(),
    interviewSessions: interviews.listSessions(),
    qaCategories: repo.listQaCategories(),
    qaRecords: repo.listQa(),
    createdAt: new Date().toISOString(),
    sources: repo.listSources(true),
    articles,
    versions,
    files: paths.map((path, index) => {
      const bytes = readFileSync(repo.resolvePath(path));
      if (index % 50 === 0 || index + 1 === paths.length)
        progress("扫描资料文件", index + 1, paths.length);
      return { path, hash: hash(bytes), size: bytes.length };
    }),
  };
  const zip = new ZipFile(),
    temporary = destination + "." + randomUUID() + ".tmp";
  const completion = pipeline(zip.outputStream, createWriteStream(temporary));
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), "manifest.json");
  paths.forEach((path, index) => {
    zip.addFile(repo.resolvePath(path), path);
    if (index % 50 === 0 || index + 1 === paths.length)
      progress("打包备份", index + 1, paths.length);
  });
  progress("写入压缩包", paths.length, paths.length);
  zip.end();
  try {
    await completion;
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
