# Security policy

## Supported versions

Security fixes are released for the **latest minor version** only. Please upgrade before
reporting, if you can (`docker compose pull && docker compose up -d`).

| Version | Supported |
|---|---|
| Latest release (see [Releases](https://github.com/davidgarciab/domain-brain/releases)) | ✅ |
| Older versions | ❌ |

## Reporting a vulnerability

**Please don't open a public issue, discussion or pull request for security problems.**

Report them privately through GitHub:
[**Report a vulnerability**](https://github.com/davidgarciab/domain-brain/security/advisories/new)
(the repository's **Security** tab).

Please include:

- the affected version and how you run it (Docker, platform, SQLite or Postgres);
- what an attacker could do, and under which conditions (e.g. needs an account, needs a
  self-hoster to have set something up a certain way);
- steps to reproduce, or a proof of concept.

Please don't include real credentials or other people's data, and only test against your own
installation.

## What happens next

Domain Brain is maintained by volunteers, so timings are best effort:

1. You'll get an acknowledgement, usually within a few days.
2. We'll confirm the issue, agree on severity, and work on a fix in a private advisory, where you
   can follow along and review it.
3. The fix is released, and the advisory is published with credit to you, unless you'd rather not
   be named.

Please keep the details private until the fix has been released.

## Things that are especially worth reporting

- Accessing or changing another user's domains, settings or registrar connections.
- Leaking stored registrar credentials (they are encrypted at rest and never sent to the browser).
- Bypassing sign-in, closed registration (`REGISTRATION_ENABLED=false`) or the cross-site request
  checks.
- Anything that lets an outside request make the server fetch arbitrary URLs.

Problems that come from a self-hoster's own setup (for example, serving the app over plain HTTP on
the internet, or a weak `APP_SECRET`) aren't vulnerabilities in Domain Brain, but improvements to
the docs that help people avoid them are welcome.
