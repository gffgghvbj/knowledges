import type { DatabaseSync } from "node:sqlite";
const installed = new WeakMap<DatabaseSync, Set<string>>();
// Connection-local, transactional revisions: no persistent schema change or backup data.
export function revision(db: DatabaseSync, tables: string[]): string {
  let known = installed.get(db);
  if (!known) {
    db.exec(
      "CREATE TEMP TABLE ui_revisions (name TEXT PRIMARY KEY, value INTEGER NOT NULL)",
    );
    installed.set(db, (known = new Set()));
  }
  for (const table of tables) {
    if (!/^[a-z_]+$/.test(table)) throw Error("Invalid revision table");
    if (known.has(table)) continue;
    db.prepare("INSERT INTO ui_revisions VALUES (?,0)").run(table);
    for (const operation of ["INSERT", "UPDATE", "DELETE"])
      db.exec(`CREATE TEMP TRIGGER ui_${table}_${operation} AFTER ${operation} ON main.${table}
        BEGIN UPDATE ui_revisions SET value=value+1 WHERE name='${table}'; END`);
    known.add(table);
  }
  const read = db.prepare("SELECT value FROM ui_revisions WHERE name=?");
  return tables.map((t) => read.get(t)!.value).join(":");
}
