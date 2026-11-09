# Self-hosting Domain Brain

Domain Brain is one Docker container. By default it keeps everything in a single SQLite file, so
all you need is somewhere to run a container and a folder (volume) to keep its data.

- [Quick start (Docker Compose)](#quick-start-docker-compose)
- [Configuration](#configuration)
- [Email reminders](#email-reminders)
- [Your first account and closing sign-ups](#your-first-account-and-closing-sign-ups)
- [Running behind a reverse proxy / HTTPS](#running-behind-a-reverse-proxy--https)
- [Hosting platforms (Render, Fly.io, Railway, Coolify)](#hosting-platforms)
- [Using Postgres instead of SQLite](#using-postgres-instead-of-sqlite)
- [Backups](#backups)
- [Upgrading](#upgrading)
- [Admin commands (reset a password)](#admin-commands)
- [Running without Docker](#running-without-docker)
- [Troubleshooting](#troubleshooting)

## Quick start (Docker Compose)

```bash
mkdir domain-brain && cd domain-brain
curl -O https://raw.githubusercontent.com/davidgarciab/domain-brain/main/deploy/docker-compose.yml
```

Open `docker-compose.yml` and set `APP_SECRET` to a long random value:

```bash
openssl rand -hex 32
```

Then start it:

```bash
docker compose up -d
```

Open http://localhost:3000 and create your account. Your data lives in `./data` next to the
compose file.

The image is published for `linux/amd64` and `linux/arm64` (so it also runs on a Raspberry Pi
4/5 or an ARM VPS) at `ghcr.io/davidgarciab/domain-brain`. Tags: `latest`, `0.1`, `0.1.0`, …

## Configuration

Everything is set with environment variables. Only `APP_SECRET` is required.

| Variable | Default | What it does |
|---|---|---|
| `APP_SECRET` | — (**required**, at least 32 characters) | Signs sessions and encrypts stored registrar credentials. **Keep it safe and don't change it**: changing it signs everyone out and makes stored registrar connections unusable (you'd have to reconnect them). |
| `APP_URL` | `http://localhost:3000` | The address people use to open Domain Brain, e.g. `https://domains.example.com`. **Must match exactly**, or sign-in and forms are rejected as a security measure. Detected automatically on Render, Railway and Fly.io. |
| `PORT` | `3000` | Port inside the container. |
| `DATABASE_URL` | `file:/data/domain-brain.db` (in Docker) | `file:<path>` for SQLite, or `postgres://user:pass@host:5432/db`. |
| `REGISTRATION_ENABLED` | `true` | Set to `false` to stop new sign-ups. |
| `JOBS_ENABLED` | `true` | Runs background jobs (reminders, registry refresh, registrar sync). Only relevant if you run several copies; see [Postgres](#using-postgres-instead-of-sqlite). |
| `SMTP_URL` | unset | Email server for reminders, e.g. `smtps://user:pass@smtp.example.com:465`. Unset = no emails. |
| `EMAIL_FROM` | `Domain Brain <noreply@localhost>` | Sender of reminder emails. Use an address your SMTP provider allows. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` or `silent`. |

## Email reminders

Domain Brain emails each user before their domains expire (30, 7 and 1 days by default; every user
can change this in **Settings**). Without `SMTP_URL`, everything else works but no emails are sent,
and the settings page says so.

Any SMTP provider works. The URL format is `smtp://` (port 587, upgraded with STARTTLS) or
`smtps://` (port 465, TLS from the start):

```yaml
SMTP_URL: smtps://USERNAME:PASSWORD@smtp.example.com:465
EMAIL_FROM: Domain Brain <domains@example.com>
```

If the username or password contains special characters like `@`, `:` or `/`, URL-encode them
(`@` → `%40`). After setting it, use **Settings → Send test email** to check that delivery works.

Reminders go out once an hour, after 08:00 in each user's timezone, as one email listing every
domain that needs attention.

## Your first account and closing sign-ups

1. Start Domain Brain and create your account(s) at `/signup`.
2. If you don't want anyone else to sign up, set `REGISTRATION_ENABLED: "false"` and restart
   (`docker compose up -d`). Existing accounts keep working; the sign-up page is disabled.

## Running behind a reverse proxy / HTTPS

Put any reverse proxy (Caddy, Traefik, nginx, …) in front of port 3000 and set `APP_URL` to the
public HTTPS address. Session cookies are marked secure when `APP_URL` starts with `https://`.

Example with Caddy (it gets the certificate automatically):

```
domains.example.com {
  reverse_proxy localhost:3000
}
```

## Hosting platforms

All of these need **one always-on instance with a persistent disk** at `/data` (for SQLite).
Reminders and syncs run inside the app, so platforms that put idle apps to sleep would stop them.

### Render

Use the [Deploy to Render](https://render.com/deploy?repo=https://github.com/davidgarciab/domain-brain)
button, or create a Blueprint from this repo. It uses [`render.yaml`](../render.yaml): the
published image, a 1 GB disk at `/data`, a generated `APP_SECRET`, and the **Starter** plan (free
instances sleep and can't have disks). `APP_URL` is detected automatically; set it yourself if you
add a custom domain.

### Fly.io

With the [`flyctl`](https://fly.io/docs/flyctl/install/) CLI, from a clone of this repo:

```bash
fly launch --copy-config --config deploy/fly.toml --no-deploy   # choose an app name and region
fly volumes create data --size 1
fly secrets set APP_SECRET=$(openssl rand -hex 32)
fly deploy --config deploy/fly.toml
```

[`deploy/fly.toml`](../deploy/fly.toml) keeps one machine running. `APP_URL` defaults to
`https://<app>.fly.dev`; set it with `fly secrets set APP_URL=…` if you use a custom domain.

### Railway

1. New project → **Deploy a Docker image** → `ghcr.io/davidgarciab/domain-brain:latest`.
2. Add a **volume** mounted at `/data`.
3. Add the variable `APP_SECRET` (use Railway's "generate" option or `openssl rand -hex 32`).
4. Under Networking, generate a public domain. `APP_URL` is picked up from it automatically.

### Coolify, Portainer, Dokploy, …

Use [`deploy/docker-compose.yml`](../deploy/docker-compose.yml) as is. Set `APP_SECRET` and
`APP_URL` in the platform's environment settings and make sure `/data` is a persistent volume.

## Using Postgres instead of SQLite

SQLite is plenty for personal use and small teams. Use Postgres if you already run one or want to
run several copies of the app. [`deploy/docker-compose.postgres.yml`](../deploy/docker-compose.postgres.yml)
starts both:

```bash
curl -O https://raw.githubusercontent.com/davidgarciab/domain-brain/main/deploy/docker-compose.postgres.yml
docker compose -f docker-compose.postgres.yml up -d
```

To use your own database, set `DATABASE_URL=postgres://user:password@host:5432/dbname`. The user
needs permission to create tables; tables are created in the connection's default schema.

If you run **more than one copy** of the app, set `JOBS_ENABLED=false` on all but one of them.
Reminders would still only be sent once, but registry and registrar lookups would be repeated.

Switching an existing installation between SQLite and Postgres isn't supported yet.

## Backups

**SQLite:** everything is in `data/domain-brain.db`. While the app is running, make a consistent
copy with:

```bash
docker compose exec domain-brain node -e "require('better-sqlite3')('/data/domain-brain.db').backup('/data/backup.db').then(() => console.log('ok'))"
```

then copy `data/backup.db` somewhere safe. Or stop the container and copy the whole `data` folder.

**Postgres:** use `pg_dump` as usual.

Also keep a copy of your `APP_SECRET`. Without it, a restored backup still has your domains, but
stored registrar connections have to be reconnected.

## Upgrading

```bash
docker compose pull
docker compose up -d
```

Database changes are applied automatically when the new version starts. Back up first, and read
the release notes for anything marked as breaking. To stay on a release line, pin the tag (e.g.
`ghcr.io/davidgarciab/domain-brain:0.1`) instead of `latest`.

## Admin commands

Run inside the container (or from the app folder without Docker):

```bash
docker compose exec domain-brain node cli.ts list-users
docker compose exec domain-brain node cli.ts reset-password you@example.com
```

`reset-password` prints a new random password and signs that user out everywhere. Use it when
someone forgets their password and email isn't configured.

## Running without Docker

Requires Node.js 24 and [pnpm](https://pnpm.io) (`corepack enable` installs the right version).

```bash
git clone https://github.com/davidgarciab/domain-brain.git && cd domain-brain
pnpm install
pnpm build
APP_SECRET=$(openssl rand -hex 32) pnpm start     # or put the variables in a .env file
```

The database goes to `./data/domain-brain.db` unless you set `DATABASE_URL`. Use a process
manager (systemd, pm2, …) to keep it running.

## Troubleshooting

- **"Invalid configuration: APP_SECRET is required"** on start: set `APP_SECRET` (at least 32
  characters).
- **Sign-in or saving a form does nothing / returns an error:** `APP_URL` doesn't match the
  address in your browser (check `http` vs `https`, the port, and `www`).
- **Container can't write to `/data`:** the app runs as the `node` user (uid 1000). Make sure the
  mounted folder is writable by it: `sudo chown -R 1000:1000 ./data`.
- **No reminder emails:** check `SMTP_URL`, use **Settings → Send test email**, and look at the
  logs (`docker compose logs domain-brain`). Reminders are sent after 08:00 in the user's timezone.
- **A registrar connection says the credentials can't be decrypted:** `APP_SECRET` changed. Remove
  the connection and add it again.
- **Namecheap says the IP is invalid:** Namecheap only accepts API calls from whitelisted IPv4
  addresses. Add your server's public IPv4 under Profile → Tools → API Access → Whitelisted IPs.
  The connect form suggests the address by asking `api.ipify.org`; behind NAT or a proxy, use the
  address your server's outgoing traffic actually uses.
- **Health check:** `GET /healthz` returns `{"status":"ok"}` when the app and database are up.
