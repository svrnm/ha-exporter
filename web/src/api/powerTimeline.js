import {
  normalizeCumulativeStatsToKwh,
  pointsToHourlyDeltas,
  sortStatisticsPointsAscending,
  splitEnergyDashboardTotals,
} from './energyModel.js';

// Convert per-entity state history (variable cadence, raw string values)
// into an evenly-keyed timeline suitable for Recharts. Each source may have
// a different unit (`W`, `kW`, `mW`) declared via attributes — we normalise
// everything to kW before plotting.

export function parsePowerStateToKw(raw, unit) {
  if (raw == null || raw === 'unavailable' || raw === 'unknown') return null;
  const n = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const u = String(unit || '').trim().toLowerCase();
  if (u === 'kw') return n;
  if (u === 'mw') return n * 1000;
  // Default assumption: watts. Most HA power sensors report in W.
  return n / 1000;
}

/**
 * @param {string} raw
 * @param {string|undefined} unit
 * @returns {number | null}  Energy in kWh
 */
export function parseEnergyStateToKwh(raw, unit) {
  if (raw == null || raw === 'unavailable' || raw === 'unknown') return null;
  const n = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const u = String(unit || '')
    .trim()
    .toLowerCase()
    .replace(/\s/g, '');
  if (u === 'mwh') return n * 1000;
  if (u === 'kwh' || u === 'kw·h') return n;
  if (u === 'wh' || u === 'w·h') return n / 1000;
  // Unknown unit: assume kWh (typical for battery "stored energy" sensors).
  return n;
}

/**
 * HA Exporter "battery remaining" entity: may be energy (kWh/Wh) or state of charge (%).
 *
 * @param {{ state?: unknown, attributes?: { unit_of_measurement?: unknown } }|undefined} row
 * @returns {{ kwh: number|null, socFraction: number|null }}  `socFraction` is 0–1 when the sensor is a % SoC.
 */
export function parseBatteryAvailableSensor(row) {
  if (!row || row.state == null || row.state === '') {
    return { kwh: null, socFraction: null };
  }
  const raw = String(row.state).trim();
  if (raw === 'unavailable' || raw === 'unknown') {
    return { kwh: null, socFraction: null };
  }
  const u = String(row.attributes?.unit_of_measurement ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s/g, '')
    .replace('²', '2');
  const isPercentUnit =
    u === '%' || u.endsWith('%') || u.includes('%') || String(raw).includes('%');
  if (isPercentUnit) {
    const n = Number(String(raw).replace(/%/g, '').replace(',', '.').trim());
    if (!Number.isFinite(n)) return { kwh: null, socFraction: null };
    const clamped = Math.max(0, Math.min(100, n));
    return { kwh: null, socFraction: clamped / 100 };
  }
  const kwh = parseEnergyStateToKwh(raw, row.attributes?.unit_of_measurement);
  return { kwh, socFraction: null };
}

function toKilowatts(raw, unit) {
  return parsePowerStateToKw(raw, unit);
}

/**
 * Home load (kW) from a merged power row (solar split vs grid export / battery charge).
 * Declared before `mergePowerTimeline` so the merge body can call it.
 *
 * @param {object} r  { solarKw, gridPos, gridNeg, batteryPos, batteryNeg }
 */
function consumptionFromMergedRow(r) {
  const gridExportAbs = -Math.min(0, r.gridNeg);
  const solarToGrid = Math.min(r.solarKw, gridExportAbs);
  const batteryIn = r.batteryNeg < 0 ? -r.batteryNeg : 0;
  const solarToBattery = Math.min(
    Math.max(0, r.solarKw - solarToGrid),
    batteryIn,
  );
  const solarToHome = Math.max(0, r.solarKw - solarToGrid - solarToBattery);
  return solarToHome + (r.gridPos || 0) + (r.batteryPos || 0);
}

/**
 * Merge multiple state-history series into a unified timeline.
 *
 * @param {{[key: string]: {states: Array<{state: string, attributes?: any, last_updated: string}>}}} sources
 *        Map of series-key → { states }. Example:
 *        { solar: { states: [...] }, grid: { states: [...] }, batteryIn: {...}, batteryOut: {...} }
 * @param {Date} startDate  Left edge of the timeline (earlier points are dropped).
 * @param {Date} endDate    Right edge (later points are dropped).
 * @returns {Array<Object>}  Rows `{ ts: ISO, tsMs: number, <key>: kW, ... }`
 *          The returned objects also carry derived series used by the chart:
 *          - `gridPos`    — grid import (+)
 *          - `gridNeg`    — grid export (negative kW, drawn below zero)
 *          - `batteryPos` — battery discharge
 *          - `batteryNeg` — battery charge (negative)
 *          - `consumption` — total power used by the home at that instant
 */
export function mergePowerTimeline(sources, startDate, endDate) {
  const keys = Object.keys(sources).filter(
    (k) => Array.isArray(sources[k]?.states) && sources[k].states.length > 0,
  );
  if (keys.length === 0) return [];

  // Unique timestamps across all sources, clamped to [startDate, endDate].
  const sMs = startDate instanceof Date ? startDate.getTime() : new Date(startDate).getTime();
  const eMs = endDate instanceof Date ? endDate.getTime() : new Date(endDate).getTime();

  const timestamps = new Set();
  for (const key of keys) {
    for (const row of sources[key].states) {
      const t = Date.parse(row.last_updated);
      if (!Number.isFinite(t) || t < sMs || t > eMs) continue;
      timestamps.add(t);
    }
  }
  // Seed the start + end so the chart spans the full window even when the
  // first sample is late into the day.
  timestamps.add(sMs);
  timestamps.add(eMs);

  const ordered = Array.from(timestamps).sort((a, b) => a - b);

  // Running last-known value per series. Null until we see the first sample.
  const lastValue = Object.fromEntries(keys.map((k) => [k, null]));
  // Pre-sort each series so we can advance with pointers instead of scanning.
  const cursors = Object.fromEntries(keys.map((k) => [k, 0]));
  const sortedByKey = Object.fromEntries(
    keys.map((k) => [
      k,
      [...sources[k].states]
        .map((r) => ({
          tsMs: Date.parse(r.last_updated),
          kw: toKilowatts(r.state, r.attributes?.unit_of_measurement),
        }))
        .filter((r) => Number.isFinite(r.tsMs))
        .sort((a, b) => a.tsMs - b.tsMs),
    ]),
  );

  const out = [];
  for (const t of ordered) {
    // Advance each series' pointer up to t (inclusive) to forward-fill.
    for (const k of keys) {
      const arr = sortedByKey[k];
      while (cursors[k] < arr.length && arr[cursors[k]].tsMs <= t) {
        const v = arr[cursors[k]].kw;
        if (v != null) lastValue[k] = v;
        cursors[k]++;
      }
    }
    const row = { ts: new Date(t).toISOString(), tsMs: t };
    const solar = nz(lastValue.solar);
    const grid = nz(lastValue.grid);
    const batteryIn = nz(lastValue.batteryIn);
    const batteryOut = nz(lastValue.batteryOut);

    row.solarKw = Math.max(0, solar);
    row.gridPos = Math.max(0, grid);
    row.gridNeg = Math.min(0, grid); // already negative (or 0)
    row.batteryPos = Math.max(0, batteryOut);
    // Charge rate is reported positive by HA; we draw it below the zero line.
    row.batteryNeg = batteryIn > 0 ? -batteryIn : 0;

    // Consumption = solar-to-home + grid-in + battery-out. PV that went to
    // grid-export / battery-charge is excluded because it didn't touch the
    // home load.
    row.consumption = consumptionFromMergedRow(row);
    out.push(row);
  }
  return out;
}

function nz(v) {
  return v == null ? 0 : v;
}

const FIVE_MINUTE_MS = 5 * 60 * 1000;

/**
 * Average merged power rows into fixed 5-minute buckets ( aligned to
 * `startDate` ) for chart display. Use full-resolution `mergePowerTimeline`
 * output for integration / Sankey; pass this to the Live power chart to avoid
 * minute (or sub-minute) state churn crowding the axis.
 *
 * @param {Array<{ts: string, tsMs: number, solarKw: number, gridPos: number, gridNeg: number, batteryPos: number, batteryNeg: number, consumption?: number}>} rows
 * @param {string | Date} startDate
 * @param {string | Date} endDate
 * @returns {typeof rows}
 */
export function bucketPowerTimeline5Min(rows, startDate, endDate) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return rows;
  }

  const acc = new Map();
  for (const r of rows) {
    const t = r.tsMs;
    if (t == null || !Number.isFinite(t) || t < startMs || t > endMs) continue;
    const b =
      startMs +
      Math.floor((t - startMs) / FIVE_MINUTE_MS) * FIVE_MINUTE_MS;
    let a = acc.get(b);
    if (!a) {
      a = {
        n: 0,
        solarKw: 0,
        gridPos: 0,
        gridNeg: 0,
        batteryPos: 0,
        batteryNeg: 0,
      };
      acc.set(b, a);
    }
    a.n += 1;
    a.solarKw += r.solarKw || 0;
    a.gridPos += r.gridPos || 0;
    a.gridNeg += r.gridNeg || 0;
    a.batteryPos += r.batteryPos || 0;
    a.batteryNeg += r.batteryNeg || 0;
  }

  return Array.from(acc.entries())
    .sort((x, y) => x[0] - y[0])
    .map(([tsMs, a]) => {
      const n = a.n;
      const row = {
        ts: new Date(tsMs).toISOString(),
        tsMs,
        solarKw: a.solarKw / n,
        gridPos: a.gridPos / n,
        gridNeg: a.gridNeg / n,
        batteryPos: a.batteryPos / n,
        batteryNeg: a.batteryNeg / n,
      };
      row.consumption = consumptionFromMergedRow(row);
      return row;
    });
}

/**
 * Numerically integrate the merged timeline rows into per-series kWh totals.
 *
 * Uses the trapezoidal rule over `(tsMs, kW)` pairs, which is accurate enough
 * for sampling rates of a few seconds to a few minutes. Returns values in
 * kilowatt-hours.
 *
 * This lets the Sankey render meaningful totals as soon as there's live
 * power data, without having to wait until the server's first hourly
 * statistic delta comes through (those need two consecutive hour samples
 * before producing any delta at all).
 *
 * @returns {{
 *   gridIn: number, gridOut: number,
 *   solar: number,
 *   batteryIn: number, batteryOut: number
 * }}
 */
export function integrateTimeline(rows) {
  const totals = {
    gridIn: 0,
    gridOut: 0,
    solar: 0,
    batteryIn: 0,
    batteryOut: 0,
  };
  if (!Array.isArray(rows) || rows.length < 2) return totals;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const hours = Math.max(0, (cur.tsMs - prev.tsMs) / 3_600_000);
    if (hours === 0) continue;
    totals.gridIn += avg(prev.gridPos, cur.gridPos) * hours;
    totals.gridOut += avg(-prev.gridNeg, -cur.gridNeg) * hours;
    totals.solar += avg(prev.solarKw, cur.solarKw) * hours;
    totals.batteryOut += avg(prev.batteryPos, cur.batteryPos) * hours;
    totals.batteryIn += avg(-prev.batteryNeg, -cur.batteryNeg) * hours;
  }
  return totals;
}

function avg(a, b) {
  return ((a || 0) + (b || 0)) / 2;
}

/**
 * Derive a power-over-time series from cumulative 5-minute *energy* statistics
 * (kWh meter `sum` deltas) — one average kW per closed bucket.
 *
 *   delta_kwh per 5-min bucket  ÷  (5/60 h)  =  average kW for the bucket
 *   ↔ delta_kwh × 12  =  kW
 *
 * The Live (Now) page prefers `mergePowerTimeline` on Energy `stat_rate` flow
 * entities to align with Home Assistant’s power chart; this path is a fallback
 * when recorder state history is empty, and stays useful for meter-only views.
 *
 * @param {EnergyModel|null} model
 * @param {Array<{statId: string, data?: {points?: Array<any>}}>} statsResults
 *        Same shape as `useManyStatistics(...).results`.
 * @returns {Array<Object>} Rows `{ ts, tsMs, gridPos, gridNeg, solarKw,
 *          batteryPos, batteryNeg, consumption }`.
 */
export function buildPowerTimelineFromEnergy(model, statsResults) {
  if (!model || !Array.isArray(statsResults) || statsResults.length === 0) {
    return [];
  }

  // statId → Map<periodStartIso, kW>. We compute deltas per stat and
  // convert each bucket's kWh to kW. The server-supplied `anchor` row
  // (the bucket immediately preceding our window) is used as the initial
  // `prev` so the FIRST in-range bucket — typically 00:00 of the day —
  // also gets a delta. Without it, the chart's left edge was systematically
  // missing the first 5-minute slot.
  const byStat = new Map();
  for (const r of statsResults) {
    const rawPoints = r?.data?.points ?? [];
    const rawAnchor = r?.data?.anchor ?? null;
    const { points, anchor } = normalizeCumulativeStatsToKwh(rawPoints, rawAnchor);
    if (!points.length) continue;
    const deltas = pointsToHourlyDeltas(points, anchor, { maxDeltaKwh: 25 / 12 });
    const m = new Map();
    for (const d of deltas) {
      m.set(d.start, d.value * 12);
    }
    if (m.size > 0) byStat.set(r.statId, m);
  }

  if (byStat.size === 0) return [];

  // Identify which stat_ids feed which power channel. A model may have
  // multiple grid flows (rare — bidirectional + meter combo), in which
  // case we sum them.
  const importIds = (model.grid ?? []).map((g) => g.from).filter(Boolean);
  const exportIds = (model.grid ?? []).map((g) => g.to).filter(Boolean);
  const solarIds = (model.solar ?? []).map((s) => s.stat).filter(Boolean);
  const battOutIds = (model.battery ?? []).map((b) => b.from).filter(Boolean);
  const battInIds = (model.battery ?? []).map((b) => b.to).filter(Boolean);

  // Collect all bucket boundaries we saw.
  const timestamps = new Set();
  for (const m of byStat.values()) {
    for (const k of m.keys()) timestamps.add(k);
  }
  const sorted = Array.from(timestamps).sort();

  const sumChannel = (ids, iso) =>
    ids.reduce((acc, id) => acc + (byStat.get(id)?.get(iso) ?? 0), 0);

  const out = [];
  for (const iso of sorted) {
    const tsMs = Date.parse(iso);
    if (!Number.isFinite(tsMs)) continue;
    const gridImport = Math.max(0, sumChannel(importIds, iso));
    const gridExport = Math.max(0, sumChannel(exportIds, iso));
    const solarKw = Math.max(0, sumChannel(solarIds, iso));
    const batteryOut = Math.max(0, sumChannel(battOutIds, iso));
    const batteryIn = Math.max(0, sumChannel(battInIds, iso));

    // Mirror mergePowerTimeline's accounting so the consumption line
    // matches: solar that was exported / used to charge the battery
    // didn't pass through the home load.
    const solarToGrid = Math.min(solarKw, gridExport);
    const solarToBattery = Math.min(
      Math.max(0, solarKw - solarToGrid),
      batteryIn,
    );
    const solarToHome = Math.max(
      0,
      solarKw - solarToGrid - solarToBattery,
    );

    out.push({
      ts: iso,
      tsMs,
      solarKw,
      gridPos: gridImport,
      gridNeg: -gridExport,
      batteryPos: batteryOut,
      batteryNeg: -batteryIn,
      consumption: solarToHome + gridImport + batteryOut,
    });
  }
  return out;
}

/**
 * Same accounting as the last `mergePowerTimeline` point: how much PV / grid /
 * battery (dis)charge is attributed to the home load. All values in kW.
 */
function liveHomeFlowKw(solar, grid, batteryIn, battDischargeRaw) {
  const nz = (v) => (v == null || !Number.isFinite(v) ? 0 : v);
  const totalSolarKw = Math.max(0, nz(solar));
  const rowGrid = nz(grid);
  const rowBIn = nz(batteryIn);
  const rowBOut = nz(battDischargeRaw);
  const gridExportAbs = -Math.min(0, rowGrid);
  const solarToGrid = Math.min(totalSolarKw, gridExportAbs);
  const solarToBattery = Math.min(
    Math.max(0, totalSolarKw - solarToGrid),
    rowBIn,
  );
  const solarToHome = Math.max(
    0,
    totalSolarKw - solarToGrid - solarToBattery,
  );
  const gridIn = Math.max(0, rowGrid);
  const batteryToHome = Math.max(0, rowBOut);
  const home = solarToHome + gridIn + batteryToHome;
  return { totalSolarKw, rowGrid, solarToHome, gridIn, batteryOut: batteryToHome, home };
}

/**
 * Per-path instant power in watts for the same diagram split as
 * `splitEnergyDashboardTotals` (kWh), from live `stat_rate` sensors.
 *
 * @param {import('./energyModel.js').EnergyModel | null | undefined} model
 * @param {Map<string, {state?: string, attributes?: {unit_of_measurement?: string}}> | null | undefined} byEntity
 * @returns {null | {
 *   solarToGrid: number, solarToBattery: number, solarToHome: number,
 *   gridToBattery: number, batteryToGrid: number, batteryToHome: number, gridToHome: number,
 * }}
 */
export function liveFlowSplitWatts(model, byEntity) {
  const pe = model?.powerEntities;
  if (!pe || !(pe.grid || pe.solar || pe.batteryIn || pe.batteryOut)) {
    return null;
  }

  const getKw = (id) => {
    if (!id || !byEntity) return null;
    const row = byEntity.get(id);
    if (!row || row.state == null || row.state === '') return null;
    return parsePowerStateToKw(
      String(row.state),
      row.attributes?.unit_of_measurement,
    );
  };

  const solar = getKw(pe.solar);
  const grid = getKw(pe.grid);
  const batteryInKw = getKw(pe.batteryIn);
  const batteryDischargeKw = getKw(pe.batteryOut);

  const any = [solar, grid, batteryInKw, batteryDischargeKw].some(
    (v) => v != null && Number.isFinite(v),
  );
  if (!any) return null;

  const nz = (v) => (v == null || !Number.isFinite(v) ? 0 : v);
  const S = pe.solar ? Math.max(0, nz(solar)) : 0;
  let Gi = 0;
  let Go = 0;
  if (pe.grid && grid != null && Number.isFinite(grid)) {
    const g = grid;
    Gi = Math.max(0, g);
    Go = Math.max(0, -g);
  }
  const Bin = pe.batteryIn ? Math.max(0, nz(batteryInKw)) : 0;
  const Bout = pe.batteryOut ? Math.max(0, nz(batteryDischargeKw)) : 0;

  const sp = splitEnergyDashboardTotals(S, Gi, Go, Bin, Bout);
  const w = (kw) => kw * 1000;
  return {
    solarToGrid: w(sp.solarToGrid),
    solarToBattery: w(sp.solarToBattery),
    solarToHome: w(sp.solarToHome),
    gridToBattery: w(sp.gridToBattery),
    batteryToGrid: w(sp.batteryToGrid),
    batteryToHome: w(sp.batteryToHome),
    gridToHome: w(sp.gridToHome),
  };
}

/**
 * Instant power in watts from `/states/latest` for the four Energy “stat_rate”
 * sensors, using the same split as the last point in `mergePowerTimeline` /
 * the Live page chart.
 *
 * @param {import('./energyModel.js').EnergyModel | null | undefined} model
 * @param {Map<string, {state?: string, attributes?: {unit_of_measurement?: string}}> | null | undefined} byEntity
 * @returns {{
 *   hasPowerSensors: boolean,
 *   solarW: number | null,
 *   gridNetW: number | null,
 *   batteryNetW: number | null,
 *   homeW: number | null,
 * }}
 */
export function currentPowerWattsFromLatest(model, byEntity) {
  const pe = model?.powerEntities;
  if (!pe || !(pe.grid || pe.solar || pe.batteryIn || pe.batteryOut)) {
    return {
      hasPowerSensors: false,
      solarW: null,
      gridNetW: null,
      batteryNetW: null,
      homeW: null,
    };
  }

  const getKw = (id) => {
    if (!id || !byEntity) return null;
    const row = byEntity.get(id);
    if (!row || row.state == null || row.state === '') return null;
    return parsePowerStateToKw(
      String(row.state),
      row.attributes?.unit_of_measurement,
    );
  };

  const solar = getKw(pe.solar);
  const grid = getKw(pe.grid);
  const batteryInKw = getKw(pe.batteryIn);
  const batteryDischargeKw = getKw(pe.batteryOut);

  const nz = (v) => (v == null || !Number.isFinite(v) ? 0 : v);
  const { totalSolarKw, rowGrid, home } = liveHomeFlowKw(
    solar,
    grid,
    batteryInKw,
    batteryDischargeKw,
  );

  const anyPowerReading = [solar, grid, batteryInKw, batteryDischargeKw].some(
    (v) => v != null && Number.isFinite(v),
  );

  const wOut = (kw) => kw * 1000;
  return {
    hasPowerSensors: true,
    solarW: pe.solar
      ? solar == null
        ? null
        : wOut(totalSolarKw)
      : null,
    gridNetW: pe.grid
      ? grid == null
        ? null
        : wOut(rowGrid)
      : null,
    batteryNetW:
      pe.batteryIn || pe.batteryOut
        ? batteryInKw == null && batteryDischargeKw == null
          ? null
          : wOut(nz(batteryDischargeKw) - nz(batteryInKw))
        : null,
    homeW: anyPowerReading ? wOut(home) : null,
  };
}

function shortStatId(statId) {
  const parts = String(statId).split('.');
  return parts[parts.length - 1];
}

/**
 * Latest W per device `stat` from `device_consumption[].stat_rate` (0 when missing).
 * Used with `buildHierarchicalLiveWattsSankeyData` on the Live page.
 *
 * @param {import('./energyModel.js').EnergyModel | null | undefined} model
 * @param {Map<string, {state?: string, attributes?: {unit_of_measurement?: string}}> | null | undefined} byEntity
 * @returns {Map<string, number>}
 */
export function buildWattsByStatMap(model, byEntity) {
  const m = new Map();
  if (!model?.devices?.length || !byEntity) return m;
  for (const d of model.devices) {
    if (!d.stat) continue;
    let w = 0;
    if (d.statRate) {
      const row = byEntity.get(d.statRate);
      if (row && row.state != null && row.state !== '') {
        const kw = parsePowerStateToKw(
          String(row.state),
          row.attributes?.unit_of_measurement,
        );
        if (kw != null && Number.isFinite(kw)) w = Math.max(0, kw) * 1000;
      }
    }
    m.set(d.stat, w);
  }
  return m;
}

/**
 * Live page Sankey: **watts only** from Energy dashboard power sensors — the
 * four flow `stat_rate` entities (same split as the power chart) and, for each
 * device row, `device_consumption[].stat_rate` when configured in HA. Nothing
 * is inferred from kWh. When no live system power reading exists yet, falls
 * back to kWh + hierarchical `graphData`.
 *
 * @param {import('./energyModel.js').EnergyModel | null | undefined} model
 * @param {Map<string, {state?: string, attributes?: {unit_of_measurement?: string}}> | null | undefined} byEntity
 * @param {{ totals: object, devices: Array<{name: string, stat?: string, value: number}>}} sankey
 * @param {object | null} graphData
 * @returns {{
 *   valueUnit: 'kwh' | 'watts',
 *   totals: object,
 *   devices: Array<{name: string, stat?: string, value: number}>,
 *   graphData: object | null,
 * }}
 */
export function nowPageSankeyWithLiveWatts(model, byEntity, sankey, graphData) {
  if (!model?.powerEntities) {
    return {
      valueUnit: 'kwh',
      totals: sankey.totals,
      devices: sankey.devices,
      graphData,
    };
  }
  const pe = model.powerEntities;

  const getKw = (id) => {
    if (!id || !byEntity) return null;
    const row = byEntity.get(id);
    if (!row || row.state == null || row.state === '') return null;
    return parsePowerStateToKw(
      String(row.state),
      row.attributes?.unit_of_measurement,
    );
  };

  const solar = getKw(pe.solar);
  const grid = getKw(pe.grid);
  const batteryInKw = getKw(pe.batteryIn);
  const batteryDischargeKw = getKw(pe.batteryOut);

  const anyPowerReading = [solar, grid, batteryInKw, batteryDischargeKw].some(
    (v) => v != null && Number.isFinite(v),
  );
  if (!anyPowerReading) {
    return {
      valueUnit: 'kwh',
      totals: sankey.totals,
      devices: sankey.devices,
      graphData,
    };
  }

  const { solarToHome, gridIn, batteryOut: batteryToHomeKw, home } =
    liveHomeFlowKw(solar, grid, batteryInKw, batteryDischargeKw);
  const w = (kw) => kw * 1000;
  const { totals } = sankey;

  const dash = model.devices ?? [];
  const statIds = new Set(dash.map((d) => d.stat).filter(Boolean));
  const isFlowRoot = (d) => {
    const p = d.includedInStat;
    if (!p) return true;
    return !statIds.has(p);
  };

  const devicesW = [];
  for (const d of dash) {
    if (!isFlowRoot(d) || !d.statRate) continue;
    const kw = getKw(d.statRate);
    if (kw == null || !Number.isFinite(kw)) continue;
    const wVal = Math.max(0, kw) * 1000;
    if (wVal < 1) continue;
    devicesW.push({
      name: d.name || shortStatId(d.stat),
      stat: d.stat,
      value: wVal,
    });
  }
  devicesW.sort((a, b) => b.value - a.value);

  return {
    valueUnit: 'watts',
    totals: {
      ...totals,
      gridIn: w(gridIn),
      solarToHome: w(solarToHome),
      batteryOut: w(batteryToHomeKw),
      home: w(home),
    },
    devices: devicesW,
    graphData: null,
  };
}
