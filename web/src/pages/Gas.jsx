// web/src/pages/Gas.jsx
import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
import ThermostatIcon from '@mui/icons-material/Thermostat';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';
/* eslint-disable no-unused-vars */
// Imports used by EfficiencySection (Task 9).
import ShowerIcon from '@mui/icons-material/Shower';
import WhatshotIcon from '@mui/icons-material/Whatshot';
import PercentIcon from '@mui/icons-material/Percent';
import { HourlyBarChart } from '../components/HourlyBarChart.jsx';
import { BurnerTimelineStrip } from '../components/BurnerTimelineStrip.jsx';
/* eslint-enable no-unused-vars */
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { StatCard } from '../components/StatCard.jsx';
import { formatDay, formatHour, formatKwh, formatNumber } from '../format.js';
import { alpha, useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { useInstance } from '../layout/InstanceContext.jsx';
import { useEnergyBundle, useManyStates } from '../api/hooks.js';
import {
  allowsFiveMinuteForRange,
  isDailyAggregateRange,
  RangePicker,
  RANGES,
  StickyDateToolbar,
  resolveRange,
} from '../components/RangePicker.jsx';
import { useUrlSyncedRange } from '../hooks/useUrlSyncedRange.js';
import {
  averageOutsideTemp,
  bucketBurnerMinutes,
  bucketHeatEnergyKwh,
  bucketsForRange,
  splitGasByPurpose,
} from '../api/thermeModel.js';

const WARMEENERGIE = 'sensor.weishaupt_warmeenergie';
const BURNER_PHASE = 'sensor.weishaupt_wtc_kessel_betriebsphase_brenner';
const DHW_PUMP = 'sensor.weishaupt_systemgerat_pumpe_warmwasser';
const OUTSIDE_TEMP = 'sensor.weishaupt_systemgerat_aussentemperatur';
const THERME_ENTITY_IDS = [WARMEENERGIE, BURNER_PHASE, DHW_PUMP, OUTSIDE_TEMP];

const OUTSIDE_OVERLAY_MAX_DAYS = 3;

export function Gas() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const lng = i18n.language;
  const { selected } = useInstance();
  const [range, setRange] = useUrlSyncedRange();
  const [resolution, setResolution] = useState('hour');
  const { start, end } = useMemo(() => resolveRange(range), [range]);

  const effectiveResolution = allowsFiveMinuteForRange(range) ? resolution : 'hour';

  const { model, stats } = useEnergyBundle(selected, start, end, {
    period: effectiveResolution,
  });

  const therme = useManyStates(
    selected,
    THERME_ENTITY_IDS,
    start,
    end,
  );

  const statesByEntity = useMemo(() => {
    const m = new Map();
    for (const r of therme.results) {
      if (r.data?.states) m.set(r.entityId, r.data.states);
    }
    return m;
  }, [therme.results]);

  const features = useMemo(() => {
    const has = (id) => (statesByEntity.get(id)?.length ?? 0) > 0;
    return {
      hasWarmeenergie: has(WARMEENERGIE),
      hasBurner: has(BURNER_PHASE),
      hasPump: has(DHW_PUMP),
      hasOutside: has(OUTSIDE_TEMP),
    };
  }, [statesByEntity]);

  const gasStats = useMemo(() => model?.gas ?? [], [model]);

  const byStat = useMemo(() => {
    const map = new Map();
    for (const r of stats.results) if (r.data) map.set(r.statId, r.data);
    return map;
  }, [stats.results]);

  const derived = useMemo(() => {
    if (!start || !end) return null;
    const grid = bucketsForRange(start, end, effectiveResolution);
    if (grid.length === 0) return null;
    const gasDeltas = mergeGasDeltas(gasStats, byStat, grid);
    const totalM3 = gasDeltas.reduce((s, d) => s + d.value, 0);
    const bucketDurationMin = effectiveResolution === 'hour' ? 60 : 5;
    const heatStates = statesByEntity.get(WARMEENERGIE) ?? [];
    const burnerStates = statesByEntity.get(BURNER_PHASE) ?? [];
    const pumpStates = statesByEntity.get(DHW_PUMP) ?? [];
    const outsideStates = statesByEntity.get(OUTSIDE_TEMP) ?? [];
    const kwhBuckets = features.hasWarmeenergie
      ? bucketHeatEnergyKwh(heatStates, grid)
      : null;
    const burnerBuckets = features.hasBurner
      ? bucketBurnerMinutes(burnerStates, grid)
      : null;
    const splitBuckets =
      features.hasPump && features.hasBurner
        ? splitGasByPurpose(gasDeltas, pumpStates, burnerStates, grid)
        : null;
    const outsideBuckets =
      features.hasOutside && spansAtMostDays(start, end, OUTSIDE_OVERLAY_MAX_DAYS)
        ? averageOutsideTemp(outsideStates, grid)
        : null;
    const totals = {
      m3: totalM3,
      kwhThermal: kwhBuckets ? kwhBuckets.reduce((s, b) => s + b.value, 0) : null,
      burnerMin: burnerBuckets
        ? burnerBuckets.reduce((s, b) => s + b.value, 0)
        : null,
      dhwM3: splitBuckets
        ? splitBuckets.reduce((s, b) => s + b.dhw, 0)
        : null,
      avgOutsideC: outsideBuckets
        ? weightedMean(outsideBuckets, bucketDurationMin)
        : null,
    };
    totals.dhwShare =
      totals.dhwM3 != null && totalM3 > 0 ? totals.dhwM3 / totalM3 : null;
    totals.kwhPerM3 =
      totals.kwhThermal != null && totalM3 > 0
        ? totals.kwhThermal / totalM3
        : null;
    return {
      grid,
      bucketDurationMin,
      gasDeltas,
      kwhBuckets,
      burnerBuckets,
      splitBuckets,
      outsideBuckets,
      totals,
    };
  }, [
    start,
    end,
    effectiveResolution,
    gasStats,
    byStat,
    features,
    statesByEntity,
  ]);

  const c = theme.palette.energy || {};
  const gasColor = c.gas ?? theme.palette.primary.main;
  const heatingColor = alpha(gasColor, 0.55);

  if (gasStats.length === 0) {
    return (
      <Stack spacing={{ xs: 2, sm: 2.5 }}>
        <StickyDateToolbar>
          <RangePicker value={range} onChange={setRange} ranges={RANGES} />
        </StickyDateToolbar>
        <Alert severity="info">{t('summary.noData')}</Alert>
      </Stack>
    );
  }

  const anyTherme =
    features.hasWarmeenergie ||
    features.hasBurner ||
    features.hasPump ||
    features.hasOutside;

  return (
    <Stack spacing={{ xs: 2, sm: 2.5 }}>
      <StickyDateToolbar>
        <RangePicker
          value={range}
          onChange={setRange}
          ranges={RANGES}
          extra={
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                maxWidth: '100%',
              }}
            >
              <Typography
                variant="body2"
                color="text.secondary"
                component="span"
                sx={{ lineHeight: 1.2, whiteSpace: 'nowrap' }}
              >
                {t('gas.granularity.label')}
              </Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={effectiveResolution}
                onChange={(_, v) => {
                  if (v && allowsFiveMinuteForRange(range)) setResolution(v);
                  else if (v) setResolution('hour');
                }}
              >
                <ToggleButton value="hour" sx={{ px: 1, minWidth: 0, whiteSpace: 'nowrap' }}>
                  {t('gas.granularity.hour')}
                </ToggleButton>
                <ToggleButton
                  value="5minute"
                  disabled={!allowsFiveMinuteForRange(range)}
                  sx={{ px: 1, minWidth: 0, whiteSpace: 'nowrap' }}
                >
                  {t('gas.granularity.5minute')}
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
          }
        />
      </StickyDateToolbar>

      {!anyTherme && (
        <Alert severity="info">{t('gas.enableThermeHint')}</Alert>
      )}

      {/* Sections rendered in Tasks 8 + 9. */}
      <Box sx={{ display: 'grid', gap: { xs: 2, sm: 2.5 } }}>
        <ConsumptionSection
          t={t}
          lng={lng}
          range={range}
          derived={derived}
          features={features}
          stats={stats}
          gasColor={gasColor}
          heatingColor={heatingColor}
          outsideColor={theme.palette.text.secondary}
        />
        <EfficiencySection
          t={t}
          lng={lng}
          range={range}
          derived={derived}
          features={features}
          gasColor={gasColor}
        />
      </Box>
    </Stack>
  );
}

function mergeGasDeltas(gasStats, byStat, grid) {
  const sums = new Map(grid.map((b) => [b.start, 0]));
  for (const g of gasStats) {
    const data = byStat.get(g.stat);
    if (!data?.deltas) continue;
    for (const d of data.deltas) {
      if (!sums.has(d.start)) continue;
      sums.set(d.start, sums.get(d.start) + (Number(d.value) || 0));
    }
  }
  return grid.map((b) => ({ start: b.start, value: sums.get(b.start) ?? 0 }));
}

function weightedMean(buckets, bucketDurationMin) {
  let num = 0;
  let den = 0;
  for (const b of buckets) {
    if (b.value == null) continue;
    num += b.value * bucketDurationMin;
    den += bucketDurationMin;
  }
  return den > 0 ? num / den : null;
}

function spansAtMostDays(startIso, endIso, days) {
  const t0 = Date.parse(startIso);
  const t1 = Date.parse(endIso);
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return false;
  return t1 - t0 <= days * 86_400_000;
}

function ConsumptionSection({
  t,
  lng,
  range,
  derived,
  features,
  stats,
  gasColor,
  heatingColor,
  outsideColor,
}) {
  const totals = derived?.totals;
  const loading = stats.isLoading || !derived;
  const dailyAggregate = isDailyAggregateRange(range);
  const rows = useMemo(() => {
    if (!derived) return [];
    const gasByStart = new Map(derived.gasDeltas.map((d) => [d.start, d.value]));
    const splitByStart = new Map(
      (derived.splitBuckets ?? []).map((s) => [s.start, s]),
    );
    const outByStart = new Map(
      (derived.outsideBuckets ?? []).map((o) => [o.start, o.value]),
    );
    return derived.grid.map((b) => {
      const total = gasByStart.get(b.start) ?? 0;
      const split = splitByStart.get(b.start);
      const dhw = split ? split.dhw : 0;
      const heating = split ? split.heating : total;
      return {
        start: b.start,
        label: dailyAggregate ? formatDay(b.start, lng) : formatHour(b.start, lng),
        dhw,
        heating,
        outsideC: outByStart.has(b.start) ? outByStart.get(b.start) : null,
      };
    });
  }, [derived, dailyAggregate, lng]);
  const hasOutsideOverlay = derived?.outsideBuckets != null;

  return (
    <Stack spacing={{ xs: 2, sm: 2.5 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        {t('gas.section.consumption')}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gap: { xs: 2, sm: 2.5 },
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(3, minmax(0, 1fr))',
          },
        }}
      >
        <StatCard
          icon={<LocalFireDepartmentIcon />}
          accent={gasColor}
          label={t('gas.totalRange')}
          value={formatKwh(totals?.m3 ?? null, lng)}
          unit={t('units.m3')}
          loading={loading}
        />
        <StatCard
          icon={<ThermostatIcon />}
          accent={outsideColor}
          label={t('gas.avgOutside')}
          value={
            totals?.avgOutsideC == null
              ? '—'
              : formatNumber(totals.avgOutsideC, lng, {
                  maximumFractionDigits: 1,
                })
          }
          unit={t('units.degC')}
          loading={loading}
        />
        <StatCard
          icon={<TimerOutlinedIcon />}
          accent={gasColor}
          label={t('gas.burnerMinutes')}
          value={
            totals?.burnerMin == null
              ? '—'
              : formatNumber(totals.burnerMin, lng, {
                  maximumFractionDigits: 0,
                })
          }
          unit={t('units.minutes')}
          loading={loading}
        />
      </Box>
      <ConsumptionChart
        t={t}
        rows={rows}
        gasColor={gasColor}
        heatingColor={heatingColor}
        outsideColor={outsideColor}
        showOutside={hasOutsideOverlay}
        showStack={features.hasBurner && features.hasPump}
        lng={lng}
      />
    </Stack>
  );
}

function ConsumptionChart({
  t,
  rows,
  gasColor,
  heatingColor,
  outsideColor,
  showOutside,
  showStack,
  lng,
}) {
  const theme = useTheme();
  if (rows.length === 0) return null;
  return (
    <Box sx={{ width: '100%', height: { xs: 280, sm: 340 }, bgcolor: 'background.paper', borderRadius: 1, p: { xs: 1.5, sm: 2 } }}>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
        {t('gas.consumptionChart')}
      </Typography>
      <Box sx={{ width: '100%', height: 'calc(100% - 28px)' }}>
        <ResponsiveContainer>
          <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={theme.palette.divider} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
              axisLine={{ stroke: theme.palette.divider }}
              tickLine={false}
              minTickGap={16}
            />
            <YAxis
              yAxisId="m3"
              tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={48}
              tickFormatter={(v) => formatKwh(v, lng)}
            />
            {showOutside && (
              <YAxis
                yAxisId="temp"
                orientation="right"
                tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={36}
                tickFormatter={(v) => formatNumber(v, lng, { maximumFractionDigits: 0 })}
              />
            )}
            <RTooltip
              contentStyle={{
                background: theme.palette.background.paper,
                border: `1px solid ${theme.palette.divider}`,
              }}
              formatter={(value, name, item) => {
                if (typeof value !== 'number') return [value, name];
                if (item?.dataKey === 'outsideC') {
                  return [`${formatNumber(value, lng, { maximumFractionDigits: 1 })} ${t('units.degC')}`, name];
                }
                return [`${formatKwh(value, lng)} ${t('units.m3')}`, name];
              }}
            />
            <Legend wrapperStyle={{ paddingTop: 8 }} />
            {showStack ? (
              <>
                <Bar
                  yAxisId="m3"
                  dataKey="dhw"
                  name={t('gas.legend.dhw')}
                  stackId="m3"
                  fill={gasColor}
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  yAxisId="m3"
                  dataKey="heating"
                  name={t('gas.legend.heating')}
                  stackId="m3"
                  fill={heatingColor}
                  radius={[4, 4, 0, 0]}
                />
              </>
            ) : (
              <Bar
                yAxisId="m3"
                dataKey="heating"
                name={t('gas.totalRange')}
                fill={gasColor}
                radius={[4, 4, 0, 0]}
              />
            )}
            {showOutside && (
              <Line
                yAxisId="temp"
                type="monotone"
                dataKey="outsideC"
                name={t('gas.outsideOverlay')}
                stroke={outsideColor}
                dot={false}
                strokeWidth={2}
                connectNulls
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  );
}

function EfficiencySection() {
  // Filled in by Task 9.
  return null;
}
