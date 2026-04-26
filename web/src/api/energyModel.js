// Normalise Home Assistant's `energy_prefs` blob into a flat, easy-to-consume
// shape. The HA schema is documented at
// https://developers.home-assistant.io/docs/energy — we only pluck the keys
// we need and ignore unknown source types gracefully.

/**
 * @typedef {Object} PowerEntities
 * @property {string|null} grid        Net grid power sensor (signed W/kW).
 * @property {string|null} solar       Solar production power sensor (W/kW).
 * @property {string|null} batteryOut  Battery discharge (home-bound) power.
 * @property {string|null} batteryIn   Battery charge (incoming) power.
 *
 * @typedef {Object} EnergyModel
 * @property {Array<{from: string, fromCost?: string|null, fromPriceEntity?: string|null, fromPriceNumber?: number|null, to?: string|null, toCompensation?: string|null, toPriceEntity?: string|null, toPriceNumber?: number|null}>} grid
 * @property {Array<{stat: string}>} solar
 * @property {Array<{from?: string|null, to?: string|null}>} battery
 * @property {Array<{stat: string, cost?: string|null, unit?: string, priceEntity?: string|null, priceNumber?: number|null}>} gas
 * @property {Array<{stat: string, cost?: string|null, unit?: string}>} water
 * @property {Array<{stat: string, name?: string|null, includedInStat?: string|null, statRate?: string|null}>} devices
 * @property {{version: number, entityArea: Record<string, string>, areas: Record<string, {name: string, floor_id?: string}>, floors: Record<string, {name: string, level?: number}>}|null} areaContext
 * @property {string|null} currency
 * @property {string|null} co2SignalEntity
 * @property {string|null} electricityPriceEntity
 * @property {string|null} gasPriceEntity
 * @property {string|null} batteryAvailableKwhEntity  Optional: remaining energy (kWh/Wh) **or** SoC % sensor for ring + “power now”.
 * @property {string|null} batteryCapacityKwhEntity   Optional: usable capacity (kWh); with available → SOC % on web.
 * @property {PowerEntities} powerEntities
 */

const HA_EXPORTER_ELECTRICITY_PRICE = 'ha_exporter_electricity_price_entity';
const HA_EXPORTER_GAS_PRICE = 'ha_exporter_gas_price_entity';
const HA_EXPORTER_BATTERY_AVAILABLE_KWH = 'ha_exporter_battery_available_kwh_entity';
const HA_EXPORTER_BATTERY_CAPACITY_KWH = 'ha_exporter_battery_capacity_kwh_entity';

/** @param {unknown} n */
function readPriceNumber(n) {
  if (typeof n === 'number' && Number.isFinite(n)) return n;
  if (typeof n === 'string' && n.trim() !== '') {
    const normalized = String(n).trim().replace(/\s/g, '').replace(',', '.');
    const v = Number(normalized);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

/** Recorder / API may return numbers as strings; EU decimals often use `,`. */
export function parseScalarNumber(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === 'unknown' || trimmed === 'unavailable') {
      return null;
    }
    const normalized = trimmed.replace(/\s/g, '').replace(',', '.');
    const v = Number(normalized);
    if (Number.isFinite(v)) return v;
    // Tariff helpers often show "0.29 EUR/kWh", "€ 0,29", etc. — take first decimal token.
    const m = trimmed.match(/-?\d+(?:[.,]\d+)?(?:e[+-]?\d+)?/i);
    if (!m) return null;
    const v2 = Number(m[0].replace(',', '.'));
    return Number.isFinite(v2) ? v2 : null;
  }
  return null;
}

/**
 * Energy dashboard price field (`entity_energy_price`): usually an entity_id string;
 * some exports use trimmed ids or a small object shape.
 * @param {unknown} e
 */
function readPriceEntity(e) {
  if (typeof e === 'string') {
    const s = e.trim();
    return s ? s : null;
  }
  if (typeof e === 'number' && Number.isFinite(e)) return String(e);
  if (e && typeof e === 'object' && typeof e.entity_id === 'string') {
    const s = e.entity_id.trim();
    return s ? s : null;
  }
  return null;
}

/**
 * Normalise recorder statistic ids from HA `energy_prefs` (usually strings;
 * some exports / edge cases carry numbers or stray whitespace).
 * @param {unknown} v
 * @returns {string|null}
 */
export function readStatisticId(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string') {
    const s = v.trim();
    return s ? s : null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

// Read either `source.<key>` or `source.power_config.<key>` because HA
// accepts both locations depending on how the dashboard was configured.
function readRate(source, key) {
  const direct = source?.[key];
  if (typeof direct === 'string' && direct) return direct;
  const nested = source?.power_config?.[key];
  if (typeof nested === 'string' && nested) return nested;
  return null;
}

/** @returns {EnergyModel} */
export function buildEnergyModel(prefs) {
  /** @type {EnergyModel} */
  const empty = {
    grid: [],
    solar: [],
    battery: [],
    gas: [],
    water: [],
    devices: [],
    currency: null,
    co2SignalEntity: null,
    electricityPriceEntity: null,
    gasPriceEntity: null,
    batteryAvailableKwhEntity: null,
    batteryCapacityKwhEntity: null,
    powerEntities: {
      grid: null,
      solar: null,
      batteryOut: null,
      batteryIn: null,
    },
    areaContext: null,
  };
  if (!prefs || typeof prefs !== 'object') return empty;

  const model = {
    ...empty,
    powerEntities: { ...empty.powerEntities },
  };
  model.currency = prefs.currency ?? null;

  const ac = prefs.ha_exporter_area_context;
  if (ac && typeof ac === 'object' && ac.version === 1) {
    const entityArea = typeof ac.entity_area === 'object' && ac.entity_area
      ? { ...ac.entity_area }
      : {};
    const areas = typeof ac.areas === 'object' && ac.areas ? { ...ac.areas } : {};
    const floors = typeof ac.floors === 'object' && ac.floors ? { ...ac.floors } : {};
    model.areaContext = {
      version: 1,
      entityArea,
      areas,
      floors,
    };
  } else {
    model.areaContext = null;
  }

  // Electricity Maps / CO₂ Signal integration: HA tracks a single sensor
  // here whose state is the grid's fossil-fuel percentage.
  const co2 = prefs.co2signal_config;
  if (co2 && typeof co2 === 'object') {
    model.co2SignalEntity = readStatisticId(co2.entity);
  }

  model.electricityPriceEntity = readStatisticId(prefs[HA_EXPORTER_ELECTRICITY_PRICE]);
  model.gasPriceEntity = readStatisticId(prefs[HA_EXPORTER_GAS_PRICE]);
  model.batteryAvailableKwhEntity = readStatisticId(
    prefs[HA_EXPORTER_BATTERY_AVAILABLE_KWH],
  );
  model.batteryCapacityKwhEntity = readStatisticId(
    prefs[HA_EXPORTER_BATTERY_CAPACITY_KWH],
  );

  for (const source of prefs.energy_sources ?? []) {
    if (!source || typeof source !== 'object') continue;
    switch (source.type) {
      case 'grid': {
        // HA exposes two grid schemas in the wild:
        //
        //   (a) Modern: `flow_from: [{stat_energy_from}]`,
        //       `flow_to: [{stat_energy_to}]` — one entry per meter.
        //   (b) Flat:   `stat_energy_from` and `stat_energy_to` directly on
        //       the source object. Seen in installs that were set up via
        //       older HA versions or by integrations that write prefs by
        //       hand (e.g. some bidirectional-meter or battery-inverter
        //       addons).
        //
        // We accept both. Duplicates are impossible here because the two
        // schemas are mutually exclusive per source in practice, but even
        // if both were present, they'd just produce extra rows — the UI
        // sums them by stat_id via `totalsByStat`.
        for (const flow of source.flow_from ?? []) {
          const from = readStatisticId(flow.stat_energy_from);
          if (!from) continue;
          model.grid.push({
            from,
            fromCost: readStatisticId(flow.stat_cost),
            fromPriceEntity: readPriceEntity(flow.entity_energy_price),
            fromPriceNumber: readPriceNumber(flow.number_energy_price),
          });
        }
        for (const flow of source.flow_to ?? []) {
          const to = readStatisticId(flow.stat_energy_to);
          if (!to) continue;
          model.grid.push({
            from: '',
            to,
            toCompensation: readStatisticId(flow.stat_compensation),
            toPriceEntity: readPriceEntity(flow.entity_energy_price),
            toPriceNumber: readPriceNumber(flow.number_energy_price),
          });
        }
        if (readStatisticId(source.stat_energy_from) && !(source.flow_from?.length)) {
          model.grid.push({
            from: readStatisticId(source.stat_energy_from),
            fromCost: readStatisticId(source.stat_cost),
            fromPriceEntity: readPriceEntity(source.entity_energy_price),
            fromPriceNumber: readPriceNumber(source.number_energy_price),
          });
        }
        if (readStatisticId(source.stat_energy_to) && !(source.flow_to?.length)) {
          model.grid.push({
            from: '',
            to: readStatisticId(source.stat_energy_to),
            toCompensation: readStatisticId(source.stat_compensation),
            toPriceEntity: readPriceEntity(source.entity_energy_price_export),
            toPriceNumber: readPriceNumber(source.number_energy_price_export),
          });
        }
        // Live-power sensor for the grid — a single signed net-power
        // reading in HA, typically >0 when importing and <0 when exporting.
        const gridRate = readRate(source, 'stat_rate');
        if (gridRate) model.powerEntities.grid = gridRate;
        break;
      }
      case 'solar': {
        const solarStat = readStatisticId(source.stat_energy_from);
        if (solarStat) {
          model.solar.push({ stat: solarStat });
        }
        const solarRate = readRate(source, 'stat_rate');
        if (solarRate) model.powerEntities.solar = solarRate;
        break;
      }
      case 'battery': {
        model.battery.push({
          from: readStatisticId(source.stat_energy_from),
          to: readStatisticId(source.stat_energy_to),
        });
        // Batteries expose two separate rate sensors — discharge (from) and
        // charge (to) — under `power_config`. We prefer those over the
        // aggregate `stat_rate` which is a signed net value.
        const rateFrom = readRate(source, 'stat_rate_from');
        const rateTo = readRate(source, 'stat_rate_to');
        if (rateFrom) model.powerEntities.batteryOut = rateFrom;
        if (rateTo) model.powerEntities.batteryIn = rateTo;
        break;
      }
      case 'gas': {
        const gasStat = readStatisticId(source.stat_energy_from);
        if (gasStat) {
          model.gas.push({
            stat: gasStat,
            cost: readStatisticId(source.stat_cost),
            unit: source.unit_of_measurement ?? 'm³',
            priceEntity: readPriceEntity(source.entity_energy_price),
            priceNumber: readPriceNumber(source.number_energy_price),
          });
        }
        break;
      }
      case 'water': {
        const waterStat = readStatisticId(source.stat_energy_from);
        if (waterStat) {
          model.water.push({
            stat: waterStat,
            cost: readStatisticId(source.stat_cost),
            unit: source.unit_of_measurement ?? 'm³',
          });
        }
        break;
      }
      default:
        break;
    }
  }

  for (const device of prefs.device_consumption ?? []) {
    const devStat = readStatisticId(device?.stat_consumption);
    if (devStat) {
      model.devices.push({
        stat: devStat,
        name: device.name ?? null,
        // Parent meter in the Energy dashboard — this device's kWh is included
        // in the parent's total; summing both would double-count (see HA
        // DeviceConsumption.included_in_stat).
        includedInStat: readStatisticId(device.included_in_stat),
        statRate:
          typeof device.stat_rate === 'string' && device.stat_rate
            ? device.stat_rate
            : null,
      });
    }
  }

  return model;
}

/**
 * All statistic_ids referenced by the model. Useful for batch fetching.
 */
export function allStatIdsFromModel(model) {
  const ids = new Set();
  const push = (v) => {
    if (typeof v === 'string' && v) ids.add(v);
  };
  for (const g of model.grid) {
    push(g.from);
    push(g.fromCost);
    push(g.fromPriceEntity);
    push(g.to);
    push(g.toCompensation);
    push(g.toPriceEntity);
  }
  for (const s of model.solar) push(s.stat);
  for (const b of model.battery) {
    push(b.from);
    push(b.to);
  }
  for (const g of model.gas) {
    push(g.stat);
    push(g.cost);
    push(g.priceEntity);
  }
  for (const w of model.water) {
    push(w.stat);
    push(w.cost);
  }
  for (const d of model.devices) push(d.stat);
  if (model.co2SignalEntity) push(model.co2SignalEntity);
  if (model.electricityPriceEntity) push(model.electricityPriceEntity);
  if (model.gasPriceEntity) push(model.gasPriceEntity);
  return Array.from(ids);
}

/**
 * kWh-weighted mean import price from Energy dashboard grid rows
 * (`entity_energy_price` / `number_energy_price` on each import flow).
 *
 * @param {EnergyModel} model
 * @param {Map<string, number>} totalsByStat
 * @param {Map<string, number>} meanPriceByStatId
 */
export function weightedGridImportPrice(model, totalsByStat, meanPriceByStatId) {
  let kwhSum = 0;
  let costSum = 0;
  for (const g of model.grid ?? []) {
    if (!g.from) continue;
    const kwh = totalsByStat.get(g.from);
    if (kwh == null || !Number.isFinite(kwh) || kwh <= 0) continue;
    let unit = null;
    if (g.fromPriceEntity) {
      unit = meanPriceByStatId.get(g.fromPriceEntity) ?? null;
    } else if (g.fromPriceNumber != null) {
      unit = g.fromPriceNumber;
    }
    if (unit != null && Number.isFinite(unit)) {
      kwhSum += kwh;
      costSum += kwh * unit;
    }
  }
  return kwhSum > 0 ? costSum / kwhSum : null;
}

/**
 * Gas spend from dashboard price entity / fixed number when `stat_cost` is absent.
 *
 * @param {EnergyModel} model
 * @param {Map<string, number>} totalsByStat
 * @param {Map<string, number>} meanPriceByStatId
 */
export function gasSpendFromEnergyPrefs(model, totalsByStat, meanPriceByStatId) {
  let total = 0;
  let any = false;
  for (const g of model.gas ?? []) {
    const vol = totalsByStat.get(g.stat);
    if (vol == null || !Number.isFinite(vol) || vol <= 0) continue;
    let unit = null;
    if (g.priceEntity) {
      unit = meanPriceByStatId.get(g.priceEntity) ?? null;
    } else if (g.priceNumber != null) {
      unit = g.priceNumber;
    }
    if (unit != null && Number.isFinite(unit)) {
      total += vol * unit;
      any = true;
    }
  }
  return any ? total : null;
}

/**
 * Average the state/mean values of a statistics series. Used for percentage
 * sensors (CO₂ signal fossil-fuel %) where summing makes no sense — we want
 * a representative value over the period.
 *
 * Prefers `mean` (HA's per-hour average) over `state` (last value of the
 * hour) when both are available, and weights each hour equally.
 *
 * @param {Array<{mean?: number|null, state?: number|null}>} points
 */
export function meanOfPoints(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  let sum = 0;
  let n = 0;
  for (const p of points) {
    const v = parseScalarNumber(p.mean) ?? parseScalarNumber(p.state);
    if (v != null) {
      sum += v;
      n += 1;
    }
  }
  return n === 0 ? null : sum / n;
}

/**
 * Electricity Maps / CO₂ Signal: HA does **not** use a plain average of the
 * hourly fossil-fuel percentages. Hours with more grid import should weigh
 * more (that hour's grid mix mattered more for your footprint). This matches
 * that behaviour closely enough that "CO₂-neutral consumption" lines up with
 * the Energy dashboard.
 *
 * @param {EnergyModel|null} model
 * @param {Array<{statId?: string, data?: {deltas?: Array<{start: string, value: number}>}}>} statsResults  `useManyStatistics(...).results`
 * @param {string} co2EntityId  Statistic id (same as entity_id in HA prefs)
 * @returns {number|null}  Weighted mean fossil % (0–100), or null
 */
/** Normalize any ISO-like bucket start to a canonical UTC hour id for joins. */
function utcHourKey(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(Math.floor(t / 3_600_000) * 3_600_000).toISOString();
}

export function weightedFossilPercentForGrid(
  model,
  statsResults,
  co2EntityId,
) {
  if (!model || !co2EntityId || !Array.isArray(statsResults)) return null;
  const co2Result = statsResults.find((r) => r.statId === co2EntityId);
  const points = co2Result?.data?.points;
  if (!Array.isArray(points) || points.length === 0) return null;

  /** @type {Map<string, number>} */
  const importKwhByHour = new Map();
  for (const g of model.grid ?? []) {
    if (!g.from) continue;
    const r = statsResults.find((x) => x.statId === g.from);
    for (const d of r?.data?.deltas ?? []) {
      const v = Number(d.value);
      if (!Number.isFinite(v) || v <= 0) continue;
      const k = utcHourKey(d.start);
      if (!k) continue;
      importKwhByHour.set(k, (importKwhByHour.get(k) ?? 0) + v);
    }
  }

  let num = 0;
  let den = 0;
  for (const p of points) {
    if (!p.period_start) continue;
    const k = utcHourKey(p.period_start);
    if (!k) continue;
    const gridKwh = importKwhByHour.get(k) ?? 0;
    if (gridKwh <= 0) continue;
      const fossilRaw = parseScalarNumber(p.mean) ?? parseScalarNumber(p.state);
      if (fossilRaw == null) continue;
      num += fossilRaw * gridKwh;
    den += gridKwh;
  }
  if (den <= 0) return meanOfPoints(points);
  return num / den;
}

/**
 * Representative €/kWh or €/m³ from hourly statistic rows when some buckets
 * only have partial columns populated (common for tariff / price sensors).
 *
 * @param {Array<{mean?: number|null, state?: number|null, min?: number|null, max?: number|null}>} points
 */
export function representativeUnitPriceFromPoints(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const avg = meanOfPoints(points);
  if (avg != null) return avg;
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    for (const key of ['mean', 'state', 'min', 'max']) {
      const v = parseScalarNumber(p[key]);
      if (v != null) return v;
    }
  }
  return null;
}

/**
 * Mean price (or other scalar statistic) per statistic_id from fetched results.
 *
 * @param {Array<{statId?: string, data?: {points?: Array}}>} statsResults
 * @returns {Map<string, number>}
 */
export function meanPriceByStatIdFromResults(statsResults) {
  const m = new Map();
  if (!Array.isArray(statsResults)) return m;
  for (const r of statsResults) {
    if (!r?.statId || !r.data?.points?.length) continue;
    const avg = representativeUnitPriceFromPoints(r.data.points);
    if (avg != null && Number.isFinite(avg)) m.set(r.statId, avg);
  }
  return m;
}

/**
 * Entity ids used as €/kWh or €/m³ price inputs (Energy dashboard + exporter overrides).
 *
 * @param {EnergyModel | null | undefined} model
 * @returns {string[]}
 */
export function allPriceEntityIdsFromModel(model) {
  if (!model) return [];
  const ids = new Set();
  for (const g of model.grid ?? []) {
    if (g.fromPriceEntity) ids.add(g.fromPriceEntity);
    if (g.toPriceEntity) ids.add(g.toPriceEntity);
  }
  for (const g of model.gas ?? []) {
    if (g.priceEntity) ids.add(g.priceEntity);
  }
  if (model.electricityPriceEntity) ids.add(model.electricityPriceEntity);
  if (model.gasPriceEntity) ids.add(model.gasPriceEntity);
  return Array.from(ids);
}

/**
 * Apply unit prices from latest pushed HA state. Static contract / template
 * tariff sensors often have no useful window statistics; when a live state
 * exists it should win over sparse or stale statistic-derived means.
 *
 * @param {Map<string, number>} meanByStat
 * @param {EnergyModel | null | undefined} model
 * @param {Map<string, {state?: string}>} [latestByEntity]
 */
export function mergeLatestStateUnitPrices(meanByStat, model, latestByEntity) {
  const out = new Map(meanByStat);
  if (!latestByEntity?.size) return out;
  for (const id of allPriceEntityIdsFromModel(model)) {
    const row = latestByEntity.get(id);
    if (row == null || row.state === '' || row.state == null) continue;
    const n = parseScalarNumber(row.state);
    if (n != null) out.set(id, n);
  }
  return out;
}

/**
 * Last ingested hourly bucket per statistic (GET /statistics/latest). Fills
 * unit prices when the selected window has no rows but the DB still has a
 * recent tariff sample — common when state history was pruned but stats remain.
 *
 * @param {Map<string, number>} meanByStat
 * @param {EnergyModel|null|undefined} model
 * @param {Array<{ statistic_id?: string, mean?: unknown, state?: unknown, min?: unknown, max?: unknown }>} [latestRows]
 * @returns {Map<string, number>}
 */
export function mergeMeanPricesFromLatestStatistics(meanByStat, model, latestRows) {
  const out = new Map(meanByStat);
  if (!model || !Array.isArray(latestRows) || latestRows.length === 0) return out;
  const byId = new Map();
  for (const r of latestRows) {
    const sid = r?.statistic_id;
    if (typeof sid === 'string' && sid) byId.set(sid, r);
  }
  for (const id of allPriceEntityIdsFromModel(model)) {
    if (out.has(id)) continue;
    const row = byId.get(id);
    if (!row) continue;
    const v = representativeUnitPriceFromPoints([
      {
        mean: row.mean,
        state: row.state,
        min: row.min,
        max: row.max,
      },
    ]);
    if (v != null && Number.isFinite(v)) out.set(id, v);
  }
  return out;
}

/**
 * Fill missing €/kWh or €/m³ keys from `fallback` (e.g. lifetime window) when
 * `primary` has no hourly samples — tariff sensors often have empty statistics
 * for a single past day while cumulative energy still exists.
 *
 * @param {Map<string, number>} primary
 * @param {Map<string, number>} fallback
 * @returns {Map<string, number>}
 */
export function mergeMeanPriceMaps(primary, fallback) {
  const out = new Map(primary);
  if (!fallback?.size) return out;
  for (const [k, v] of fallback) {
    if (out.has(k)) continue;
    if (v != null && Number.isFinite(v)) out.set(k, v);
  }
  return out;
}

/**
 * Scale a cumulative statistics row to kWh so deltas/totals match the Energy
 * dashboard. Home Assistant stores `sum` in the sensor’s native unit; some
 * individual devices (e.g. Shelly) report `Wh` and look like 146 000 "kWh" if
 * the numbers are read as kWh.
 *
 * @param {string | null | undefined} uom
 * @returns {number}  Factor to multiply cumulative `sum` by to get kWh
 */
function kwhMultiplierFromUnit(uom) {
  const u = String(uom || '')
    .trim()
    .toLowerCase()
    .replace(/\s/g, '')
    .replace('²', '2');
  if (u === 'wh' || u === 'w·h') return 0.001;
  if (u === 'mwh' || u === 'megawatt-hour') return 1000;
  if (u === 'mj' || u === 'megajoule') return 1 / 3.6;
  // e.g. IPMI/ESPHome "energy" sensors — recorder stores sum in Joules
  if (u === 'j' || u === 'joule' || u === 'joules') return 1 / 3_600_000;
  if (u === 'kj' || u === 'kilojoule' || u === 'kilojoules') return 1 / 3600;
  if (u === 'gj' || u === 'gigajoule') return 1000 / 3.6; // 1 GJ = 1e9/3.6e6 kWh
  return 1;
}

/**
 * @param {number | null | undefined} n
 * @param {string | null | undefined} uom
 * @returns {number | null}
 */
function scaleCumulativeToKwh(n, uom) {
  if (n == null) return n;
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return v * kwhMultiplierFromUnit(uom);
}

/**
 * @param {object} row  One statistics row (anchor or in-range point)
 * @returns {object}   Same shape; Wh/MWh/MJ scaled to kWh, EUR/… unchanged
 */
export function normalizeCumulativeRowToKwh(row) {
  if (!row || typeof row !== 'object') return row;
  const u = row.unit ?? null;
  if (kwhMultiplierFromUnit(u) === 1) return { ...row };
  return {
    ...row,
    sum: row.sum != null ? scaleCumulativeToKwh(row.sum, u) : row.sum,
    state: row.state != null ? scaleCumulativeToKwh(row.state, u) : row.state,
    mean: row.mean != null ? scaleCumulativeToKwh(row.mean, u) : row.mean,
    min: row.min != null ? scaleCumulativeToKwh(row.min, u) : row.min,
    max: row.max != null ? scaleCumulativeToKwh(row.max, u) : row.max,
    unit: 'kWh',
  };
}

/**
 * Sort statistic rows by `period_start` using real time, not string order.
 * Mixed ISO forms (`...+00:00` vs `....000Z`) sort incorrectly as plain TEXT
 * in SQLite, so the API can return rows out of chronological order — that
 * breaks cumulative deltas and any `last − first` math unless we fix order
 * here (works even if an older server build is still running).
 */
export function sortStatisticsPointsAscending(points) {
  if (!Array.isArray(points)) return [];
  return [...points].sort((a, b) => {
    const ta = Date.parse(a?.period_start ?? '');
    const tb = Date.parse(b?.period_start ?? '');
    const da = Number.isFinite(ta) ? ta : 0;
    const db = Number.isFinite(tb) ? tb : 0;
    return da - db;
  });
}

/**
 * @param {Array<object>} [points]
 * @param {object | null} [anchor]
 * @returns {{ points: Array<object>, anchor: object | null }}
 */
export function normalizeCumulativeStatsToKwh(points, anchor) {
  const sorted = sortStatisticsPointsAscending(Array.isArray(points) ? points : []);
  const p = sorted.map((x) => normalizeCumulativeRowToKwh(x));
  const a = anchor && typeof anchor === 'object' ? normalizeCumulativeRowToKwh(anchor) : null;
  return { points: p, anchor: a };
}

/** Currency / cost statistics — meter-glitch heuristics must not touch these. */
export function isMonetaryStatisticsUnit(unit) {
  const s = String(unit ?? '')
    .toLowerCase()
    .replace(/\s/g, '');
  return (
    s.includes('eur') ||
    s.includes('chf') ||
    s.includes('usd') ||
    s.includes('gbp') ||
    s.includes('sek') ||
    s.includes('nok') ||
    s.includes('dkk') ||
    s.includes('pln') ||
    s.includes('cost') ||
    s.includes('€') ||
    s.includes('£') ||
    s.includes('$')
  );
}

/** Cumulative reading dropped to ~zero while still high before — typical bad sample. */
const GLITCH_PREV_MIN_KWH = 0.02;
const GLITCH_DROP_RATIO = 0.08;
const GLITCH_RECOVER_RATIO = 0.86;

/**
 * @param {number} prevSum  Previous bucket cumulative `sum` (kWh-like after normalise).
 * @param {number} sum      Current bucket cumulative `sum`.
 * @param {string|null|undefined} unit
 */
export function isNearZeroCumulativeGlitch(prevSum, sum, unit) {
  if (isMonetaryStatisticsUnit(unit)) return false;
  if (!Number.isFinite(prevSum) || !Number.isFinite(sum)) return false;
  if (prevSum < GLITCH_PREV_MIN_KWH) return false;
  return sum <= prevSum * GLITCH_DROP_RATIO;
}

/**
 * Turn a series of cumulative `sum` points into per-bucket deltas.
 *
 * IMPORTANT: only `sum` is treated as cumulative. `state` is meaningless as a
 * delta — for `state_class: measurement` sensors (e.g. power meters) it's the
 * raw instantaneous reading (or the lifetime counter), not energy used in the
 * bucket. Earlier versions of this code used to fall back to state when sum
 * was null, which made Sankey totals explode with values like
 * "Server CPU 123 420 kWh" coming from a single lifetime reading.
 *
 * Counter resets (sum decreasing) are clamped to zero — this guards against
 * inverter/meter rollovers without inventing a synthetic spike.
 *
 * **Near-zero glitch:** some energy meters briefly report `sum ≈ 0` then jump
 * back. A naive chain treats the rebound as one bucket consuming almost the
 * entire lifetime reading. For non-monetary units we detect that collapse and,
 * after the valley, attribute `current − last_good_plateau` instead of
 * `current − glitch_reading`.
 *
 * Pass `anchor` (the row immediately preceding the requested window — the
 * server returns it on every /statistics response) to recover the delta for
 * the FIRST in-range bucket. Without it, delta-based totals lose the first
 * bucket of every window, which is exactly the off-by-one that makes our
 * daily totals run a hair below HA's.
 *
 * @param {Array<{period_start: string, sum: number|null, state: number|null, unit: string|null}>} points
 * @param {{sum?: number|null}|null} [anchor]
 * @param {{ maxDeltaKwh?: number|null }} [options]  Optional cap on the “ramp
 *   from glitch” bucket when recovery vs plateau is ambiguous (5‑minute data
 *   can pass a tighter cap than hourly).
 * @returns {Array<{start: string, value: number, unit: string|null}>}
 */
export function pointsToHourlyDeltas(points, anchor = null, options = {}) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const sorted = sortStatisticsPointsAscending(points);
  const out = [];
  let prev = anchor && anchor.sum != null ? Number(anchor.sum) : null;
  /** @type {number|null} */
  let pendingRecover = null;
  const maxCap =
    options.maxDeltaKwh != null && Number.isFinite(options.maxDeltaKwh)
      ? options.maxDeltaKwh
      : null;

  for (const p of sorted) {
    if (p.sum == null) {
      // Skip buckets with no cumulative reading but **keep** `prev`. Gaps in
      // long-term hourly stats (common for solar / battery when the recorder
      // omits `sum` for some hours) would otherwise reset the chain and drop
      // every subsequent delta until the next anchor — totals read low vs HA.
      continue;
    }
    const sum = Number(p.sum);
    if (!Number.isFinite(sum)) continue;
    const u = p.unit ?? null;

    if (prev != null) {
      let value;
      if (pendingRecover != null) {
        if (sum >= pendingRecover * GLITCH_RECOVER_RATIO) {
          value = Math.max(0, sum - pendingRecover);
          pendingRecover = null;
        } else {
          // Still in the bad valley (or a slow climb from zero) — no energy yet.
          value = 0;
        }
      } else if (isNearZeroCumulativeGlitch(prev, sum, u)) {
        value = 0;
        pendingRecover = prev;
      } else {
        value = sum - prev;
        if (value < 0) value = 0;
        if (maxCap != null && value > maxCap) value = maxCap;
      }
      out.push({
        start: p.period_start,
        value,
        unit: u,
      });
    }
    prev = sum;
  }
  return out;
}

/**
 * Sum total value over a delta series.
 */
export function sumDeltas(deltas) {
  let total = 0;
  for (const d of deltas) total += d.value || 0;
  return total;
}

/**
 * `totalStatisticPeriodTotal` can return 0 when the anchor/`sum` chain misses
 * the first bucket (common) or monetary rows are sparse, while `sumDeltas`
 * still reflects the window. Prefer a non-zero delta sum in that case.
 *
 * @param {number} spanTotal
 * @param {Array<{ value?: number }>} deltas
 */
export function resolveStatisticWindowTotal(spanTotal, deltas) {
  const dSum =
    Array.isArray(deltas) && deltas.length > 0 ? sumDeltas(deltas) : null;
  if (Number.isFinite(spanTotal)) {
    if (spanTotal !== 0) return spanTotal;
    if (dSum != null && Number.isFinite(dSum) && dSum !== 0) return dSum;
    return spanTotal;
  }
  if (dSum != null && Number.isFinite(dSum)) return dSum;
  return 0;
}

/**
 * Approximate period use as last−first when only sparse samples are available.
 * Pass an `anchor` row (the one preceding the window) to make this work even
 * with a single in-range bucket — that's the typical case when the user opens
 * a "today" view shortly after midnight.
 *
 * @param {Array<{sum?: number|null}>} points
 * @param {{sum?: number|null}|null} [anchor]
 */
export function cumulativeSpanTotal(points, anchor = null) {
  if (!Array.isArray(points)) return null;
  const sorted = sortStatisticsPointsAscending(
    points.filter((p) => p.sum != null && Number.isFinite(Number(p.sum))),
  );
  if (sorted.length === 0) return null;
  const lastSum = Number(sorted[sorted.length - 1].sum);
  if (anchor && anchor.sum != null && Number.isFinite(Number(anchor.sum))) {
    const d = lastSum - Number(anchor.sum);
    return d < 0 ? 0 : d;
  }
  if (sorted.length < 2) return null;
  const d = lastSum - Number(sorted[0].sum);
  return d < 0 ? 0 : d;
}

/**
 * Total usage or cost over the requested window.
 *
 * When the server supplies an **anchor** (reading just before the window),
 * use `last_sum − anchor_sum` on **time-sorted** points. That matches HA's
 * cumulative definition and is immune to per-hour delta ordering bugs when
 * rows were returned out of chronological order.
 *
 * Without an anchor, fall back to summed deltas (first bucket may be low vs HA
 * until backfill provides a preceding row).
 *
 * @param {Array<{period_start?: string, sum?: number|null, state?: number|null, mean?: number|null, unit?: string|null}>} points
 * @param {{sum?: number|null}|null} [anchor]
 * @param {{ maxDeltaKwh?: number, firstInWindow?: { sum?: number|null, period_start?: string }|null, lastInWindow?: { sum?: number|null, period_start?: string }|null }} [options] `first` /
 *   `last` from the server (non-null `sum` only) define the cumulative window. Prefer
 *   `lastInWindow` over the last row in `points` — the chart may omit the latest hours when
 *   `sum` is null, which made lifetime totals look like a single day.
 */
export function totalStatisticPeriodTotal(points, anchor = null, options = {}) {
  const firstInWindow = options?.firstInWindow ?? null;
  const lastInWindow = options?.lastInWindow ?? null;
  const deltaOpts =
    options?.maxDeltaKwh != null && Number.isFinite(options.maxDeltaKwh)
      ? { maxDeltaKwh: options.maxDeltaKwh }
      : {};
  const sorted = sortStatisticsPointsAscending(
    (Array.isArray(points) ? points : []).filter(
      (p) => p && p.sum != null && Number.isFinite(Number(p.sum)),
    ),
  );
  const lastP = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  const lastE =
    lastInWindow && lastInWindow.sum != null && Number.isFinite(Number(lastInWindow.sum))
      ? lastInWindow
      : lastP;
  if (lastE) {
    if (anchor && anchor.sum != null && Number.isFinite(Number(anchor.sum))) {
      const d = Number(lastE.sum) - Number(anchor.sum);
      return d < 0 ? 0 : d;
    }
    if (firstInWindow && firstInWindow.sum != null && Number.isFinite(Number(firstInWindow.sum))) {
      const tf = firstInWindow.period_start
        ? Date.parse(String(firstInWindow.period_start))
        : NaN;
      const tl = lastE.period_start ? Date.parse(String(lastE.period_start)) : NaN;
      const sameBucket =
        Number.isFinite(tf) && Number.isFinite(tl) && tf === tl;
      if (!sameBucket) {
        const d = Number(lastE.sum) - Number(firstInWindow.sum);
        return d < 0 ? 0 : d;
      }
    }
  }
  const deltas = pointsToHourlyDeltas(points, anchor, deltaOpts);
  if (deltas.length > 0) return sumDeltas(deltas);
  const span = cumulativeSpanTotal(points, anchor);
  return span != null ? span : 0;
}

/**
 * Split dashboard kWh totals into flows shown on HA-style energy diagrams.
 * Uses the same “solar first” ordering as `powerTimeline.js`:
 * export is covered by solar production before battery; battery charge is
 * covered by remaining solar before grid import. Over long ranges where
 * solar/export/battery phases do not line up in time, this is an approximation.
 *
 * @param {number} solar
 * @param {number} gridIn
 * @param {number} gridOut
 * @param {number} batteryIn
 * @param {number} batteryOut
 */
export function splitEnergyDashboardTotals(solar, gridIn, gridOut, batteryIn, batteryOut) {
  const S = Math.max(0, Number(solar) || 0);
  const Gi = Math.max(0, Number(gridIn) || 0);
  const Go = Math.max(0, Number(gridOut) || 0);
  const Bin = Math.max(0, Number(batteryIn) || 0);
  const Bout = Math.max(0, Number(batteryOut) || 0);

  const solarToGrid = Math.min(S, Go);
  const solarToBattery = Math.min(Math.max(0, S - solarToGrid), Bin);
  const solarToHome = Math.max(0, S - solarToGrid - solarToBattery);

  const gridToBattery = Math.max(0, Bin - solarToBattery);
  const batteryToGrid = Math.max(0, Math.min(Bout, Go - solarToGrid));
  const batteryToHome = Math.max(0, Bout - batteryToGrid);
  const gridToHome = Math.max(0, Gi - gridToBattery);

  return {
    solarToGrid,
    solarToBattery,
    solarToHome,
    gridToBattery,
    batteryToGrid,
    batteryToHome,
    gridToHome,
  };
}

/**
 * Statistic ids where HA / inverters often write long-term buckets only when
 * the value moves — and where the exporter may have started mid-day, so the
 * server has a **late first sample** vs the selected calendar range. Grid
 * import is usually dense every hour and is intentionally omitted here.
 *
 * @param {EnergyModel | null | undefined} model
 * @returns {string[]}
 */
export function cumulativeFlowStatIdsForCoverage(model) {
  if (!model) return [];
  return [
    ...model.solar.map((s) => s.stat),
    ...model.battery.flatMap((b) => [b.from, b.to].filter(Boolean)),
    ...model.gas.map((g) => g.stat),
  ].filter(Boolean);
}

/**
 * Largest gap (ms) between `rangeStartIso` and the earliest `period_start`
 * among the listed stats' **first returned point** (points must be sorted ASC
 * by time, as after `normalizeCumulativeStatsToKwh`). Used to detect
 * incomplete history on the server vs Home Assistant's full recorder.
 *
 * @param {string} rangeStartIso
 * @param {Array<{statId?: string, data?: {points?: Array<{period_start?: string}>}}>} statsResults
 * @param {string[]} statIds
 */
export function maxStatisticCoverageLagMs(rangeStartIso, statsResults, statIds) {
  if (!rangeStartIso || !Array.isArray(statsResults) || !statIds?.length) return 0;
  const startMs = Date.parse(rangeStartIso);
  if (!Number.isFinite(startMs)) return 0;
  let maxLag = 0;
  for (const id of statIds) {
    const r = statsResults.find((x) => x.statId === id);
    const pts = r?.data?.points;
    if (!Array.isArray(pts) || pts.length === 0) continue;
    const t0 = Date.parse(pts[0]?.period_start ?? '');
    if (!Number.isFinite(t0)) continue;
    maxLag = Math.max(maxLag, Math.max(0, t0 - startMs));
  }
  return maxLag;
}
