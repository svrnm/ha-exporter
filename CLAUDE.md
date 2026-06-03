# CLAUDE.md

Guidance for working in this repo. The user-facing docs live in the per-directory `README.md`s — read those for the *what*. This file is the *how* for code changes.

## Repo layout

Three independently-installable but tightly-coupled pieces:

- `custom_components/ha_exporter/` — Home Assistant **custom integration** (Python, HA core APIs). Domain `ha_exporter`, integration name "HA Exporter". Pushes statistics + state changes + Energy dashboard config to a remote `POST /ingest`.
- `server/` — Dahoamboard backend. Node 22.5+ ESM, Express 5, **built-in `node:sqlite`** (no native addon). Receives the envelope, stores it, and serves read endpoints + the React bundle.
- `web/` — Dahoamboard frontend. React 19 + Vite 8 + MUI 9, TanStack Query, react-router 7, recharts. Plain JS (no TypeScript).

The integration name in HA is **HA Exporter**. The server + web UI brand themselves **Dahoamboard**.

## Commands

| Where | Command | Purpose |
|---|---|---|
| `web/` | `npm install`, `npm run dev` | Vite dev server on :5173, proxies API paths to :8080. |
| `web/` | `npm run build` | Outputs to `web/dist`; the server picks it up automatically. |
| `web/` | `npm run lint` | ESLint flat config (`web/eslint.config.js`). |
| `server/` | `npm install`, `npm start` | Boots Express on `:8080`. |
| `server/` | `npm run dev` | `node --watch` reload. |
| `server/` | `npm run lint` | ESLint with `--max-warnings 0`. |
| `server/` | `npm run generate-tokens` | Writes random plaintext + `sha256$…` fingerprints into `server/.env`. |
| repo root | `pre-commit run -a` | Runs gitleaks, eslint (web + server), pylint, EOF/whitespace fixers. |

There is **no test suite** in this repo. Don't fabricate one — verify changes by running the dev server / hitting endpoints with `curl` / loading the UI, and report honestly when behaviour can't be exercised locally.

## Architecture notes that are easy to miss

### The envelope contract is the API
The integration's `POST /ingest` body shape (`schema_version`, `instance_id`, `ha_version`, `sent_at`, `statistics[]`, `states[]`, `energy_prefs`) is the source of truth shared by all three pieces. If you touch one side, check the other two:
- Producer: `custom_components/ha_exporter/uploader.py` + `collector.py`.
- Consumer: `server/src/routes/ingest.js`.
- Persisted shape: `server/src/db.js` (schema + migrations).

### Statistics have *two* periods
`statistics.period` is `'hour'` (HA long-term) or `'5minute'` (HA short-term). Both are pulled on every tick. The SQLite UNIQUE key is `(instance_id, statistic_id, period, period_start)` — `period` must always be in WHERE clauses or you'll mix buckets. Short-term and states are pruned on a 6h sweep (`SHORT_STATS_RETENTION_DAYS`, `STATES_RETENTION_DAYS`); long-term hourly is kept forever. The states sweep always keeps the *newest* row per entity so static price/`input_number` values still show up after gaps.

### Tokens: plaintext on the wire, fingerprint at rest
`HA_EXPORTER_READ_TOKEN` / `HA_EXPORTER_WRITE_TOKEN` may hold plaintext or `sha256$<64hex>`. **Clients always send plaintext** — the server hashes per-request and compares. Don't add code paths that require plaintext at rest. The write token is also accepted on read routes (debug convenience); the read token is *not* accepted for writes.

### SPA fallback runs before bearer auth
`server/src/server.js` serves `web/dist` static assets and the SPA `index.html` fallback **before** mounting the auth middleware, so the browser can load the login screen without a token. API prefixes (`API_PREFIXES`) are excluded from the fallback. When adding a new top-level API path, add it to `API_PREFIXES` and to `web/vite.config.js`'s dev proxy list.

### Paths are anchored to the source tree, not CWD
`DATABASE_PATH` and `WEB_ROOT` resolve relative to `server/`, not the process CWD. Don't "fix" this with `process.cwd()` — systemd units launch from `/` and would break.

### Schema migrations run inside one transaction
`db.js` runs idempotent table creates plus an in-place migration that adds `period` to `statistics` and widens its UNIQUE constraint. The migration is wrapped in a single transaction so concurrent readers never see a half-migrated state. New migrations should follow the same pattern (transactional + idempotent on re-run).

### Buffer survives outages
The integration buffers everything in `.storage/ha_exporter.buffer.<entry_id>` (capped at 50k state records + 50k stat batches). On `408` / `429` / `5xx` / network errors it backs off exponentially (1s → 5min cap). Don't drop the buffer file lightly — it represents un-acked data.

### Live page polls
`web/src/pages/Now.jsx` (Live flow) reads `GET /states/latest` every 15 s; `useLatestStatistics` polls every 30 s. Don't introduce shorter intervals without understanding the cost on a Pi-hosted server.

## Conventions

- **ESM everywhere** (`"type": "module"`) in `web/` and `server/`. Internal imports include the file extension (`./auth.js`, `./db.js`, `./Login.jsx`) — keep that.
- **Times** are canonical UTC ISO strings (`…Z`). `db.js#toIsoUtc` normalises on the way in. Don't store local time.
- **Atomic ingest**: a single `POST /ingest` is applied inside one SQLite transaction. Don't break that — partial writes after an integration retry would corrupt cursors.
- **No TypeScript** in `web/`; props aren't validated (`react/prop-types` is off). Keep new code plain JS.
- **MUI 9 + Emotion**, dark theme with a custom `palette.energy` slot (`grid`, `solar`, `battery`, `gas`, `home`). Charts and the flow diagram share that vocabulary — reuse the slot, don't hardcode hex.
- **i18n**: any user-visible string in `web/` goes through `react-i18next`. Translation bundles live in `web/src/locales/{en,de}.json`. German is a first-class language, not an afterthought.
- **Comments**: follow the existing style — short, only where intent is non-obvious. Don't add "what" comments.

## When you change things

- **Adding a config option to the integration**: update `const.py`, `config_flow.py` (both initial + options flow), `translations/en.json`, `RuntimeData` in `__init__.py`, and the README's options table.
- **Adding an API route on the server**: add it under `server/src/routes/`, mount it in `server.js`, add the prefix to `API_PREFIXES`, add it to `web/vite.config.js`'s `API_PATHS`, and document it in `server/README.md`.
- **Touching the SQLite schema**: write a transactional, idempotent migration in `db.js`. Test against an existing DB file (`server/data/ha-exporter.sqlite`) before merging.
- **Changing the envelope schema**: bump `schema_version`, update both producer and consumer, and consider whether older clients need a grace period.

## Things to avoid

- Don't add a build step on the server — it's intentionally `node src/server.js` with zero compilation.
- Don't pull in a different SQLite library; `node:sqlite` is the only dep on the data path and it's the reason there's no native build.
- Don't add tests just to add tests. If you do add them, justify the runner choice (no framework is currently wired up).
- Don't write secrets to the repo. Pre-commit runs **gitleaks** and will block.
- Don't remove the bearer-before-static ordering in `server.js` — see "SPA fallback" above.
