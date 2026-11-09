import { z } from "zod";

// The ONLY module that reads process.env. See CLAUDE.md → "Configuration".

const DEV_SECRET = "dev-only-secret-do-not-use-in-production!";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  APP_SECRET: z
    .string({ error: "APP_SECRET is required. Generate one with: openssl rand -hex 32" })
    .min(32, "APP_SECRET must be at least 32 characters. Generate one with: openssl rand -hex 32"),
  APP_URL: z.url().default("http://localhost:3000"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .default("file:./data/domain-brain.db")
    .refine((url) => /^(file:|postgres(ql)?:\/\/)/.test(url), {
      message: "DATABASE_URL must start with file: (SQLite) or postgres:// (Postgres)",
    }),
  REGISTRATION_ENABLED: z.stringbool().default(true),
  JOBS_ENABLED: z.stringbool().default(true),
  SMTP_URL: z.string().min(1).optional(),
  EMAIL_FROM: z.string().default("Domain Brain <noreply@localhost>"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Env = z.infer<typeof schema>;

export class EnvError extends Error {}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const input = { ...source };
  // Empty strings (e.g. `SMTP_URL=` in a compose file) mean "unset".
  for (const key of Object.keys(input)) if (input[key] === "") delete input[key];
  // Don't make contributors generate a secret just to run `pnpm dev`.
  if (input.NODE_ENV === "development" && !input.APP_SECRET) input.APP_SECRET = DEV_SECRET;

  const result = schema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new EnvError(`Invalid configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
