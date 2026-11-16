## What and why

<!-- What does this change, and why? Link the issue: "Fixes #123". -->

## How it was tested

<!-- Tests added or updated. For UI changes, add screenshots (desktop and phone width). For a
registrar, say whether you tried it against the real API. -->

## Checklist

- [ ] `pnpm typecheck && pnpm lint && pnpm test` pass
- [ ] Database changes are a new migration and work on SQLite and Postgres
- [ ] User-visible change: entry under "Unreleased" in `CHANGELOG.md` (with upgrade steps if needed)
- [ ] New setting: safe default, added to `env.ts`, `CLAUDE.md` and `docs/self-hosting.md`
- [ ] No secrets, real credentials or personal data in code, tests or screenshots

<!-- See CONTRIBUTING.md for details. Tick only what applies. -->
