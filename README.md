# Domain Brain

Keep track of every domain you own: where it's registered, when it expires, what it costs. Get an
alert before anything lapses.

- Add domains by hand, or import them from **Cloudflare, Porkbun or GoDaddy**
- Expiry dates, registrar and nameservers are filled in automatically via **RDAP**
- **Email alerts** before a domain expires (default 30, 7 and 1 days)
- Tags and notes to organize your domains
- Multi-user: every account has its own domains

**Self-host it** in one container with no external database, or use the hosted version if you'd
rather not run it yourself.

> 🚧 Early development. Nothing is released yet.

## Self-hosting (quick start)

```bash
mkdir domain-brain && cd domain-brain
curl -O https://raw.githubusercontent.com/<owner>/domain-brain/main/deploy/docker-compose.yml
# edit APP_SECRET (generate one with: openssl rand -hex 32)
docker compose up -d
```

Open http://localhost:3000 and create your account. Then set `REGISTRATION_ENABLED=false` if you
don't want anyone else to sign up.

All your data lives in `./data`. To back up, copy that folder. To upgrade, run `docker compose pull && docker compose up -d`.

## Development

Requires Node.js 24 and pnpm.

```bash
pnpm install
pnpm dev
```

- Architecture: [docs/architecture.md](docs/architecture.md)
- Project rules and decisions: [CLAUDE.md](CLAUDE.md)

## License

[AGPL-3.0](LICENSE)
