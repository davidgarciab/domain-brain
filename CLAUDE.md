# CLAUDE.md — Domain Brain

**This file is the source of truth for the project.** If code, docs, or anything else disagrees with
this file, this file wins. Update this file in the same change when you change a decision recorded here.
Detailed design (data model, flows, deployment) lives in [`docs/architecture.md`](docs/architecture.md),
which must stay consistent with this file.

## What this is

Domain Brain is an open-source app for storing and managing the domain names you own: where each is
registered, when it expires, what it costs, and whether it auto-renews. It sends you an alert before a
domain expires.

It ships as **one codebase and one Docker image** used in two ways:

1. **Self-hosted**: one container with SQLite in a mounted volume. This is the default and the priority.
2. **Hosted SaaS**: the same image run by us with Postgres, for people who don't want to host it.

**Guiding principle: self-hosting must stay trivially simple.** A self-hoster needs exactly one
container, one volume, and one required secret. Any change that adds a required service, a required
env var, or a manual setup step must be justified and recorded here.

## Product scope (MVP)

- Multi-user, **personal accounts**: each user owns their domains. No teams/orgs in the MVP.
- Manual domain CRUD with registrar, expiry date, renewal price, auto-renew flag, notes, and tags.
- **RDAP auto-lookup**: fill in and refresh expiry, registrar, nameservers, and status from public RDAP.
- **Expiry notifications** by email (SMTP) at configurable days before expiry (default 30, 7, 1).
- **Registrar API sync** (import/refresh domains) for **Cloudflare, Porkbun, GoDaddy**.

Out of scope for the MVP: teams/orgs, DNS record management, billing, WHOIS (port 43) fallback,
webhooks/Slack notifications, public REST API. Don't build these without updating this file first.

## Decisions

| Area | Decision | Why |
|---|---|---|
| Language | TypeScript (strict), ESM only | Requested |
| Package manager | pnpm 12 (pinned via `packageManager` in `package.json`). Packages allowed to run install scripts are listed under `allowBuilds` in `pnpm-workspace.yaml` | Requested |
| Runtime | Node.js 24 LTS | Current LTS |
| Repo shape | **Single package**, not a monorepo | Simplest; split only if a second deployable appears |
| Framework | **React Router v8** (framework mode, SSR) | One full-stack app; plain Node server; no vendor lean |
| HTTP server | Express + `@react-router/express`: tiny `server.ts` entry run by Node, app in `server/app.ts` bundled by Vite | One process for HTTP, migrations, and scheduled jobs |
| Database | **SQLite (default) or Postgres**, chosen by `DATABASE_URL` | SQLite for zero-ops self-host; Postgres for the SaaS |
| DB access | **Kysely** (`better-sqlite3` and `pg` dialects) | One query layer and one migration set for both dialects |
| Migrations | Kysely `Migrator` (`kysely/migration`), TS migrations in `app/.server/db/migrations` bundled via `import.meta.glob`, run automatically on boot | No manual step for self-hosters |
| Auth | **Better Auth** (email + password, DB sessions), using our Kysely instance; its tables are created by our migrations | Supports SQLite and Postgres; self-contained |
| Validation | Zod (form input, env, registrar API responses) | One validation library everywhere |
| UI | Tailwind CSS v4; shadcn/ui components (copied into `app/components/ui`) once we need richer UI (not set up yet) | No runtime UI dependency to fight |
| Scheduler | In-process with `croner`, enabled by `JOBS_ENABLED` | No Redis or queue service |
| Email | Nodemailer over SMTP (`SMTP_URL`) | Works with any provider; optional |
| Logging | pino (JSON in production, pretty in development) | |
| Lint/format | Biome | One fast tool instead of ESLint + Prettier |
| Tests | Vitest; DB tests run on SQLite always and on Postgres when `TEST_DATABASE_URL` is set (CI sets it) | Keeps both dialects honest |
| Distribution | Docker image on GHCR + `docker-compose.yml`; one-click templates for Railway, Render, Fly.io, Coolify | Requested |
| License | **AGPL-3.0** | Changes must be shared by anyone running a modified version as a service |

## Repository layout

```
server.ts                        Process entry, run directly by Node 24 (type stripping): Express,
                                 Vite in dev / built assets in prod, boot, listen, graceful shutdown.
                                 No app imports and no path aliases here.
server/app.ts                    Express app (healthz + React Router handler); the Vite SSR build entry
app/
  root.tsx, routes.ts            React Router root and route config
  context.ts                     `runtimeContext`: gives loaders/actions the Runtime (db, auth)
  routes/                        Route modules (loaders/actions + UI). Thin: call services.
  components/                    React components (components/ui = shadcn, when added)
  lib/                           Code shared by client and server (pure, no secrets, no DB)
  .server/                       Server-only code (never importable from the client bundle)
    env.ts                       Zod-validated env; the ONLY place that reads process.env (*)
    logger.ts                    pino
    runtime.ts                   boot(): DB → migrations → auth → jobs. Cached on globalThis
    db/                          index.ts (createDb, dialect), schema.ts (row types), migrate.ts,
                                 migrations/NNNN_name.ts
    auth/                        auth.ts (Better Auth config), session.ts (getUser/requireUser)
    domains/                     Domain service (CRUD, tags, field-ownership rules)
    rdap/                        RDAP bootstrap + lookup client
    registrars/                  Provider interface + cloudflare.ts, porkbun.ts, godaddy.ts
    notifications/               Expiry check + email sending
    jobs/                        Scheduler setup and job definitions
    crypto.ts                    AES-256-GCM encryption for stored registrar credentials
tests/                           Integration tests + helpers (unit tests live next to source as *.test.ts)
scripts/                         Dev scripts run directly by Node (e.g. new-migration.ts)
deploy/                          docker-compose.yml, docker-compose.postgres.yml, PaaS templates
docs/                            architecture.md, self-hosting.md
Dockerfile
```

(*) Exception: `server.ts` reads `NODE_ENV` to decide between dev and prod before any app code loads.
Directories for features not built yet (`domains/`, `rdap/`, `registrars/`, `notifications/`) are
created when those features land.

## Configuration (env vars)

Only `APP_SECRET` is required. Everything else has a working default.

| Var | Default | Purpose |
|---|---|---|
| `APP_SECRET` | — (**required**, ≥32 chars) | Session signing and the key for encrypting registrar credentials |
| `APP_URL` | `http://localhost:3000` | Public base URL (auth callbacks, links in emails) |
| `PORT` | `3000` | HTTP port |
| `DATABASE_URL` | `file:./data/domain-brain.db` | `file:` → SQLite; `postgres://` → Postgres |
| `REGISTRATION_ENABLED` | `true` | Self-hosters set `false` after creating their accounts |
| `JOBS_ENABLED` | `true` | Run scheduled jobs in this process (enable on exactly one replica) |
| `SMTP_URL` | unset | e.g. `smtps://user:pass@smtp.example.com:465`. Unset = email disabled, UI says so |
| `EMAIL_FROM` | `Domain Brain <noreply@localhost>` | Sender address |
| `LOG_LEVEL` | `info` | pino level |

Adding a new env var: add it to `app/.server/env.ts`, this table, and `docs/self-hosting.md`. New vars
**must have a safe default** unless there is no way around it.

## Commands

```bash
pnpm install
pnpm dev            # dev server with HMR (SQLite at ./data; a .env file is loaded if present)
pnpm build          # production build
pnpm start          # run built server (runs migrations on boot)
pnpm test           # vitest (SQLite); set TEST_DATABASE_URL=postgres://... to also run Postgres
pnpm typecheck      # react-router typegen + tsc
pnpm lint           # biome check
pnpm format         # biome format --write
pnpm db:migration <name>   # scaffold app/.server/db/migrations/NNNN_<name>.ts
```

Notes:
- `pnpm dev` runs Node with `--conditions development`. Without it, Node and Vite load different
  React Router builds and requests fail with "Invalid `context` value". Keep the flag.
- In development, `APP_SECRET` defaults to a fixed insecure value; everywhere else it is required.
- To run DB tests against Postgres locally, point `TEST_DATABASE_URL` at any Postgres database you
  can create schemas in. Each test uses its own throwaway schema.

Before considering any task done: `pnpm typecheck && pnpm lint && pnpm test` pass.

## Coding rules

### Architecture
- Route modules stay thin: parse input with Zod, call a service in `app/.server/*`, return data.
  Business logic never lives in route files.
- Every loader/action that touches user data must get the user from the session helper and
  **scope every query by `user_id`**. There are no cross-user queries outside jobs.
- Server-only code goes under `app/.server/`. Never import it from `app/lib` or components.
- Read config only via `app/.server/env.ts`. Never read `process.env` elsewhere.
- External HTTP calls (RDAP, registrars) use `fetch` with a timeout (`AbortSignal.timeout`) and
  validate responses with Zod. Never trust their shape.

### Database portability (SQLite + Postgres)
All queries and migrations must work on both dialects. To keep that cheap:
- Migration files export `up(db, dialect)`; the `dialect` argument is for the rare type difference,
  and using it needs a comment explaining why.
- Column names are snake_case and row types in `db/schema.ts` mirror them exactly. No Kysely
  `CamelCasePlugin` (it would break Better Auth's queries). Map to camelCase objects in services.
- **IDs**: `text` primary keys, generated in the app (UUIDv7). No auto-increment.
- **Dates**: date-only values (expiry, registration) are `text` in `YYYY-MM-DD`; timestamps are `text`
  ISO-8601 UTC (`2026-11-09T12:00:00.000Z`). They sort correctly as strings on both dialects.
- **Booleans**: `integer` 0/1, mapped to `boolean` in the service layer.
- **Money**: `integer` minor units (cents) + `text` ISO-4217 currency. Never floats.
- **JSON**: `text` holding JSON, parsed and validated with Zod at the service boundary.
- Use the Kysely query builder. Raw `sql` only when unavoidable, and covered by a test on both dialects.
- No dialect-specific features (`RETURNING` is fine, both support it; no `ON CONFLICT` variants beyond
  Kysely's `onConflict` builder; no Postgres arrays/jsonb; no SQLite-only functions).
- Migrations are append-only. Never edit a migration that has been released.
- **Exception: Better Auth's tables** (`user`, `session`, `account`, `verification`) use the types
  Better Auth expects per dialect (`boolean`/`timestamptz` on Postgres, `integer`/`date` on SQLite),
  with columns mapped to snake_case in `auth/auth.ts`. `tests/migrations.test.ts` asks Better Auth
  whether our schema matches what it expects. When upgrading Better Auth, run the tests; if they fail,
  add a migration.

### Security
- Registrar credentials are encrypted at rest with AES-256-GCM using a key derived from `APP_SECRET`
  (HKDF). They are never sent to the client and never logged.
- Changing `APP_SECRET` invalidates sessions and stored registrar credentials; document this, don't
  try to work around it.
- All mutations go through React Router actions (form POSTs) protected by the session. No GET mutations.
  React Router rejects cross-origin action POSTs (CSRF check), so `APP_URL` must match the URL users
  actually use.
- Auth forms call `auth.api.*` with `asResponse: true` and forward cookies via `authResult()`.
  Redirect targets from user input go through `safeRedirect()`.

### Style
- Biome defaults; no default exports except where React Router requires them (route modules, root).
- Prefer plain functions and modules over classes. Exceptions: none so far.
- Domain names are stored **lowercase, ASCII (punycode)**, and displayed as Unicode.
- Don't add a dependency when a few lines will do. A new runtime dependency needs a reason in the PR.

### Tests
- Services and registrar adapters get tests. Registrar adapters are tested against recorded fixtures,
  never against live APIs in CI.
- DB-touching tests use a fresh SQLite in-memory DB (and Postgres schema when `TEST_DATABASE_URL` is set).

## SaaS vs self-hosted

Same code, same image. Differences come only from configuration (`DATABASE_URL`,
`REGISTRATION_ENABLED`, `JOBS_ENABLED`, `SMTP_URL`). There is no "mode" flag. If a hosted-only feature
(e.g. billing) is ever added, it must be optional and off by default, and recorded here first.

## Working with Claude on this repo

- Ask before making a decision that isn't covered here and that is costly to reverse (new service
  dependency, schema shape, new env var, auth changes).
- Update this file and `docs/architecture.md` in the same change as any decision change.
- Commit messages: imperative mood, short subject line (≤72 chars).
