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
  // Build (t, on) transitions. Out-of-range rows are dropped so the
  // "pre-first-row defaults to off" contract holds even if callers pass
  // a wider window.
  /** @type {Array<{ t: number, on: boolean }>} */
  const transitions = [];
  for (const row of states) {
    const t = Date.parse(row.last_changed);
    if (!Number.isFinite(t)) continue;
    if (t < rangeStart || t >= rangeEnd) continue;
    transitions.push({ t, on: isBurnerOnState(row.state) });
  }
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
