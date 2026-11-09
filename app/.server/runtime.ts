import { type Auth, createAuth } from "./auth/auth";
import { createDb, type DbHandle } from "./db";
import { migrateToLatest } from "./db/migrate";
import { env } from "./env";
import { type Jobs, startJobs } from "./jobs";
import { logger } from "./logger";

export type Runtime = DbHandle & { auth: Auth; jobs: Jobs | null };

// Stored on globalThis so Vite's dev-mode module reloading doesn't open a second
// database connection or start the scheduler twice.
const KEY = Symbol.for("domain-brain.runtime");
const store = globalThis as typeof globalThis & { [KEY]?: Promise<Runtime> };

/** Process startup: open DB → run migrations → auth → jobs. Idempotent. */
export function boot(): Promise<Runtime> {
  store[KEY] ??= (async () => {
    const config = env();
    const log = logger();
    const handle = createDb(config.DATABASE_URL);
    log.info({ dialect: handle.dialect }, "database opened");

    const results = await migrateToLatest(handle.db, handle.dialect);
    for (const r of results ?? []) log.info({ migration: r.migrationName }, "migration applied");

    const auth = createAuth(handle, config);
    const jobs = config.JOBS_ENABLED ? startJobs(handle.db) : null;
    if (!jobs) log.info("background jobs disabled (JOBS_ENABLED=false)");

    return { ...handle, auth, jobs };
  })();
  return store[KEY];
}

export async function shutdown(): Promise<void> {
  const pending = store[KEY];
  if (!pending) return;
  store[KEY] = undefined;
  const rt = await pending;
  rt.jobs?.stop();
  await rt.db.destroy();
}
