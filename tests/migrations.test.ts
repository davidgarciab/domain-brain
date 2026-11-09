import { getMigrations } from "better-auth/db/migration";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authOptions, createAuth } from "~/.server/auth/auth";
import { createDb, type DbHandle } from "~/.server/db";
import { migrateToLatest } from "~/.server/db/migrate";
import { parseEnv } from "~/.server/env";
import { createTestDb, testDialects } from "./helpers/db";

const env = parseEnv(process.env);

describe.each(testDialects())("migrations on %s", (dialect) => {
  let handle: DbHandle & { cleanup: () => Promise<void> };

  beforeEach(async () => {
    handle = await createTestDb(dialect);
  });
  afterEach(async () => {
    await handle.cleanup();
  });

  it("applies cleanly and is idempotent", async () => {
    const first = await migrateToLatest(handle.db, dialect);
    expect(first?.every((r) => r.status === "Success")).toBe(true);
    expect(first?.length).toBeGreaterThan(0);

    const second = await migrateToLatest(handle.db, dialect);
    expect(second).toEqual([]);
  });

  it("creates exactly the schema Better Auth expects", async () => {
    await migrateToLatest(handle.db, dialect);
    const plan = await getMigrations(authOptions(handle, env));
    expect(plan.toBeCreated).toEqual([]);
    expect(plan.toBeAdded).toEqual([]);
    expect(plan.toBeAddedIndexes).toEqual([]);
    expect(plan.schemaProblems).toEqual([]);
  });

  it("supports sign-up and sign-in", async () => {
    await migrateToLatest(handle.db, dialect);
    const auth = createAuth(handle, env);
    const body = { name: "Ada", email: "ada@example.com", password: "correct horse battery" };

    const signUp = await auth.api.signUpEmail({ body });
    expect(signUp.user.email).toBe(body.email);

    const signIn = await auth.api.signInEmail({
      body: { email: body.email, password: body.password },
    });
    expect(signIn.user.id).toBe(signUp.user.id);

    const user = await handle.db
      .selectFrom("user")
      .select(["id", "email"])
      .where("email", "=", body.email)
      .executeTakeFirstOrThrow();
    expect(user.id).toBe(signUp.user.id);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("postgres connection loss", () => {
  it("survives Postgres terminating idle connections", async () => {
    const handle = await createTestDb("postgres");
    try {
      await migrateToLatest(handle.db, "postgres");
      const before = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(handle.db);
      const pid = before.rows[0]?.pid;
      // Kill our (now idle) pooled connection from another connection, like a server restart would.
      const admin = createDb(process.env.TEST_DATABASE_URL ?? "");
      await sql`select pg_terminate_backend(${pid})`.execute(admin.db);
      await admin.db.destroy();
      await new Promise((r) => setTimeout(r, 200));
      // The pool recovers with a fresh connection, and no uncaught error crashed the process.
      const after = await sql<{ ok: number }>`select 1 as ok`.execute(handle.db);
      expect(after.rows[0]?.ok).toBe(1);
    } finally {
      await handle.cleanup();
    }
  });
});
