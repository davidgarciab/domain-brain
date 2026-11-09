// Bundled by Vite as the server build entry (see vite.config.ts) and loaded by server.ts.
import { createRequestHandler } from "@react-router/express";
import express from "express";
import { sql } from "kysely";
import { RouterContextProvider } from "react-router";
import { env } from "~/.server/env";
import { logger } from "~/.server/logger";
import { boot, shutdown } from "~/.server/runtime";
import { runtimeContext } from "~/context";

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
    build: () => import("virtual:react-router/server-build"),
    async getLoadContext() {
      const context = new RouterContextProvider();
      context.set(runtimeContext, await boot());
      return context;
    },
  }),
);
