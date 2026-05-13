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
