import type Database from "better-sqlite3";

/**
 * Migration primitives shared by lib/db.ts and lib/db/*-schema.ts.
 *
 * The migration list is replayed on every boot, so "duplicate column name" (an ALTER that
 * already ran) and "already exists" (a CREATE without IF NOT EXISTS) are expected and are
 * the ONLY errors swallowed. Anything else - a typo, a bad CHECK, a missing table, a locked
 * database - used to vanish into an empty catch and leave the schema silently half-applied.
 * It is now logged with the offending statement and rethrown so boot fails loudly.
 */

type DB = Database.Database;

export function isBenignMigrationError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /duplicate column name|already exists/i.test(msg);
}

/** Run one idempotent migration statement; only re-run noise is ignored. */
export function execMigration(db: DB, sql: string): void {
  try {
    db.exec(sql);
  } catch (err) {
    if (isBenignMigrationError(err)) return;
    const msg = err instanceof Error ? err.message : String(err);
    // A plain (non-unique) index is an optimisation, never correctness: a legacy table that
    // lacks the column must not stop the app booting. Logged so it is visible, not silent.
    if (/^\s*CREATE\s+INDEX\b/i.test(sql)) {
      console.warn(`[db] index skipped: ${msg}\n  statement: ${sql.trim().slice(0, 300)}`);
      return;
    }
    console.error(`[db] migration failed: ${msg}\n  statement: ${sql.trim().slice(0, 300)}`);
    throw err;
  }
}

export function tableColumns(db: DB, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{ name: string }>).map((c) => c.name);
}

export function tableSql(db: DB, table: string): string | null {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql: string } | undefined;
  return row?.sql ?? null;
}

function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return name;
}

/**
 * Rebuild `table` through a temporary table (SQLite cannot drop columns or change
 * constraints in place). `createTempSql` must create `tempTable`. Rows are copied over the
 * INTERSECTION of the old and new column lists, so a column added by a later ALTER is kept
 * whenever the new definition has it, instead of being dropped by a hard-coded copy list.
 *
 * - A `tempTable` left behind by an earlier crashed attempt is dropped first.
 * - Create/copy/drop/rename run in ONE transaction: a failure rolls back to the old table.
 * - foreign_keys is a no-op inside a transaction, so it is switched off around it and
 *   always restored afterwards, even when the rebuild throws.
 */
export function rebuildTable(
  db: DB,
  opts: { table: string; tempTable: string; createTempSql: string; copyTransform?: Record<string, string>; after?: () => void },
): void {
  const table = quoteIdent(opts.table);
  const temp = quoteIdent(opts.tempTable);
  const fkWasOn = (db.pragma("foreign_keys", { simple: true }) as number) === 1;
  db.pragma("foreign_keys = OFF");
  try {
    db.exec(`DROP TABLE IF EXISTS ${temp}`);
    db.transaction(() => {
      db.exec(opts.createTempSql);
      const oldCols = new Set(tableColumns(db, table));
      const shared = tableColumns(db, temp).filter((c) => oldCols.has(c));
      if (shared.length === 0) throw new Error(`Rebuild of ${table} shares no columns with ${temp}`);
      const select = shared.map((c) => opts.copyTransform?.[c] ?? c).join(", ");
      db.exec(`INSERT INTO ${temp} (${shared.join(", ")}) SELECT ${select} FROM ${table}`);
      db.exec(`DROP TABLE ${table}`);
      db.exec(`ALTER TABLE ${temp} RENAME TO ${table}`);
      opts.after?.();
    })();
  } catch (err) {
    console.error(`[db] rebuild of ${table} failed and was rolled back:`, err instanceof Error ? err.message : err);
    throw err;
  } finally {
    if (fkWasOn) db.pragma("foreign_keys = ON");
  }
}
