import { type BetterAuthOptions, betterAuth } from "better-auth";
import { uuidv7 } from "uuidv7";
import type { DbHandle } from "../db";
import type { Env } from "../env";

// Better Auth uses camelCase field names; we map them to our snake_case columns.
// The tables themselves are created by our own migration (db/migrations/0001_initial.ts).
const fieldMapping = {
  user: {
    fields: { emailVerified: "email_verified", createdAt: "created_at", updatedAt: "updated_at" },
  },
  session: {
    fields: {
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
      ipAddress: "ip_address",
      userAgent: "user_agent",
      userId: "user_id",
    },
  },
  account: {
    fields: {
      accountId: "account_id",
      providerId: "provider_id",
      userId: "user_id",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      idToken: "id_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  verification: {
    fields: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at" },
  },
} satisfies Partial<BetterAuthOptions>;

export function authOptions({ db, dialect }: DbHandle, env: Env) {
  return {
    appName: "Domain Brain",
    baseURL: env.APP_URL,
    secret: env.APP_SECRET,
    database: { db, type: dialect },
    emailAndPassword: {
      enabled: true,
      disableSignUp: !env.REGISTRATION_ENABLED,
    },
    advanced: {
      database: { generateId: () => uuidv7() },
    },
    telemetry: { enabled: false },
    ...fieldMapping,
  } satisfies BetterAuthOptions;
}

export function createAuth(handle: DbHandle, env: Env) {
  return betterAuth(authOptions(handle, env));
}

export type Auth = ReturnType<typeof createAuth>;
