import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "./env";

const secret = "x".repeat(32);

describe("parseEnv", () => {
  it("applies defaults when only APP_SECRET is set", () => {
    const env = parseEnv({ APP_SECRET: secret });
    expect(env).toMatchObject({
      NODE_ENV: "production",
      APP_URL: "http://localhost:3000",
      PORT: 3000,
      DATABASE_URL: "file:./data/domain-brain.db",
      REGISTRATION_ENABLED: true,
      JOBS_ENABLED: true,
      LOG_LEVEL: "info",
    });
    expect(env.SMTP_URL).toBeUndefined();
  });

  it("requires APP_SECRET outside development", () => {
    expect(() => parseEnv({})).toThrow(EnvError);
    expect(() => parseEnv({ APP_SECRET: "short" })).toThrow(/at least 32/);
  });

  it("provides a dev secret in development", () => {
    expect(parseEnv({ NODE_ENV: "development" }).APP_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it("parses booleans and treats empty strings as unset", () => {
    const env = parseEnv({
      APP_SECRET: secret,
      REGISTRATION_ENABLED: "false",
      JOBS_ENABLED: "0",
      SMTP_URL: "",
    });
    expect(env.REGISTRATION_ENABLED).toBe(false);
    expect(env.JOBS_ENABLED).toBe(false);
    expect(env.SMTP_URL).toBeUndefined();
  });

  it("rejects unsupported database URLs", () => {
    expect(() => parseEnv({ APP_SECRET: secret, DATABASE_URL: "mysql://x" })).toThrow(
      /DATABASE_URL/,
    );
    expect(parseEnv({ APP_SECRET: secret, DATABASE_URL: "postgresql://u@h/db" }).DATABASE_URL).toBe(
      "postgresql://u@h/db",
    );
  });
});
