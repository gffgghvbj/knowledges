import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { LibraryRepository } from '../../src/main/library/repository';

let root: string, repo: LibraryRepository;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'library-')); repo = new LibraryRepository(root); });
afterEach(() => { repo?.close(); rmSync(root, { recursive: true, force: true }); });
function input(markdown = '# Redis\n内存回收', time = '2026-09-30T00:00:00.000Z') {
  const source = repo.addSource('https://example.com/start');
  return { candidate: { sourceId: source.id, canonicalUrl: 'https://example.com/redis.html', title: 'CON 中文', sectionPath: ['Redis'] }, markdown, text: markdown, fetchedAt: time, assets: [] };
}
test('same article content deduplicates while changed content keeps history', () => {
  const first = repo.saveArticle(input(), []);
  repo.saveArticle(input(), []);
  expect(repo.listVersions(first.articleId)).toHaveLength(1);
  const next = repo.saveArticle(input('# 新内容', '2026-10-01T00:00:00.000Z'), []);
  expect(repo.listVersions(first.articleId)).toHaveLength(2);
  expect(repo.getArticle(first.articleId)?.currentVersionId).toBe(next.id);
  repo.restoreVersion(first.articleId, first.id);
  expect(repo.readArticle(first.articleId).markdown).toContain('内存回收');
  expect(repo.listVersions(first.articleId)).toHaveLength(2);
});
test('content-addressed paths and image references work in current and historical files', () => {
  const asset = repo.writeAsset(Buffer.from('image'), 'image/png');
  const version = repo.saveArticle(input(`![图](asset:${asset.hash})`), [asset]);
  for (const file of [version.markdownPath, `articles/${version.articleId}/current.md`]) {
    const markdown = readFileSync(join(root, file), 'utf8');
    const ref = markdown.match(/!\[图\]\((.*?)\)/)![1];
    expect(readFileSync(resolve(dirname(join(root, file)), ref), 'utf8')).toBe('image');
    expect(file).not.toContain('CON');
  }
});
test('reopening repairs interrupted materialization without losing old versions', () => {
  const v = repo.saveArticle(input(), []);
  const path = join(root, `articles/${v.articleId}/current.md`);
  writeFileSync(path, 'interrupted');
  repo.close(); repo = new LibraryRepository(root);
  expect(readFileSync(path, 'utf8')).toContain('内存回收');
});
test('unsafe source schemes and out-of-library paths are rejected', () => {
  expect(() => repo.addSource('file:///etc/passwd')).toThrow();
  expect(() => repo.resolvePath('../outside')).toThrow();
});
