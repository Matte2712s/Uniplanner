# Uniplanner

A personal calendar webapp that pulls timetables from Cineca "University
Planner" public calendars (the ones at `*.prod.up.cineca.it/calendarioPubblico/...`),
merges several of them into one calendar, and lets you pick which courses
(insegnamenti) to include per source. Sign in with Google to sync your
sources and views across devices; works without an account too (settings
stay in the browser's local storage).

Live site: <https://uniplanner.duckdns.org>

## How it works

Cineca's calendar page is a single-page app that never embeds events in
HTML - it calls three JSON endpoints on the same host (see
[server/src/cineca/service.ts](server/src/cineca/service.ts) for the
reverse-engineered contract, reconstructed from `University Planner.htm`
in this repo and confirmed against the live API). This app calls those
same endpoints server-side, validates every response against a strict
schema, and renders plain text only - it never fetches or parses a
Cineca *page*, only its API, and only on an allowlisted domain
(`*.prod.up.cineca.it`).

## Project layout

- `shared/` - types and validation (Cineca URL parser, view settings) used by both sides
- `server/` - Fastify API: Google OAuth, the Cineca proxy (SSRF-guarded, cached, schema-validated), sources/views/prefs storage in SQLite
- `web/` - React + Vite SPA: FullCalendar-based views, source/course picker, view switcher

## Requirements

- Node.js 22.13+ (uses the built-in `node:sqlite` and `node:test`-adjacent APIs)

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:

- `BASE_URL` - the app's own URL, as the *browser* sees it: `http://localhost:5173` for `npm run dev` (Vite's dev server - it proxies `/api` to the Fastify server on :3000, so the browser-facing origin is always :5173 in dev), your real HTTPS origin in production
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - from a Google Cloud OAuth 2.0 "Web application" client. Add `${BASE_URL}/api/auth/google/callback` as an authorized redirect URI (e.g. `http://localhost:5173/api/auth/google/callback` in dev)
- Leave `DEV_LOGIN` as `false` unless you want a passwordless local-only login for testing without Google credentials (never enable this in production)

Edit [server/config/sources.json](server/config/sources.json) to list the
default calendars every user sees (see that folder's README for the
format). One example UniTO calendar is included; replace it with the ones
you want as defaults - titles are fetched live from Cineca, not read from
this file.

## Run

```bash
npm run dev     # API on :3000, Vite dev server on :5173 (proxies /api to :3000)
npm test        # vitest: URL validator, SSRF guard, response hardening
npm run build   # builds web/dist
npm start       # serves the built SPA + API from a single Node process on :3000
```

In dev, open `http://localhost:5173`. In production (`npm start` or the
Dockerfile), everything is served from `BASE_URL` on one origin - keep
`BASE_URL` correct, since it also gates the Google OAuth redirect and the
CSRF `Origin` check.

## Deploy with Docker + Caddy

```bash
docker compose up -d
```

`Caddyfile` reads its site address straight from `BASE_URL` in `.env`
(no separate domain to configure) - set it to your public HTTPS origin,
e.g. `https://your-hostname.ddns.net`, with no trailing slash or path.
Caddy then handles TLS and reverse-proxies to the app container.

`docker compose up -d` also starts a `duckdns` container that keeps a
`*.duckdns.org` hostname pointed at your current IP (a cron job every 5
minutes, same as DuckDNS's own install instructions) - it idles doing
nothing unless `DUCKDNS_SUBDOMAIN`/`DUCKDNS_TOKEN` are set, see `DUCKDNS_*`
in `.env.example`.

## Security notes

- Custom source URLs are parsed and validated against a strict allowlist
  (`*.prod.up.cineca.it`, `https`, no credentials/port, a well-formed
  calendar id) before anything is fetched - see
  [shared/src/sourceUrl.ts](shared/src/sourceUrl.ts) and
  [server/src/sources/validate.ts](server/src/sources/validate.ts). The
  user-supplied URL itself is never fetched; only a canonical URL rebuilt
  from the validated host + id is.
- Every outbound Cineca request re-resolves DNS and rejects private,
  loopback, link-local and other non-public addresses, then pins the
  checked IP for that connection (`server/src/cineca/ssrf.ts`,
  `client.ts`) to close the DNS-rebinding TOCTOU gap.
- Cineca responses are parsed with strict, length- and count-capped zod
  schemas (`server/src/cineca/rawSchema.ts`); unknown fields are dropped,
  not passed through. Nothing from a Cineca response is ever rendered as
  HTML (`react/no-danger` is enforced by lint) - only as React text, so
  there is no script-injection path even from a compromised or malicious
  calendar entry.
- Sessions are random tokens in an `HttpOnly`, `SameSite=Lax` cookie;
  only a SHA-256 hash is stored server-side. Mutating requests are also
  checked against the `Origin` header as CSRF defense in depth. A strict
  CSP (`default-src 'self'`, no inline scripts/styles, `frame-ancestors
  'none'`) is set via `@fastify/helmet`.

## License

Copyright (c) 2026 Matteo Sardi

Licensed under [Creative Commons Attribution-NonCommercial-ShareAlike 4.0
International](https://creativecommons.org/licenses/by-nc-sa/4.0/) (CC BY-NC-SA
4.0). The full text is in [LICENSE](LICENSE).

- Attribution: give credit to Matteo Sardi, link to the license, and indicate
  if you made changes.
- NonCommercial: you may not use the project or derivatives for commercial
  purposes.
- ShareAlike: modified versions must be released under the same license.

Third-party dependencies keep their own licenses.
