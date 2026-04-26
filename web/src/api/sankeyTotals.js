import { splitEnergyDashboardTotals } from './energyModel.js';
import { integrateTimeline } from './powerTimeline.js';

/**
 * Reconcile a per-device period total with whole-home import for the same window.
 *
 * When Home Assistant (or a template) sets `unit_of_measurement` to kWh but the
 * recorder's cumulative `sum` is still in Wh, the web normalizer never divides
 * by 1000 — the period total can look like "140.836 kWh" while grid+PV+Battery
 * into the home is only a few kWh. If `value/1000` is physically plausible, use it.
 * Otherwise drop values that are impossible (one circuit cannot use more than
 * the home received in the same period on a single-meter setup).
 *
 * @param {number} value
 * @param {number} home
 */
export function reconcileDeviceKwhToHome(value, home) {
  if (value == null || !Number.isFinite(value) || value <= 0) return 0;
  if (home == null || !Number.isFinite(home) || home <= 0) return value;

  const tol = 1.15;
  if (value <= home * tol) return value;

  const v1000 = value / 1000;
  // 10–1000: common Wh range shown as "kWh" in HA when UoM is wrong (e.g. 140.8 → 0.14)
  if (v1000 > 0 && v1000 <= home * tol && value >= 10 && value < 1000) {
    return v1000;
  }

  // Single device cannot exceed what entered the home (single-meter household)
  if (home < 100 && value > 5 * home) {
    return 0;
  }

  return value;
}

/**
 * Compute Sankey input totals and per-device kWh for an arbitrary time range.
 *
 * @param {object | null} model  See `buildEnergyModel` in `energyModel.js`.
 * @param {{ results: Array<{ statId: string, data?: { total?: number } }> } | undefined} stats
 * @param {Array<unknown>} rows  Power-timeline rows for the same window (for
 *   integral fallback). Pass `[]` when only statistics should be used.
 */
export function buildSankeyTotals(model, stats, rows) {
  const empty = {
    totals: {
      gridIn: 0,
      gridOut: 0,
      solar: 0,
      solarToHome: 0,
      batteryIn: 0,
      batteryOut: 0,
      home: 0,
    },
    devices: [],
  };
  if (!model) {
    return {
      ...empty,
      deviceLeaves: [],
      model: null,
      totalByStat: new Map(),
    };
  }

  const totalByStat = new Map();
  for (const r of stats?.results ?? []) {
    if (r.data?.total != null) totalByStat.set(r.statId, r.data.total);
  }
  const sumIds = (ids) =>
    ids.reduce((acc, id) => acc + (totalByStat.get(id) ?? 0), 0);

  const statGridIn = sumIds(model.grid.map((g) => g.from).filter(Boolean));
  const statGridOut = sumIds(model.grid.map((g) => g.to).filter(Boolean));
  const statSolar = sumIds(model.solar.map((s) => s.stat));
  const statBattOut = sumIds(model.battery.map((b) => b.from).filter(Boolean));
  const statBattIn = sumIds(model.battery.map((b) => b.to).filter(Boolean));

  const integrated = integrateTimeline(rows);
  const pick = (fromStats, fromIntegral) =>
    fromStats > 0 ? fromStats : fromIntegral;

  const gridIn = pick(statGridIn, integrated.gridIn);
  const gridOut = pick(statGridOut, integrated.gridOut);
  const solar = pick(statSolar, integrated.solar);
  const batteryOut = pick(statBattOut, integrated.batteryOut);
  const batteryIn = pick(statBattIn, integrated.batteryIn);

  const { solarToHome, gridToHome, batteryToHome } = splitEnergyDashboardTotals(
    solar,
    gridIn,
    gridOut,
    batteryIn,
    batteryOut,
  );
  const home = solarToHome + gridToHome + batteryToHome;

  // Home Assistant `device_consumption` can chain meters: a child has
  // `included_in_stat` pointing at a parent whose cumulative total already
  // includes the child. Summing every row double-counts vs `home` and breaks
  // "untracked". Only count **flow roots** — devices whose parent meter is not
  // also listed in the dashboard (or have no parent).
  const dash = model.devices ?? [];
  const statIds = new Set(dash.map((d) => d.stat).filter(Boolean));
  const isFlowRoot = (d) => {
    const p = d.includedInStat;
    if (!p) return true;
    return !statIds.has(p);
  };

  const deviceValue = (d) => reconcileDeviceKwhToHome(totalByStat.get(d.stat) ?? 0, home);

  const devices = dash
    .filter(isFlowRoot)
    .map((d) => ({
      name: d.name || shortId(d.stat),
      stat: d.stat,
      value: deviceValue(d),
    }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);

  // Bar chart: only “leaf” meters (nothing included into them) so bars do
  // not double-count parents that are split into children.
  const isParentStat = (s) => dash.some((c) => c.includedInStat === s);
  const deviceLeaves = dash
    .filter((d) => !isParentStat(d.stat))
    .map((d) => ({
      name: d.name || shortId(d.stat),
      stat: d.stat,
      value: deviceValue(d),
    }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);

  return {
    totals: { gridIn, gridOut, solar, solarToHome, batteryIn, batteryOut, home },
    devices,
    deviceLeaves,
    model,
    totalByStat,
  };
}

function shortId(statId) {
  const parts = String(statId).split('.');
  return parts[parts.length - 1];
}
