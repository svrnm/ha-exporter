# Gas page: granularity toggle + Weishaupt therme integration

Design doc for rewriting `web/src/pages/Gas.jsx` from a single bar chart into a richer "consumption + efficiency" view, layering in state-tracked sensors from the Weishaupt heating system.

## Goal

Today the Gas page renders one KPI card (`Total m³`) and one hourly bar chart. The user wants:

1. A granularity toggle (`hour` / `5minute`) on par with the Electricity page.
2. Integration of Weishaupt therme data: heat delivered (kWh), outside-temperature context, burner on-time, and a DHW-vs-heating split of gas consumption.

Out of scope for this change: an operational view of the boiler (flow/return temperatures, demand setpoints, DHW tank temperature, electrical-power estimate, cost overlay).

## Approach

All new derived series are computed **client-side** from raw `/states` history. No server-side endpoints, no schema changes. New pure helpers live next to `energyModel.js`. The page composes them in a single `useMemo` and renders two stacked sections.

This matches the pattern already used for the CO₂-signal overlay (`aggregateMeasurementPointsToHourly` in `energyModel.js`).

## Integration prerequisite

The Weishaupt entities are not in Energy preferences, so the integration only ships their state changes when they are listed in `CONF_EXTRA_ENTITIES`. Required IDs:

- `sensor.weishaupt_warmeenergie` — per-push heat energy deltas (Wh-like values; bursts during burner runs, can be negative)
- `sensor.weishaupt_wtc_kessel_betriebsphase_brenner` — burner phase (categorical: `Brenner aus`, `Brenner ein: Regelbetrieb`, `Brenner ein: Steuerbetrieb`, `Nachbelüftung`)
- `sensor.weishaupt_systemgerat_pumpe_warmwasser` — DHW pump on/off (`Ein` / `Aus`)
- `sensor.weishaupt_systemgerat_aussentemperatur` — outside temperature (°C, continuous)

If any are missing the page degrades cleanly (see Empty states).

## Layout

Top: `StickyDateToolbar` containing the existing `RangePicker` and a new `ToggleButtonGroup` for granularity. Toggle is disabled with a tooltip when `allowsFiveMinuteForRange(range)` is false (Electricity-page parity).

Two stacked sections below.

### Section 1 — Consumption

KPI strip (3 cards):

- **Total m³** — sum of the existing gas statistic over the range.
- **Ø Outside °C** — time-weighted mean of `aussentemperatur` over the range.
- **Burner minutes** — total minutes the burner was in any `Brenner ein: …` phase.

Chart: stacked bar chart of m³ per bucket, split into DHW (color `palette.energy.gas`) and heating (`alpha(palette.energy.gas, 0.55)`), with an outside-temp line on a secondary axis. Implemented inline in `Gas.jsx` using Recharts `<ComposedChart>`; not extracted to a shared component until a second page needs it.

### Section 2 — Heat & efficiency

KPI strip (3 cards):

- **kWh thermal** — sum of `weishaupt_warmeenergie` deltas in the range, converted to kWh.
- **kWh / m³** — `totalKwhThermal / totalM3`, 2 decimals, `—` when m³ is 0.
- **DHW share %** — share of m³ apportioned to DHW by the split helper.

Chart: kWh-thermal bars per bucket via the existing `HourlyBarChart`.

Strip below the bars: **burner timeline strip** — a row of cells aligned to the same bucket grid, intensity = `burnerMinutesInBucket / bucketDurationMinutes`, full saturation = `palette.energy.gas`. New component `web/src/components/BurnerTimelineStrip.jsx` (~60 LOC).

## New code

### `web/src/api/thermeModel.js` (new)

Pure functions, no React, no fetch. All take a `bucketGrid: [{ start, end }]` produced by an extracted-or-re-exported helper from `energyModel.js`.

- **`bucketStartsForRange(start, end, period)`** — single source of truth for bucket boundaries. Either lifted from existing logic in `energyModel.js` or re-exported from there so the new helpers and the existing gas-bar pipeline use the same boundaries.
- **`bucketHeatEnergyKwh(states, bucketGrid) → [{ start, value }]`** — sums `weishaupt_warmeenergie` deltas per bucket, divides by 1000 for kWh. Negatives pass through. Empty bucket = `0` (silent burner = no heat, not "unknown").
- **`bucketBurnerMinutes(states, bucketGrid) → [{ start, value }]`** — integrates time spent in any `Brenner ein: …` phase per bucket. Segments straddling bucket boundaries are split. Uses the anchor row (the integration always keeps the newest row per entity, so `range.start` has a known phase).
- **`splitGasByPurpose(gasDeltas, pumpStates, burnerStates, bucketGrid) → [{ start, dhw, heating }]`** — for each bucket: compute total burner-on time and burner-on time that overlaps with `pumpe_warmwasser = Ein` (= DHW). Apportion `gasDeltas[bucket]` by that fraction. If burner or pump anchor is missing for the bucket, fall back to `dhw = 0, heating = gasDeltas[bucket]`.
- **`averageOutsideTemp(states, bucketGrid) → [{ start, value }]`** — time-weighted mean per bucket. Bucket with no in-range rows inherits the anchor value (temperature is continuous, unlike burner phase).

### `web/src/format.js` (additive)

- **`formatNumber(value, lang, options)`** — locale-aware number formatter without `kWh` suffix. Used by the new KPI cards (`Burner minutes`, `DHW share %`, `Ø Outside °C`, `kWh / m³`).

### `web/src/components/BurnerTimelineStrip.jsx` (new)

Compact row of bucket-aligned cells. Height ~28 px, full width. Cell color: `alpha(palette.energy.gas, intensity)`. Tooltip per cell: `t('gas.burner.tooltip', { bucket, minutes })`.

### `web/src/pages/Gas.jsx` (rewritten)

Composition:

```
const { model, stats } = useEnergyBundle(selected, start, end, { period });
const therme = useManyStates(selected, [warmeenergie, brenner, pumpe, aussen], start, end);
const features = useThermeFeatures(model, therme.results);  // { hasWarmeenergie, hasBurner, hasPump, hasOutside }
const derived = useMemo(() => {
  const grid = bucketStartsForRange(start, end, period);
  const gasDeltas = mergeGasDeltas(model, stats);
  return {
    gasDeltas,
    splitM3: features.hasPump && features.hasBurner ? splitGasByPurpose(...) : null,
    kwhThermal: features.hasWarmeenergie ? bucketHeatEnergyKwh(...) : null,
    burnerMinutes: features.hasBurner ? bucketBurnerMinutes(...) : null,
    outsideAvg: features.hasOutside ? averageOutsideTemp(...) : null,
  };
}, [...]);
```

`useThermeFeatures` is a small helper (in `thermeModel.js` or inline) deciding which subsections render based on what `useManyStates` returned.

## i18n

Add to `web/src/locales/en.json` and `web/src/locales/de.json`:

```
gas.granularity.hour
gas.granularity.5minute
gas.section.consumption
gas.section.efficiency
gas.dhwShare
gas.avgOutside
gas.kwhThermal
gas.kwhPerM3
gas.burnerMinutes
gas.outsideOverlay
gas.burner.tooltip
gas.enableThermeHint
gas.stateHistoryShortHint
units.degC
units.kwhPerM3
units.minutes
```

`gas.totalRange` and `units.m3` already exist. German is first-class — write deliberate translations, not English mirrors.

## Empty states (priority order)

1. **Gas statistic missing.** Existing `gasStats.length === 0` path: render only the "no data" alert.
2. **Gas present, Weishaupt entities all missing.** Render the existing m³ KPI + bar chart plus one `Alert severity="info"` with `t('gas.enableThermeHint')`. No half-empty Weishaupt cards.
3. **Gas present, some Weishaupt entities present.** Render whatever is computable. Cards depending on a missing entity show `—`; the burner timeline strip is omitted when burner phase is missing; the heat-thermal chart is omitted when warmeenergie is missing.
4. **Range outside state retention** (`STATES_RETENTION_DAYS`, default 7). `useManyStates` returns empty rows for the older days; the page renders the alert `t('gas.stateHistoryShortHint')`, keeps the gas m³ bars (long-term stats are retained), and renders bars without the DHW/heating stack on the days that lack state history (single solid color).

## Performance

`useManyStates` caps at 20 000 rows per entity. Three of the four Weishaupt entities are sparse state-change streams (burner, pump, warmeenergie — all event-driven, ~thousands of rows in 30 days). Outside temperature is the exception:

- Sample data shows ~2–5 events/min for `aussentemperatur`. 30 days at that rate is ~130 k rows, well above the cap. Even a single day is ~4 000–7 000 rows.
- **Mitigation:** clamp the outside-temp overlay to ranges spanning ≤ 3 days (covers `today`, `yesterday`, any single-day `day:` selection, and short `span:` ranges). For longer ranges omit the overlay line; `Ø Outside °C` displays `—`. The rest of the Weishaupt section still renders.

Other entities don't need clamping.

## Bucket-grid coherence and DST

All bucket boundaries come from `bucketStartsForRange`, the single source of truth. Existing gas-bar bucketing in `pointsToHourlyDeltas` aligns to UTC hour boundaries (per `db.js#toIsoUtc`); the new helpers must use the same boundaries to avoid drift between the gas bars and the new overlays. X-axis labels localise in the chart layer; bucket math stays UTC.

## Caching

`useManyStates` shares query keys with `useStates`. Navigating between Live and Gas does not refetch shared entities. No changes needed.

## Verification (manual — repo has no test suite)

1. `cd web && npm run dev`, open `/gas`.
2. With all four Weishaupt entities tracked: walk `today` / `yesterday` / `last7` / `last30`. For each: KPIs render, bars stack, kWh-thermal non-zero on burner-active days, burner timeline strip lights up at expected times. Cross-reference the four burner runs on 2026-05-10 in the user's sample data.
3. Toggle granularity to `5minute` on `today` — bucket count grows ~12×, overlays still align, x-axis still readable. On `last30`, the toggle disables itself with a tooltip.
4. Remove `weishaupt_warmeenergie` from `extra_entities`, restart the integration → `kWh thermal` and `kWh/m³` cards show `—`, heat-thermal chart omitted, rest renders.
5. Remove **all** Weishaupt entities → page matches current Gas behaviour plus the `gas.enableThermeHint` alert.
6. `cd web && npm run lint`; `npm run build` once for sanity.

## Implementation order

1. **Helpers (no UI).** `thermeModel.js`, `formatNumber`. One-off Node script under `web/scripts/` to drive the helpers with the user's sample data and spot-check output.
2. **Hook composition.** Toggle state, `useManyStates`, single `useMemo`, `useThermeFeatures` switch.
3. **Consumption section UI.** Toolbar + granularity toggle, three KPIs, inline `<ComposedChart>` with stacked bars + outside-temp line.
4. **Heat & efficiency section UI.** Three KPIs, kWh-thermal bars (reuse `HourlyBarChart`), `BurnerTimelineStrip` component.
5. **i18n.** Add keys to `en.json` + `de.json` deliberately for both languages.
6. **Empty states + retention alerts.** Wire the four priority-ordered branches.

## Explicitly out of scope

- Test framework introduction.
- Server-side endpoints (Approach B from brainstorming).
- Operational signals: flow/return temperature, demand setpoints, DHW tank temperature, electrical-power estimate.
- Cost (€) overlay.
- Promoting outside temperature to a tracked statistic.
