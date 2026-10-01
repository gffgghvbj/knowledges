import type { Article } from "../../shared/contracts";
import type { LibraryRepository } from "./repository";
export function searchArticles(
  repo: LibraryRepository,
  query: string,
  filter: { sourceId?: string; sectionPath?: string[] },
  page = 0,
): { items: Article[]; total: number } {
  const q = query.trim().slice(0, 1000),
    params: string[] = [];
  let where = "1=1",
    from = "articles a";
  if (q) {
    if ([...q].length >= 3 && /^[\p{L}\p{N} ]+$/u.test(q)) {
      from += " JOIN search_fts f ON f.id=a.id";
      where = "search_fts MATCH ?";
      params.push(`"${q.replaceAll('"', '""')}"`);
    } else {
      from += " JOIN search_docs d ON d.id=a.id";
      where = "(d.title LIKE ? ESCAPE '\\' OR d.body LIKE ? ESCAPE '\\')";
      const literal = "%" + q.replace(/[\\%_]/g, "\\$&") + "%";
      params.push(literal, literal);
    }
  }
  where += " AND json_extract(a.data,'$.deletedAt') IS NULL";
  if (filter.sourceId) {
    where += " AND json_extract(a.data,'$.sourceId')=?";
    params.push(filter.sourceId);
  }
  if (filter.sectionPath?.length) {
    where += " AND json_extract(a.data,'$.sectionPath[0]')=?";
    params.push(filter.sectionPath[0]);
  }
  const total = Number(
    repo.db
      .prepare(`SELECT count(*) n FROM ${from} WHERE ${where}`)
      .get(...params)?.n || 0,
  );
  const items = repo.db
    .prepare(
      `SELECT a.data FROM ${from} WHERE ${where} ORDER BY json_extract(a.data,'$.title') LIMIT 50 OFFSET ?`,
    )
    .all(...params, Math.max(0, Math.floor(page)) * 50)
    .map((r) => JSON.parse(r.data as string));
  return { items, total };
}
