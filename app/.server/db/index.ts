import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import SqliteDatabase from "better-sqlite3";
import { Kysely, PostgresDialect, SqliteDialect } from "kysely";
import pg from "pg";
import type { Database } from "./schema";

export type Dialect = "sqlite" | "postgres";

export type Db = Kysely<Database>;

export type DbHandle = { db: Db; dialect: Dialect };

export function dialectFromUrl(url: string): Dialect {
  if (url.startsWith("file:")) return "sqlite";
  if (/^postgres(ql)?:\/\//.test(url)) return "postgres";
  throw new Error(`Unsupported DATABASE_URL: ${url}`);
}

/** `file:./data/x.db` → `./data/x.db`; `file::memory:` → `:memory:`. */
export function sqlitePath(url: string): string {
  return url.slice("file:".length);
}

export function createDb(url: string): DbHandle {
  const dialect = dialectFromUrl(url);

  if (dialect === "sqlite") {
    const path = sqlitePath(url);
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const database = new SqliteDatabase(path);
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    database.pragma("busy_timeout = 5000");
    return { dialect, db: new Kysely<Database>({ dialect: new SqliteDialect({ database }) }) };
  }

  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return { dialect, db: new Kysely<Database>({ dialect: new PostgresDialect({ pool }) }) };
}
