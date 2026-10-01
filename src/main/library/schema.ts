import type { DatabaseSync } from "node:sqlite";
export function migrate(db: DatabaseSync) {
  const version = db.prepare("PRAGMA user_version").get()
    ?.user_version as number;
  if (version > 9) throw Error("资料库来自更新版本，请升级应用后打开");
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, article_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS versions_article ON versions(article_id);
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS search_docs (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL);
    CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(id UNINDEXED, title, body, tokenize='trigram');
    CREATE TABLE IF NOT EXISTS knowledge_chunks (id TEXT PRIMARY KEY, article_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS knowledge_article ON knowledge_chunks(article_id);
    CREATE TABLE IF NOT EXISTS qa_records (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS qa_categories (name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS vector_embeddings (fingerprint TEXT NOT NULL, chunk_id TEXT NOT NULL, input_hash TEXT NOT NULL, vector BLOB NOT NULL, PRIMARY KEY (fingerprint, chunk_id));
    CREATE TABLE IF NOT EXISTS vector_control (id INTEGER PRIMARY KEY CHECK(id=1), paused INTEGER NOT NULL, error TEXT NOT NULL);
    INSERT OR IGNORE INTO vector_control VALUES (1,1,'');
    CREATE TABLE IF NOT EXISTS interview_materials (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS interview_questions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS interview_sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS article_maintenance (
      article_id TEXT PRIMARY KEY,
      indexed_version TEXT, indexed_title TEXT, index_revision INTEGER, chunk_count INTEGER,
      materialized_version TEXT, materialized_mtime REAL, materialized_size INTEGER
    );
    CREATE TABLE IF NOT EXISTS interview_reviews (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    PRAGMA user_version=9;`);
}
