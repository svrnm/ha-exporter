# HA Exporter

> **Warning:** This app is purely vibe-coded and provided as-is. Use it at your own risk.

A Home Assistant custom integration (**HA Exporter**) that pushes your long-term energy
statistics and selected sensor state changes to a REST API you own.

**Dahoamboard** is the companion server and web UI in `server/` and `web/` that stores and visualizes that data. The integration name in Home Assistant stays **HA Exporter**.

Built to make it easy to keep a **remote copy of the Energy dashboard**
(plus any extra sensors you want), by automatically discovering the entities
configured in Home Assistant's built-in Energy panel and streaming them,
along with the dashboard's config, to your endpoint.

## What gets exported

Every push is a single `POST {endpoint}/ingest` with a JSON body (gzipped when
> 4 KB) containing:

- **`statistics`** — long-term statistics for every entity used in the
  Home Assistant Energy dashboard (grid consumption / return, solar
  production, battery in/out, gas, water, per-device consumption, costs).
  Each batch now carries a `period` field: `"hour"` for HA's long-term
  hourly buckets and `"5minute"` for the short-term ones. Both are pulled
  on every tick, so sensors that only have short-term stats (e.g. because
  they lack a `state_class`) still show up downstream.
- **`states`** — real-time (batched) state changes for any extra entities
  you select in the config flow, **plus** any power sensors (`stat_rate`,
  `stat_rate_from`, `stat_rate_to`) surfaced by the Energy dashboard.
  These power sensors drive the companion UI's live-flow view.
- **`energy_prefs`** — a verbatim copy of the Energy dashboard configuration
  so your remote service can reconstruct the same grouping/layout.

### Envelope schema

```json
{
  "schema_version": 1,
  "instance_id": "c0ffee...",
  "ha_version": "2026.4.2",
  "sent_at": "2026-04-24T18:55:00+00:00",
  "statistics": [
    {
      "statistic_id": "sensor.grid_consumption",
      "source": "recorder",
      "period": "hour",
      "unit_of_measurement": "kWh",
      "points": [
        {
          "start": "2026-04-24T17:00:00+00:00",
          "sum": 1234.56,
          "state": 5.1,
          "mean": null,
          "min": null,
          "max": null
        }
      ]
    }
  ],
  "states": [
    {
      "entity_id": "sensor.living_room_temperature",
      "state": "21.4",
      "attributes": {"unit_of_measurement": "°C"},
      "last_updated": "2026-04-24T18:54:12+00:00",
      "last_changed": "2026-04-24T18:54:12+00:00"
    }
  ],
  "energy_prefs": {
    "energy_sources": [
      {"type": "grid", "flow_from": [...], "flow_to": [...]}
    ],
    "device_consumption": [{"stat_consumption": "sensor.washer_energy"}]
  }
}
```

Your API should respond with any `2xx` on success. `408`, `429`, `5xx` trigger
exponential backoff; other `4xx` are treated as bad requests and the batch is
dropped (and logged).

## Authentication

Requests are sent with:

```
Authorization: Bearer <token>
Content-Type: application/json
User-Agent: ha_exporter/0.1 HomeAssistant/<version>
```

The server uses two bearer secrets: a **read** token for the web UI
(`HA_EXPORTER_READ_TOKEN`) and a **write** token for Home Assistant
(`HA_EXPORTER_WRITE_TOKEN`, uploads and remote reset). Those env vars may hold
**SHA-256 fingerprints** (`sha256$…`) instead of plaintext; clients still send
the raw token in `Authorization`. Use `cd server && npm run generate-tokens`
to create fingerprints and update `.env`. Use HTTPS.

## Install via HACS

1. HACS → Integrations → ⋮ → **Custom repositories**.
2. Add this repo URL, category **Integration**.
3. Search for **HA Exporter** in HACS and install.
4. Restart Home Assistant.
5. Settings → Devices & Services → **Add integration** → **HA Exporter**.
6. Enter your endpoint (e.g. `https://ingest.example.com`) and the **write**
   token (same value as `HA_EXPORTER_WRITE_TOKEN` on the server).

## Configuration options

| Field | Default | Notes |
|---|---|---|
| Endpoint URL | — | Base URL; `/ingest` is appended. |
| Write token | — | Sent as `Authorization: Bearer …` on uploads; must match `HA_EXPORTER_WRITE_TOKEN` on the server. |
| Push interval | 300 s | Minimum 30 s. |
| Auto-export Energy dashboard entities | on | Both hourly (long-term) and 5-minute (short-term) statistics, plus state changes for any referenced power sensor so the live-flow view works. |
| Extra entities | [] | Real-time state changes for these. |
| Verify TLS | on | Disable only for dev / self-signed. |
| Initial backfill (days) | 30 | On first run (no local cursors), upload this much history from Home Assistant. `0` disables. Max 366. 5-minute stats are capped at 10 days regardless (HA itself retains short-term stats for that long). |

All values can be changed later via **Configure** on the integration.

## Hydrate / reset

Home Assistant retains long-term statistics indefinitely, so the exporter
can bootstrap a fresh remote from whatever history HA already has.

- **First install**: the integration checks for saved per-statistic cursors.
  When there are none it triggers a one-shot backfill of *Initial backfill
  (days)* worth of hourly statistics in the background and pushes them
  to the remote. Subsequent restarts resume from the cursor and only send
  new data.
- **Fill gaps manually**: call `ha_exporter.backfill` with `days: 30` (or
  up to 366). Pass `clear_cursors: true` to force every point to be
  re-sent, handy after a remote restore or schema change.
- **Start over**: call `ha_exporter.reset_remote` — the integration
  `DELETE`s the remote's stored statistics + states for this HA instance
  (keeping the stored Energy dashboard config), clears its local cursors,
  then re-hydrates with `days` of history (default 30, `0` to wipe only).
  Pass `full: true` to also drop the stored dashboard config.

## Services

- `ha_exporter.push_now` — force a flush of the buffer.
- `ha_exporter.backfill` — re-export long-term statistics.
  - `days` (1 – 366, takes precedence over `hours`)
  - `hours` (1 – 8 784)
  - `clear_cursors` (default `false`) — forget the per-statistic
    bookmarks before collecting so everything is re-sent.
- `ha_exporter.reset_remote` — wipe the remote's data for this HA
  instance, then re-hydrate.
  - `days` (0 – 366, default 30; `0` wipes only)
  - `full` (default `false`) — also delete the stored Energy dashboard
    configuration and instance record on the server.

## Events

On every successful push the integration fires `ha_exporter_pushed` with:

```yaml
event_type: ha_exporter_pushed
data:
  states: 42
  statistics: 7
  status: 200
```

You can build notification automations off it (e.g. alert when no push has
happened in 30 min).

## Resilience

- Everything is buffered in `.storage/ha_exporter.buffer.<entry_id>` so an API
  outage (or HA restart) does not drop data.
- The buffer is capped at 50 000 state records + 50 000 statistic batches to
  avoid unbounded growth during prolonged outages.
- On retryable failures (`408` / `429` / `5xx` / network) we back off
  exponentially (1 s → 2 s → … → 5 min cap) and retry on the next interval.

## Development

Drop `custom_components/ha_exporter/` into your HA config dir (or symlink the
whole repo into HACS's `custom_repositories`) and restart.

```
custom_components/ha_exporter/
├── __init__.py
├── buffer.py
├── collector.py
├── config_flow.py
├── const.py
├── energy_discovery.py
├── manifest.json
├── services.yaml
├── translations/en.json
└── uploader.py
```

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for the full text.
