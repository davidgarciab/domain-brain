import { type Kysely, sql } from "kysely";
import type { Dialect } from "../index";

// Released migrations are append-only: never edit this file after a release.

export async function up(db: Kysely<any>, dialect: Dialect): Promise<void> {
  // ── Better Auth tables ─────────────────────────────────────────────────────
  // Mirrors Better Auth's expected schema (with the snake_case field mapping in
  // app/.server/auth/auth.ts). tests/migrations.test.ts fails if Better Auth
  // ever expects something different.
  const bool = dialect === "postgres" ? "boolean" : "integer";
  const ts = dialect === "postgres" ? "timestamptz" : "date";
  const now = sql`CURRENT_TIMESTAMP`;

  await db.schema
    .createTable("user")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("email", "text", (c) => c.notNull().unique())
    .addColumn("email_verified", bool, (c) => c.notNull())
    .addColumn("image", "text")
    .addColumn("created_at", ts, (c) => c.notNull().defaultTo(now))
    .addColumn("updated_at", ts, (c) => c.notNull().defaultTo(now))
    .execute();

  await db.schema
    .createTable("session")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("expires_at", ts, (c) => c.notNull())
    .addColumn("token", "text", (c) => c.notNull().unique())
    .addColumn("created_at", ts, (c) => c.notNull().defaultTo(now))
    .addColumn("updated_at", ts, (c) => c.notNull())
    .addColumn("ip_address", "text")
    .addColumn("user_agent", "text")
    .addColumn("user_id", "text", (c) => c.notNull().references("user.id").onDelete("cascade"))
    .execute();
  await db.schema.createIndex("session_user_id_idx").on("session").column("user_id").execute();

  await db.schema
    .createTable("account")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("account_id", "text", (c) => c.notNull())
    .addColumn("provider_id", "text", (c) => c.notNull())
    .addColumn("user_id", "text", (c) => c.notNull().references("user.id").onDelete("cascade"))
    .addColumn("access_token", "text")
    .addColumn("refresh_token", "text")
    .addColumn("id_token", "text")
    .addColumn("access_token_expires_at", ts)
    .addColumn("refresh_token_expires_at", ts)
    .addColumn("scope", "text")
    .addColumn("password", "text")
    .addColumn("created_at", ts, (c) => c.notNull().defaultTo(now))
    .addColumn("updated_at", ts, (c) => c.notNull())
    .execute();
  await db.schema.createIndex("account_user_id_idx").on("account").column("user_id").execute();

  await db.schema
    .createTable("verification")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("identifier", "text", (c) => c.notNull())
    .addColumn("value", "text", (c) => c.notNull())
    .addColumn("expires_at", ts, (c) => c.notNull())
    .addColumn("created_at", ts, (c) => c.notNull().defaultTo(now))
    .addColumn("updated_at", ts, (c) => c.notNull().defaultTo(now))
    .execute();
  await db.schema
    .createIndex("verification_identifier_idx")
    .on("verification")
    .column("identifier")
    .execute();

  // ── App tables (portable types only) ───────────────────────────────────────

  await db.schema
    .createTable("registrar_connection")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("user_id", "text", (c) => c.notNull().references("user.id").onDelete("cascade"))
    .addColumn("provider", "text", (c) => c.notNull())
    .addColumn("label", "text", (c) => c.notNull())
    .addColumn("credentials_enc", "text", (c) => c.notNull())
    .addColumn("last_sync_at", "text")
    .addColumn("last_sync_error", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex("registrar_connection_user_id_idx")
    .on("registrar_connection")
    .column("user_id")
    .execute();

  await db.schema
    .createTable("domain")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("user_id", "text", (c) => c.notNull().references("user.id").onDelete("cascade"))
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("source", "text", (c) => c.notNull())
    .addColumn("registrar_connection_id", "text", (c) =>
      c.references("registrar_connection.id").onDelete("set null"),
    )
    .addColumn("registrar_name", "text")
    .addColumn("registered_at", "text")
    .addColumn("expires_at", "text")
    .addColumn("auto_renew", "integer")
    .addColumn("renewal_price_minor", "integer")
    .addColumn("currency", "text")
    .addColumn("nameservers", "text", (c) => c.notNull().defaultTo("[]"))
    .addColumn("statuses", "text", (c) => c.notNull().defaultTo("[]"))
    .addColumn("notes", "text")
    .addColumn("rdap_checked_at", "text")
    .addColumn("rdap_error", "text")
    .addColumn("registrar_missing_since", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .addUniqueConstraint("domain_user_id_name_uq", ["user_id", "name"])
    .execute();
  await db.schema.createIndex("domain_expires_at_idx").on("domain").column("expires_at").execute();
  await db.schema
    .createIndex("domain_registrar_connection_id_idx")
    .on("domain")
    .column("registrar_connection_id")
    .execute();

  await db.schema
    .createTable("tag")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("user_id", "text", (c) => c.notNull().references("user.id").onDelete("cascade"))
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("color", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .addUniqueConstraint("tag_user_id_name_uq", ["user_id", "name"])
    .execute();

  await db.schema
    .createTable("domain_tag")
    .addColumn("domain_id", "text", (c) => c.notNull().references("domain.id").onDelete("cascade"))
    .addColumn("tag_id", "text", (c) => c.notNull().references("tag.id").onDelete("cascade"))
    .addPrimaryKeyConstraint("domain_tag_pk", ["domain_id", "tag_id"])
    .execute();
  await db.schema.createIndex("domain_tag_tag_id_idx").on("domain_tag").column("tag_id").execute();

  await db.schema
    .createTable("notification_settings")
    .addColumn("user_id", "text", (c) => c.primaryKey().references("user.id").onDelete("cascade"))
    .addColumn("email_enabled", "integer", (c) => c.notNull().defaultTo(1))
    .addColumn("days_before", "text", (c) => c.notNull().defaultTo("[30,7,1]"))
    .addColumn("timezone", "text", (c) => c.notNull().defaultTo("UTC"))
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createTable("notification_log")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("domain_id", "text", (c) => c.notNull().references("domain.id").onDelete("cascade"))
    .addColumn("expires_at", "text", (c) => c.notNull())
    .addColumn("days_before", "integer", (c) => c.notNull())
    .addColumn("sent_at", "text", (c) => c.notNull())
    .addUniqueConstraint("notification_log_dedupe_uq", ["domain_id", "expires_at", "days_before"])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const table of [
    "notification_log",
    "notification_settings",
    "domain_tag",
    "tag",
    "domain",
    "registrar_connection",
    "verification",
    "account",
    "session",
    "user",
  ]) {
    await db.schema.dropTable(table).execute();
  }
}
