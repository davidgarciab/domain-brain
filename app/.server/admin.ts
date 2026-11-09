import { randomBytes } from "node:crypto";
import type { Auth } from "./auth/auth";
import type { Db } from "./db";

// Operator commands (run via `node cli.ts`). See docs/self-hosting.md.

export class AdminError extends Error {}

/** Sets a new random password, signs the user out everywhere, and returns the password. */
export async function resetPassword(auth: Auth, email: string): Promise<string> {
  const ctx = await auth.$context;
  const found = await ctx.internalAdapter.findUserByEmail(email.trim().toLowerCase(), {
    includeAccounts: true,
  });
  if (!found) throw new AdminError(`No user with email ${email}.`);
  if (!found.accounts.some((a) => a.providerId === "credential")) {
    throw new AdminError(`${email} has no password login.`);
  }
  const password = randomBytes(12).toString("base64url");
  await ctx.internalAdapter.updatePassword(found.user.id, await ctx.password.hash(password));
  await ctx.internalAdapter.deleteUserSessions(found.user.id);
  return password;
}

export async function listUsers(
  db: Db,
): Promise<{ email: string; name: string; domains: number }[]> {
  const users = await db
    .selectFrom("user")
    .select(["id", "email", "name"])
    .orderBy("email")
    .execute();
  const counts = await db
    .selectFrom("domain")
    .select(["user_id", (eb) => eb.fn.countAll<number | string>().as("n")])
    .groupBy("user_id")
    .execute();
  const byUser = new Map(counts.map((c) => [c.user_id, Number(c.n)]));
  return users.map((u) => ({ email: u.email, name: u.name, domains: byUser.get(u.id) ?? 0 }));
}
