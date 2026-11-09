import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdminError, listUsers, resetPassword } from "~/.server/admin";
import { createAuth } from "~/.server/auth/auth";
import type { DbHandle } from "~/.server/db";
import { createDomain } from "~/.server/domains/service";
import { parseEnv } from "~/.server/env";
import { createMigratedTestDb, testDialects } from "./helpers/db";

const env = parseEnv(process.env);

describe.each(testDialects())("admin commands on %s", (dialect) => {
  let handle: DbHandle & { cleanup: () => Promise<void> };
  beforeEach(async () => {
    handle = await createMigratedTestDb(dialect);
  });
  afterEach(async () => {
    await handle.cleanup();
  });

  it("resets a password and signs the user out", async () => {
    const auth = createAuth(handle, env);
    const email = "ada@example.com";
    const { user } = await auth.api.signUpEmail({
      body: { name: "Ada", email, password: "old password 123" },
    });
    await auth.api.signInEmail({ body: { email, password: "old password 123" } });

    const password = await resetPassword(auth, "  Ada@Example.com ");
    expect(password.length).toBeGreaterThanOrEqual(16);

    await expect(
      auth.api.signInEmail({ body: { email, password: "old password 123" } }),
    ).rejects.toThrow();
    expect((await auth.api.signInEmail({ body: { email, password } })).user.id).toBe(user.id);
    const sessions = await handle.db
      .selectFrom("session" as never)
      .select(sql`count(*)`.as("n"))
      .where(sql.ref("user_id"), "=", user.id)
      .executeTakeFirstOrThrow();
    expect(Number((sessions as { n: unknown }).n)).toBe(1); // only the sign-in just above

    await createDomain(handle.db, user.id, {
      name: "a.com",
      registrarName: null,
      registeredAt: null,
      expiresAt: null,
      autoRenew: null,
      renewalPriceMinor: null,
      currency: null,
      notes: null,
      tags: [],
    });
    expect(await listUsers(handle.db)).toEqual([{ email, name: "Ada", domains: 1 }]);
  });

  it("fails clearly for unknown users", async () => {
    await expect(resetPassword(createAuth(handle, env), "nobody@example.com")).rejects.toThrow(
      AdminError,
    );
  });
});
