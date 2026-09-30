import type { LibraryRepository } from "../library/repository";
import type { Article } from "../../shared/contracts";
import type { Evidence, QaScope } from "../../shared/knowledge";
import { MAX_CONTEXT_CHARS } from "../../shared/knowledge";
import type { DatabaseSync } from "node:sqlite";
import { hash } from "../library/files";
export function indexKnowledge(
  db: DatabaseSync,
  article: Article,
  markdown: string,
) {
  db.prepare("DELETE FROM knowledge_chunks WHERE article_id=?").run(article.id);
  const lines = markdown.split("\n");
  let start = 0;
  const flush = (end: number) => {
    const quote = lines.slice(start, end).join("\n");
    if (quote.trim()) {
      const chunk: Evidence = {
        id: hash(article.currentVersionId + ":" + start + ":" + end),
        articleId: article.id,
        versionId: article.currentVersionId,
        title: article.title.slice(0, 2000),
        lineStart: start + 1,
        lineEnd: end,
        quote,
      };
      db.prepare("INSERT INTO knowledge_chunks VALUES(?,?,?)").run(
        chunk.id,
        article.id,
        JSON.stringify(chunk),
      );
    }
    start = end;
  };
  let size = 0;
  for (let i = 0; i < lines.length; i++) {
    size += lines[i].length + 1;
    if ((!lines[i].trim() && size > 250) || size > 2200) {
      flush(i + 1);
      size = 0;
    }
  }
  flush(lines.length);
}
const stop = new Set(
  "的 了 是 在 和 与 如何 什么 为什么 怎么 哪些 一个 可以 有 请 说明 介绍 区别 呢 吗 ？ ?".split(
    " ",
  ),
);
export function terms(text: string): string[] {
  return [
    ...new Set(
      [
        ...new Intl.Segmenter("zh", { granularity: "word" }).segment(
          text.toLowerCase(),
        ),
      ]
        .filter((s) => s.isWordLike && !stop.has(s.segment))
        .map((s) => s.segment),
    ),
  ].slice(0, 40);
}
export function retrieve(
  repo: LibraryRepository,
  question: string,
  scope: QaScope,
): Evidence[] {
  const query = terms(question);
  if (!query.length) return [];
  const articles = new Map(
    repo
      .listArticles()
      .filter(
        (a) =>
          (!scope.sourceId || a.sourceId === scope.sourceId) &&
          (!scope.section || a.sectionPath.includes(scope.section)),
      )
      .map((a) => [a.id, a]),
  );
  const ranked = repo.db
    .prepare("SELECT data FROM knowledge_chunks")
    .all()
    .map((row) => JSON.parse(row.data as string) as Evidence)
    .filter((c) => {
      const a = articles.get(c.articleId);
      return (
        a &&
        a.currentVersionId === c.versionId &&
        (!scope.topic ||
          (c.title + "\n" + c.quote)
            .toLowerCase()
            .includes(scope.topic.toLowerCase()))
      );
    })
    .map((c) => {
      const body = c.quote.toLowerCase(),
        title = c.title.toLowerCase();
      const score = query.reduce(
        (sum, t) =>
          sum +
          (body.includes(t) ? (t.length > 1 ? 3 : 1) : 0) +
          (title.includes(t) ? 1 : 0),
        0,
      );
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id));
  let size = 0;
  return ranked
    .filter((x) => {
      if (size + x.c.quote.length > MAX_CONTEXT_CHARS) return false;
      size += x.c.quote.length;
      return true;
    })
    .slice(0, 8)
    .map((x) => x.c);
}
