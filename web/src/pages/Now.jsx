import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { useInstance } from '../layout/InstanceContext.jsx';
import {
  useEnergyBundle,
  useLatestStates,
  useManyStates,
  useManyStatistics,
} from '../api/hooks.js';
import { PowerTimelineChart } from '../components/PowerTimelineChart.jsx';
import { PowerFlowSankey } from '../components/PowerFlowSankey.jsx';
import {
  bucketPowerTimeline5Min,
  buildPowerTimelineFromEnergy,
  buildWattsByStatMap,
  currentPowerWattsFromLatest,
  mergePowerTimeline,
  nowPageSankeyWithLiveWatts,
} from '../api/powerTimeline.js';
import { allStatIdsFromModel } from '../api/energyModel.js';
import {
  buildHierarchicalLiveWattsSankeyData,
  buildHierarchicalSankeyData,
} from '../api/energySankeyGraph.js';
import { buildSankeyTotals } from '../api/sankeyTotals.js';
import { formatHour, formatDateTimeShort } from '../format.js';

/**
 * Live view modelled on Home Assistant's own Energy dashboard power page.
 *
 *   ┌──────────────── now: 273 W ────────────────┐
 *   ├───────── power over time (today) ──────────┤
 *   └── Sankey: where the energy went (today) ───┘
 *
 * The power chart uses state history of the four Energy `stat_rate` / flow
 * (kW) entities. The custom component preloads recorder history for those
 * same entities so the API matches HA. 5-minute energy statistics are only a
 * fallback when that history is not on the server yet. The “Current power
 * flow” Sankey shows W from the same `stat_rate` sensors (and per-device
 * `stat_rate` when set in the Energy dashboard); it falls back to today’s
 * kWh when no live system reading is available yet.
 *
 * State history is polled on a 10 s cadence; the day window advances on a
 * 30 s tick. The “current W” chip uses `/states/latest` at 15 s.
 */
export function Now() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const lng = i18n.language;
  const { selected } = useInstance();

  // Advance the window boundary on a 30 s tick. Without this, every render
  // would compute a fresh `end = new Date()`, trashing our react-query cache
  // keys and causing the chart queries to refetch constantly (every mouse
  // move, every child state change, etc.).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const [start, end] = useMemo(() => todayRange(), [tick]);

  const { prefs, model, stats } = useEnergyBundle(
    selected,
    start,
    end,
    { period: 'hour' },
  );

  const powerEntities = model?.powerEntities ?? {};
  const entityIds = useMemo(
    () =>
      [
        powerEntities.grid,
        powerEntities.solar,
        powerEntities.batteryIn,
        powerEntities.batteryOut,
      ].filter(Boolean),
    [powerEntities],
  );

  const statesByEntity = useManyStates(
    selected,
    entityIds,
    start,
    end,
    { pollMs: 10_000 },
  );

  // Used only to build a fallback series when the four power / flow entities
  // have no state history in range (e.g. fresh `reset_remote`). Energy
  // statistics repopulate before raw states in that scenario.
  const energyStatIds = useMemo(
    () => (model ? allStatIdsFromModel(model) : []),
    [model],
  );
  const energy5min = useManyStatistics(
    selected,
    energyStatIds,
    start,
    end,
    { period: '5minute' },
  );
  const { isLoading: energy5minLoading } = energy5min;

  const latest = useLatestStates(selected, { pollMs: 15_000 });

  const rows = useMemo(() => {
    const fromStats = buildPowerTimelineFromEnergy(model, energy5min.results);

    const byEntity = new Map();
    for (const r of statesByEntity.results) {
      if (r.data) byEntity.set(r.entityId, r.data);
    }
    const fromPower = mergePowerTimeline(
      {
        grid: byEntity.get(powerEntities.grid) ?? { states: [] },
        solar: byEntity.get(powerEntities.solar) ?? { states: [] },
        batteryIn: byEntity.get(powerEntities.batteryIn) ?? { states: [] },
        batteryOut: byEntity.get(powerEntities.batteryOut) ?? { states: [] },
      },
      new Date(start),
      new Date(end),
    );

    if (fromPower.length > 0) return fromPower;
    if (fromStats.length > 0) return fromStats;
    return [];
  }, [
    model,
    energy5min.results,
    statesByEntity.results,
    powerEntities,
    start,
    end,
  ]);

  // Chart: 5-minute buckets so the axis is not one point per state update.
  // Sankey / integration still use full-resolution `rows` above.
  const chartRows = useMemo(
    () => bucketPowerTimeline5Min(rows, start, end),
    [rows, start, end],
  );

  // Match Summary’s “home consumption”: same `stat_rate` math from
  // `/states/latest`. The chart still uses merged history, whose last
  // forward-filled point can differ when recorder vs latest disagree.
  const livePowerNow = useMemo(
    () => currentPowerWattsFromLatest(model, latest.data?.byEntity),
    [model, latest.data?.byEntity],
  );

  const headerHomeKw = useMemo(() => {
    if (
      livePowerNow.hasPowerSensors &&
      livePowerNow.homeW != null &&
      Number.isFinite(livePowerNow.homeW)
    ) {
      return livePowerNow.homeW / 1000;
    }
    return rows.length ? rows[rows.length - 1].consumption : 0;
  }, [livePowerNow, rows]);

  // Build the Sankey totals. Prefer hourly statistics (most accurate, gives
  // us per-device breakdowns) but fall back to integrating the live power
  // timeline when the server has no hourly deltas yet — otherwise the page
  // shows "not enough data" for the first hour or two of every new day.
  const sankey = useMemo(
    () => buildSankeyTotals(model, stats, rows),
    [model, stats, rows],
  );

  const sankeyGraph = useMemo(
    () =>
      model && sankey.totalByStat instanceof Map && sankey.totalByStat.size > 0
        ? buildHierarchicalSankeyData(
            model,
            sankey.totalByStat,
            sankey.totals,
            {
              t,
              c: theme.palette.energy || {},
              theme,
              groupRestLabel: t('electricity.sankeyGroupRest'),
              areaUnassignedLabel: t('electricity.sankeyAreaUnassigned'),
              floorNoLevelLabel: t('electricity.sankeyFloorNoLevel'),
            },
          )
        : { nodes: [], links: [] },
    [model, sankey.totals, sankey.totalByStat, t, theme],
  );

  const nowSankey = useMemo(() => {
    const base = nowPageSankeyWithLiveWatts(
      model,
      latest.data?.byEntity,
      sankey,
      sankeyGraph,
    );
    if (base.valueUnit !== 'watts' || !model?.devices?.length) {
      return base;
    }
    const wattsByStat = buildWattsByStatMap(model, latest.data?.byEntity);
    const graphH = buildHierarchicalLiveWattsSankeyData(
      model,
      wattsByStat,
      base.totals,
      {
        t,
        c: theme.palette.energy || {},
        theme,
        groupRestLabel: t('electricity.sankeyGroupRest'),
        areaUnassignedLabel: t('electricity.sankeyAreaUnassigned'),
        floorNoLevelLabel: t('electricity.sankeyFloorNoLevel'),
      },
    );
    if (graphH?.links?.length) {
      return { ...base, graphData: graphH, devices: [] };
    }
    return base;
  }, [model, latest.data?.byEntity, sankey, sankeyGraph, t, theme]);

  const c = theme.palette.energy || {};

  if (prefs.isLoading) {
    return <LinearProgress />;
  }
  if (prefs.error && prefs.error.status === 404) {
    return <Alert severity="info">{t('summary.noData')}</Alert>;
  }

  if (!entityIds.length) {
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        {t('now.noPowerSensors')}
      </Alert>
    );
  }

  // Detect "still hydrating" state: no 5-minute energy stats AND state
  // history has fewer than ~10 samples. In that case the chart has
  // nothing meaningful to draw and a generic hint beats a flat-line.
  const stats5HasData = energy5min.results.some(
    (r) => (r.data?.points?.length ?? 0) > 0,
  );
  const totalStateSamples = statesByEntity.results.reduce(
    (acc, r) => acc + (r.data?.states?.length ?? 0),
    0,
  );
  // Early after reset, warn only when the chart is still empty after loads.
  const hydrating =
    rows.length < 2 &&
    !stats5HasData &&
    totalStateSamples < 10 &&
    !statesByEntity.isLoading &&
    !energy5minLoading;

  // Short "last update" caption — takes the max timestamp across our four
  // tracked power sensors from /states/latest so it stays fresh while the
  // timeline chart is in-flight.
  const lastRow = pickLatestRow(latest.data?.rows, entityIds);
  const lastSeen = lastRow?.last_updated ?? null;

  return (
    <Stack spacing={2}>
      <HeaderRow
        currentKw={headerHomeKw}
        color={c.home ?? theme.palette.primary.main}
        title={t('now.title')}
        subtitle={t('now.subtitle')}
        lastSeenLabel={
          lastSeen
            ? `${t('now.lastUpdated')}: ${formatDateTimeShort(lastSeen, lng)}`
            : null
        }
      />

      {hydrating && (
        <Alert severity="info">{t('now.hydrating')}</Alert>
      )}

      {rows.length === 0 &&
      (statesByEntity.isLoading || energy5minLoading) ? (
        <LinearProgress />
      ) : (
        <PowerTimelineChart
          rows={chartRows}
          colors={{
            solar: c.solar,
            grid: c.grid,
            battery: c.battery,
            // Consumption line uses the primary text colour (white on dark,
            // dark on light) so it always stands out above the stack.
            home: theme.palette.text.primary,
          }}
          formatAxis={(tsMs) => formatHour(new Date(tsMs), lng)}
          formatTooltipTime={(tsMs) =>
            formatDateTimeShort(new Date(tsMs).toISOString(), lng)
          }
          title={t('now.timelineTitle')}
        />
      )}

      <PowerFlowSankey
        totals={nowSankey.totals}
        devices={nowSankey.devices}
        graphData={nowSankey.graphData}
        valueUnit={nowSankey.valueUnit}
        locale={lng}
      />
    </Stack>
  );
}

// --------------------------------------------------------------------------- //
// Header card — big current-W readout
// --------------------------------------------------------------------------- //

function HeaderRow({ currentKw, color, title, subtitle, lastSeenLabel }) {
  const formatted = formatKw(currentKw);
  return (
    <Paper
      sx={{
        p: { xs: 2, sm: 2.5 },
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexWrap: 'wrap',
      }}
    >
      <Stack sx={{ flex: 1, minWidth: 200 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {subtitle}
          {lastSeenLabel ? ` — ${lastSeenLabel}` : null}
        </Typography>
      </Stack>
      <Chip
        icon={<HomeOutlinedIcon sx={{ color: `${color} !important` }} />}
        label={formatted}
        sx={{
          height: 44,
          fontSize: 18,
          fontWeight: 700,
          px: 1.5,
          bgcolor: `${color}22`,
          color,
          '.MuiChip-label': { px: 1.5 },
        }}
      />
    </Paper>
  );
}

// --------------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------------- //

function todayRange() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  return [start.toISOString(), end.toISOString()];
}

function formatKw(kw) {
  const v = Number.isFinite(kw) ? kw : 0;
  if (Math.abs(v) < 1) return `${Math.round(v * 1000)} W`;
  return `${v.toFixed(Math.abs(v) < 10 ? 2 : 1)} kW`;
}

function pickLatestRow(rows, entityIds) {
  if (!Array.isArray(rows)) return null;
  const set = new Set(entityIds);
  let latest = null;
  for (const r of rows) {
    if (!set.has(r.entity_id)) continue;
    if (!latest || (r.last_updated ?? '') > (latest.last_updated ?? '')) {
      latest = r;
    }
  }
  return latest;
}

