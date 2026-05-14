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
/* eslint-disable no-unused-vars */
// Imports used by ConsumptionSection (Task 8) and EfficiencySection (Task 9).
// When those tasks add usage, merge the isDailyAggregateRange import below
// into the named RangePicker.jsx import group further down.
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
import ShowerIcon from '@mui/icons-material/Shower';
import ThermostatIcon from '@mui/icons-material/Thermostat';
import WhatshotIcon from '@mui/icons-material/Whatshot';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';
import PercentIcon from '@mui/icons-material/Percent';
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
import { HourlyBarChart } from '../components/HourlyBarChart.jsx';
import { BurnerTimelineStrip } from '../components/BurnerTimelineStrip.jsx';
import { StatCard } from '../components/StatCard.jsx';
import { formatDay, formatHour, formatKwh, formatNumber } from '../format.js';
import { isDailyAggregateRange } from '../components/RangePicker.jsx';
/* eslint-enable no-unused-vars */
import { alpha, useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { useInstance } from '../layout/InstanceContext.jsx';
import { useEnergyBundle, useManyStates } from '../api/hooks.js';
import {
  allowsFiveMinuteForRange,
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

function ConsumptionSection() {
  // Filled in by Task 8.
  return null;
}

function EfficiencySection() {
  // Filled in by Task 9.
  return null;
}
