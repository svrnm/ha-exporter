# Per-device consumption over time on the Electricity page

**Date:** 2026-05-13
**Page:** `web/src/pages/Electricity.jsx`
**New component:** `web/src/components/DeviceHourlyChart.jsx`

## Problem

The Electricity page has time-resolved bar charts for grid, solar, and grid in/out, plus a per-device **totals** bar chart (`DeviceKwhBarChart`). What's missing is per-device consumption **over time** at the same hour / 5-minute resolution that the rest of the page already supports. A user can see "device X used 14 kWh this week" but not "device X spiked Tuesday evening."

## Goal

Add one new stacked time-series chart to the Electricity page that shows per-device consumption at the resolution selected by the page's existing hour / 5-minute toggle. The chart sits **above** the existing device totals bar chart, so the temporal view comes first and the totals view summarizes underneath.

## Non-goals

- No server / API changes. Per-device statistics are already fetched on this page; we are deriving a new view from existing data.
- No new resolution toggle on this chart — it follows the page-level toggle.
- No per-device line chart, no user-selectable device subset, no chip filters.
- No changes to `DeviceKwhBarChart`.

## Architecture

Per-device statistics are already in `stats.results` because
`allStatIdsFromModel(model)` (called by `useEnergyBundle`) includes every
`model.devices[*].stat`. `Electricity.jsx` already derives `deltasByStat`
(a `Map<statId, deltas>`) from `stats.results`. The new chart is a
derived view over `model.devices` and `deltasByStat`.

One new component, `DeviceHourlyChart`, wraps the existing `HourlyBarChart`
and is responsible for:

1. Filtering `model.devices` to **leaves** (no other device's
   `includedInStat` points at this one), matching the existing
   `sankeyTotals.deviceLeaves` rule. Avoids double-counting nested meters.
2. Computing total kWh per device over the range and sorting descending.
3. Taking the top **N = 8** by total. Summing the remainder into a synthetic
   `"Other"` device whose `data` is the per-bucket sum of the leftover
   devices' deltas.
4. Mapping each kept device to a `HourlyBarChart` series:
   `{ key, label, color, data }`. Colors come from `BAR_TINTS` (the same
   palette `DeviceKwhBarChart` uses), indexed by sorted position. `"Other"`
   uses a theme-neutral grey (`theme.palette.action.disabledBackground` —
   blends with the chart background but still readable).
5. Stack order: named devices at the bottom (biggest first, closest to the
   axis), `"Other"` at the top. Matches HA's Energy dashboard convention.

Inputs in / outputs out:

- **Props:** `{ devices: model.devices, deltasByStat, range, title, topN = 8 }`
- **Renders:** a single `<HourlyBarChart>` instance, or `null` when there
  is no data to show.

## Component contract

```jsx
<DeviceHourlyChart
  devices={model?.devices ?? []}
  deltasByStat={deltasByStat}
  range={range}
  title={t('electricity.devicesOverTime')}
  topN={8}
/>
```

`devices` is the raw `model.devices` array (each entry has at least
`{ stat, name, includedInStat }`). The component handles leaf filtering
internally so callers don't have to.

## Data flow

```
model.devices  ─┐
                ├─► filter to leaves (drop parents whose stat is the   ┐
                │   includedInStat of any other device)                │
                │                                                      │
deltasByStat  ──┤                                                      │
                │                                                      ├─► series[]
                ├─► totals per leaf  ─►  sort desc  ─►  top N + Other  │     │
                │                                                      │     │
range  ─────────┴──────────────────────────────────────────────────────┘     │
                                                                             ▼
                                                              <HourlyBarChart …/>
```

The "Other" series' `data` is built by iterating each non-top device's
`deltas` and summing `value` per `start` timestamp into a `Map`, then
emitting a sorted `[{ start, value }]` array. Same shape every other
series uses.

## Placement on the page

`Electricity.jsx` already renders, in order:

1. Stacked hourly (grid / solar / battery)
2. Solar generation (hourly)
3. Grid in / out (hourly)
4. **`DeviceKwhBarChart`** (device totals)

The new chart sits **between (3) and (4)**: time-series device view, then
totals view. Both are inside the existing `Box` with
`gridTemplateColumns: '1fr'`, so they stack naturally on all viewports.

Render condition: `!flowLoading && model && (model.devices?.length ?? 0) > 0`.

## Behavior with existing controls

| Control                                | Effect on new chart                                                                                                |
|----------------------------------------|--------------------------------------------------------------------------------------------------------------------|
| Hour / 5-minute toggle                 | The chart reads `stats.results` indirectly via `deltasByStat`, which already follows `effectiveResolution`. Free.   |
| Range that triggers daily aggregation  | `HourlyBarChart` already collapses to daily bars when `isDailyAggregateRange(range)`. Free.                          |
| Refresh                                | Page-level refresh re-runs the same queries; chart re-renders automatically.                                         |

## Color and ordering

`BAR_TINTS` (in `DeviceKwhBarChart`) is indexed by sorted position.
`DeviceKwhBarChart` sorts devices by total value descending; the new chart
does the same. The top device therefore gets `BAR_TINTS[0]` in both
charts — same color, same device. This is a deliberately cheap approach.
A bullet-proof "stable color per stat id" mapping is out of scope.

`"Other"` uses a neutral fill that doesn't compete with named colors:
`alpha(theme.palette.text.secondary, 0.25)`.

## Empty / error states

- `devices` is empty or every leaf totals to zero → return `null`. The
  page already has a higher-level `<Alert severity="info">{noData}</Alert>`
  fallback when `stackedSeries.length === 0`, so a quiet no-render is the
  right behavior here (no duplicate empty card).
- `deltasByStat` has no entries for a leaf → the leaf totals to zero,
  filtered out by the top-N step.

## i18n

Add two keys to `web/src/locales/en.json` and `web/src/locales/de.json`,
under the existing `electricity` namespace:

| Key                              | English             | German       |
|----------------------------------|---------------------|--------------|
| `electricity.devicesOverTime`    | `Devices over time` | `Geräte im Zeitverlauf` |
| `electricity.otherDevices`       | `Other`             | `Sonstige`   |

## Verification

There is no test suite (per `CLAUDE.md`). Verify manually:

- `cd web && npm run lint` exits 0.
- `cd web && npm run dev`, then on the Electricity page:
  - With a multi-device instance, confirm a new stacked bar chart appears
    between the grid in/out chart and the device totals bar chart.
  - Confirm the top device's color in the new chart matches its color in
    the totals chart below.
  - Toggle the resolution between hour and 5-minute on a short range:
    the new chart's bars refine the same way the existing stacked chart
    does.
  - Pick a multi-day range that triggers daily aggregation; bars collapse
    to daily and the device segments still stack correctly.
  - Switch language to German; title and `"Other"` label translate.
  - Hover a stacked segment: the existing `HourlyBarChart` tooltip lists
    each device's contribution. (No new tooltip code.)

## Risks and trade-offs

- **Color stability across page renders.** Because both charts sort by
  current-range totals, a device that drops out of the top N (or moves up
  the order) will swap colors. Acceptable for now; a stat-id-keyed palette
  is the future-proof fix.
- **"Other" hides individual spikes.** If a non-top device spikes briefly,
  it disappears into "Other". Acceptable because the totals bar chart
  immediately below shows every device. The page is the explanation; the
  chart is the entry point.
- **8 colors is the practical ceiling of `BAR_TINTS` legibility.** If a
  user has fewer than 8 leaf devices, "Other" is just absent — the chart
  shows all of them with no bucket. No special case needed.

## Files touched

- **Create:** `web/src/components/DeviceHourlyChart.jsx`
- **Modify:** `web/src/pages/Electricity.jsx` (import + render the new
  component between the grid in/out chart and `DeviceKwhBarChart`)
- **Modify:** `web/src/locales/en.json`, `web/src/locales/de.json` (two
  new keys each)
