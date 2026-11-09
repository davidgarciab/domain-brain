# Architecture

> [`CLAUDE.md`](../CLAUDE.md) holds the decisions and rules and wins over this file if they disagree.
> This document explains how the pieces fit together.

## 1. Overview

```
                 ┌──────────────────────── one Node.js process ────────────────────────┐
 Browser ──HTTP──▶ Express ─▶ React Router (SSR, loaders/actions) ─▶ Services (.server) │
                 │                     │                                │                │
                 │              Better Auth (sessions)                  ▼                │
                 │                                               Kysely ──▶ SQLite file  │
                 │  croner scheduler ─▶ Jobs ─▶ Services               └──▶ or Postgres  │
                 │                         │                                             │
                 └─────────────────────────┼─────────────────────────────────────────────┘
                                           ├──▶ RDAP servers (public, via IANA bootstrap)
                                           ├──▶ Registrar APIs (Cloudflare, Porkbun, GoDaddy)
                                           └──▶ SMTP server (optional)
```

There is one deployable and one process. No queue, cache, or worker service. Everything that runs
in the background runs inside the same process on a schedule.

### Process lifecycle (`server.ts`)

1. Load and validate env (`app/.server/env.ts`). Exit with a readable error if invalid
   (for example, a missing `APP_SECRET`).
2. Open the database. The dialect comes from the `DATABASE_URL` scheme (`file:` = SQLite,
   `postgres:`/`postgresql:` = Postgres). For SQLite, create the parent directory, then set
   `journal_mode=WAL`, `foreign_keys=ON` and `busy_timeout=5000`.
3. Run pending migrations with Kysely's `Migrator`. If a migration fails, log it and exit; the app
   does not serve requests with a half-migrated schema.
4. If `JOBS_ENABLED`, start the scheduler.
5. Start Express: static assets, `GET /healthz` (checks the DB), then the React Router handler.
6. On SIGTERM/SIGINT, stop the scheduler, stop accepting connections, close the DB, and exit.

## 2. Data model

Better Auth uses its own tables (`user`, `session`, `account`, `verification`). We create them in our
first Kysely migration, copied from Better Auth's schema, so there is only one migration system.
When upgrading Better Auth, check its changelog for schema changes and add a migration if needed.

All IDs are UUIDv7 `text`. All timestamps are ISO-8601 UTC `text`. See the portability rules in
CLAUDE.md.

```
user (Better Auth) 1───* domain *───* tag          (via domain_tag)
     │                     │
     │                     *───1 registrar_connection (nullable)
     │                     │
     │                     1───* notification_log
     ├───* registrar_connection
     └───1 notification_settings
```

### `domain`
| Column | Type | Notes |
|---|---|---|
| id | text PK | |
| user_id | text FK → user | indexed |
| name | text | lowercase punycode, e.g. `xn--bcher-kva.example`; unique with `user_id` |
| source | text | `manual` \| `registrar` |
| registrar_connection_id | text FK, nullable | set when imported by a sync |
| registrar_name | text, nullable | display name, e.g. "Porkbun" |
| registered_at | text `YYYY-MM-DD`, nullable | |
| expires_at | text `YYYY-MM-DD`, nullable | indexed; used by notifications |
| auto_renew | integer 0/1, nullable | null = unknown |
| renewal_price_minor | integer, nullable | e.g. 1099 = 10.99 |
| currency | text, nullable | ISO-4217 |
| nameservers | text (JSON `string[]`) | |
| statuses | text (JSON `string[]`) | EPP status codes from RDAP/registrar |
| notes | text, nullable | user-owned |
| rdap_checked_at | text ts, nullable | |
| rdap_error | text, nullable | last lookup error, shown in the UI |
| registrar_missing_since | text ts, nullable | set when a sync no longer returns this domain |
| created_at / updated_at | text ts | |

### `tag` / `domain_tag`
`tag(id, user_id, name, color)` with `name` unique per user. `domain_tag(domain_id, tag_id)` has a
composite PK and cascading deletes.

### `registrar_connection`
| Column | Type | Notes |
|---|---|---|
| id | text PK | |
| user_id | text FK | |
| provider | text | `cloudflare` \| `porkbun` \| `godaddy` |
| label | text | user-chosen name, e.g. "Personal Porkbun" |
| credentials_enc | text | AES-256-GCM: `base64(iv).base64(tag).base64(ciphertext)` of the JSON credentials |
| last_sync_at | text ts, nullable | |
| last_sync_error | text, nullable | |
| created_at / updated_at | text ts | |

### `notification_settings`
`user_id` PK, `email_enabled` (0/1, default 1), `days_before` (JSON `number[]`, default `[30,7,1]`),
`timezone` (IANA name, default `UTC`).

### `notification_log`
`id`, `domain_id` FK, `expires_at` (the expiry this alert was about), `days_before`, `sent_at`.
There is a **unique index on `(domain_id, expires_at, days_before)`**. Before sending, we insert the
row. If the insert hits the unique constraint, the alert was already sent. This makes notifications
idempotent, even if two processes run jobs by mistake, and a renewal (a new `expires_at`) resets
the alerts.

## 3. Field ownership

A domain's data can come from three sources. Each field has one source that wins:

| Field | Winner |
|---|---|
| expires_at, registered_at, nameservers, statuses | registrar sync > RDAP > manual |
| registrar_name, auto_renew | registrar sync > manual (RDAP only fills these when empty) |
| renewal_price_minor, currency | registrar sync if the API provides it, else manual |
| notes, tags | always the user |

In the UI, fields that a registrar connection controls are read-only and labelled with their source.
On a `manual` domain, everything is editable, and RDAP only fills fields the user left empty, except
`expires_at`, which RDAP always refreshes because the registry is authoritative.

## 4. Integrations

### RDAP (`app/.server/rdap`)
- We fetch the IANA bootstrap file `https://data.iana.org/rdap/dns.json`, cache it in memory for 24h,
  and map the TLD to an RDAP base URL. TLDs without RDAP get `rdap_error = "no RDAP server for .tld"`.
  A WHOIS fallback is post-MVP.
- `GET {base}/domain/{name}`. We parse `events` (`registration`, `expiration`), registrar `entities`,
  `nameservers` and `status` with Zod, ignoring unknown fields.
- When it runs: once right after a domain is added, then every 24h in the `rdap-refresh` job, which
  takes the oldest `rdap_checked_at` first, at most N per run, with concurrency 2 and backoff on
  `429` responses, to stay polite with registries.

### Registrar adapters (`app/.server/registrars`)
Every provider implements one interface:

```ts
interface RegistrarProvider<C> {
  id: "cloudflare" | "porkbun" | "godaddy";
  displayName: string;
  credentialsSchema: z.ZodType<C>;      // also drives the "connect" form
  verify(creds: C): Promise<void>;      // throws a user-readable error
  listDomains(creds: C): Promise<RegistrarDomain[]>;
}

type RegistrarDomain = {
  name: string;                 // normalized lowercase punycode
  expiresAt: string | null;     // YYYY-MM-DD
  registeredAt: string | null;
  autoRenew: boolean | null;
  nameservers: string[] | null;
  renewalPriceMinor: number | null;
  currency: string | null;
};
```

| Provider | Credentials | Endpoint | Gotchas |
|---|---|---|---|
| Cloudflare | API token (Registrar read), account ID | `GET /client/v4/accounts/{id}/registrar/domains` | Only domains registered *at* Cloudflare, not zones that just use Cloudflare DNS |
| Porkbun | API key + secret key | `POST /api/json/v3/domain/listAll` (paginated with `start`) | The user must turn on API access in the Porkbun account |
| GoDaddy | API key + secret | `GET /v1/domains` (header `sso-key KEY:SECRET`) | GoDaddy only grants production API access to accounts that meet its requirements (e.g. 10+ domains). Explain this in the connect form |

**How a sync works** (manual "Sync now" or the `registrar-sync` job every 6h):
1. Decrypt the credentials, then call `listDomains`.
2. Upsert each domain by `(user_id, name)`, applying the field ownership rules. Set `source=registrar`
   and `registrar_connection_id`.
3. For domains linked to this connection that the registrar no longer returned (transferred out or
   expired), set `registrar_missing_since`. **Never delete them automatically.** The UI flags them.
4. Record `last_sync_at`, or `last_sync_error` (a readable message, never raw credentials).

Deleting a connection unlinks its domains, which become `manual`. It does not delete them.

### Email notifications (`app/.server/notifications`)
The `expiry-check` job runs hourly. For each user with `email_enabled`, it finds domains where
`expires_at - today(user tz)` is in `days_before`, inserts into `notification_log` (see the
idempotency note above) and sends **one digest email per user per run**. If `SMTP_URL` is unset,
the job is a no-op and the settings page shows "Email not configured on this server".

## 5. Background jobs

| Job | Schedule | What it does |
|---|---|---|
| `expiry-check` | hourly | Sends due expiry emails (idempotent) |
| `rdap-refresh` | every 30 min, small batches | Refreshes domains checked more than 24h ago |
| `registrar-sync` | every 6h | Syncs every registrar connection |

Jobs use `croner` with `protect: true`, so a slow run never overlaps the next one. They only run where
`JOBS_ENABLED=true`. With several replicas (SaaS), enable jobs on exactly one. Notifications stay
correct even if you get this wrong, but RDAP and registrar calls would be duplicated.

## 6. Auth

- Better Auth with email and password, database sessions, and an httpOnly session cookie
  (`secure` when `APP_URL` is https).
- `REGISTRATION_ENABLED=false` hides the sign-up page and rejects sign-up requests. The first account
  is created by turning registration on, signing up, then turning it off. This is documented in the
  self-hosting guide.
- Password reset by email when SMTP is configured. Without SMTP, an operator resets a password with
  the CLI command `pnpm user:reset-password <email>` (inside the container:
  `docker exec … node build/cli.js reset-password <email>`).
- Post-MVP: OAuth providers, passkeys, TOTP. Better Auth supports these as plugins.

## 7. Deployment

### Docker image
- Multi-stage build on `node:24-slim`: install with `pnpm install --frozen-lockfile`, build, then
  `pnpm prune --prod`. `better-sqlite3` uses its prebuilt glibc binary.
- Runs as the non-root `node` user. `WORKDIR /app`, `VOLUME /data`, `EXPOSE 3000`.
- The default `DATABASE_URL` inside the image is `file:/data/domain-brain.db`.
- Has a `HEALTHCHECK` on `/healthz`.
- Published to `ghcr.io/<owner>/domain-brain` as `:latest` and `:vX.Y.Z` tags, for multiple
  architectures (amd64 and arm64, for Raspberry Pi and ARM VPS users).

### Self-hosting (target: under 2 minutes)
```yaml
# deploy/docker-compose.yml
services:
  domain-brain:
    image: ghcr.io/<owner>/domain-brain:latest
    ports: ["3000:3000"]
    environment:
      APP_SECRET: change-me-to-a-long-random-string   # openssl rand -hex 32
      APP_URL: http://localhost:3000
      # SMTP_URL: smtps://user:pass@smtp.example.com:465
    volumes: ["./data:/data"]
    restart: unless-stopped
```
A separate `deploy/docker-compose.postgres.yml` shows the optional Postgres setup.

**Backups**: SQLite means you back up one file. The docs recommend
`sqlite3 /data/domain-brain.db ".backup ..."` or stopping the container and copying `./data`.
Postgres users use `pg_dump`.

**Upgrades**: `docker compose pull && docker compose up -d`. Migrations run automatically on boot.

### One-click PaaS templates (`deploy/`)
| Platform | File | Notes |
|---|---|---|
| Railway | template (button in the README) | Volume mounted at `/data` |
| Render | `render.yaml` blueprint | Needs a persistent disk at `/data` (paid plan), or the Render Postgres option |
| Fly.io | `fly.toml` | `fly volumes create data`; one machine with SQLite |
| Coolify | uses `docker-compose.yml` as is | |

Each template generates `APP_SECRET` automatically where the platform supports it. With SQLite on a
PaaS, there is **one instance and a persistent volume**. The docs say this clearly.

### Hosted SaaS
The same image with `DATABASE_URL=postgres://…` (managed Postgres), `REGISTRATION_ENABLED=true`, a
transactional SMTP provider, ≥2 web replicas with `JOBS_ENABLED=false`, and 1 replica with
`JOBS_ENABLED=true`. TLS and the domain are handled by the platform's proxy.

## 8. Scaling notes (not needed now)
- SQLite in WAL mode easily handles thousands of users and domains for this workload (mostly reads,
  few writes).
- If the SaaS outgrows a single jobs replica, add a `job_lock` table (a lease with an expiry)
  instead of introducing Redis.
- If a public API is needed, add `/api/v1/*` resource routes in the same app, with token auth.
  No separate service.

## 9. Post-MVP roadmap (unordered)
Teams/orgs with shared domains · WHOIS fallback for TLDs without RDAP · more registrars (Namecheap,
Gandi, OVH, Hetzner…) · Slack/Discord/webhook/ntfy notifications · CSV import/export · DNS record
overview · iCal feed of expiry dates · public REST API · SSL certificate expiry tracking.
