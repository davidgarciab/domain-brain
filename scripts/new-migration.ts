// Usage: pnpm db:migration <name>  →  app/.server/db/migrations/NNNN_<name>.ts
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "../app/.server/db/migrations");
const name = process.argv[2]
  ?.toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_|_$/g, "");
if (!name) {
  console.error("Usage: pnpm db:migration <name>");
  process.exit(1);
}

const last = readdirSync(dir)
  .map((f) => Number.parseInt(f.slice(0, 4), 10))
  .filter((n) => !Number.isNaN(n))
  .reduce((a, b) => Math.max(a, b), 0);
const file = join(dir, `${String(last + 1).padStart(4, "0")}_${name}.ts`);

writeFileSync(
  file,
  `import type { Kysely } from "kysely";
import type { Dialect } from "../index";

// Must work on SQLite and Postgres. See CLAUDE.md → "Database portability".
// Released migrations are append-only: never edit this file after a release.

export async function up(db: Kysely<any>, _dialect: Dialect): Promise<void> {}
`,
);
console.log(`Created ${file}`);
