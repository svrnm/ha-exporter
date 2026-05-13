import { useMemo } from 'react';
import { alpha, useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { HourlyBarChart } from './HourlyBarChart.jsx';

// Same palette as DeviceKwhBarChart so a device's color is stable between the
// time-series chart and the totals chart underneath it. Indexed by sorted
// position (largest device first).
const BAR_TINTS = [
  '#8D6E63',
  '#EC407A',
  '#BCAAA4',
  '#FFB300',
  '#26A69A',
  '#FFEE58',
  '#9CCC65',
  '#B2EBF2',
  '#CE93D8',
  '#81D4FA',
  '#A5D6A7',
  '#90CAF9',
];

/**
 * Per-device consumption over time. Filters `devices` to leaf meters,
 * keeps the `topN` largest contributors over the range, and rolls the
 * rest into a single "Other" stack segment.
 */
export function DeviceHourlyChart({
  devices,
  deltasByStat,
  range,
  title,
  topN = 8,
}) {
  const theme = useTheme();
  const { t } = useTranslation();

  const series = useMemo(
    () => buildSeries(devices, deltasByStat, topN, t('electricity.otherDevices'), theme),
    [devices, deltasByStat, topN, t, theme],
  );

  if (series.length === 0) return null;

  return <HourlyBarChart title={title} series={series} range={range} />;
}

function buildSeries(devices, deltasByStat, topN, otherLabel, theme) {
  const list = Array.isArray(devices) ? devices : [];
  if (list.length === 0) return [];

  // A device is a leaf when no other device's `includedInStat` points at it.
  const parentStatIds = new Set();
  for (const d of list) {
    if (d?.includedInStat) parentStatIds.add(d.includedInStat);
  }
  const leaves = list.filter((d) => d?.stat && !parentStatIds.has(d.stat));
  if (leaves.length === 0) return [];

  const totalled = leaves
    .map((d) => {
      const data = Array.isArray(deltasByStat.get(d.stat))
        ? deltasByStat.get(d.stat)
        : [];
      const total = data.reduce(
        (acc, row) => acc + (Number(row?.value) || 0),
        0,
      );
      return { device: d, data, total };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total);

  if (totalled.length === 0) return [];

  const top = totalled.slice(0, topN);
  const rest = totalled.slice(topN);

  // Named devices first, biggest at the bottom of the stack.
  const series = top.map((row, i) => ({
    key: `device-${i}`,
    label: row.device.name || shortId(row.device.stat),
    color: BAR_TINTS[i % BAR_TINTS.length],
    data: row.data,
  }));

  if (rest.length > 0) {
    const merged = new Map();
    for (const row of rest) {
      for (const point of row.data) {
        const key = point?.start;
        if (key == null) continue;
        merged.set(key, (merged.get(key) ?? 0) + (Number(point.value) || 0));
      }
    }
    const otherData = Array.from(merged.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([start, value]) => ({ start, value }));
    if (otherData.length > 0) {
      series.push({
        key: 'device-other',
        label: otherLabel,
        color: alpha(theme.palette.text.secondary, 0.25),
        data: otherData,
      });
    }
  }

  return series;
}

function shortId(statId) {
  const parts = String(statId).split('.');
  return parts[parts.length - 1] ?? String(statId);
}
