// web/src/api/thermeModel.js
//
// Client-side helpers for the Gas page's "Heat & efficiency" section.
//
// All bucketing is UTC-aligned so the new derived series line up with HA's
// long-term statistics grid (top-of-hour or 5-minute slots). Display
// localisation happens in the chart layer, never here.

import { parseScalarNumber } from './energyModel.js';

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
    return bucketGrid.map((b) => ({ start: b.start, value: 0 }));
  }
  const bucketStarts = bucketGrid.map((b) => Date.parse(b.start));
  const bucketEnd = Date.parse(bucketGrid[bucketGrid.length - 1].end);
  for (const row of states) {
    const t = Date.parse(row.last_changed);
    if (!Number.isFinite(t)) continue;
    if (t < bucketStarts[0] || t >= bucketEnd) continue;
    const v = parseScalarNumber(row.state);
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
    return bucketGrid.map((b) => ({ start: b.start, value: 0 }));
  }
  const rangeStart = Date.parse(bucketGrid[0].start);
  const rangeEnd = Date.parse(bucketGrid[bucketGrid.length - 1].end);
  const transitions = buildTransitions(
    states,
    isBurnerOnState,
    rangeStart,
    rangeEnd,
  );
  if (transitions.length === 0) {
    return bucketGrid.map((b) => ({ start: b.start, value: 0 }));
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

/**
 * Build (timestamp, predicate-result) transitions from a sorted state-history
 * array. Out-of-range rows are dropped so the caller's "default off" contract
 * holds even when callers pass a wider state window.
 *
 * @param {Array<{ last_changed: string, state: string }>} states  Sorted ASC.
 * @param {(state: string) => boolean} predicate
 * @param {number} rangeStartMs
 * @param {number} rangeEndMs
 * @returns {Array<{ t: number, on: boolean }>}
 */
function buildTransitions(states, predicate, rangeStartMs, rangeEndMs) {
  const out = [];
  if (!Array.isArray(states)) return out;
  for (const row of states) {
    const t = Date.parse(row.last_changed);
    if (!Number.isFinite(t)) continue;
    if (t < rangeStartMs || t >= rangeEndMs) continue;
    out.push({ t, on: predicate(row.state) });
  }
  return out;
}

/** True when the DHW pump state string is "Ein". */
export function isPumpOnState(state) {
  return typeof state === 'string' && state.trim() === 'Ein';
}

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
  const burnerTr = buildTransitions(burnerStates, isBurnerOnState, rangeStart, rangeEnd);
  const pumpTr = buildTransitions(pumpStates, isPumpOnState, rangeStart, rangeEnd);

  // Generate combined segments by merging transition timestamps with the
  // range bounds. buildTransitions has already filtered to [rangeStart,
  // rangeEnd), so no extra bounds check is needed here.
  const eventTimes = new Set([rangeStart, rangeEnd]);
  for (const tr of burnerTr) eventTimes.add(tr.t);
  for (const tr of pumpTr) eventTimes.add(tr.t);
  const sortedTimes = Array.from(eventTimes).sort((a, b) => a - b);

  let bIdx = 0;
  let pIdx = 0;
  let burnerOn = false;
  let pumpOn = false;

  for (let i = 0; i + 1 < sortedTimes.length; i++) {
    const segStart = sortedTimes[i];
    const segEnd = sortedTimes[i + 1];
    // Consume transitions at or before segStart so the state applies during
    // this segment, not the next. Without this, a transition timestamped
    // exactly at segStart would only affect later segments.
    while (bIdx < burnerTr.length && burnerTr[bIdx].t <= segStart) {
      burnerOn = burnerTr[bIdx].on;
      bIdx++;
    }
    while (pIdx < pumpTr.length && pumpTr[pIdx].t <= segStart) {
      pumpOn = pumpTr[pIdx].on;
      pIdx++;
    }
    if (segEnd <= segStart) continue;
    if (burnerOn) {
      distributeMinutes(burnerOnPerBucket, bucketGrid, segStart, segEnd);
      if (pumpOn) {
        distributeMinutes(burnerOnAndDhwPerBucket, bucketGrid, segStart, segEnd);
      }
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
    const v = parseScalarNumber(row.state);
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
