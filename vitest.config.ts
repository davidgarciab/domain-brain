import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["app/**/*.test.ts", "tests/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      APP_SECRET: "test-secret-test-secret-test-secret-test",
      LOG_LEVEL: "silent",
    },
  },
});
