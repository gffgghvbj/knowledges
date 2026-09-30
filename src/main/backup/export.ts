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
) {
  const articles = repo.listArticles(),
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
    formatVersion: 4,
    interviewMaterials: interviews.listMaterials(),
    interviewQuestions: interviews.listQuestions(),
    interviewSessions: interviews.listSessions(),
    qaCategories: repo.listQaCategories(),
    qaRecords: repo.listQa(),
    createdAt: new Date().toISOString(),
    sources: repo.listSources(),
    articles,
    versions,
    files: paths.map((path) => {
      const bytes = readFileSync(repo.resolvePath(path));
      return { path, hash: hash(bytes), size: bytes.length };
    }),
  };
  const zip = new ZipFile(),
    temporary = destination + "." + randomUUID() + ".tmp";
  const completion = pipeline(zip.outputStream, createWriteStream(temporary));
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), "manifest.json");
  for (const path of paths) zip.addFile(repo.resolvePath(path), path);
  zip.end();
  try {
    await completion;
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
