// Operator commands for a built installation (run from the app directory):
//   node cli.ts reset-password <email>
//   node cli.ts list-users
// In Docker: docker compose exec domain-brain node cli.ts <command>
// Loads the built server bundle, so run `pnpm build` first when working from source.
import { existsSync } from "node:fs";

const BUILD_PATH = "./build/server/index.js";
if (!existsSync(BUILD_PATH)) {
  console.error("No build found. Run `pnpm build` first.");
  process.exit(1);
}
const mod = (await import(BUILD_PATH)) as { runCli: (args: string[]) => Promise<number> };
process.exitCode = await mod.runCli(process.argv.slice(2));
