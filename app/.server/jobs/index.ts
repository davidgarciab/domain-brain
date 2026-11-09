import { Cron } from "croner";
import { logger } from "../logger";

/**
 * Background jobs (see docs/architecture.md → "Background jobs").
 * Each job runs in-process; `protect: true` prevents overlapping runs.
 * Jobs are added here as features land: expiry-check, rdap-refresh, registrar-sync.
 */
type JobDefinition = { name: string; schedule: string; run: () => Promise<void> };

const definitions: JobDefinition[] = [];

export type Jobs = { stop: () => void };

export function startJobs(): Jobs {
  const log = logger();
  const crons = definitions.map(
    (job) =>
      new Cron(job.schedule, { name: job.name, protect: true }, async () => {
        const started = Date.now();
        try {
          await job.run();
          log.info({ job: job.name, ms: Date.now() - started }, "job finished");
        } catch (error) {
          log.error({ job: job.name, err: error }, "job failed");
        }
      }),
  );
  log.info({ jobs: definitions.map((j) => j.name) }, "scheduler started");
  return {
    stop: () => {
      for (const cron of crons) cron.stop();
    },
  };
}
