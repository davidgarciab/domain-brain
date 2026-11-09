// Operator commands, exported via server/app.ts and run by the root cli.ts:
//   node cli.ts reset-password <email>
//   node cli.ts list-users
// Uses the same configuration (DATABASE_URL, APP_SECRET, …) as the server.
import { AdminError, listUsers, resetPassword } from "~/.server/admin";
import { createAuth } from "~/.server/auth/auth";
import { createDb } from "~/.server/db";
import { migrateToLatest } from "~/.server/db/migrate";
import { env } from "~/.server/env";

const USAGE = `Usage:
  node cli.ts reset-password <email>   Set a new random password and sign the user out
  node cli.ts list-users               List accounts`;

export async function runCli(args: string[]): Promise<number> {
  const [command, arg] = args;
  if (!command || command === "help" || command === "--help") {
    console.log(USAGE);
    return command ? 0 : 1;
  }
  const config = env();
  const handle = createDb(config.DATABASE_URL);
  try {
    await migrateToLatest(handle.db, handle.dialect);
    switch (command) {
      case "reset-password": {
        if (!arg) throw new AdminError("Pass the user's email: reset-password <email>");
        const password = await resetPassword(createAuth(handle, config), arg);
        console.log(`New password for ${arg}: ${password}`);
        console.log(
          "All of this user's sessions were signed out. Ask them to change it after signing in.",
        );
        return 0;
      }
      case "list-users": {
        const users = await listUsers(handle.db);
        if (users.length === 0) console.log("No users yet.");
        for (const u of users) console.log(`${u.email}\t${u.name}\t${u.domains} domains`);
        return 0;
      }
      default:
        console.error(`Unknown command: ${command}\n\n${USAGE}`);
        return 1;
    }
  } catch (error) {
    if (error instanceof AdminError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  } finally {
    await handle.db.destroy();
  }
}
