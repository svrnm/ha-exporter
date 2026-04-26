import { reconcileDeviceKwhToHome } from './sankeyTotals.js';

const MIN_KWH = 0.01;
/** Minimum W to show a flow in live (stat_rate) mode — matches `PowerFlowSankey` */
const MIN_SANKEY_W = 1;
const MAX_ROOT_DEVICES = 7;

const UNASSIGNED_AREA = '__unassigned__';
const NO_FLOOR = '__no_floor__';

function shortId(statId) {
  const parts = String(statId).split('.');
  return parts[parts.length - 1];
}

/**
 * @param {import('./energyModel.js').EnergyModel} model
 * @param {(d: {stat: string, includedInStat?: string|null}) => boolean} isFlowRoot
 */
function shouldUseAreaLayer(model, isFlowRoot) {
  const ac = model.areaContext;
  if (!ac || ac.version !== 1 || !ac.entityArea) return false;
  const dash = model.devices;
  for (const d of dash) {
    if (!isFlowRoot(d)) continue;
    const aid = ac.entityArea[d.stat];
    if (typeof aid === 'string' && aid) return true;
  }
  return false;
}

/**
 * Whether to insert a floor column: more than one floor bucket, or a single
 * real floor (not the synthetic no-floor bucket).
 * @param {Array<{d: object, v: number}>} roots
 * @param {import('./energyModel.js').EnergyModel} model
 */
function shouldUseFloorColumn(roots, model) {
  const ac = model.areaContext;
  if (!ac) return false;
  const used = new Set();
  for (const { d } of roots) {
    const aid = ac.entityArea[d.stat] ?? null;
    if (!aid) {
      used.add(NO_FLOOR);
    } else {
      const f = ac.areas[aid]?.floor_id;
      const isReal = typeof f === 'string' && f;
      used.add(isReal ? f : NO_FLOOR);
    }
  }
  if (used.size > 1) return true;
  if (used.size === 1) {
    const u = used.values().next().value;
    return u !== NO_FLOOR;
  }
  return false;
}

/**
 * @param {string} floorId
 * @param {import('./energyModel.js').EnergyModel} model
 * @param {string} noFloorLabel
 */
function floorDisplayName(floorId, model, noFloorLabel) {
  if (floorId === NO_FLOOR) return noFloorLabel;
  const f = model.areaContext?.floors?.[floorId];
  return f?.name ?? shortId(floorId);
}

/**
 * @param {string} areaId
 * @param {import('./energyModel.js').EnergyModel} model
 * @param {string} unassignedLabel
 */
function areaDisplayName(areaId, model, unassignedLabel) {
  if (areaId === UNASSIGNED_AREA) return unassignedLabel;
  const a = model.areaContext?.areas?.[areaId];
  return a?.name ?? shortId(areaId);
}

/**
 * @param {import('./energyModel.js').EnergyModel} model
 * @param {(stat: string) => number} getValue  kWh or W per device `stat`, depending on `totals`
 * @param {number} minVisible
 * @param {number} restLinkMin  — “remaining in group” when parent splits into children
 * @param {{ gridIn: number, solarToHome: number, batteryOut: number, home: number}} totals
 * @param {object} ctx
 * @param {import('i18n').TFunction} ctx.t
 * @param {object} ctx.c  palette.energy
 * @param {object} ctx.theme
 * @param {string} ctx.groupRestLabel
 * @param {string} ctx.areaUnassignedLabel
 * @param {string} ctx.floorNoLevelLabel
 */
function buildHierarchicalSankeyFromValues(
  model,
  getValue,
  minVisible,
  restLinkMin,
  totals,
  { t, c, theme, groupRestLabel, areaUnassignedLabel, floorNoLevelLabel },
) {
  if (!model?.devices?.length) {
    return { nodes: [], links: [] };
  }

  const homeTotal = totals.home;
  const dash = model.devices;
  const statIds = new Set(dash.map((d) => d.stat).filter(Boolean));
  const isFlowRoot = (d) => {
    const p = d.includedInStat;
    if (!p) return true;
    return !statIds.has(p);
  };

  const byParent = new Map();
  for (const d of dash) {
    if (!d.includedInStat || !statIds.has(d.includedInStat)) continue;
    if (!byParent.has(d.includedInStat)) byParent.set(d.includedInStat, []);
    byParent.get(d.includedInStat).push(d);
  }
  for (const arr of byParent.values()) {
    arr.sort(
      (a, b) => (getValue(b.stat) ?? 0) - (getValue(a.stat) ?? 0),
    );
  }

  const nodes = [];
  const links = [];
  const add = (n) => {
    nodes.push(n);
    return nodes.length - 1;
  };

  const unassignedA = areaUnassignedLabel ?? t('electricity.sankeyAreaUnassigned');
  const noFloorL = floorNoLevelLabel ?? t('electricity.sankeyFloorNoLevel');

  const gridIdx =
    totals.gridIn > minVisible ? add({ name: t('summary.flow.grid'), color: c.grid }) : -1;
  const solarIdx =
    totals.solarToHome > minVisible
      ? add({ name: t('summary.flow.pv'), color: c.solar })
      : -1;
  const batteryIdx =
    totals.batteryOut > minVisible
      ? add({ name: t('summary.flow.battery'), color: c.battery })
      : -1;
  const homeIdx = add({ name: t('summary.flow.home'), color: c.home });

  if (gridIdx >= 0) {
    links.push({ source: gridIdx, target: homeIdx, value: totals.gridIn, color: c.grid });
  }
  if (solarIdx >= 0) {
    links.push({
      source: solarIdx,
      target: homeIdx,
      value: totals.solarToHome,
      color: c.solar,
    });
  }
  if (batteryIdx >= 0) {
    links.push({
      source: batteryIdx,
      target: homeIdx,
      value: totals.batteryOut,
      color: c.battery,
    });
  }

  const roots = dash
    .filter(isFlowRoot)
    .map((d) => ({ d, v: getValue(d.stat) }))
    .filter((x) => x.v > minVisible);
  roots.sort((a, b) => b.v - a.v);
  const top = roots.slice(0, MAX_ROOT_DEVICES);
  const tail = roots.slice(MAX_ROOT_DEVICES);

  /**
   * @param {object} dev
   * @param {number} parentIdx
   */
  function sub(dev, parentIdx) {
    const v = getValue(dev.stat);
    if (v < minVisible) return;

    const ch = byParent.get(dev.stat) ?? [];

    const col =
      ch.length > 0 ? theme.palette.text.secondary : theme.palette.text.primary;
    const idx = add({ name: dev.name || shortId(dev.stat), color: col, stat: dev.stat });

    links.push({ source: parentIdx, target: idx, value: v, color: c.home });

    let sumCh = 0;
    for (const c0 of ch) {
      const kv = getValue(c0.stat);
      if (kv < minVisible) continue;
      sumCh += kv;
      sub(c0, idx);
    }

    const rem = v - sumCh;
    if (ch.length > 0 && rem > restLinkMin) {
      const ridx = add({
        name: groupRestLabel,
        color: theme.palette.text.disabled,
        stat: null,
      });
      links.push({ source: idx, target: ridx, value: rem, color: c.home });
    }
  }

  const useArea = shouldUseAreaLayer(model, isFlowRoot);
  const useFloor = useArea && shouldUseFloorColumn(top, model);

  /**
   * @param {Array<{d: object, v: number}>} rootSlice
   * @param {number} fromIdx
   */
  function emitDeviceTreeFromParent(rootSlice, fromIdx) {
    for (const { d } of rootSlice) {
      sub(d, fromIdx);
    }
  }

  if (useArea) {
    const floorMap = new Map();

    for (const row of top) {
      const ac0 = model.areaContext;
      const aid = ac0?.entityArea?.[row.d.stat] ?? null;
      let floorId;
      let akey;
      if (!aid) {
        floorId = NO_FLOOR;
        akey = UNASSIGNED_AREA;
      } else {
        const finfo = ac0?.areas?.[aid];
        const fid = finfo?.floor_id;
        const isReal = typeof fid === 'string' && fid;
        floorId = isReal ? fid : NO_FLOOR;
        akey = aid;
      }
      if (!floorMap.has(floorId)) {
        floorMap.set(floorId, new Map());
      }
      const am = floorMap.get(floorId);
      const nm = areaDisplayName(akey, model, unassignedA);
      if (!am.has(akey)) {
        am.set(akey, { name: nm, rows: [] });
      }
      am.get(akey).rows.push(row);
    }

    const areaMuted = theme.palette.text.secondary;
    const floorMuted = theme.palette.text.primary;

    const floorOrder = [...floorMap.keys()];
    if (useFloor) {
      floorOrder.sort((a, b) => {
        if (a === NO_FLOOR) return 1;
        if (b === NO_FLOOR) return -1;
        const la = model.areaContext?.floors?.[a]?.level;
        const lb = model.areaContext?.floors?.[b]?.level;
        if (la != null && lb != null && la !== lb) return la - lb;
        return floorDisplayName(a, model, noFloorL).localeCompare(
          floorDisplayName(b, model, noFloorL),
        );
      });
    } else {
      const onlyAreas = new Map();
      for (const row of top) {
        const ac0 = model.areaContext;
        const aid = ac0?.entityArea?.[row.d.stat] ?? null;
        const akey = aid || UNASSIGNED_AREA;
        const nm = areaDisplayName(akey, model, unassignedA);
        if (!onlyAreas.has(akey)) {
          onlyAreas.set(akey, { name: nm, rows: [] });
        }
        onlyAreas.get(akey).rows.push(row);
      }
      const arOrder = [...onlyAreas.keys()].sort((x, y) => {
        const sx = onlyAreas.get(x).rows.reduce((s, r) => s + r.v, 0);
        const sy = onlyAreas.get(y).rows.reduce((s, r) => s + r.v, 0);
        return sy - sx;
      });
      for (const ak of arOrder) {
        const g = onlyAreas.get(ak);
        const s = g.rows.reduce((a, b) => a + b.v, 0);
        if (s < minVisible) continue;
        const aidx = add({ name: g.name, color: areaMuted, stat: null });
        links.push({ source: homeIdx, target: aidx, value: s, color: c.home });
        emitDeviceTreeFromParent(g.rows, aidx);
      }
    }

    if (useFloor) {
      for (const fid of floorOrder) {
        const am = floorMap.get(fid);
        if (!am) continue;
        const fsum = [...am.values()].reduce(
          (s, g) => s + g.rows.reduce((a, b) => a + b.v, 0),
          0,
        );
        if (fsum < minVisible) continue;
        const fidx = add({
          name: floorDisplayName(fid, model, noFloorL),
          color: floorMuted,
          stat: null,
        });
        links.push({ source: homeIdx, target: fidx, value: fsum, color: c.home });

        const aOrder = [...am.keys()].sort((x, y) => {
          const sx = am.get(x).rows.reduce((s, r) => s + r.v, 0);
          const sy = am.get(y).rows.reduce((s, r) => s + r.v, 0);
          return sy - sx;
        });
        for (const ak of aOrder) {
          const g = am.get(ak);
          const s = g.rows.reduce((a, b) => a + b.v, 0);
          if (s < minVisible) continue;
          const aidx = add({ name: g.name, color: areaMuted, stat: null });
          links.push({ source: fidx, target: aidx, value: s, color: c.home });
          emitDeviceTreeFromParent(g.rows, aidx);
        }
      }
    }
  } else {
    for (const { d } of top) {
      sub(d, homeIdx);
    }
  }
  if (tail.length > 0) {
    const s = tail.reduce((a, b) => a + b.v, 0);
    if (s > minVisible) {
      const oidx = add({
        name: t('now.sankey.others', { count: tail.length }),
        color: theme.palette.text.secondary,
        stat: null,
      });
      links.push({ source: homeIdx, target: oidx, value: s, color: c.home });
    }
  }

  let fromHome = 0;
  for (const l of links) {
    if (l.source === homeIdx) fromHome += l.value;
  }
  const untracked = Math.max(0, homeTotal - fromHome);
  if (untracked > minVisible) {
    const uidx = add({ name: t('now.sankey.untracked'), color: theme.palette.text.disabled });
    links.push({
      source: homeIdx,
      target: uidx,
      value: untracked,
      color: theme.palette.action.disabledBackground,
    });
  }

  return { nodes, links };
}

/**
 * kWh (range statistics) + optional Home Assistant area context.
 * Recharts { nodes, links } for a multi-level flow based on
 * `device_consumption[].included_in_stat` in the energy prefs, optionally
 * with Home / floor / area / device columns when `ha_exporter_area_context` is present.
 */
export function buildHierarchicalSankeyData(
  model,
  totalByStat,
  totals,
  ctx,
) {
  if (!model?.devices?.length) {
    return { nodes: [], links: [] };
  }
  const homeTotal = totals.home;
  const getValue = (stat) =>
    reconcileDeviceKwhToHome(totalByStat.get(stat) ?? 0, homeTotal);
  return buildHierarchicalSankeyFromValues(
    model,
    getValue,
    MIN_KWH,
    0.02,
    totals,
    ctx,
  );
}

/**
 * Live (instant) power: same topology as {@link buildHierarchicalSankeyData},
 * with values in **W** from per-device `stat_rate` in `wattsByStat` (key = `device.stat`)
 * and `totalsW` for the system flows. Missing stat_rate → 0 (device hidden unless grouped).
 */
export function buildHierarchicalLiveWattsSankeyData(
  model,
  wattsByStat,
  totalsW,
  ctx,
) {
  const getValue = (stat) => Math.max(0, Number(wattsByStat.get(stat)) || 0);
  return buildHierarchicalSankeyFromValues(
    model,
    getValue,
    MIN_SANKEY_W,
    1,
    totalsW,
    ctx,
  );
}
