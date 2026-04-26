import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import Battery5BarIcon from '@mui/icons-material/Battery5Bar';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import PowerOutlinedIcon from '@mui/icons-material/PowerOutlined';
import SolarPowerIcon from '@mui/icons-material/SolarPower';
import { alpha, useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { useInstance } from '../layout/InstanceContext.jsx';
import {
  useEnergyBundle,
  useLatestStates,
  useManyStates,
  useManyStatistics,
} from '../api/hooks.js';
import { PowerTimelineChart } from '../components/PowerTimelineChart.jsx';
import { DeviceKwhBarChart } from '../components/DeviceKwhBarChart.jsx';
import {
  bucketPowerTimeline5Min,
  buildPowerTimelineFromEnergy,
  currentPowerWattsFromLatest,
  mergePowerTimeline,
  nowPageSankeyWithLiveWatts,
} from '../api/powerTimeline.js';
import { allStatIdsFromModel } from '../api/energyModel.js';
import { buildSankeyTotals } from '../api/sankeyTotals.js';
import { formatHour, formatDateTimeShort, formatWatts } from '../format.js';

/**
 * Live view modelled on Home Assistant's own Energy dashboard power page.
 *
 *   ┌──────────────── now: 273 W ────────────────┐
 *   ├───────── power over time (today) ──────────┤
 *   └── Per-device power (W) for leaf meters — same `stat_rate` as HA power
 *       (falls back to empty when no live flow reading yet).
 *
 * The power chart uses state history of the four Energy `stat_rate` / flow
 * (kW) entities. The custom component preloads recorder history for those
 * same entities so the API matches HA. 5-minute energy statistics are only a
 * fallback when that history is not on the server yet.
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

  /** W for the home row: same source as the previous “big chip” (latest states, or last timeline point). */
  const homeWDisplay = useMemo(() => {
    if (
      livePowerNow.hasPowerSensors &&
      livePowerNow.homeW != null &&
      Number.isFinite(livePowerNow.homeW)
    ) {
      return livePowerNow.homeW;
    }
    const last = rows[rows.length - 1];
    if (
      last &&
      last.consumption != null &&
      Number.isFinite(last.consumption)
    ) {
      return last.consumption * 1000;
    }
    return null;
  }, [livePowerNow, rows]);

  // Build the Sankey totals. Prefer hourly statistics (most accurate, gives
  // us per-device breakdowns) but fall back to integrating the live power
  // timeline when the server has no hourly deltas yet — otherwise the page
  // shows "not enough data" for the first hour or two of every new day.
  const sankey = useMemo(
    () => buildSankeyTotals(model, stats, rows),
    [model, stats, rows],
  );

  /** Match Electricity per-device chart: only leaf meters (not parents split into children). */
  const deviceLeafStatSet = useMemo(() => {
    const dash = model?.devices ?? [];
    if (dash.length === 0) return new Set();
    return new Set(
      dash
        .filter((d) => {
          if (!d.stat) return false;
          const isParent = dash.some((c) => c.includedInStat === d.stat);
          return !isParent;
        })
        .map((d) => d.stat),
    );
  }, [model]);

  const hasNestedDeviceMeters = useMemo(() => {
    const list = model?.devices ?? [];
    const ids = new Set(list.map((d) => d.stat).filter(Boolean));
    return list.some((d) => d.includedInStat && ids.has(d.includedInStat));
  }, [model]);

  const liveDeviceWatts = useMemo(() => {
    const base = nowPageSankeyWithLiveWatts(
      model,
      latest.data?.byEntity,
      sankey,
      null,
    );
    if (base.valueUnit !== 'watts') {
      return { devices: [] };
    }
    return {
      devices: base.devices.filter(
        (d) => d.stat && deviceLeafStatSet.has(d.stat),
      ),
    };
  }, [model, latest.data?.byEntity, sankey, deviceLeafStatSet]);

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
        pe={model?.powerEntities}
        homeW={homeWDisplay}
        live={livePowerNow}
        colors={{
          home: c.home ?? theme.palette.primary.main,
          solar: c.solar,
          battery: c.battery,
          grid: c.grid,
        }}
        title={t('now.title')}
        subtitle={t('now.subtitle')}
        lastSeenLabel={
          lastSeen
            ? `${t('now.lastUpdated')}: ${formatDateTimeShort(lastSeen, lng)}`
            : null
        }
        locale={lng}
        t={t}
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

      {model && (
        <DeviceKwhBarChart
          valueUnit="watt"
          devices={liveDeviceWatts.devices}
          title={t('now.devicesTitle')}
          emptyText={t('now.devicesEmptyWatts')}
          titleInfo={
            hasNestedDeviceMeters
              ? {
                  text: t('electricity.deviceHierarchyHint'),
                  ariaLabel: t('electricity.deviceHierarchyHintAria'),
                }
              : null
          }
        />
      )}
    </Stack>
  );
}

// --------------------------------------------------------------------------- //
// Header: title + four live W widgets
// --------------------------------------------------------------------------- //

function HeaderRow({
  pe,
  homeW,
  live,
  colors,
  title,
  subtitle,
  lastSeenLabel,
  locale,
  t,
}) {
  return (
    <Paper sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack spacing={2}>
        <Stack spacing={0.5}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {subtitle}
            {lastSeenLabel ? ` — ${lastSeenLabel}` : null}
          </Typography>
        </Stack>
        <Box
          sx={{
            display: 'grid',
            gap: 1.5,
            gridTemplateColumns: {
              xs: 'repeat(2, minmax(0, 1fr))',
              sm: 'repeat(2, minmax(0, 1fr))',
              md: 'repeat(4, minmax(0, 1fr))',
            },
          }}
        >
          <LiveWWidget
            label={t('summary.powerNowHome')}
            valueText={
              homeW != null && Number.isFinite(homeW)
                ? formatWattLabel(homeW, locale)
                : '—'
            }
            sublabel={null}
            icon={<HomeOutlinedIcon sx={{ fontSize: 24 }} />}
            color={colors.home}
          />
          {pe?.solar ? (
            <LiveWWidget
              label={t('summary.powerNowSolar')}
              valueText={
                live.solarW != null && Number.isFinite(live.solarW)
                  ? formatWattLabel(live.solarW, locale)
                  : '—'
              }
              sublabel={null}
              icon={<SolarPowerIcon sx={{ fontSize: 24 }} />}
              color={colors.solar}
            />
          ) : null}
          {pe?.batteryIn || pe?.batteryOut ? (
            <LiveWWidget
              label={t('summary.powerNowBattery')}
              valueText={batteryWattMainText(live.batteryNetW, locale)}
              sublabel={batterySublabel(live.batteryNetW, t)}
              icon={<Battery5BarIcon sx={{ fontSize: 24 }} />}
              color={colors.battery}
            />
          ) : null}
          {pe?.grid ? (
            <LiveWWidget
              label={t('summary.powerNowGrid')}
              valueText={gridWattMainText(live.gridNetW, locale)}
              sublabel={gridSublabel(live.gridNetW, t)}
              icon={<PowerOutlinedIcon sx={{ fontSize: 24 }} />}
              color={colors.grid}
            />
          ) : null}
        </Box>
      </Stack>
    </Paper>
  );
}

function formatWattLabel(w, locale) {
  const n = formatWatts(w, locale);
  return `${n} W`;
}

function gridWattMainText(gridNetW, locale) {
  if (gridNetW == null || !Number.isFinite(gridNetW)) return '—';
  const a = Math.abs(gridNetW);
  return formatWattLabel(a, locale);
}

function gridSublabel(gridNetW, t) {
  if (gridNetW == null || !Number.isFinite(gridNetW)) return null;
  if (gridNetW > 0) return t('summary.powerNowGridImport');
  if (gridNetW < 0) return t('summary.powerNowGridExport');
  return t('summary.powerNowGrid');
}

function batteryWattMainText(batteryNetW, locale) {
  if (batteryNetW == null || !Number.isFinite(batteryNetW)) return '—';
  return formatWattLabel(Math.abs(batteryNetW), locale);
}

function batterySublabel(batteryNetW, t) {
  if (batteryNetW == null || !Number.isFinite(batteryNetW)) return null;
  if (batteryNetW < 0) return t('summary.powerNowBatteryCharging');
  if (batteryNetW > 0) return t('summary.powerNowBatteryDischarging');
  return t('summary.powerNowBattery');
}

function LiveWWidget({ label, valueText, sublabel, icon, color }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        display: 'flex',
        gap: 1.25,
        minWidth: 0,
        borderColor: 'divider',
        bgcolor: alpha(color, 0.06),
        alignItems: 'flex-start',
      }}
    >
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: 1.25,
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          color,
          bgcolor: alpha(color, 0.18),
        }}
      >
        {icon}
      </Box>
      <Stack spacing={0.25} sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          variant="caption"
          color="text.secondary"
          display="block"
          sx={{ lineHeight: 1.2 }}
        >
          {label}
        </Typography>
        <Typography
          component="p"
          variant="h6"
          sx={{ fontWeight: 700, lineHeight: 1.2, m: 0, wordBreak: 'break-all' }}
          className="num"
        >
          {valueText}
        </Typography>
        {sublabel ? (
          <Typography variant="caption" color="text.secondary" display="block">
            {sublabel}
          </Typography>
        ) : null}
      </Stack>
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
