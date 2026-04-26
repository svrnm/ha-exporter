import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  IconButton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { alpha, useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { useInstance } from '../layout/InstanceContext.jsx';
import { useEnergyBundle, useManyStatistics } from '../api/hooks.js';
import {
  allStatIdsFromModel,
  cumulativeFlowStatIdsForCoverage,
  maxStatisticCoverageLagMs,
} from '../api/energyModel.js';
import { buildHierarchicalSankeyData } from '../api/energySankeyGraph.js';
import { buildSankeyTotals } from '../api/sankeyTotals.js';
import { PartialHistoryHint } from '../components/PartialHistoryHint.jsx';
import {
  allowsFiveMinuteForRange,
  RangePicker,
  RANGES,
  resolveRange,
} from '../components/RangePicker.jsx';
import { DeviceKwhBarChart } from '../components/DeviceKwhBarChart.jsx';
import { HourlyBarChart } from '../components/HourlyBarChart.jsx';
import { PowerFlowSankey } from '../components/PowerFlowSankey.jsx';
import { useUrlSyncedRange } from '../hooks/useUrlSyncedRange.js';

export function Electricity() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const { selected } = useInstance();
  const [range, setRange] = useUrlSyncedRange();
  const [resolution, setResolution] = useState('hour');
  const { start, end } = useMemo(() => resolveRange(range), [range]);

  // Hourly when the range is too long for retained 5‑minute stats on the server.
  const effectiveResolution = allowsFiveMinuteForRange(range) ? resolution : 'hour';

  const { prefs, model, stats } = useEnergyBundle(selected, start, end, {
    period: effectiveResolution,
  });

  // Flow + per-device charts always use hourly statistics so longer ranges
  // stay complete (5-minute stats are only kept ~10 days on the server).
  const needHourlyCopy = effectiveResolution === '5minute';
  const energyStatIds = useMemo(
    () => (model ? allStatIdsFromModel(model) : []),
    [model],
  );
  const hourlyStats = useManyStatistics(
    selected,
    energyStatIds,
    start,
    end,
    { period: 'hour', enabled: needHourlyCopy && energyStatIds.length > 0 },
  );
  const statsForFlow = needHourlyCopy ? hourlyStats : stats;

  const statsCoverageLagMs = useMemo(
    () =>
      maxStatisticCoverageLagMs(
        start,
        statsForFlow.results,
        cumulativeFlowStatIdsForCoverage(model),
      ),
    [start, statsForFlow.results, model],
  );

  const sankey = useMemo(
    () => buildSankeyTotals(model, statsForFlow, []),
    [model, statsForFlow],
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

  const refetchAction = useMemo(
    () => (
      <Tooltip title={t('errors.retry')}>
        <span>
          <IconButton
            size="small"
            aria-label={t('errors.retry')}
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ['prefs', selected] });
              void queryClient.invalidateQueries({ queryKey: ['stats', selected] });
            }}
          >
            <RefreshIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    ),
    [queryClient, selected, t],
  );

  const deltasByStat = useMemo(() => {
    const map = new Map();
    for (const r of stats.results) {
      if (r.data) map.set(r.statId, r.data.deltas);
    }
    return map;
  }, [stats.results]);

  const c = theme.palette.energy || {};

  const gridInData = combine(model?.grid.map((g) => deltasByStat.get(g.from)));
  const gridOutData = combine(model?.grid.map((g) => deltasByStat.get(g.to)));
  const solarData = combine(model?.solar.map((s) => deltasByStat.get(s.stat)));
  const batteryOutData = combine(model?.battery.map((b) => deltasByStat.get(b.from)));
  const batteryInData = combine(model?.battery.map((b) => deltasByStat.get(b.to)));

  const stackedSeries = [
    { key: 'grid', label: t('summary.imported'), color: c.grid, data: gridInData },
    { key: 'solar', label: t('summary.solarTotal'), color: c.solar, data: solarData },
    { key: 'battery', label: t('summary.batteryTotal'), color: c.battery, data: batteryOutData },
    {
      key: 'gridOut',
      label: t('summary.returned'),
      color: alpha(c.grid, 0.55),
      data: gridOutData,
      signed: 'negative',
    },
    {
      key: 'batteryIn',
      label: t('now.series.batteryCharge'),
      color: alpha(c.battery, 0.6),
      data: batteryInData,
      signed: 'negative',
    },
  ].filter((s) => s.data.length > 0);

  const solarBarSeries = useMemo(() => {
    const list = model?.solar ?? [];
    if (list.length === 0) return [];
    return list
      .map((s, i) => {
        const data = combine([deltasByStat.get(s.stat)]);
        if (data.length === 0) return null;
        const many = list.length > 1;
        return {
          key: `solar${i}`,
          label: many ? shortId(s.stat) : t('electricity.solarGeneration'),
          color: many
            ? alpha(c.solar, 0.4 + (0.6 * (i + 1)) / list.length)
            : c.solar,
          data,
        };
      })
      .filter(Boolean);
  }, [deltasByStat, model?.solar, t, c.solar]);

  const gridBarSeries = useMemo(() => {
    const grid = model?.grid ?? [];
    const inRows = grid.filter((g) => g.from);
    const outRows = grid.filter((g) => g.to);
    const series = [];
    inRows.forEach((row, i) => {
      const data = combine([deltasByStat.get(row.from)]);
      if (data.length === 0) return;
      series.push({
        key: `gridIn${i}`,
        label: inRows.length > 1 ? shortId(row.from) : t('summary.imported'),
        color: inRows.length > 1 ? alpha(c.grid, 0.45 + 0.55 * ((i + 1) / inRows.length)) : c.grid,
        data,
      });
    });
    outRows.forEach((row, i) => {
      const data = combine([deltasByStat.get(row.to)]);
      if (data.length === 0) return;
      series.push({
        key: `gridOut${i}`,
        label: outRows.length > 1 ? shortId(row.to) : t('summary.returned'),
        color: alpha(c.grid, 0.45 + 0.14 * i),
        signed: 'negative',
        data,
      });
    });
    return series;
  }, [deltasByStat, model?.grid, t, c.grid]);

  if (prefs.error && prefs.error.status === 404) {
    return <Alert severity="info">{t('summary.noData')}</Alert>;
  }

  const isDetailed = effectiveResolution === '5minute';
  const flowLoading = needHourlyCopy ? hourlyStats.isLoading : stats.isLoading;

  const hasNestedDeviceMeters = useMemo(() => {
    const list = model?.devices ?? [];
    const ids = new Set(list.map((d) => d.stat).filter(Boolean));
    return list.some((d) => d.includedInStat && ids.has(d.includedInStat));
  }, [model]);

  return (
    <Stack spacing={{ xs: 2, sm: 2.5 }}>
      <RangePicker
        value={range}
        onChange={setRange}
        ranges={RANGES}
        rowExtra={
          <Box
            sx={{
              display: 'inline-flex',
              flexDirection: 'row',
              alignItems: 'center',
              flexShrink: 0,
              flexWrap: 'nowrap',
              gap: 1.5,
            }}
          >
            <Typography
              variant="body2"
              color="text.secondary"
              component="span"
              sx={{ lineHeight: 1.2, whiteSpace: 'nowrap' }}
            >
              {t('electricity.resolution')}
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
                {t('electricity.resolutionHour')}
              </ToggleButton>
              <ToggleButton
                value="5minute"
                disabled={!allowsFiveMinuteForRange(range)}
                sx={{ px: 1, minWidth: 0, whiteSpace: 'nowrap' }}
              >
                {t('electricity.resolution5min')}
              </ToggleButton>
            </ToggleButtonGroup>
            {!flowLoading && (
              <PartialHistoryHint lagMs={statsCoverageLagMs} />
            )}
          </Box>
        }
      />

      {stackedSeries.length === 0 ? (
        <Alert severity="info">{t('summary.noData')}</Alert>
      ) : (
        <Box sx={{ display: 'grid', gap: { xs: 2, sm: 2.5 }, gridTemplateColumns: '1fr' }}>
          <HourlyBarChart
            title={
              isDetailed ? t('electricity.detailed') : t('electricity.stackedHourly')
            }
            series={stackedSeries}
            range={range}
          />
          {solarBarSeries.length > 0 && (
            <HourlyBarChart
              title={t('electricity.solarGeneration')}
              series={solarBarSeries}
              range={range}
            />
          )}
          {gridBarSeries.length > 0 && (
            <HourlyBarChart
              title={t('electricity.gridInOut')}
              series={gridBarSeries}
              range={range}
            />
          )}
          {!flowLoading && model && (
            <>
              <DeviceKwhBarChart
                devices={sankey.deviceLeaves ?? sankey.devices}
                title={t('electricity.devicesTitle')}
                headerAction={refetchAction}
                titleInfo={
                  hasNestedDeviceMeters
                    ? {
                        text: t('electricity.deviceHierarchyHint'),
                        ariaLabel: t('electricity.deviceHierarchyHintAria'),
                      }
                    : null
                }
              />
              <PowerFlowSankey
                totals={sankey.totals}
                devices={sankey.devices}
                graphData={sankeyGraph}
                locale={i18n.language}
                title={t('electricity.sankeyTitle')}
                emptyText={t('electricity.sankeyEmpty')}
                headerAction={refetchAction}
              />
            </>
          )}
        </Box>
      )}
    </Stack>
  );
}

function combine(lists) {
  if (!lists) return [];
  const map = new Map();
  for (const arr of lists) {
    if (!Array.isArray(arr)) continue;
    for (const d of arr) {
      map.set(d.start, (map.get(d.start) ?? 0) + (Number(d.value) || 0));
    }
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([start, value]) => ({ start, value }));
}

function shortId(statId) {
  const parts = String(statId).split('.');
  return parts[parts.length - 1] ?? String(statId);
}
