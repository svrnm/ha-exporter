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
