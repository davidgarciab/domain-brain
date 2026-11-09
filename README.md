# Domain Brain

Keep track of every domain you own: where it's registered, when it expires, what it costs. Get an
email before anything lapses.

- **Import from your registrar**: Cloudflare, Gandi, GoDaddy, Namecheap, Name.com, NameSilo,
  OVHcloud, Porkbun and Spaceship, kept in sync every 6 hours
- **Or add domains by hand**: expiry date, registrar and nameservers are filled in from the
  registry (RDAP) where available
- **Expiry reminders by email**: 30, 7 and 1 days before by default, in your timezone
- Tags, notes, renewal prices and auto-renew status in one list
- Multi-user: each account sees only its own domains

Self-host it as **one container with no external database**, or use the hosted version if you'd
rather not run it yourself.

## Self-hosting

```bash
mkdir domain-brain && cd domain-brain
curl -O https://raw.githubusercontent.com/davidgarciab/domain-brain/main/deploy/docker-compose.yml
# set APP_SECRET in docker-compose.yml (generate one with: openssl rand -hex 32)
docker compose up -d
```

Open http://localhost:3000 and create your account. All data lives in `./data`.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/davidgarciab/domain-brain)

The [self-hosting guide](docs/self-hosting.md) covers configuration, email, HTTPS, Fly.io, Railway,
Coolify, Postgres, backups, upgrades and admin commands.

## Development

Requires Node.js 24 and pnpm (`corepack enable` picks the pinned version).

```bash
pnpm install
pnpm dev          # http://localhost:3000, SQLite in ./data
pnpm test         # add TEST_DATABASE_URL=postgres://... to also test against Postgres
pnpm lint && pnpm typecheck
```

Optional: `cp .env.example .env` to change settings locally.

- How it works: [docs/architecture.md](docs/architecture.md)
- Project rules and decisions (also the instructions for AI coding agents): [CLAUDE.md](CLAUDE.md)

Contributions are welcome. Please open an issue first for larger changes. Adding a registrar is a
good first contribution: it's one file implementing a small interface, plus tests (see
`app/.server/registrars/`).

### Releasing

Bump `version` in `package.json`, update [CHANGELOG.md](CHANGELOG.md), then tag and push:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

The release workflow publishes `ghcr.io/davidgarciab/domain-brain` (amd64 + arm64) and creates a
GitHub release.

## License

Copyright © 2026 David Garcia Berenguer.

Domain Brain is free software, licensed under the [GNU Affero General Public License v3.0](LICENSE).
If you run a modified version as a network service, you must make your source code available to
its users.
