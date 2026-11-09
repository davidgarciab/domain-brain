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

### Process lifecycle

`server.ts` is the entry point. Node 24 runs it directly (type stripping). It sets up Express:
Vite middleware in development, static `build/client` assets in production. Then it loads
`server/app.ts`: through Vite's `ssrLoadModule` in development, or the bundled `build/server/index.js`
in production. That module calls `boot()` (in `app/.server/runtime.ts`), which does steps 1–4 below,
and then the server listens. `boot()` is cached on `globalThis`, so dev-mode module reloads don't
reconnect to the database or restart jobs.

1. Load and validate env (`app/.server/env.ts`). Exit with a readable error if invalid
   (for example, a missing `APP_SECRET`).
2. Open the database. The dialect comes from the `DATABASE_URL` scheme (`file:` = SQLite,
   `postgres:`/`postgresql:` = Postgres). For SQLite, create the parent directory, then set
   `journal_mode=WAL`, `foreign_keys=ON` and `busy_timeout=5000`.
3. Run pending migrations with Kysely's `Migrator`. Migration files are bundled with
   `import.meta.glob`, so the built server doesn't need the source tree. If a migration fails, log it
   and exit; the app does not serve requests with a half-migrated schema.
4. If `JOBS_ENABLED`, start the scheduler.
5. Start Express: static assets, `GET /healthz` (checks the DB), then the React Router handler.
6. On SIGTERM/SIGINT, stop the scheduler, stop accepting connections, close the DB, and exit.

## 2. Data model

Better Auth uses its own tables (`user`, `session`, `account`, `verification`). We create them in our
first Kysely migration, copied from Better Auth's schema, so there is only one migration system.
Their columns are mapped to snake_case in `app/.server/auth/auth.ts`, and they keep the native types
Better Auth expects per dialect (`boolean`/`timestamptz` on Postgres). A test runs Better Auth's own
schema diff (`getMigrations`) against our migrated database on both dialects, so a Better Auth upgrade
that needs schema changes fails CI instead of failing in production.

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
composite PK and cascading deletes. Tag names are stored lowercase and trimmed. A tag exists only
while at least one domain uses it; the service deletes unused tags. `color` is reserved for later.

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
`user_id` PK, `email_enabled` (0/1, default 1), `days_before` (JSON `number[]`, default `[30,7,1]`,
1–365, at most 5), `timezone` (IANA name, default `UTC`). A user without a row gets the defaults,
so reminders are on for new accounts. The row is created the first time the user saves settings.

### `notification_log`
`id`, `domain_id` FK, `expires_at` (the expiry this alert was about), `days_before` (the threshold;
`0` = "expires today / recently expired"), `sent_at`. There is a **unique index on
`(domain_id, expires_at, days_before)`**. Before sending, we insert the row with
`ON CONFLICT DO NOTHING`; if nothing was inserted, the alert was already sent (or claimed by
another process). This makes notifications idempotent, even if two processes run jobs by mistake.
A renewal (a new `expires_at`) resets the alerts. If the email fails to send, the claimed rows are
deleted so the next run retries.

### Domain list and search
The list is sorted by expiry (soonest first, unknown last), then name. Search (name in Unicode or
punycode, registrar name) and tag filtering happen in memory after loading the user's domains. A
user's list is small, and SQL can't match partial Unicode input like "bü" against punycode names.

## 3. Field ownership

A domain's data can come from three sources. Each field has one source that wins:

| Field | `manual` domain | `registrar` domain |
|---|---|---|
| expires_at, registered_at, nameservers, statuses | RDAP overwrites when it has a value; the user can edit | registrar sync wins; RDAP only fills empty fields; read-only for the user (nameservers/statuses aren't user-editable anywhere) |
| registrar_name, auto_renew | the user; RDAP only fills an empty registrar name | registrar sync; read-only for the user |
| renewal_price_minor, currency | the user | registrar sync if the API provides it, else the user |
| notes, tags | the user | the user |

The registry is authoritative for registration facts, so on a manual domain a successful RDAP
lookup replaces what the user typed for those four fields. For TLDs without RDAP, the user's values
stay. A domain's `name` never changes after it is created; to fix a typo, delete it and add it again.

Implemented in `rdapUpdate()` (`app/.server/rdap/refresh.ts`) and `updateDomain()`
(`app/.server/domains/service.ts`, see `REGISTRAR_OWNED_FIELDS`).

## 4. Integrations

### RDAP (`app/.server/rdap`)
- We fetch the IANA bootstrap file `https://data.iana.org/rdap/dns.json`, cache it in memory for 24h,
  and map the TLD to an RDAP base URL. TLDs without RDAP get a readable `rdap_error`. Several popular
  ccTLDs aren't in the bootstrap (as of 2026-11: `.de`, `.io`, `.es`), so their users enter dates by
  hand until the post-MVP WHOIS fallback exists.
- `GET {base}/domain/{name}`. We parse `events` (`registration`, `expiration`), registrar `entities`,
  `nameservers` and `status` with Zod, ignoring unknown fields.
- Every request has an 8s timeout. Errors map to user-facing messages (not found, timeout, HTTP
  status). A failed lookup still sets `rdap_checked_at`, so the job doesn't retry it before 24h.
- When it runs:
  - inline when a domain is added, so the user lands on a page with the expiry date filled in;
  - on demand via "Refresh now" on the domain page;
  - in the `rdap-refresh` job every 30 minutes. Each run takes up to 50 domains not checked in 24h
    (never-checked first, then oldest), two at a time. It stops the batch on a `429`; the rest are
    picked up next run.
- Tests use recorded fixtures (`tests/fixtures/rdap/`) and an injected `fetch`, never the network.

### Registrar adapters (`app/.server/registrars`)
Every provider implements one interface (`types.ts`):

```ts
interface RegistrarProvider<C> {
  id: "cloudflare" | "porkbun" | "godaddy";
  displayName: string;
  setupHelp: string;                      // shown on the connect form
  fields: CredentialField[];              // drives the connect form (secret fields are never echoed)
  credentialsSchema: z.ZodType<C>;        // validates the form input
  verify(creds: C, fetch): Promise<void>; // throws RegistrarError with a user-readable message
  listDomains(creds: C, fetch): Promise<RegistrarDomain[]>;
}

type RegistrarDomain = {
  name: string;                 // normalized lowercase punycode
  expiresAt: string | null;     // YYYY-MM-DD
  registeredAt: string | null;
  autoRenew: boolean | null;
  nameservers: string[] | null; // null = not reported by this API
  renewalPriceMinor: number | null;
  currency: string | null;
};
```

`fetch` is passed in so adapters are tested against recorded responses, never live APIs. Shared HTTP
handling (`http.ts`) adds a 20s timeout and maps network errors, 429 and 5xx to readable messages.

Checked against the providers' docs and live error responses in 2026-11:

| Provider | Credentials | Endpoint | Notes |
|---|---|---|---|
| Cloudflare | API token (Bearer) with Registrar read access, account ID | `GET /client/v4/accounts/{id}/registrar/registrations` with cursor pagination (`per_page` ≤ 50) | The older `/registrar/domains` endpoint reached end of life on 2026-09-27. Only domains registered at Cloudflare Registrar are listed. No nameservers in the response. Auth failures come back as HTTP 400 (code 9106, malformed token) or 401 (code 10000). |
| Porkbun | API key + secret key (in the JSON body) | `POST https://api.porkbun.com/api/json/v3/domain/listAll`, pages of 1000 via `start`; `POST /ping` to verify | Only domains with API access turned on are listed (per domain, or "Opt In All Domains"). Dates look like `"2027-01-15 10:00:00"` (UTC). Errors: HTTP 400 with `{status: "ERROR", message}`. |
| GoDaddy | Personal access token (Bearer) **or** legacy API key + secret (`sso-key`) | `GET https://api.godaddy.com/v1/domains?limit=1000&includes=nameServers`, paginated with `marker` (last domain) | Production API access is limited to accounts that meet GoDaddy's requirements; the connect form says so. Domains in `CANCELLED*`, `TRANSFERRED*`, `UPDATED*`, `CONFISCATED`, `FAILED*` and `REVERTED` status are treated as no longer in the account. |

None of the three reports renewal prices in these endpoints, so price stays user-entered for now.

**Connecting** (`connectRegistrar()`): validate the form with the provider's schema → `verify()`
against the live API → store the connection with AES-GCM-encrypted credentials → run the first
sync. Nothing is stored if verification fails.

**How a sync works** (`syncConnection()`: "Sync now", after connecting, or the `registrar-sync` job
every 6h, which syncs connections one at a time):
1. Decrypt the credentials (if `APP_SECRET` changed, this fails with a "remove and reconnect"
   message), then call `listDomains`.
2. In one transaction, upsert each domain by `(user_id, name)`:
   - set `source=registrar`, `registrar_connection_id`, and `registrar_name` (the provider's name);
   - copy the registrar-owned fields the registrar reported (see Field ownership);
   - clear `registrar_missing_since`.
   An existing manual domain with the same name is taken over, but keeps its notes, tags and price.
   New domains are picked up first by the next `rdap-refresh` run.
3. Linked domains the registrar no longer returns (transferred out, expired, or API access turned
   off) get `registrar_missing_since` set once. **They are never deleted**; the list and domain
   page flag them. The flag clears if the domain reappears.
4. Record `last_sync_at` and either clear `last_sync_error` or store a readable message. Raw
   responses and credentials are never stored or logged.

Removing a connection makes its domains `manual` and editable again. It does not delete them.

### Email notifications (`app/.server/notifications`)
The `expiry-check` job runs hourly (minute 5). For each user with reminders on:

1. Skip the user if it is before **08:00 in their timezone**. Anything due earlier goes out on the
   first run after 08:00.
2. Find their domains expiring between 7 days ago and `max(days_before)` days from their local today.
3. For each one, work out the **due threshold** (`dueThreshold()`): the smallest threshold whose
   window the domain is in (`days_left <= threshold`), or `0` if it expires today or expired in the
   last 7 days. With `[30, 7, 1]`: 25 days left → 30; 5 days left → 7.
   - This catches up instead of matching exact days. If the server was down on "day 7", the 7-day
     alert still goes out on day 5. A domain added with 3 days left gets one alert, not three.
   - Each threshold fires at most once per `expires_at` (see `notification_log`).
4. Claim the due alerts in `notification_log`, then send **one digest email per user per run**:
   soonest first, each with a link to the domain page, plus a link to settings.

If `SMTP_URL` is unset, the job is a no-op. The settings page then says email isn't configured
and hides the "Send test email" button. That button sends a test message to the user's own address,
so self-hosters can check their SMTP setup.

Mailer: `createSmtpMailer()` wraps nodemailer (`SMTP_URL` is passed straight to it, so any
nodemailer SMTP URL works). Tests use a fake `Mailer`, plus an in-process SMTP sink
(`tests/helpers/smtp.ts`) to check that real SMTP delivery works.

## 5. Background jobs

| Job | Schedule | What it does |
|---|---|---|
| `expiry-check` | hourly at :05 | Sends due expiry digests (idempotent, catch-up) |
| `rdap-refresh` | every 30 min, ≤50 domains | Refreshes domains checked more than 24h ago |
| `registrar-sync` | every 6h at :17 | Syncs every registrar connection, one at a time |

Jobs use `croner` with `protect: true`, so a slow run never overlaps the next one. They only run where
`JOBS_ENABLED=true`. With several replicas (SaaS), enable jobs on exactly one. Notifications stay
correct even if you get this wrong, but RDAP and registrar calls would be duplicated.

## 6. Auth

- Better Auth with email and password, database sessions, and an httpOnly session cookie
  (`secure` when `APP_URL` is https).
- Our login, sign-up and logout pages are React Router actions that call `auth.api.*` server-side
  and forward the session cookies. Better Auth's HTTP endpoints are also mounted at `/api/auth/*`
  (resource route `app/routes/api.auth.ts`) for flows that need them, such as email links.
- Route protection: `requireUser(context, request)` in a loader redirects to
  `/login?redirectTo=…`. Signed-in pages live under the `routes/app-layout.tsx` layout, which does this.
- `REGISTRATION_ENABLED=false` hides the sign-up page and rejects sign-up requests. The first account
  is created by turning registration on, signing up, then turning it off. This is documented in the
  self-hosting guide.
- Password reset by email when SMTP is configured. Without SMTP, an operator resets a password with
  `node cli.ts reset-password <email>` (in Docker: `docker compose exec domain-brain node cli.ts
  reset-password <email>`). It prints a new random password and deletes the user's sessions.
- Post-MVP: OAuth providers, passkeys, TOTP. Better Auth supports these as plugins.

## 7. Deployment

### Docker image
- Multi-stage build on `node:24-slim`: install with `pnpm install --frozen-lockfile`, build, then
  `pnpm prune --prod`. `better-sqlite3` uses its prebuilt glibc binary. The final image runs
  `node server.ts` with the `build/` output and production `node_modules`. `cli.ts` (admin
  commands) sits next to it and loads the same server bundle, which exports `runCli()`.
- Runs as the non-root `node` user. `WORKDIR /app`, `VOLUME /data`, `EXPOSE 3000`.
- The default `DATABASE_URL` inside the image is `file:/data/domain-brain.db`.
- Has a `HEALTHCHECK` on `/healthz`.
- Published by `.github/workflows/release.yml` on `vX.Y.Z` tags to `ghcr.io/davidgarciab/domain-brain`
  as `:X.Y.Z`, `:X.Y` and `:latest`, for amd64 and arm64 (Raspberry Pi and ARM VPS users).

### Self-hosting (target: under 2 minutes)
The user-facing guide is [`docs/self-hosting.md`](self-hosting.md): Compose quick start,
configuration, email, reverse proxy, platforms, Postgres, backups, upgrades, admin commands.
`deploy/docker-compose.yml` (SQLite) and `deploy/docker-compose.postgres.yml` are the supported
Compose files; both were tested with the built image.

### Hosting platforms
| Platform | File | Notes |
|---|---|---|
| Render | `render.yaml` (repo root; "Deploy to Render" button in the README) | Prebuilt image, 1 GB disk at `/data`, generated `APP_SECRET`, Starter plan: free instances sleep and have no disks |
| Fly.io | `deploy/fly.toml` | Volume `data` at `/data`; `auto_stop_machines = "off"` and one machine always running |
| Railway | none (steps in the guide) | Deploy the image, add a volume at `/data`. A template button can be published from the Railway dashboard later |
| Coolify & co. | `deploy/docker-compose.yml` as is | |

**One always-on instance.** Jobs run in-process, so platforms that sleep idle apps would silently
stop reminders and syncs. All templates avoid that.

**`APP_URL` detection.** Auth and React Router's CSRF check need the public URL. If `APP_URL` is
unset, `env.ts` derives it from `RENDER_EXTERNAL_URL`/`RENDER_EXTERNAL_HOSTNAME`,
`RAILWAY_PUBLIC_DOMAIN` or `FLY_APP_NAME`.

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
