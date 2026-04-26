# Dahoamboard (web UI)

A React + MUI dashboard that consumes the `ha-exporter-server` API and
mirrors the Home Assistant Energy dashboard (Summary, Electricity, Gas,
Live) with German/English i18n and a mobile-first responsive layout.

Pages:

- **Summary** — daily/weekly/monthly totals and the 6-node energy
  distribution bubble (PV, Grid, Home, Battery, Gas, CO₂-free).
- **Electricity** — stacked bar of sources and a grid import/export line
  chart. Switch between hourly (default) and 5-minute resolution on
  ranges up to one day for a per-bucket breakdown like HA's own energy
  dashboard.
- **Gas** — per-range total and hourly trend.
- **Live** — real-time flow diagram with animated particles driven by
  the current value of the `stat_rate` power sensors surfaced by your
  HA Energy dashboard. Polled every 15 s.

## Stack

- React 19 + Vite (plain JavaScript)
- MUI (`@mui/material`, `@mui/icons-material`, `@emotion/*`)
- Recharts (charts) + hand-rolled SVG flow diagram
- `@tanstack/react-query` for API caching
- `react-router` for client-side routing
- `i18next` / `react-i18next` / language detector

All data is read-only; the UI never writes back to the server.

## Development

```bash
cd web
npm install
npm run dev
```

Vite serves on <http://localhost:5173> and proxies `/ingest`, `/instances`,
`/entities`, `/statistics`, `/states`, `/energy`, `/health` to
<http://localhost:8080>, where the Node server should be running.

Paste the dashboard token from your server operator into the login screen. It
is stored in `localStorage` under `ha_exporter_token`. A 401 from any request
clears it and bounces you back to the login.

## Production build

```bash
cd web
npm run build
```

The build writes to `web/dist`. The server automatically serves that
folder (its default `WEB_ROOT` is `../web/dist` relative to its source
tree) so after a build all you need is to restart / reload the Node
server. Deep-link reloads (e.g. `/electricity`) fall back to
`index.html` via an SPA rewrite in `server/src/server.js`.

If you prefer a different layout, point the server at the bundle with
`WEB_ROOT=/absolute/path/to/web/dist`.

A convenience top-level wiring:

```bash
# Build UI, then boot the server.
npm run build --prefix web
npm start --prefix server
```

## Internationalisation

Translation bundles live in `src/locales/{en,de}.json`. The initial
language is detected from the browser and persisted in `localStorage`
under `ha_exporter_lng`. The language menu in the AppBar switches at
runtime — numbers and dates automatically reformat via `Intl`.

## Theme

`src/theme.js` builds a dark MUI theme with a custom `palette.energy`
slot (`grid`, `solar`, `battery`, `gas`, `home`) so the flow diagram
and charts share the same colour vocabulary as the rest of the app.

## Data flow

`src/api/energyModel.js` walks the HA `energy_prefs` blob returned by
`GET /energy/prefs?instance_id=...` and normalises it into a single
flat object:

```js
{
  grid: [{from, fromCost, to?, toCompensation?}],
  solar: [{stat}],
  battery: [{from, to}],
  gas: [{stat, cost, unit}],
  water: [{stat, cost, unit}],
  devices: [{stat, name}],
  currency: 'EUR',
  co2SignalEntity: 'sensor.co2_signal',   // if Electricity Maps is configured
  powerEntities: {                        // live rate sensors (W/kW)
    grid: 'sensor.main_power',            // signed net power
    solar: 'sensor.pv_power',             // production
    batteryIn: 'sensor.battery_charge_w', // charging rate
    batteryOut: 'sensor.battery_dischg_w' // discharging rate
  }
}
```

Pages use React Query hooks:

- `useInstances`, `usePrefs`, `useStates`, `useEntities` — plumbing.
- `useStatistics(instanceId, statId, start, end, { period })` and
  `useManyStatistics(..., { period })` — query either `period: 'hour'`
  (default, long-term) or `period: '5minute'` (short-term, ~10d
  retention). The cache key includes the period so both can coexist.
- `useLatestStatistics(instanceId, { period })` — most recent point per
  stat, polled every 30 s.
- `useLatestStates(instanceId, { pollMs })` — current snapshot of every
  tracked entity, used by the Live page to drive animation. 15 s poll by
  default.
- `useEnergyBundle(instanceId, start, end, { period })` — shorthand that
  fetches prefs + every statistic the Energy dashboard references.
