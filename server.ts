// Process entry point, run directly by Node (type stripping). Keep it tiny: no path
// aliases and no app code here. Everything else lives in server/app.ts, which Vite bundles.
// NODE_ENV is the only variable read directly; all other config comes from app/.server/env.ts.
import compression from "compression";
import express from "express";

/** The shape of server/app.ts (kept structural: that file is compiled by Vite, not Node). */
type ServerModule = {
  app: express.RequestHandler;
  boot: () => Promise<unknown>;
  shutdown: () => Promise<void>;
  env: () => { PORT: number };
};

const DEVELOPMENT = process.env.NODE_ENV === "development";
const BUILD_PATH = "./build/server/index.js";

const app = express();
app.disable("x-powered-by");
app.use(compression());

let mod: ServerModule;

if (DEVELOPMENT) {
  const vite = await import("vite");
  const viteDevServer = await vite.createServer({ server: { middlewareMode: true } });
  const load = () => viteDevServer.ssrLoadModule("./server/app.ts") as Promise<ServerModule>;
  mod = await load();
  app.use(viteDevServer.middlewares);
  app.use(async (req, res, next) => {
    try {
      // Re-imported per request so server code changes apply without a restart.
      (await load()).app(req, res, next);
    } catch (error) {
      if (error instanceof Error) viteDevServer.ssrFixStacktrace(error);
      next(error);
    }
  });
} else {
  mod = (await import(BUILD_PATH)) as ServerModule;
  app.use("/assets", express.static("build/client/assets", { immutable: true, maxAge: "1y" }));
  app.use(express.static("build/client", { maxAge: "1h" }));
  app.use(mod.app);
}

// Fail fast on bad config or a failed migration, before accepting traffic.
try {
  await mod.boot();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const { PORT } = mod.env();
const server = app.listen(PORT, () => {
  console.log(`Domain Brain listening on http://localhost:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(async () => {
      await mod.shutdown();
      process.exit(0);
    });
    // Don't hang forever on keep-alive connections.
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
