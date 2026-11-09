import { Cron } from "croner";
import type { Db } from "../db";
import { env } from "../env";
import { logger } from "../logger";
import { runExpiryCheck } from "../notifications/expiry";
import { mailer } from "../notifications/mailer";
import { rdapClient } from "../rdap/client";
import { refreshStaleDomains } from "../rdap/refresh";
import { syncAllConnections } from "../registrars/service";

/**
 * Background jobs (see docs/architecture.md → "Background jobs").
 * Each job runs in-process; `protect: true` prevents overlapping runs.
 */
type JobDefinition = { name: string; schedule: string; run: () => Promise<unknown> };

function definitions(db: Db): JobDefinition[] {
  return [
    {
      name: "expiry-check",
      schedule: "5 * * * *",
      run: async () => {
        const m = mailer();
        if (!m) return { skipped: "SMTP_URL not set" };
        return runExpiryCheck(db, m, { appUrl: env().APP_URL });
      },
    },
    {
      name: "registrar-sync",
      schedule: "17 */6 * * *",
      run: () => syncAllConnections(db, { secret: env().APP_SECRET }),
    },
    {
      name: "rdap-refresh",
      schedule: "*/30 * * * *",
      run: () => refreshStaleDomains(db, rdapClient()),
    },
  ];
}

export type Jobs = { stop: () => void };

export function startJobs(db: Db): Jobs {
  const log = logger();
  const jobs = definitions(db);
  const crons = jobs.map(
    (job) =>
      new Cron(job.schedule, { name: job.name, protect: true }, async () => {
        const started = Date.now();
        try {
          const result = await job.run();
          log.info({ job: job.name, ms: Date.now() - started, result }, "job finished");
        } catch (error) {
          log.error({ job: job.name, err: error }, "job failed");
        }
      }),
  );
  log.info({ jobs: jobs.map((j) => j.name) }, "scheduler started");
  return {
    stop: () => {
      for (const cron of crons) cron.stop();
    },
  };
}
