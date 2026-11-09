import { getMigrations } from "better-auth/db/migration";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authOptions, createAuth } from "~/.server/auth/auth";
import type { DbHandle } from "~/.server/db";
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
