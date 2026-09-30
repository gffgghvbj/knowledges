import type { DatabaseSync } from 'node:sqlite';
export function migrate(db: DatabaseSync) {
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, article_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS versions_article ON versions(article_id);
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS search_docs (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL);
    CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(id UNINDEXED, title, body, tokenize='trigram');
    PRAGMA user_version=1;`);
}
