// Bundled by Vite as the server build entry (see vite.config.ts) and loaded by server.ts.
import { createRequestHandler } from "@react-router/express";
import express from "express";
import { sql } from "kysely";
import { RouterContextProvider } from "react-router";
import { env } from "~/.server/env";
import { logger } from "~/.server/logger";
import { boot, shutdown } from "~/.server/runtime";
import { runtimeContext } from "~/context";

export { runCli } from "./cli";
export { boot, env, shutdown };

export const app: express.Express = express();

app.get("/healthz", async (_req, res) => {
  try {
    const { db } = await boot();
    await sql`select 1`.execute(db);
    res.json({ status: "ok" });
  } catch (error) {
    logger().error({ err: error }, "health check failed");
    res.status(503).json({ status: "error" });
  }
});

app.use(
  createRequestHandler({
    // React Router rejects action POSTs whose Origin doesn't match the request URL (CSRF check).
    // Behind an HTTPS proxy (Render, Fly.io, Caddy, …) the app sees http://, so the browser's
    // https:// Origin never matches. Allow APP_URL's host: it's the public URL by definition.
    build: async () => ({
      ...(await import("virtual:react-router/server-build")),
      allowedActionOrigins: [new URL(env().APP_URL).host],
    }),
    async getLoadContext() {
      const context = new RouterContextProvider();
      context.set(runtimeContext, await boot());
      return context;
    },
  }),
);
