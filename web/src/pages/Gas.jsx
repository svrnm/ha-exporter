import { useMemo } from 'react';
import { Alert, Box, Stack } from '@mui/material';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { useInstance } from '../layout/InstanceContext.jsx';
import { useEnergyBundle } from '../api/hooks.js';
import { RangePicker, RANGES, StickyDateToolbar, resolveRange } from '../components/RangePicker.jsx';
import { HourlyBarChart } from '../components/HourlyBarChart.jsx';
import { StatCard } from '../components/StatCard.jsx';
import { formatKwh } from '../format.js';
import { useUrlSyncedRange } from '../hooks/useUrlSyncedRange.js';

export function Gas() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const { selected } = useInstance();
  const [range, setRange] = useUrlSyncedRange();
  const { start, end } = useMemo(() => resolveRange(range), [range]);

  const { model, stats } = useEnergyBundle(selected, start, end);

  const c = theme.palette.energy || {};
  const gasStats = model?.gas ?? [];

  const byStat = useMemo(() => {
    const map = new Map();
    for (const r of stats.results) {
      if (r.data) map.set(r.statId, r.data);
    }
    return map;
  }, [stats.results]);

  const combined = [];
  let total = 0;
  for (const g of gasStats) {
    const d = byStat.get(g.stat);
    if (!d) continue;
    total += d.total;
    for (const point of d.deltas) combined.push(point);
  }

  const series = combined.length
    ? [
        {
          key: 'gas',
          label: t('nav.gas'),
          color: c.gas,
          data: mergeByStart(combined),
        },
      ]
    : [];

  if (gasStats.length === 0) {
    return <Alert severity="info">{t('summary.noData')}</Alert>;
  }

  return (
    <Stack spacing={{ xs: 2, sm: 2.5 }}>
      <StickyDateToolbar>
        <RangePicker value={range} onChange={setRange} ranges={RANGES} />
      </StickyDateToolbar>

      <Box
        sx={{
          display: 'grid',
          gap: { xs: 2, sm: 2.5 },
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
        }}
      >
        <StatCard
          icon={<LocalFireDepartmentIcon />}
          accent={c.gas}
          label={t('gas.totalRange')}
          value={formatKwh(total, i18n.language)}
          unit={t('units.m3')}
          loading={stats.isLoading}
        />
      </Box>

      {series.length === 0 ? (
        <Alert severity="info">{t('summary.noData')}</Alert>
      ) : (
        <HourlyBarChart
          title={t('gas.title')}
          series={series}
          range={range}
          unit={t('units.m3')}
        />
      )}
    </Stack>
  );
}

function mergeByStart(points) {
  const map = new Map();
  for (const p of points) {
    map.set(p.start, (map.get(p.start) ?? 0) + (Number(p.value) || 0));
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([start, value]) => ({ start, value }));
}
