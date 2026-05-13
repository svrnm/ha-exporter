# Gas Page Therme Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `web/src/pages/Gas.jsx` into a two-section "consumption + efficiency" view that integrates four Weishaupt therme state entities (heat energy, burner phase, DHW pump, outside temp) and adds an hour/5-minute granularity toggle on par with the Electricity page.

**Architecture:** All new derived series are computed client-side. A new pure-function module `web/src/api/thermeModel.js` produces per-bucket aggregates from raw `/states` history. The page composes those with the existing `useEnergyBundle` gas data via a single `useMemo`. A new small component `BurnerTimelineStrip` renders burner-on intensity per bucket. No server changes, no schema changes.

**Tech Stack:** React 19, plain JS (no TypeScript), Vite 8, MUI 9 + Emotion (dark theme `palette.energy.gas`), TanStack Query, Recharts, `react-i18next`. Repo has no test framework — verification is via a one-off Node script for helper math, then manual dev-server inspection per `CLAUDE.md`.

**Spec:** `docs/superpowers/specs/2026-05-13-gas-page-therme-design.md`. One amendment locked in by reading the server: `GET /states` returns only rows strictly within `[start, end)` — there is no anchor row. The helpers therefore use conservative defaults for the period before the first in-range row (categorical signals = `off`, continuous = first in-range value).

**File map:**
- Create: `web/src/api/thermeModel.js` — pure bucketing helpers.
- Create: `web/scripts/check-therme-helpers.mjs` — manual verification driver.
- Create: `web/src/components/BurnerTimelineStrip.jsx` — small visual component.
- Modify: `web/src/pages/Gas.jsx` — full rewrite, ~250 LOC final.
- Modify: `web/src/locales/en.json`, `web/src/locales/de.json` — new keys.

`formatNumber` **already exists** in `web/src/format.js`; do not re-add it.

---

## Task 1: Bucket grid helper

The single source of truth for bucket boundaries. UTC-aligned, matches HA's recorder grid (top-of-hour for `hour`, multiples of 5 minutes for `5minute`). Used by every other helper plus the strip component.

**Files:**
- Create: `web/src/api/thermeModel.js`

- [ ] **Step 1: Create the file with `bucketsForRange`**

```js
// web/src/api/thermeModel.js
//
// Client-side helpers for the Gas page's "Heat & efficiency" section.
//
// All bucketing is UTC-aligned so the new derived series line up with HA's
// long-term statistics grid (top-of-hour or 5-minute slots). Display
// localisation happens in the chart layer, never here.

const PERIOD_MS = {
  hour: 3_600_000,
  '5minute': 300_000,
};

/**
 * Produce the bucket grid for a range at a given period.
 *
 * @param {string} startIso  Inclusive UTC ISO start.
 * @param {string} endIso    Exclusive UTC ISO end.
 * @param {'hour'|'5minute'} period
 * @returns {Array<{ start: string, end: string }>}  Sorted, contiguous.
 */
export function bucketsForRange(startIso, endIso, period) {
  const step = PERIOD_MS[period];
  if (!step) return [];
  const t0 = Date.parse(startIso);
  const t1 = Date.parse(endIso);
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return [];
  const floored = Math.floor(t0 / step) * step;
  const out = [];
  for (let ms = floored; ms < t1; ms += step) {
    out.push({
      start: new Date(ms).toISOString(),
      end: new Date(ms + step).toISOString(),
    });
  }
  return out;
}
```

- [ ] **Step 2: Create the verification driver**

```bash
mkdir -p web/scripts
```

```js
// web/scripts/check-therme-helpers.mjs
//
// Manual driver for thermeModel.js. Repo has no test framework (see
// CLAUDE.md). Run with:
//
//   node web/scripts/check-therme-helpers.mjs
//
// Spot-check the printed totals against the known burner runs on 2026-05-10.

import { bucketsForRange } from '../src/api/thermeModel.js';

const grid = bucketsForRange(
  '2026-05-10T00:00:00Z',
  '2026-05-11T00:00:00Z',
  'hour',
);

console.log('grid length (hour, 1 day):', grid.length);
console.log('grid[0]:', grid[0]);
console.log('grid[grid.length - 1]:', grid[grid.length - 1]);

const fiveMin = bucketsForRange(
  '2026-05-10T04:00:00Z',
  '2026-05-10T05:00:00Z',
  '5minute',
);
console.log('grid length (5min, 1 hour):', fiveMin.length);
```

- [ ] **Step 3: Run the driver and verify**

Run: `node web/scripts/check-therme-helpers.mjs`
Expected output (exact):
```
grid length (hour, 1 day): 24
grid[0]: { start: '2026-05-10T00:00:00.000Z', end: '2026-05-10T01:00:00.000Z' }
grid[grid.length - 1]: { start: '2026-05-10T23:00:00.000Z', end: '2026-05-11T00:00:00.000Z' }
grid length (5min, 1 hour): 12
```

- [ ] **Step 4: Commit**

```bash
git add web/src/api/thermeModel.js web/scripts/check-therme-helpers.mjs
git commit -m "feat(web): add thermeModel.bucketsForRange + verification driver"
```

---

## Task 2: `bucketHeatEnergyKwh`

Sums per-push deltas from `sensor.weishaupt_warmeenergie` into kWh per bucket. Negatives pass through (the sensor genuinely emits them — see sample data on 2026-05-10 around 02:55). Empty buckets are `0`, not `null` (silent burner = no heat, not "unknown").

**Files:**
- Modify: `web/src/api/thermeModel.js`
- Modify: `web/scripts/check-therme-helpers.mjs`

- [ ] **Step 1: Add `bucketHeatEnergyKwh` to thermeModel.js**

Append to `web/src/api/thermeModel.js`:

```js
/**
 * Parse the `state` field from a state-history row to a number.
 * Tolerates trailing whitespace and EU decimals (HA sometimes emits ",").
 */
function parseStateNumber(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s === '' || s === 'unknown' || s === 'unavailable') return null;
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

/**
 * Sum `weishaupt_warmeenergie` per-push deltas (Wh-ish) into kWh per bucket.
 *
 * The sensor emits a delta on every collector push: positive bursts during
 * burner runs, occasional small negatives, zero when idle. We just sum and
 * divide by 1000. Buckets with no rows are emitted as 0 kWh — a silent
 * burner is genuinely "no heat delivered", not "unknown".
 *
 * @param {Array<{ last_changed: string, state: string }>} states  Sorted ASC.
 * @param {Array<{ start: string, end: string }>} bucketGrid
 * @returns {Array<{ start: string, value: number }>}
 */
export function bucketHeatEnergyKwh(states, bucketGrid) {
  if (!Array.isArray(bucketGrid) || bucketGrid.length === 0) return [];
  const sums = new Array(bucketGrid.length).fill(0);
  if (!Array.isArray(states) || states.length === 0) {
    return bucketGrid.map((b, i) => ({ start: b.start, value: sums[i] }));
  }
  const bucketStarts = bucketGrid.map((b) => Date.parse(b.start));
  const bucketEnd = Date.parse(bucketGrid[bucketGrid.length - 1].end);
  for (const row of states) {
    const t = Date.parse(row.last_changed);
    if (!Number.isFinite(t)) continue;
    if (t < bucketStarts[0] || t >= bucketEnd) continue;
    const v = parseStateNumber(row.state);
    if (v == null) continue;
    // Binary search: find last bucket whose start <= t.
    let lo = 0;
    let hi = bucketStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (bucketStarts[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    sums[lo] += v;
  }
  return bucketGrid.map((b, i) => ({ start: b.start, value: sums[i] / 1000 }));
}
```

- [ ] **Step 2: Extend the driver to spot-check**

Append to `web/scripts/check-therme-helpers.mjs`:

```js
import { bucketHeatEnergyKwh } from '../src/api/thermeModel.js';

// Subset of sensor.weishaupt_warmeenergie state changes on 2026-05-10
// (taken from the user-provided sample). Burner ran roughly 04:20-04:33,
// 06:16-06:32, 10:18-10:35, 15:36-15:53, 18:20-18:39.
const heatStates = [
  { last_changed: '2026-05-10T02:54:34.472Z', state: '656.30' },
  { last_changed: '2026-05-10T02:57:14.394Z', state: '525.32' },
  { last_changed: '2026-05-10T02:58:18.383Z', state: '123.30' },
  { last_changed: '2026-05-10T02:59:22.291Z', state: '-370.20' },
  { last_changed: '2026-05-10T04:20:26.382Z', state: '708.00' },
  { last_changed: '2026-05-10T04:20:58.430Z', state: '1160.38' },
  { last_changed: '2026-05-10T04:22:02.227Z', state: '43.93' },
  { last_changed: '2026-05-10T04:24:10.412Z', state: '-1381.72' },
  { last_changed: '2026-05-10T04:26:18.281Z', state: '859.13' },
  { last_changed: '2026-05-10T04:26:50.404Z', state: '507.78' },
  { last_changed: '2026-05-10T10:18:54.350Z', state: '526.62' },
  { last_changed: '2026-05-10T10:19:26.314Z', state: '1338.01' },
];

const kwh = bucketHeatEnergyKwh(heatStates, grid);
const nonZero = kwh.filter((k) => k.value !== 0);
console.log('\nbucketHeatEnergyKwh non-zero buckets:');
for (const k of nonZero) console.log(`  ${k.start}  ${k.value.toFixed(3)} kWh`);
```

- [ ] **Step 3: Run the driver and verify**

Run: `node web/scripts/check-therme-helpers.mjs`
Expected: at least three non-zero buckets at `02:00`, `04:00`, `10:00` UTC on 2026-05-10. The `04:00` bucket sums positives + the `-1381.72` glitch, so the value is in the low single digits of kWh (around `+1.9 kWh`). No errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/api/thermeModel.js web/scripts/check-therme-helpers.mjs
git commit -m "feat(web): add thermeModel.bucketHeatEnergyKwh"
```

---

## Task 3: `bucketBurnerMinutes`

Walks state-change history for `sensor.weishaupt_wtc_kessel_betriebsphase_brenner` and integrates "minutes burner was on" per bucket. A segment that straddles bucket boundaries is split. Pre-first-row state defaults to **off** (conservative: avoids inflating early-morning buckets when state retention is short).

**Files:**
- Modify: `web/src/api/thermeModel.js`
- Modify: `web/scripts/check-therme-helpers.mjs`

- [ ] **Step 1: Add `bucketBurnerMinutes` to thermeModel.js**

Append:

```js
/**
 * True when a burner-phase state string indicates active combustion.
 * HA emits German strings verbatim; "Brenner ein: …" covers Regelbetrieb,
 * Steuerbetrieb, etc. Nachbelüftung and Brenner aus are off.
 */
export function isBurnerOnState(state) {
  if (typeof state !== 'string') return false;
  return state.startsWith('Brenner ein');
}

/**
 * Minutes the burner spent in any "Brenner ein: …" phase per bucket.
 *
 * Treats the state before the first in-range row as off (the GET /states
 * endpoint does not include an anchor row, so we cannot know — assuming
 * off is the conservative default that avoids inflating overnight buckets).
 * A segment crossing bucket boundaries is split proportionally.
 *
 * @param {Array<{ last_changed: string, state: string }>} states  Sorted ASC.
 * @param {Array<{ start: string, end: string }>} bucketGrid
 * @returns {Array<{ start: string, value: number }>}  Minutes per bucket.
 */
export function bucketBurnerMinutes(states, bucketGrid) {
  if (!Array.isArray(bucketGrid) || bucketGrid.length === 0) return [];
  const minutes = new Array(bucketGrid.length).fill(0);
  if (!Array.isArray(states) || states.length === 0) {
    return bucketGrid.map((b, i) => ({ start: b.start, value: minutes[i] }));
  }
  const rangeStart = Date.parse(bucketGrid[0].start);
  const rangeEnd = Date.parse(bucketGrid[bucketGrid.length - 1].end);
  // Build (t, on) transitions. Pre-first-row state defaults to off.
  /** @type {Array<{ t: number, on: boolean }>} */
  const transitions = [];
  for (const row of states) {
    const t = Date.parse(row.last_changed);
    if (!Number.isFinite(t)) continue;
    transitions.push({ t, on: isBurnerOnState(row.state) });
  }
  if (transitions.length === 0) {
    return bucketGrid.map((b, i) => ({ start: b.start, value: minutes[i] }));
  }
  // Iterate consecutive (current → next) segments, clipped to range.
  let segStart = rangeStart;
  let segOn = false;
  for (let i = 0; i < transitions.length; i++) {
    const tr = transitions[i];
    if (tr.t > rangeEnd) break;
    const segEnd = Math.min(tr.t, rangeEnd);
    if (segOn && segEnd > segStart) {
      distributeMinutes(minutes, bucketGrid, segStart, segEnd);
    }
    segStart = Math.max(tr.t, rangeStart);
    segOn = tr.on;
  }
  if (segOn && segStart < rangeEnd) {
    distributeMinutes(minutes, bucketGrid, segStart, rangeEnd);
  }
  return bucketGrid.map((b, i) => ({ start: b.start, value: minutes[i] }));
}

/**
 * Add `(segEndMs - segStartMs) / 60000` minutes to the buckets the segment
 * overlaps, splitting at boundaries. Internal helper for bucketBurnerMinutes
 * (and reused for the DHW/heating split in a later task).
 */
function distributeMinutes(out, bucketGrid, segStartMs, segEndMs) {
  for (let i = 0; i < bucketGrid.length; i++) {
    const bs = Date.parse(bucketGrid[i].start);
    const be = Date.parse(bucketGrid[i].end);
    if (segEndMs <= bs) break;
    if (segStartMs >= be) continue;
    const overlap = Math.min(segEndMs, be) - Math.max(segStartMs, bs);
    if (overlap > 0) out[i] += overlap / 60_000;
  }
}
```

- [ ] **Step 2: Extend the driver**

Append to `web/scripts/check-therme-helpers.mjs`:

```js
import { bucketBurnerMinutes } from '../src/api/thermeModel.js';

// Burner phase transitions on 2026-05-10 (compressed).
const burnerStates = [
  { last_changed: '2026-05-10T02:54:34.469Z', state: 'Brenner ein: Regelbetrieb' },
  { last_changed: '2026-05-10T02:59:22.281Z', state: 'Nachbelüftung' },
  { last_changed: '2026-05-10T02:59:54.396Z', state: 'Brenner aus' },
  { last_changed: '2026-05-10T04:20:26.378Z', state: 'Brenner ein: Regelbetrieb' },
  { last_changed: '2026-05-10T04:24:10.410Z', state: 'Brenner aus' },
  { last_changed: '2026-05-10T04:26:18.279Z', state: 'Brenner ein: Regelbetrieb' },
  { last_changed: '2026-05-10T04:32:42.238Z', state: 'Brenner aus' },
  { last_changed: '2026-05-10T06:16:45.325Z', state: 'Brenner ein: Regelbetrieb' },
  { last_changed: '2026-05-10T06:28:29.369Z', state: 'Brenner aus' },
  { last_changed: '2026-05-10T10:18:54.346Z', state: 'Brenner ein: Regelbetrieb' },
  { last_changed: '2026-05-10T10:32:46.179Z', state: 'Brenner aus' },
  { last_changed: '2026-05-10T15:36:48.269Z', state: 'Brenner ein: Regelbetrieb' },
  { last_changed: '2026-05-10T15:50:41.199Z', state: 'Brenner aus' },
  { last_changed: '2026-05-10T18:20:34.145Z', state: 'Brenner ein: Regelbetrieb' },
  { last_changed: '2026-05-10T18:36:34.379Z', state: 'Brenner aus' },
];

const burnerMin = bucketBurnerMinutes(burnerStates, grid);
const totalMin = burnerMin.reduce((s, r) => s + r.value, 0);
console.log('\nbucketBurnerMinutes total on 2026-05-10:', totalMin.toFixed(1), 'min');
console.log('non-zero buckets:');
for (const r of burnerMin.filter((b) => b.value > 0)) {
  console.log(`  ${r.start}  ${r.value.toFixed(2)} min`);
}
```

- [ ] **Step 3: Run the driver and verify**

Run: `node web/scripts/check-therme-helpers.mjs`
Expected:
- Total burner minutes is in the range **50–70** (sum of all on/off pairs above). Each pair spans 4–17 minutes; six runs → roughly 60 minutes total.
- Non-zero buckets cluster at `02:00`, `04:00`, `06:00`, `10:00`, `15:00`, `18:00` UTC.
- No bucket exceeds 60 minutes.

- [ ] **Step 4: Commit**

```bash
git add web/src/api/thermeModel.js web/scripts/check-therme-helpers.mjs
git commit -m "feat(web): add thermeModel.bucketBurnerMinutes + isBurnerOnState"
```

---

## Task 4: `splitGasByPurpose` and `averageOutsideTemp`

Two more helpers in one task — both intersect with state-change history and reuse the segment logic from Task 3.

**Files:**
- Modify: `web/src/api/thermeModel.js`
- Modify: `web/scripts/check-therme-helpers.mjs`

- [ ] **Step 1: Add `splitGasByPurpose`**

Append:

```js
/**
 * Apportion m³ of gas per bucket into DHW vs heating.
 *
 * Algorithm: within each bucket, compute total burner-on time and the
 * subset of burner-on time that overlapped with `pumpe_warmwasser = Ein`.
 * Apportion the bucket's m³ by that fraction. If burner data is missing
 * for a bucket (no on-time), fall back to "all heating" (= gas going to
 * a brief preheat / standby — uncommon enough to bias toward heating).
 *
 * @param {Array<{ start: string, value: number }>} gasDeltas  m³ per bucket.
 * @param {Array<{ last_changed: string, state: string }>} pumpStates  Sorted ASC.
 * @param {Array<{ last_changed: string, state: string }>} burnerStates  Sorted ASC.
 * @param {Array<{ start: string, end: string }>} bucketGrid
 * @returns {Array<{ start: string, dhw: number, heating: number }>}
 */
export function splitGasByPurpose(gasDeltas, pumpStates, burnerStates, bucketGrid) {
  if (!Array.isArray(bucketGrid) || bucketGrid.length === 0) return [];
  const gasByStart = new Map(
    (gasDeltas ?? []).map((d) => [d.start, Number(d.value) || 0]),
  );
  const burnerOnPerBucket = new Array(bucketGrid.length).fill(0);
  const burnerOnAndDhwPerBucket = new Array(bucketGrid.length).fill(0);
  const rangeStart = Date.parse(bucketGrid[0].start);
  const rangeEnd = Date.parse(bucketGrid[bucketGrid.length - 1].end);

  // Walk both transition streams together. State before the first in-range
  // row defaults to off (burner) / off (pump).
  const burnerTr = transitions(burnerStates, isBurnerOnState);
  const pumpTr = transitions(pumpStates, isPumpOnState);

  // Generate combined segments by merging timestamps.
  const eventTimes = new Set([rangeStart, rangeEnd]);
  for (const tr of burnerTr) if (tr.t >= rangeStart && tr.t <= rangeEnd) eventTimes.add(tr.t);
  for (const tr of pumpTr) if (tr.t >= rangeStart && tr.t <= rangeEnd) eventTimes.add(tr.t);
  const sortedTimes = Array.from(eventTimes).sort((a, b) => a - b);

  let bIdx = 0;
  let pIdx = 0;
  let burnerOn = false;
  let pumpOn = false;
  // Prime: replay transitions at exactly rangeStart (if any).
  while (bIdx < burnerTr.length && burnerTr[bIdx].t <= rangeStart) {
    burnerOn = burnerTr[bIdx].on;
    bIdx++;
  }
  while (pIdx < pumpTr.length && pumpTr[pIdx].t <= rangeStart) {
    pumpOn = pumpTr[pIdx].on;
    pIdx++;
  }

  for (let i = 0; i + 1 < sortedTimes.length; i++) {
    const segStart = sortedTimes[i];
    const segEnd = sortedTimes[i + 1];
    if (segEnd <= segStart) continue;
    if (burnerOn) {
      distributeMinutes(burnerOnPerBucket, bucketGrid, segStart, segEnd);
      if (pumpOn) {
        distributeMinutes(burnerOnAndDhwPerBucket, bucketGrid, segStart, segEnd);
      }
    }
    // Advance burnerOn / pumpOn past segEnd.
    while (bIdx < burnerTr.length && burnerTr[bIdx].t <= segEnd) {
      burnerOn = burnerTr[bIdx].on;
      bIdx++;
    }
    while (pIdx < pumpTr.length && pumpTr[pIdx].t <= segEnd) {
      pumpOn = pumpTr[pIdx].on;
      pIdx++;
    }
  }

  return bucketGrid.map((b, i) => {
    const total = gasByStart.get(b.start) ?? 0;
    const on = burnerOnPerBucket[i];
    if (on <= 0) return { start: b.start, dhw: 0, heating: total };
    const dhwShare = burnerOnAndDhwPerBucket[i] / on;
    const dhw = total * dhwShare;
    return { start: b.start, dhw, heating: total - dhw };
  });
}

function transitions(states, predicate) {
  const out = [];
  if (!Array.isArray(states)) return out;
  for (const row of states) {
    const t = Date.parse(row.last_changed);
    if (!Number.isFinite(t)) continue;
    out.push({ t, on: predicate(row.state) });
  }
  return out;
}

/** True when the DHW pump state string is "Ein". */
export function isPumpOnState(state) {
  return typeof state === 'string' && state.trim() === 'Ein';
}
```

- [ ] **Step 2: Add `averageOutsideTemp`**

Append:

```js
/**
 * Time-weighted mean outside temperature per bucket.
 *
 * Temperature is continuous, so an empty bucket inherits the value of the
 * most recent row before it (forward-fill). For the period before the
 * first in-range row we use the *first* in-range value (backward-fill at
 * the start), which is correct unless the temperature changed sharply
 * just before `range.start`.
 *
 * @param {Array<{ last_changed: string, state: string }>} states  Sorted ASC.
 * @param {Array<{ start: string, end: string }>} bucketGrid
 * @returns {Array<{ start: string, value: number | null }>}
 */
export function averageOutsideTemp(states, bucketGrid) {
  if (!Array.isArray(bucketGrid) || bucketGrid.length === 0) return [];
  if (!Array.isArray(states) || states.length === 0) {
    return bucketGrid.map((b) => ({ start: b.start, value: null }));
  }
  const tr = [];
  for (const row of states) {
    const t = Date.parse(row.last_changed);
    const v = parseStateNumber(row.state);
    if (!Number.isFinite(t) || v == null) continue;
    tr.push({ t, v });
  }
  if (tr.length === 0) {
    return bucketGrid.map((b) => ({ start: b.start, value: null }));
  }
  return bucketGrid.map((b) => {
    const bs = Date.parse(b.start);
    const be = Date.parse(b.end);
    // Build segments within [bs, be) using forward-fill semantics.
    let cursor = bs;
    // Initial value: last tr before bs, else first tr.
    let curVal = tr[0].v;
    let idx = 0;
    while (idx < tr.length && tr[idx].t <= bs) {
      curVal = tr[idx].v;
      idx++;
    }
    let weighted = 0;
    while (idx < tr.length && tr[idx].t < be) {
      weighted += (tr[idx].t - cursor) * curVal;
      cursor = tr[idx].t;
      curVal = tr[idx].v;
      idx++;
    }
    weighted += (be - cursor) * curVal;
    return { start: b.start, value: weighted / (be - bs) };
  });
}
```

- [ ] **Step 3: Extend the driver**

Append to `web/scripts/check-therme-helpers.mjs`:

```js
import { splitGasByPurpose, averageOutsideTemp } from '../src/api/thermeModel.js';

// Synthetic gas deltas in m³ for the same 24-hour window, with non-zero
// values placed in the buckets where the burner ran in our subset.
const gasDeltas = grid.map((b) => ({
  start: b.start,
  value: b.start.includes('T04:') ? 0.18
    : b.start.includes('T06:') ? 0.13
    : b.start.includes('T10:') ? 0.16
    : b.start.includes('T15:') ? 0.14
    : b.start.includes('T18:') ? 0.13
    : 0,
}));

// DHW pump transitions extracted from the sample (Aus → Ein at burner-on
// of each DHW cycle, Ein → Aus when the cycle ends).
const pumpStates = [
  { last_changed: '2026-05-10T04:20:26.378Z', state: 'Ein' },
  { last_changed: '2026-05-10T04:32:42.238Z', state: 'Aus' },
  { last_changed: '2026-05-10T06:16:45.325Z', state: 'Ein' },
  { last_changed: '2026-05-10T06:28:29.369Z', state: 'Aus' },
  { last_changed: '2026-05-10T10:18:54.346Z', state: 'Ein' },
  { last_changed: '2026-05-10T10:35:26.226Z', state: 'Aus' },
  { last_changed: '2026-05-10T15:36:48.268Z', state: 'Ein' },
  { last_changed: '2026-05-10T15:53:21.202Z', state: 'Aus' },
  { last_changed: '2026-05-10T18:20:34.145Z', state: 'Ein' },
  { last_changed: '2026-05-10T18:39:14.302Z', state: 'Aus' },
];

const split = splitGasByPurpose(gasDeltas, pumpStates, burnerStates, grid);
console.log('\nsplitGasByPurpose non-zero buckets:');
for (const r of split.filter((s) => s.dhw + s.heating > 0)) {
  console.log(
    `  ${r.start}  dhw=${r.dhw.toFixed(3)}  heating=${r.heating.toFixed(3)}`,
  );
}

const outsideStates = [
  { last_changed: '2026-05-10T00:00:00Z', state: '16.5' },
  { last_changed: '2026-05-10T06:00:00Z', state: '19.5' },
  { last_changed: '2026-05-10T09:00:00Z', state: '25.0' },
  { last_changed: '2026-05-10T18:00:00Z', state: '22.5' },
  { last_changed: '2026-05-10T22:00:00Z', state: '20.0' },
];
const avgT = averageOutsideTemp(outsideStates, grid);
console.log('\naverageOutsideTemp first/last few buckets:');
for (const r of avgT.slice(0, 3).concat(avgT.slice(-2))) {
  console.log(`  ${r.start}  ${r.value == null ? '—' : r.value.toFixed(2)} °C`);
}
```

- [ ] **Step 4: Run the driver and verify**

Run: `node web/scripts/check-therme-helpers.mjs`
Expected (with the synthetic 04 / 06 / 10 / 15 / 18 burner runs all running with the pump on):
- All five non-zero buckets in `splitGasByPurpose` show `dhw` close to the full value (DHW share ≈ 100 %, because in this sample the burner only ran when the pump was on). `heating` is ~0 for those buckets.
- `averageOutsideTemp` shows monotonically increasing values from ~16 °C at start to a midday peak above 20 °C and back down. No `—`.

- [ ] **Step 5: Commit**

```bash
git add web/src/api/thermeModel.js web/scripts/check-therme-helpers.mjs
git commit -m "feat(web): add thermeModel.splitGasByPurpose + averageOutsideTemp"
```

---

## Task 5: `BurnerTimelineStrip` component

Compact bucket-aligned row that visualises burner-on intensity.

**Files:**
- Create: `web/src/components/BurnerTimelineStrip.jsx`

- [ ] **Step 1: Create the component**

```jsx
// web/src/components/BurnerTimelineStrip.jsx
import { Box, Paper, Stack, Tooltip, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { formatHour, formatDay, formatNumber } from '../format.js';
import { isDailyAggregateRange } from './RangePicker.jsx';

/**
 * Visualise burner-on minutes per bucket as a row of intensity-shaded cells.
 *
 * @param {{
 *   title: string,
 *   buckets: Array<{ start: string, end: string }>,
 *   minutesByStart: Map<string, number>,
 *   bucketDurationMinutes: number,
 *   range: string,
 * }} props
 */
export function BurnerTimelineStrip({
  title,
  buckets,
  minutesByStart,
  bucketDurationMinutes,
  range,
}) {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const dailyAggregate = isDailyAggregateRange(range);
  const accent = theme.palette.energy?.gas ?? theme.palette.primary.main;

  if (!buckets.length) return null;

  return (
    <Paper sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack spacing={1.25}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: `repeat(${buckets.length}, 1fr)`,
            gap: '2px',
            width: '100%',
            height: 28,
          }}
        >
          {buckets.map((b) => {
            const minutes = minutesByStart.get(b.start) ?? 0;
            const intensity = Math.min(1, minutes / bucketDurationMinutes);
            const bg =
              intensity > 0
                ? alpha(accent, 0.15 + 0.75 * intensity)
                : alpha(theme.palette.divider, 0.3);
            const label = dailyAggregate
              ? formatDay(b.start, lng)
              : formatHour(b.start, lng);
            return (
              <Tooltip
                key={b.start}
                title={t('gas.burner.tooltip', {
                  bucket: label,
                  minutes: formatNumber(minutes, lng, {
                    maximumFractionDigits: 1,
                  }),
                })}
                disableInteractive
                arrow
              >
                <Box sx={{ bgcolor: bg, borderRadius: '2px' }} />
              </Tooltip>
            );
          })}
        </Box>
      </Stack>
    </Paper>
  );
}
```

- [ ] **Step 2: Lint**

Run: `cd web && npm run lint`
Expected: no errors. (The component does not yet have a caller, but `eslint` will only complain about syntax/unused symbols within the file.)

- [ ] **Step 3: Commit**

```bash
git add web/src/components/BurnerTimelineStrip.jsx
git commit -m "feat(web): add BurnerTimelineStrip component"
```

---

## Task 6: i18n keys

Add all required keys in one shot so subsequent UI tasks can reference them without lint failures on missing keys. German is first-class per `CLAUDE.md`.

**Files:**
- Modify: `web/src/locales/en.json`
- Modify: `web/src/locales/de.json`

- [ ] **Step 1: Replace the `gas` block in `en.json`**

Find the current `"gas": { "title": "Gas usage", "totalRange": "Total for range" }` block. Replace with:

```json
  "gas": {
    "title": "Gas usage",
    "totalRange": "Total for range",
    "section": {
      "consumption": "Consumption",
      "efficiency": "Heat & efficiency"
    },
    "granularity": {
      "label": "Resolution",
      "hour": "Hourly",
      "5minute": "5 minute"
    },
    "consumptionChart": "Gas use, DHW vs heating",
    "kwhThermalChart": "Heat delivered",
    "burnerTimeline": "Burner activity",
    "outsideOverlay": "Outside temperature",
    "kwhThermal": "Heat delivered",
    "kwhPerM3": "kWh per m³",
    "burnerMinutes": "Burner minutes",
    "avgOutside": "Avg outside temperature",
    "dhwShare": "DHW share",
    "enableThermeHint": "Add the Weishaupt sensors to the integration's extra entities (warmeenergie, betriebsphase_brenner, pumpe_warmwasser, aussentemperatur) to unlock heat-delivered, burner-on, DHW/heating split and outside-temperature context.",
    "stateHistoryShortHint": "State history is only retained for {{days}} days on this server. The Weishaupt overlays only render for the days that fit in that window.",
    "burner": {
      "tooltip": "{{bucket}}: burner on {{minutes}} min"
    },
    "legend": {
      "dhw": "Hot water",
      "heating": "Heating"
    }
  },
```

- [ ] **Step 2: Add the missing units keys to `en.json`**

Find the `units` block. Add inside it (alongside the existing `m3`, `kwh`, etc.):

```json
    "degC": "°C",
    "kwhPerM3": "kWh/m³",
    "minutes": "min"
```

- [ ] **Step 3: Replace the `gas` block in `de.json`**

```json
  "gas": {
    "title": "Gasverbrauch",
    "totalRange": "Summe im Zeitraum",
    "section": {
      "consumption": "Verbrauch",
      "efficiency": "Wärme & Effizienz"
    },
    "granularity": {
      "label": "Auflösung",
      "hour": "Stündlich",
      "5minute": "5 Minuten"
    },
    "consumptionChart": "Gasverbrauch, Warmwasser vs. Heizung",
    "kwhThermalChart": "Gelieferte Wärme",
    "burnerTimeline": "Brennerbetrieb",
    "outsideOverlay": "Außentemperatur",
    "kwhThermal": "Gelieferte Wärme",
    "kwhPerM3": "kWh pro m³",
    "burnerMinutes": "Brennerminuten",
    "avgOutside": "Ø Außentemperatur",
    "dhwShare": "Anteil Warmwasser",
    "enableThermeHint": "Füge die Weishaupt-Sensoren in der Integration als zusätzliche Entitäten hinzu (warmeenergie, betriebsphase_brenner, pumpe_warmwasser, aussentemperatur), um gelieferte Wärme, Brennerlaufzeit, Warmwasser/Heizungs-Aufteilung und Außentemperatur-Kontext zu sehen.",
    "stateHistoryShortHint": "Zustandshistorie wird auf diesem Server nur {{days}} Tage aufbewahrt. Die Weishaupt-Auswertungen erscheinen nur für Tage innerhalb dieses Fensters.",
    "burner": {
      "tooltip": "{{bucket}}: Brenner ein {{minutes}} Min"
    },
    "legend": {
      "dhw": "Warmwasser",
      "heating": "Heizung"
    }
  },
```

- [ ] **Step 4: Add the missing units keys to `de.json`**

```json
    "degC": "°C",
    "kwhPerM3": "kWh/m³",
    "minutes": "Min"
```

- [ ] **Step 5: Verify the JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('web/src/locales/en.json','utf8')); JSON.parse(require('fs').readFileSync('web/src/locales/de.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 6: Commit**

```bash
git add web/src/locales/en.json web/src/locales/de.json
git commit -m "i18n(web): add gas page therme keys (en + de)"
```

---

## Task 7: Gas page rewrite — toolbar, hooks, derived data

This rewrites `web/src/pages/Gas.jsx` end-to-end. The UI is added in two stages (Consumption section first, then Heat & efficiency) but the file is overwritten in one go because keeping a half-rewritten file building is more annoying than overwriting cleanly with feature flags off.

**Files:**
- Modify: `web/src/pages/Gas.jsx`

- [ ] **Step 1: Replace the file contents**

```jsx
// web/src/pages/Gas.jsx
import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
import ShowerIcon from '@mui/icons-material/Shower';
import ThermostatIcon from '@mui/icons-material/Thermostat';
import WhatshotIcon from '@mui/icons-material/Whatshot';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';
import PercentIcon from '@mui/icons-material/Percent';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { alpha, useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { useInstance } from '../layout/InstanceContext.jsx';
import { useEnergyBundle, useManyStates } from '../api/hooks.js';
import {
  allowsFiveMinuteForRange,
  isDailyAggregateRange,
  RangePicker,
  RANGES,
  StickyDateToolbar,
  resolveRange,
} from '../components/RangePicker.jsx';
import { HourlyBarChart } from '../components/HourlyBarChart.jsx';
import { BurnerTimelineStrip } from '../components/BurnerTimelineStrip.jsx';
import { StatCard } from '../components/StatCard.jsx';
import { formatDay, formatHour, formatKwh, formatNumber } from '../format.js';
import { useUrlSyncedRange } from '../hooks/useUrlSyncedRange.js';
import {
  averageOutsideTemp,
  bucketBurnerMinutes,
  bucketHeatEnergyKwh,
  bucketsForRange,
  splitGasByPurpose,
} from '../api/thermeModel.js';

const WARMEENERGIE = 'sensor.weishaupt_warmeenergie';
const BURNER_PHASE = 'sensor.weishaupt_wtc_kessel_betriebsphase_brenner';
const DHW_PUMP = 'sensor.weishaupt_systemgerat_pumpe_warmwasser';
const OUTSIDE_TEMP = 'sensor.weishaupt_systemgerat_aussentemperatur';
const THERME_ENTITY_IDS = [WARMEENERGIE, BURNER_PHASE, DHW_PUMP, OUTSIDE_TEMP];

const OUTSIDE_OVERLAY_MAX_DAYS = 3;

export function Gas() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const lng = i18n.language;
  const { selected } = useInstance();
  const [range, setRange] = useUrlSyncedRange();
  const [resolution, setResolution] = useState('hour');
  const { start, end } = useMemo(() => resolveRange(range), [range]);

  const effectiveResolution = allowsFiveMinuteForRange(range) ? resolution : 'hour';

  const { model, stats } = useEnergyBundle(selected, start, end, {
    period: effectiveResolution,
  });

  const therme = useManyStates(
    selected,
    THERME_ENTITY_IDS,
    start,
    end,
  );

  const statesByEntity = useMemo(() => {
    const m = new Map();
    for (const r of therme.results) {
      if (r.data?.states) m.set(r.entityId, r.data.states);
    }
    return m;
  }, [therme.results]);

  const features = useMemo(() => {
    const has = (id) => (statesByEntity.get(id)?.length ?? 0) > 0;
    return {
      hasWarmeenergie: has(WARMEENERGIE),
      hasBurner: has(BURNER_PHASE),
      hasPump: has(DHW_PUMP),
      hasOutside: has(OUTSIDE_TEMP),
    };
  }, [statesByEntity]);

  const gasStats = model?.gas ?? [];

  const byStat = useMemo(() => {
    const map = new Map();
    for (const r of stats.results) if (r.data) map.set(r.statId, r.data);
    return map;
  }, [stats.results]);

  const derived = useMemo(() => {
    if (!start || !end) return null;
    const grid = bucketsForRange(start, end, effectiveResolution);
    if (grid.length === 0) return null;
    const gasDeltas = mergeGasDeltas(gasStats, byStat, grid);
    const totalM3 = gasDeltas.reduce((s, d) => s + d.value, 0);
    const bucketDurationMin = effectiveResolution === 'hour' ? 60 : 5;
    const heatStates = statesByEntity.get(WARMEENERGIE) ?? [];
    const burnerStates = statesByEntity.get(BURNER_PHASE) ?? [];
    const pumpStates = statesByEntity.get(DHW_PUMP) ?? [];
    const outsideStates = statesByEntity.get(OUTSIDE_TEMP) ?? [];
    const kwhBuckets = features.hasWarmeenergie
      ? bucketHeatEnergyKwh(heatStates, grid)
      : null;
    const burnerBuckets = features.hasBurner
      ? bucketBurnerMinutes(burnerStates, grid)
      : null;
    const splitBuckets =
      features.hasPump && features.hasBurner
        ? splitGasByPurpose(gasDeltas, pumpStates, burnerStates, grid)
        : null;
    const outsideBuckets =
      features.hasOutside && spansAtMostDays(start, end, OUTSIDE_OVERLAY_MAX_DAYS)
        ? averageOutsideTemp(outsideStates, grid)
        : null;
    const totals = {
      m3: totalM3,
      kwhThermal: kwhBuckets ? kwhBuckets.reduce((s, b) => s + b.value, 0) : null,
      burnerMin: burnerBuckets
        ? burnerBuckets.reduce((s, b) => s + b.value, 0)
        : null,
      dhwM3: splitBuckets
        ? splitBuckets.reduce((s, b) => s + b.dhw, 0)
        : null,
      avgOutsideC: outsideBuckets
        ? weightedMean(outsideBuckets, bucketDurationMin)
        : null,
    };
    totals.dhwShare =
      totals.dhwM3 != null && totalM3 > 0 ? totals.dhwM3 / totalM3 : null;
    totals.kwhPerM3 =
      totals.kwhThermal != null && totalM3 > 0
        ? totals.kwhThermal / totalM3
        : null;
    return {
      grid,
      bucketDurationMin,
      gasDeltas,
      kwhBuckets,
      burnerBuckets,
      splitBuckets,
      outsideBuckets,
      totals,
    };
  }, [
    start,
    end,
    effectiveResolution,
    gasStats,
    byStat,
    features,
    statesByEntity,
  ]);

  const c = theme.palette.energy || {};
  const gasColor = c.gas ?? theme.palette.primary.main;
  const heatingColor = alpha(gasColor, 0.55);

  if (gasStats.length === 0) {
    return (
      <Stack spacing={{ xs: 2, sm: 2.5 }}>
        <StickyDateToolbar>
          <RangePicker value={range} onChange={setRange} ranges={RANGES} />
        </StickyDateToolbar>
        <Alert severity="info">{t('summary.noData')}</Alert>
      </Stack>
    );
  }

  const anyTherme =
    features.hasWarmeenergie ||
    features.hasBurner ||
    features.hasPump ||
    features.hasOutside;

  return (
    <Stack spacing={{ xs: 2, sm: 2.5 }}>
      <StickyDateToolbar>
        <RangePicker
          value={range}
          onChange={setRange}
          ranges={RANGES}
          extra={
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                maxWidth: '100%',
              }}
            >
              <Typography
                variant="body2"
                color="text.secondary"
                component="span"
                sx={{ lineHeight: 1.2, whiteSpace: 'nowrap' }}
              >
                {t('gas.granularity.label')}
              </Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={effectiveResolution}
                onChange={(_, v) => {
                  if (v && allowsFiveMinuteForRange(range)) setResolution(v);
                  else if (v) setResolution('hour');
                }}
              >
                <ToggleButton value="hour" sx={{ px: 1, minWidth: 0, whiteSpace: 'nowrap' }}>
                  {t('gas.granularity.hour')}
                </ToggleButton>
                <ToggleButton
                  value="5minute"
                  disabled={!allowsFiveMinuteForRange(range)}
                  sx={{ px: 1, minWidth: 0, whiteSpace: 'nowrap' }}
                >
                  {t('gas.granularity.5minute')}
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
          }
        />
      </StickyDateToolbar>

      {!anyTherme && (
        <Alert severity="info">{t('gas.enableThermeHint')}</Alert>
      )}

      {/* Sections rendered in Tasks 8 + 9. */}
      <Box sx={{ display: 'grid', gap: { xs: 2, sm: 2.5 } }}>
        <ConsumptionSection
          t={t}
          lng={lng}
          range={range}
          derived={derived}
          features={features}
          stats={stats}
          gasColor={gasColor}
          heatingColor={heatingColor}
          outsideColor={theme.palette.text.secondary}
        />
        <EfficiencySection
          t={t}
          lng={lng}
          range={range}
          derived={derived}
          features={features}
          gasColor={gasColor}
        />
      </Box>
    </Stack>
  );
}

function mergeGasDeltas(gasStats, byStat, grid) {
  const sums = new Map(grid.map((b) => [b.start, 0]));
  for (const g of gasStats) {
    const data = byStat.get(g.stat);
    if (!data?.deltas) continue;
    for (const d of data.deltas) {
      if (!sums.has(d.start)) continue;
      sums.set(d.start, sums.get(d.start) + (Number(d.value) || 0));
    }
  }
  return grid.map((b) => ({ start: b.start, value: sums.get(b.start) ?? 0 }));
}

function weightedMean(buckets, bucketDurationMin) {
  let num = 0;
  let den = 0;
  for (const b of buckets) {
    if (b.value == null) continue;
    num += b.value * bucketDurationMin;
    den += bucketDurationMin;
  }
  return den > 0 ? num / den : null;
}

function spansAtMostDays(startIso, endIso, days) {
  const t0 = Date.parse(startIso);
  const t1 = Date.parse(endIso);
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return false;
  return t1 - t0 <= days * 86_400_000;
}

function ConsumptionSection() {
  // Filled in by Task 8.
  return null;
}

function EfficiencySection() {
  // Filled in by Task 9.
  return null;
}
```

- [ ] **Step 2: Start the dev server and confirm the toolbar renders**

Run: `cd web && npm run dev`
Expected:
- Server starts on `:5173` without crashes.
- Open `/gas` in a browser. The range picker + granularity toggle render. The two sections are empty (functions return `null`). If Weishaupt entities aren't tracked, the "enable therme hint" alert shows.

- [ ] **Step 3: Lint**

Run: `cd web && npm run lint`
Expected: no errors. (`ConsumptionSection` / `EfficiencySection` are unused-args warnings only if `react/prop-types` were on — it isn't, per `CLAUDE.md`. Stop and fix any other complaint.)

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Gas.jsx
git commit -m "feat(web): rewrite Gas page shell with granularity toggle + therme hooks"
```

---

## Task 8: Consumption section UI

KPI strip (3 cards) + stacked m³ bars with outside-temp overlay.

**Files:**
- Modify: `web/src/pages/Gas.jsx`

- [ ] **Step 1: Replace the `ConsumptionSection` placeholder**

Find:

```jsx
function ConsumptionSection() {
  // Filled in by Task 8.
  return null;
}
```

Replace with:

```jsx
function ConsumptionSection({
  t,
  lng,
  range,
  derived,
  features,
  stats,
  gasColor,
  heatingColor,
  outsideColor,
}) {
  const totals = derived?.totals;
  const loading = stats.isLoading || !derived;
  const dailyAggregate = isDailyAggregateRange(range);
  const rows = useMemo(() => {
    if (!derived) return [];
    const gasByStart = new Map(derived.gasDeltas.map((d) => [d.start, d.value]));
    const splitByStart = new Map(
      (derived.splitBuckets ?? []).map((s) => [s.start, s]),
    );
    const outByStart = new Map(
      (derived.outsideBuckets ?? []).map((o) => [o.start, o.value]),
    );
    return derived.grid.map((b) => {
      const total = gasByStart.get(b.start) ?? 0;
      const split = splitByStart.get(b.start);
      const dhw = split ? split.dhw : 0;
      const heating = split ? split.heating : total;
      return {
        start: b.start,
        label: dailyAggregate ? formatDay(b.start, lng) : formatHour(b.start, lng),
        dhw,
        heating,
        outsideC: outByStart.has(b.start) ? outByStart.get(b.start) : null,
      };
    });
  }, [derived, dailyAggregate, lng]);
  const hasOutsideOverlay = derived?.outsideBuckets != null;

  return (
    <Stack spacing={{ xs: 2, sm: 2.5 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        {t('gas.section.consumption')}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gap: { xs: 2, sm: 2.5 },
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(3, minmax(0, 1fr))',
          },
        }}
      >
        <StatCard
          icon={<LocalFireDepartmentIcon />}
          accent={gasColor}
          label={t('gas.totalRange')}
          value={formatKwh(totals?.m3 ?? null, lng)}
          unit={t('units.m3')}
          loading={loading}
        />
        <StatCard
          icon={<ThermostatIcon />}
          accent={outsideColor}
          label={t('gas.avgOutside')}
          value={
            totals?.avgOutsideC == null
              ? '—'
              : formatNumber(totals.avgOutsideC, lng, {
                  maximumFractionDigits: 1,
                })
          }
          unit={t('units.degC')}
          loading={loading}
        />
        <StatCard
          icon={<TimerOutlinedIcon />}
          accent={gasColor}
          label={t('gas.burnerMinutes')}
          value={
            totals?.burnerMin == null
              ? '—'
              : formatNumber(totals.burnerMin, lng, {
                  maximumFractionDigits: 0,
                })
          }
          unit={t('units.minutes')}
          loading={loading}
        />
      </Box>
      <ConsumptionChart
        t={t}
        rows={rows}
        gasColor={gasColor}
        heatingColor={heatingColor}
        outsideColor={outsideColor}
        showOutside={hasOutsideOverlay}
        showStack={features.hasBurner && features.hasPump}
        lng={lng}
      />
    </Stack>
  );
}

function ConsumptionChart({
  t,
  rows,
  gasColor,
  heatingColor,
  outsideColor,
  showOutside,
  showStack,
  lng,
}) {
  const theme = useTheme();
  if (rows.length === 0) return null;
  return (
    <Box sx={{ width: '100%', height: { xs: 280, sm: 340 }, bgcolor: 'background.paper', borderRadius: 1, p: { xs: 1.5, sm: 2 } }}>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
        {t('gas.consumptionChart')}
      </Typography>
      <Box sx={{ width: '100%', height: 'calc(100% - 28px)' }}>
        <ResponsiveContainer>
          <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={theme.palette.divider} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
              axisLine={{ stroke: theme.palette.divider }}
              tickLine={false}
              minTickGap={16}
            />
            <YAxis
              yAxisId="m3"
              tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={48}
              tickFormatter={(v) => formatKwh(v, lng)}
            />
            {showOutside && (
              <YAxis
                yAxisId="temp"
                orientation="right"
                tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={36}
                tickFormatter={(v) => formatNumber(v, lng, { maximumFractionDigits: 0 })}
              />
            )}
            <RTooltip
              contentStyle={{
                background: theme.palette.background.paper,
                border: `1px solid ${theme.palette.divider}`,
              }}
              formatter={(value, name) => {
                if (typeof value !== 'number') return [value, name];
                if (name === t('gas.outsideOverlay')) {
                  return [`${formatNumber(value, lng, { maximumFractionDigits: 1 })} ${t('units.degC')}`, name];
                }
                return [`${formatKwh(value, lng)} ${t('units.m3')}`, name];
              }}
            />
            <Legend wrapperStyle={{ paddingTop: 8 }} />
            {showStack ? (
              <>
                <Bar
                  yAxisId="m3"
                  dataKey="dhw"
                  name={t('gas.legend.dhw')}
                  stackId="m3"
                  fill={gasColor}
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  yAxisId="m3"
                  dataKey="heating"
                  name={t('gas.legend.heating')}
                  stackId="m3"
                  fill={heatingColor}
                  radius={[4, 4, 0, 0]}
                />
              </>
            ) : (
              <Bar
                yAxisId="m3"
                dataKey="heating"
                name={t('gas.totalRange')}
                fill={gasColor}
                radius={[4, 4, 0, 0]}
              />
            )}
            {showOutside && (
              <Line
                yAxisId="temp"
                type="monotone"
                dataKey="outsideC"
                name={t('gas.outsideOverlay')}
                stroke={outsideColor}
                dot={false}
                strokeWidth={2}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Add the missing `useMemo` import**

`useMemo` is already imported at the top of the file from Task 7 — no change needed. Verify by checking line 1 of `Gas.jsx`.

- [ ] **Step 3: Start the dev server and verify**

Run: `cd web && npm run dev` (or keep the existing one running — Vite hot-reloads).
Expected:
- `/gas` renders the three Consumption KPI cards.
- The m³ bar chart renders; if Weishaupt entities are tracked and present, the bars are stacked (DHW + heating) and an outside-temp line overlays for ranges ≤ 3 days.
- `today` / `yesterday` show data.
- `last30` shows non-stacked solid bars with no outside-temp overlay (overlay was clamped).

- [ ] **Step 4: Lint**

Run: `cd web && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Gas.jsx
git commit -m "feat(web): Gas page Consumption section (KPIs + stacked m3 + outside overlay)"
```

---

## Task 9: Heat & efficiency section UI

KPI strip (3 cards) + kWh-thermal bars (existing `HourlyBarChart`) + `BurnerTimelineStrip`.

**Files:**
- Modify: `web/src/pages/Gas.jsx`

- [ ] **Step 1: Replace the `EfficiencySection` placeholder**

Find:

```jsx
function EfficiencySection() {
  // Filled in by Task 9.
  return null;
}
```

Replace with:

```jsx
function EfficiencySection({ t, lng, range, derived, features, gasColor }) {
  const totals = derived?.totals;
  const loading = !derived;
  const showAny =
    features.hasWarmeenergie ||
    features.hasBurner ||
    features.hasPump;
  if (!showAny) return null;

  const kwhSeries = derived?.kwhBuckets
    ? [
        {
          key: 'kwhThermal',
          label: t('gas.kwhThermal'),
          color: gasColor,
          data: derived.kwhBuckets,
        },
      ]
    : [];

  const burnerByStart = useMemo(() => {
    const m = new Map();
    for (const r of derived?.burnerBuckets ?? []) m.set(r.start, r.value);
    return m;
  }, [derived?.burnerBuckets]);

  return (
    <Stack spacing={{ xs: 2, sm: 2.5 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        {t('gas.section.efficiency')}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gap: { xs: 2, sm: 2.5 },
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(3, minmax(0, 1fr))',
          },
        }}
      >
        <StatCard
          icon={<WhatshotIcon />}
          accent={gasColor}
          label={t('gas.kwhThermal')}
          value={
            totals?.kwhThermal == null
              ? '—'
              : formatKwh(totals.kwhThermal, lng)
          }
          unit={t('units.kwh')}
          loading={loading}
        />
        <StatCard
          icon={<PercentIcon />}
          accent={gasColor}
          label={t('gas.kwhPerM3')}
          value={
            totals?.kwhPerM3 == null
              ? '—'
              : formatNumber(totals.kwhPerM3, lng, {
                  maximumFractionDigits: 2,
                })
          }
          unit={t('units.kwhPerM3')}
          loading={loading}
        />
        <StatCard
          icon={<ShowerIcon />}
          accent={gasColor}
          label={t('gas.dhwShare')}
          value={
            totals?.dhwShare == null
              ? '—'
              : formatNumber(totals.dhwShare * 100, lng, {
                  maximumFractionDigits: 0,
                })
          }
          unit="%"
          loading={loading}
        />
      </Box>
      {kwhSeries.length > 0 && (
        <HourlyBarChart
          title={t('gas.kwhThermalChart')}
          series={kwhSeries}
          range={range}
          unit={t('units.kwh')}
        />
      )}
      {features.hasBurner && derived && (
        <BurnerTimelineStrip
          title={t('gas.burnerTimeline')}
          buckets={derived.grid}
          minutesByStart={burnerByStart}
          bucketDurationMinutes={derived.bucketDurationMin}
          range={range}
        />
      )}
    </Stack>
  );
}
```

- [ ] **Step 2: Start the dev server and verify**

Run: `cd web && npm run dev` (or keep the existing one).
Expected (with all four Weishaupt entities tracked):
- Three Efficiency KPI cards render: `kWh thermal` (e.g. `~4 kWh` on a typical day with 5 DHW cycles), `kWh / m³` (typical Erdgas H ≈ `9.5–10.5`), `DHW share` (~100 % in summer when no heating).
- `kWh thermal` bar chart renders below the KPIs.
- `BurnerTimelineStrip` renders below the chart with shaded cells aligned to the bar buckets.

- [ ] **Step 3: Lint + production build**

Run: `cd web && npm run lint && npm run build`
Expected: lint passes, build succeeds, `dist/` is created.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Gas.jsx
git commit -m "feat(web): Gas page Heat & efficiency section (KPIs + kWh bars + burner strip)"
```

---

## Task 10: Retention alert + manual verification pass

The `gas.stateHistoryShortHint` alert from the spec's empty-state rule #4. Trigger condition: any range that extends further back than `STATES_RETENTION_DAYS` (the integration default is 7) AND at least one Weishaupt entity is configured but returns no data for the older days. We detect this approximately: when the user picks `last30` and `useManyStates` returned at least one state row for at least one entity, but no rows from the first three days of the range, we render the alert.

**Files:**
- Modify: `web/src/pages/Gas.jsx`

- [ ] **Step 1: Add a coverage helper and an Alert next to the existing `enableThermeHint` alert**

In `Gas.jsx`, add this helper near the other top-level helpers (after `spansAtMostDays`):

```jsx
function stateHistoryGapDays(start, statesByEntity, entityIds) {
  const t0 = Date.parse(start);
  if (!Number.isFinite(t0)) return 0;
  let minFirst = Infinity;
  let hadAny = false;
  for (const id of entityIds) {
    const rows = statesByEntity.get(id) ?? [];
    if (rows.length === 0) continue;
    hadAny = true;
    const tf = Date.parse(rows[0].last_changed);
    if (Number.isFinite(tf)) minFirst = Math.min(minFirst, tf);
  }
  if (!hadAny || !Number.isFinite(minFirst)) return 0;
  return Math.max(0, Math.floor((minFirst - t0) / 86_400_000));
}
```

In the `Gas` component, just after the `features` `useMemo`, compute:

```jsx
const retentionGapDays = useMemo(
  () => stateHistoryGapDays(start, statesByEntity, THERME_ENTITY_IDS),
  [start, statesByEntity],
);
```

In the JSX, right after the existing `{!anyTherme && ...}` alert, add:

```jsx
{anyTherme && retentionGapDays >= 2 && (
  <Alert severity="info">
    {t('gas.stateHistoryShortHint', { days: retentionGapDays })}
  </Alert>
)}
```

(Threshold `>= 2` filters out the normal "boiler was idle this morning" case while still firing when the request spans many days beyond state retention.)

- [ ] **Step 2: Start the dev server and run the verification matrix**

Run: `cd web && npm run dev`
Walk through each row of the spec's verification list:

1. With all four Weishaupt entities tracked, open `/gas`, cycle through `today` / `yesterday` / `last7` / `last30`. Confirm KPIs, stacked m³ bars, kWh-thermal bars, burner strip render. On `last30` confirm the retention alert appears if your state history is shorter.
2. With granularity at `hour`, click `5min` on `today`. Confirm the bucket count grows ~12× and overlays still align.
3. Click `last30` and confirm the `5min` toggle is disabled.
4. In the integration config: remove `sensor.weishaupt_warmeenergie` from `extra_entities` and restart the integration. Reload `/gas`. Confirm the `kWh thermal` and `kWh / m³` cards show `—` and the kWh-thermal bar chart is omitted.
5. Remove **all** four Weishaupt entities from `extra_entities` and restart. Reload `/gas`. Confirm the page matches the original Gas behaviour (m³ KPI + m³ bars) plus the `gas.enableThermeHint` alert. No Weishaupt section renders.
6. `cd web && npm run lint && npm run build` once for sanity.

Document any discrepancies inline as follow-up TODOs at the bottom of the spec.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Gas.jsx
git commit -m "feat(web): Gas page state-retention hint alert"
```

---

## Task 11: Drop the verification driver script

The driver served its purpose in Tasks 1–4. We don't want a permanent script in the repo without a test framework — it can rot quickly and confuse readers (CLAUDE.md: "Don't add tests just to add tests"). Keep it out of the final commit history by deleting it.

**Files:**
- Delete: `web/scripts/check-therme-helpers.mjs`

- [ ] **Step 1: Remove the script**

```bash
git rm web/scripts/check-therme-helpers.mjs
# If web/scripts/ is now empty, leave it — Vite ignores empty dirs.
```

- [ ] **Step 2: Commit**

```bash
git commit -m "chore(web): drop one-off therme helpers driver"
```

---

## Verification (final)

After Task 10, all six rows of the spec's verification matrix should be reproducible against a dev server. Specifically the data points the user provided from 2026-05-10 should yield five non-zero kWh-thermal buckets and a burner timeline that lights up at `02:54`, `04:20`, `06:16`, `10:18`, `15:36`, `18:20` (with the first being a short "Nachbelüftung-only" event that may show 0 burner minutes).
