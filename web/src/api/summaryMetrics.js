import {
  gasSpendFromEnergyPrefs,
  splitEnergyDashboardTotals,
  weightedFossilPercentForGrid,
  weightedGridImportPrice,
} from './energyModel.js';

/** kg CO₂ per kWh for avoided grid supply (rough EU grid average; UI order-of-magnitude). */
export const DISPLACED_GRID_CO2_KG_PER_KWH = 0.385;

/** kg CO₂ one mature tree roughly offsets per year (highly site-dependent). */
export const TREE_CO2_SEQUESTRATION_KG_PER_YEAR = 22;

function sumList(list) {
  if (!list) return 0;
  let total = 0;
  for (const n of list) if (n != null && Number.isFinite(n)) total += n;
  return total;
}

/**
 * Sums hourly deltas on a series when `total` is missing or non-finite (same
 * idea as `resolveStatisticWindowTotal` in `useManyStatistics`); helps long
 * windows when `total` is not yet on the object.
 */
function totalFromDeltas(deltas) {
  if (!Array.isArray(deltas) || deltas.length === 0) return null;
  let s = 0;
  for (const d of deltas) s += Number(d.value) || 0;
  return Number.isFinite(s) ? s : null;
}

/**
 * For energy-flow stats, the latest “first in window” (from /statistics) across
 * solar, grid, and battery. When one series (e.g. export) has much longer
 * history than another (e.g. solar just added), unaligned cumulative totals make
 * min(solar, export) “eat” the entire production — CO₂ and split look broken.
 * Align by summing hourly deltas from this time for every flow in the split.
 */
function flowAlignmentTimeMs(model, statsResults) {
  if (!model || !Array.isArray(statsResults)) return null;
  const ids = [];
  for (const s of model.solar ?? []) if (s?.stat) ids.push(s.stat);
  for (const g of model.grid ?? []) {
    if (g?.from) ids.push(g.from);
    if (g?.to) ids.push(g.to);
  }
  for (const b of model.battery ?? []) {
    if (b?.from) ids.push(b.from);
    if (b?.to) ids.push(b.to);
  }
  let max = -Infinity;
  let any = false;
  for (const id of ids) {
    const r = statsResults.find((x) => x.statId === id);
    const ps =
      r?.data?.first?.period_start ??
      (Array.isArray(r?.data?.points) && r.data.points[0] ? r.data.points[0].period_start : null);
    if (!ps) continue;
    const t = Date.parse(String(ps));
    if (!Number.isFinite(t)) continue;
    any = true;
    if (t > max) max = t;
  }
  if (!any || !Number.isFinite(max)) return null;
  return max;
}

/**
 * kWh in [tAlign, end) from hourly deltas; if the response does not go back
 * that far, keep the boundary `fallback` total.
 */
function kwhAfterTime(r, tAlignMs, fallback) {
  if (tAlignMs == null) return fallback;
  const deltas = r?.data?.deltas;
  if (!Array.isArray(deltas) || deltas.length === 0) return fallback;
  const oldestT = Date.parse(String(deltas[0].start));
  if (Number.isFinite(oldestT) && tAlignMs < oldestT) return fallback;
  let s = 0;
  for (const d of deltas) {
    const t = Date.parse(String(d.start));
    if (!Number.isFinite(t) || t < tAlignMs) continue;
    s += Number(d.value) || 0;
  }
  return s;
}

/**
 * @param {Array<{ statId?: string, data?: { total?: number, deltas?: Array<{ value?: number }> } }>} statsResults
 * @returns {Map<string, number>}
 */
export function totalsByStatFromResults(statsResults) {
  const map = new Map();
  for (const r of statsResults ?? []) {
    if (!r?.data) continue;
    let t = r.data.total;
    if (t == null || !Number.isFinite(t)) {
      const dSum = totalFromDeltas(r.data.deltas);
      if (dSum == null) continue;
      t = dSum;
    }
    map.set(r.statId, t);
  }
  return map;
}

/**
 * @typedef {{
 *   footerCost: number|null,
 *   footerSavings: number|null,
 *   displacedFromGridKwh: number,
 *   co2AvoidedKg: number|null,
 *   treesEquivalent: number|null,
 * }} SummaryMetricsSlice
 */

/**
 * Cost, savings, and rough CO₂ / tree equivalents for a stats window.
 *
 * @param {import('./energyModel').EnergyModel|null} model
 * @param {Map<string, number>} totalsByStat
 * @param {Map<string, number>} meanPriceByStat
 * @param {Array<{ statId?: string, data?: { total?: number } }>} statsResults
 * @returns {SummaryMetricsSlice}
 */
export function computeSummaryMetrics(model, totalsByStat, meanPriceByStat, statsResults) {
  if (!model) {
    return {
      footerCost: null,
      footerSavings: null,
      displacedFromGridKwh: 0,
      co2AvoidedKg: null,
      treesEquivalent: null,
    };
  }

  const solarTotal = sumList(model.solar?.map((s) => totalsByStat.get(s.stat)));
  const gridIn = sumList(model.grid?.map((g) => totalsByStat.get(g.from)));
  const gridOut = sumList(model.grid?.map((g) => totalsByStat.get(g.to)));
  const batteryIn = sumList(model.battery?.map((b) => totalsByStat.get(b.to)));
  const batteryOut = sumList(model.battery?.map((b) => totalsByStat.get(b.from)));
  const gasTotal = sumList(model.gas?.map((g) => totalsByStat.get(g.stat)));

  const haExporterElecMean =
    model.electricityPriceEntity != null
      ? meanPriceByStat.get(model.electricityPriceEntity) ?? null
      : null;
  const haExporterGasMean =
    model.gasPriceEntity != null ? meanPriceByStat.get(model.gasPriceEntity) ?? null : null;

  const weightedImportPrice = model.grid?.length
    ? weightedGridImportPrice(model, totalsByStat, meanPriceByStat)
    : null;
  const effectiveElecUnit = haExporterElecMean ?? weightedImportPrice;

  let gridCostFromHa = null;
  if (model.grid?.length) {
    let total = 0;
    let any = false;
    for (const g of model.grid) {
      if (!g.from || !g.fromCost) continue;
      const v = totalsByStat.get(g.fromCost);
      if (v != null && Number.isFinite(v)) {
        total += v;
        any = true;
      }
    }
    if (any) gridCostFromHa = total;
  }

  let gasCostFromHa = null;
  if (model.gas?.length) {
    let total = 0;
    let any = false;
    for (const g of model.gas) {
      if (!g.cost) continue;
      const v = totalsByStat.get(g.cost);
      if (v != null && Number.isFinite(v)) {
        total += v;
        any = true;
      }
    }
    if (any) gasCostFromHa = total;
  }

  const gasSpendInferred = model.gas?.length
    ? gasSpendFromEnergyPrefs(model, totalsByStat, meanPriceByStat)
    : null;

  const gridCostMoney =
    gridCostFromHa != null
      ? gridCostFromHa
      : effectiveElecUnit != null && gridIn > 0
        ? gridIn * effectiveElecUnit
        : null;

  const gasCostMoney =
    gasCostFromHa != null
      ? gasCostFromHa
      : gasSpendInferred != null
        ? gasSpendInferred
        : haExporterGasMean != null && gasTotal > 0
          ? gasTotal * haExporterGasMean
          : null;

  const pvSavings =
    effectiveElecUnit != null && solarTotal > 0 ? solarTotal * effectiveElecUnit : null;
  const batSavings =
    effectiveElecUnit != null && batteryOut > 0 ? batteryOut * effectiveElecUnit : null;

  const footerCost =
    gridCostMoney != null || gasCostMoney != null
      ? (gridCostMoney || 0) + (gasCostMoney || 0)
      : null;

  const savingsParts = [pvSavings, batSavings].filter((v) => v != null && Number.isFinite(v));
  const footerSavings =
    savingsParts.length > 0 ? savingsParts.reduce((a, b) => a + b, 0) : null;

  const tAlign = flowAlignmentTimeMs(model, statsResults);
  const solarForSplit =
    tAlign == null
      ? solarTotal
      : sumList(
          model.solar?.map((s) =>
            kwhAfterTime(
              statsResults.find((x) => x.statId === s.stat),
              tAlign,
              totalsByStat.get(s.stat) ?? 0,
            ),
          ) ?? [],
        );
  const gridInForSplit =
    tAlign == null
      ? gridIn
      : sumList(
          model.grid?.map((g) =>
            g.from
              ? kwhAfterTime(
                  statsResults.find((x) => x.statId === g.from),
                  tAlign,
                  totalsByStat.get(g.from) ?? 0,
                )
              : 0,
          ) ?? [],
        );
  const gridOutForSplit =
    tAlign == null
      ? gridOut
      : sumList(
          model.grid?.map((g) =>
            g.to
              ? kwhAfterTime(
                  statsResults.find((x) => x.statId === g.to),
                  tAlign,
                  totalsByStat.get(g.to) ?? 0,
                )
              : 0,
          ) ?? [],
        );
  const batteryInForSplit =
    tAlign == null
      ? batteryIn
      : sumList(
          model.battery?.map((b) =>
            b.to
              ? kwhAfterTime(
                  statsResults.find((x) => x.statId === b.to),
                  tAlign,
                  totalsByStat.get(b.to) ?? 0,
                )
              : 0,
          ) ?? [],
        );
  const batteryOutForSplit =
    tAlign == null
      ? batteryOut
      : sumList(
          model.battery?.map((b) =>
            b.from
              ? kwhAfterTime(
                  statsResults.find((x) => x.statId === b.from),
                  tAlign,
                  totalsByStat.get(b.from) ?? 0,
                )
              : 0,
          ) ?? [],
        );

  const { solarToHome, batteryToHome } = splitEnergyDashboardTotals(
    solarForSplit || 0,
    gridInForSplit || 0,
    gridOutForSplit || 0,
    batteryInForSplit || 0,
    batteryOutForSplit || 0,
  );
  // Energy aligned with the summary flow / CO₂-free story: solar-to-home + all
  // battery **discharge** (not only the slice attributed to the home in the split),
  // so “All data” and CO₂ are not under-counted over long periods.
  const displacedFromGridKwh = solarToHome + batteryToHome;
  const kwhForCo2Avoided = solarToHome + (batteryOutForSplit || 0);

  let fossilFactor = 1;
  const entity = model.co2SignalEntity;
  if (entity && Array.isArray(statsResults) && statsResults.length) {
    const fossilPct = weightedFossilPercentForGrid(model, statsResults, entity);
    if (fossilPct != null && Number.isFinite(fossilPct)) {
      fossilFactor = Math.max(0, Math.min(1, fossilPct / 100));
    }
  }

  const co2AvoidedKg =
    kwhForCo2Avoided > 0
      ? kwhForCo2Avoided * DISPLACED_GRID_CO2_KG_PER_KWH * fossilFactor
      : null;

  const treesEquivalent =
    co2AvoidedKg != null && co2AvoidedKg > 0
      ? co2AvoidedKg / TREE_CO2_SEQUESTRATION_KG_PER_YEAR
      : null;

  return {
    footerCost,
    footerSavings,
    displacedFromGridKwh,
    co2AvoidedKg,
    treesEquivalent,
  };
}
