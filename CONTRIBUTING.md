# Contributing to Domain Brain

Thanks for helping out! Bug reports, fixes, docs improvements and new registrar integrations are
all welcome. This guide explains how to get set up and what a good pull request looks like.

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

- [Ways to contribute](#ways-to-contribute)
- [Before you start](#before-you-start)
- [Development setup](#development-setup)
- [Making a change](#making-a-change)
- [Adding a registrar](#adding-a-registrar)
- [Pull requests](#pull-requests)
- [Reporting security issues](#reporting-security-issues)
- [License](#license)

## Ways to contribute

- **Report a bug.** [Open an issue](https://github.com/davidgarciab/domain-brain/issues/new) with
  the version (shown in the image tag or `package.json`), how you run it (Docker Compose, Render,
  …; SQLite or Postgres), what you did, what you expected, and what happened. Logs help; remove
  passwords, API keys and email addresses first.
- **Suggest a feature.** Open an issue describing the problem it solves before writing code.
- **Improve the docs.** Typos and unclear steps in [`docs/self-hosting.md`](docs/self-hosting.md)
  can go straight to a pull request.
- **Add a registrar.** A good first contribution: one file plus tests. See
  [Adding a registrar](#adding-a-registrar).

## Before you start

- **Small fixes** (bugs, docs, tests): open a pull request directly.
- **Larger changes** (new features, new dependencies, database changes, anything touching auth):
  open an issue first so we can agree on the approach. It saves you from writing code that can't
  be merged.
- **Scope.** The current scope and the list of things deliberately left out (teams, DNS
  management, billing, WHOIS, webhooks, a public API) are in [`CLAUDE.md`](CLAUDE.md). Proposals
  to change that are welcome as issues.
- **Self-hosting stays simple.** Domain Brain runs as one container with one volume and one
  required secret. Changes that add a required service, a required setting or a manual setup
  step need a very good reason.

## Development setup

You need **Node.js 24** and **pnpm** (the pinned version is picked up by `corepack enable`).

```bash
git clone https://github.com/<you>/domain-brain.git
cd domain-brain
corepack enable
pnpm install
pnpm dev            # http://localhost:3000, SQLite in ./data
```

No configuration is needed for development. To change settings, `cp .env.example .env` (the
`.env` file is git-ignored; never commit real secrets). To test email locally, point `SMTP_URL`
at a local catcher such as Mailpit.

Useful commands:

```bash
pnpm test           # tests on SQLite
pnpm typecheck
pnpm lint           # Biome; `pnpm format` fixes formatting
pnpm build && pnpm start
pnpm db:migration <name>   # new migration file
```

**Postgres.** Every database query must work on both SQLite and Postgres. CI runs the tests on
both; to do it locally, start Postgres and point `TEST_DATABASE_URL` at it. The user needs
permission to create databases (each test creates and drops its own):

```bash
docker run -d --name db-test -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test
```

## Making a change

[`docs/architecture.md`](docs/architecture.md) explains how the app fits together, and
[`CLAUDE.md`](CLAUDE.md) holds the project's decisions and coding rules (it doubles as the
instructions for AI coding agents, so it's written to be followed literally). The rules you're
most likely to run into:

- Route modules stay thin; logic goes in services under `app/.server/`.
- Every query on user data is scoped by `user_id`.
- Read configuration only through `app/.server/env.ts`. A new setting needs a safe default and
  goes in the env table in `CLAUDE.md` and in `docs/self-hosting.md`.
- Database changes are new migration files (`pnpm db:migration <name>`). Never edit a migration
  that has been released. Follow the portability rules in `CLAUDE.md` (text IDs and dates,
  integer booleans and money, no dialect-specific SQL).
- Domain names always go through `normalizeDomainName()` / `displayDomainName()`.
- External HTTP calls use `fetch` with a timeout and validate responses with Zod; tests inject a
  fake `fetch` and never call live APIs.
- Avoid new dependencies when a few lines of code will do; a new runtime dependency needs a
  reason in the pull request.
- UI changes: check them in the browser on desktop and at phone width (390px), in light and dark
  mode.

**Tests.** Services and registrar adapters need tests. Tests that touch the database use
`describe.each(testDialects())` with the helpers in `tests/helpers/db.ts`, so they run on both
databases.

**Before you push**, all of these must pass (CI runs the same checks):

```bash
pnpm typecheck && pnpm lint && pnpm test
```

**Changelog.** If users would notice the change, add a line under "Unreleased" in
[`CHANGELOG.md`](CHANGELOG.md), written for self-hosters. Say so explicitly if they need to do
something when upgrading.

**Commits.** Imperative mood with a short subject line (≤72 characters), e.g. "Add Dynadot
registrar". Keep unrelated changes in separate pull requests.

## Adding a registrar

Integrations are read-only: they list the domains in an account with expiry dates and,
where the API offers them, auto-renew status, nameservers and renewal prices.

1. Read the registrar's **current** API docs. APIs change; note the date you checked in a comment.
2. Create `app/.server/registrars/<id>.ts` implementing `RegistrarProvider` from
   [`types.ts`](app/.server/registrars/types.ts): the credential fields, a Zod schema for them,
   `verify()` and `listDomains()`. Look at an existing adapter of the same style (JSON:
   `porkbun.ts`, XML: `namecheap.ts`) and reuse the helpers in `http.ts` / `xml.ts`.
3. Validate every API response with Zod, normalize names with `normalizeDomainName()`, and throw
   `RegistrarError` with a message the user can act on (wrong key, IP not allow-listed, …).
4. Add the id to `PROVIDER_IDS` in `types.ts` and the adapter to `index.ts`.
5. Add tests to `tests/registrars.test.ts` with a fake `fetch` that returns responses shaped like
   the provider's docs: pagination, missing optional fields, and error responses. If you copy
   real responses, replace account IDs, domain names and keys with made-up values.
6. Add the registrar to the lists in `README.md`, `CLAUDE.md` and `docs/architecture.md`, and a
   line to `CHANGELOG.md`.

If you have an account with the registrar, mention in the pull request that you tried it against
the real API. That's very helpful, since CI can only use test data.

## Pull requests

- Fork the repo, create a branch from `main`, and open the pull request against `main`.
- Describe what changed and why, link the issue it addresses (`Fixes #123`), and include
  screenshots for UI changes.
- Make sure CI is green. Maintainers may push small fixes to your branch or ask for changes;
  please don't take review comments personally, they're about the code.

Using an AI coding assistant is fine. You're responsible for the result: review it, run the
checks, and make sure you understand what you're submitting.

## Reporting security issues

**Please don't open a public issue for security problems.** Report them privately through
GitHub: the repository's **Security** tab → **Report a vulnerability**. See
[SECURITY.md](SECURITY.md) for what to include and what happens next.

## License

Domain Brain is licensed under the [GNU AGPL-3.0](LICENSE). By submitting a contribution, you
agree that it is licensed under the same terms.
