# Changelog

All notable changes are listed here. Versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

## [0.2.0] - 2026-11-09

- Registrar import for Namecheap, NameSilo and OVHcloud (EU, Canada and US)
- Fix: a dropped Postgres connection (restart, failover) no longer crashes the server

## [0.1.0] - 2026-11-09

First release.

- Domain list with expiry badges, search, tags, notes, renewal prices and auto-renew status
- Registry lookups (RDAP) when adding a domain, on demand, and every 24 hours
- Email reminders before expiry (configurable days, per-user timezone, one digest per run)
- Registrar import and sync for Cloudflare, Gandi, GoDaddy, Name.com, Porkbun and Spaceship
  (Name.com also provides renewal prices)
- Email and password accounts, with optional closed registration
- SQLite by default, Postgres optional; database changes applied automatically on start
- Docker image for amd64 and arm64, Docker Compose files, Render and Fly.io templates
- Admin commands: `list-users`, `reset-password`
