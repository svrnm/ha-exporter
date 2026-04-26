# ha-exporter-server

Tiny Node.js service that receives payloads from the
[`ha_exporter`](../custom_components/ha_exporter) Home Assistant integration
and stores them in a single SQLite file. Ships with JSON read endpoints plus
static serving for the companion React UI in [`../web`](../web).

- Node **22.5+** (built-in `node:sqlite`), Express 5. No native SQLite addon.
- Single shared bearer token. One SQLite file. No build step on the server.
- Optional: build the React UI (`cd ../web && npm run build`) and this server
  will pick up `web/dist/` automatically.

## Install & run

```bash
cd server
cp .env.example .env
# edit .env: set HA_EXPORTER_TOKEN (openssl rand -hex 32) at minimum
npm install
npm start
```

Or with env inline:

```bash
HA_EXPORTER_TOKEN=$(openssl rand -hex 32) npm start
```

Point your HA integration at `https://your-vps.example.com` (TLS should be
terminated by your virtual server's reverse proxy). The integration appends
`/ingest` itself.

## Environment variables

| Var | Default | Notes |
|---|---|---|
| `PORT` | `8080` | HTTP port. |
| `HOST` | `0.0.0.0` | Bind address; use `127.0.0.1` behind a local proxy. |
| `HA_EXPORTER_TOKEN` | **required** | Shared bearer token; must equal the token in the HA config flow. |
| `DATABASE_PATH` | `<server>/data/ha-exporter.sqlite` | Resolved relative to the source tree, not the CWD. Parent dir auto-created. |
| `BODY_LIMIT` | `50mb` | Max inflated request body. Bump for big backfills. |
| `WEB_ROOT` | `<server>/../web/dist` | Location of the built React UI. If missing, the server boots API-only. |
| `SHORT_STATS_RETENTION_DAYS` | `10` | How long to keep 5-minute statistics. Set to `0` to disable the sweep and keep them forever. Mirrors HA's own recorder retention. |
| `STATES_RETENTION_DAYS` | `10` | Prunes state *history* older than this many days, but **always keeps the newest row per entity** so static tariff / `input_number` prices still appear in `/states/latest` after long gaps. Set to `0` to disable state pruning. |

## Endpoints

All routes except `GET /health` require `Authorization: Bearer <token>`.

### Write

- `POST /ingest` — accepts the exporter envelope (JSON, optionally
  `Content-Encoding: gzip`). Writes are atomic: the whole envelope is applied
  inside a single SQLite transaction, so a retry from the integration never
  leaves partial data behind.
- `DELETE /instances/:instance_id` — wipe stored `statistics` + `states` for
  one HA instance. Optional `?full=1` also drops the stored energy
  dashboard configuration and the instance row. Responds with per-table
  row counts so callers can log them. This is what the
  `ha_exporter.reset_remote` service calls under the hood.

### Read

- `GET /health` → `{ok: true}`
- `GET /instances` → list of `{instance_id, ha_version, last_seen}`
- `GET /entities?instance_id=<id>` → `{statistic_ids, entity_ids}`
- `GET /statistics?instance_id=<id>&statistic_id=<sid>&start=<iso>&end=<iso>&limit=<n>[&period=hour|5minute]`
  — points for one statistic. Defaults: `period=hour`, last 24h, limit 1000 (max 10000).
  Use `period=5minute` to read the short-term (5-minute) buckets; those are
  kept for `SHORT_STATS_RETENTION_DAYS` days.
- `GET /statistics/latest?instance_id=<id>[&period=hour|5minute]` — most
  recent point per statistic id for the requested period.
- `GET /states?instance_id=<id>&entity_id=<eid>&start=<iso>&end=<iso>&limit=<n>`
  — paginated state changes.
- `GET /states/latest?instance_id=<id>` — current snapshot of every tracked
  entity; used by the Live-flow page to drive real-time updates.
- `GET /energy/prefs?instance_id=<id>` — stored Home Assistant Energy
  dashboard config for that instance (verbatim `manager.data`).

All reads return `{count, points|states|...}` wrappers so the UI can pull
metadata without re-counting.

### Web UI

If `web/dist/` exists, the server:

- Serves the bundle's static assets (JS/CSS/HTML) **before** bearer auth, so
  the browser can load the login screen without credentials.
- Adds an SPA fallback: any unmatched `GET` that isn't an API path and
  accepts `text/html` is answered with `index.html`, so client-side routes
  like `/electricity` survive reloads.
- The token is pasted into the UI once and stored in `localStorage`; every
  API request then attaches it, and a 401 clears it and bounces to login.

Build it with `cd ../web && npm run build` and restart the server.

## Schema

Created idempotently on startup; see [src/db.js](src/db.js). Four tables:

- `statistics (instance_id, statistic_id, period, period_start, sum, state, mean, min, max, unit, received_at)` — unique on `(instance_id, statistic_id, period, period_start)`. `period` is `'hour'` for long-term stats or `'5minute'` for short-term ones. Re-pushed backfills overwrite within the same period.
- `states (instance_id, entity_id, state, attributes, last_updated, last_changed, received_at)`
- `energy_prefs (instance_id PK, prefs JSON, updated_at)`
- `instances (instance_id PK, ha_version, last_seen)`

Older installs are migrated in place on first boot: `statistics` gets a
`period` column (backfilled with `'hour'`) and the UNIQUE constraint is
widened to include it. The migration runs inside a single transaction so
readers never see a half-migrated schema.

### Retention

A periodic sweep (every 6h, plus one at startup) deletes short-term stats
and states older than their configured window. Long-term hourly stats are
kept indefinitely — they're cheap and the Summary page reads far back into
them. Disable either sweep by setting its `*_RETENTION_DAYS` env var to `0`.

SQLite runs in WAL mode with `synchronous=NORMAL` — plenty fast for a
single-writer ingest workload.

## Smoke test

```bash
TOKEN=$(grep HA_EXPORTER_TOKEN .env | cut -d= -f2)
curl -sS -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{
       "schema_version": 1,
       "instance_id": "test-instance",
       "ha_version": "2026.4.2",
       "sent_at": "2026-04-24T18:55:00Z",
       "statistics": [{
         "statistic_id": "sensor.grid_consumption",
         "source": "recorder",
         "unit_of_measurement": "kWh",
         "points": [
           {"start": "2026-04-24T17:00:00Z", "sum": 1234.56, "state": 5.1}
         ]
       }],
       "states": [{
         "entity_id": "sensor.living_room_temperature",
         "state": "21.4",
         "attributes": {"unit_of_measurement": "C"},
         "last_updated": "2026-04-24T18:54:12Z",
         "last_changed": "2026-04-24T18:54:12Z"
       }],
       "energy_prefs": {"energy_sources": [], "device_consumption": []}
     }' \
     http://localhost:8080/ingest

curl -sS -H "Authorization: Bearer $TOKEN" \
     'http://localhost:8080/statistics?instance_id=test-instance&statistic_id=sensor.grid_consumption'

# Wipe the test instance's time-series (keep prefs + instance record):
curl -sS -X DELETE -H "Authorization: Bearer $TOKEN" \
     'http://localhost:8080/instances/test-instance'

# Full wipe (also drops prefs + instance record):
curl -sS -X DELETE -H "Authorization: Bearer $TOKEN" \
     'http://localhost:8080/instances/test-instance?full=1'
```

## Reverse-proxy notes

The server listens plain HTTP. Put nginx / caddy / traefik in front for TLS.
Minimal nginx block:

```nginx
location /ha-exporter/ {
    proxy_pass http://127.0.0.1:8080/;
    proxy_set_header Host $host;
    client_max_body_size 60m;
}
```

Then point the HA integration at `https://your-host/ha-exporter`.

## Running as a service

Pick whichever fits your virtual server. Minimal systemd unit:

```ini
[Unit]
Description=ha-exporter-server
After=network.target

[Service]
WorkingDirectory=/opt/ha-exporter-server
EnvironmentFile=/opt/ha-exporter-server/.env
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
User=ha-exporter

[Install]
WantedBy=multi-user.target
```

## Backups

The SQLite file at `DATABASE_PATH` (plus any `-wal` / `-shm` siblings) is the
whole state. Snapshot it with `sqlite3 db .backup backup.sqlite` while the
service is running, or stop the service and copy the folder.
