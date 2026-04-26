import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';
import { Box, Paper, Stack, Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { formatHour, formatDay, formatKwh } from '../format.js';
import { isDailyAggregateRange } from './RangePicker.jsx';

function addContribution(s, d) {
  const raw = Number(d.value) || 0;
  if (s.signed === 'negative') return -Math.abs(raw);
  return raw;
}

function mergeSeries(all, dailyAggregate, lng) {
  const map = new Map();
  for (const s of all) {
    for (const d of s.data ?? []) {
      const key = d.start;
      if (!map.has(key)) {
        map.set(key, {
          start: key,
          label: dailyAggregate ? formatDay(key, lng) : formatHour(key, lng),
        });
      }
      const row = map.get(key);
      row[s.key] = (row[s.key] ?? 0) + addContribution(s, d);
    }
  }
  return Array.from(map.values()).sort((a, b) => (a.start < b.start ? -1 : 1));
}

function aggregateByDay(hourly, lng) {
  const map = new Map();
  for (const row of hourly) {
    const d = new Date(row.start);
    d.setHours(0, 0, 0, 0);
    const key = d.toISOString();
    if (!map.has(key)) {
      map.set(key, { start: key, label: formatDay(key, lng) });
    }
    const out = map.get(key);
    for (const [k, v] of Object.entries(row)) {
      if (k === 'start' || k === 'label') continue;
      out[k] = (out[k] ?? 0) + (Number(v) || 0);
    }
  }
  return Array.from(map.values());
}

/**
 * Stacked hourly bar chart.
 *
 * props:
 *   title:   string
 *   series:  [{ key, label, color, data: [{start, value}]}]
 *   range:   preset, day:…, or span:… (for axis: daily aggregate when the window is multi-day)
 *   unit:    display unit string
 */
export function HourlyBarChart({ title, series, range = 'today', unit }) {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const lng = i18n.language;

  const dailyAggregate = isDailyAggregateRange(range);
  const merged = mergeSeries(series, dailyAggregate, lng);
  const rows = dailyAggregate ? aggregateByDay(merged, lng) : merged;
  const stackBySign = series.some((s) => s.signed === 'negative');

  function renderTooltip({ active, label, payload }) {
    if (!active || !payload?.length) return null;

    const byKey = new Map(payload.map((p) => [p.dataKey, p]));
    const ordered = [];
    for (const s of series) {
      const p = byKey.get(s.key);
      if (!p) continue;
      const v = Number(p.value);
      if (!Number.isFinite(v) || v === 0) continue;
      ordered.push({
        dataKey: s.key,
        name: p.name ?? s.label,
        value: v,
        color: p.color ?? p.fill ?? s.color,
      });
    }

    const unitStr = unit ?? t('units.kwh');

    return (
      <Paper
        elevation={0}
        sx={{
          px: 1.5,
          py: 1,
          background: theme.palette.background.paper,
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 1,
          boxShadow: theme.shadows[2],
        }}
      >
        <Typography
          variant="caption"
          sx={{ color: 'text.secondary', display: 'block', mb: ordered.length ? 0.75 : 0 }}
        >
          {label}
        </Typography>
        {ordered.length > 0 && (
          <Stack spacing={0.75}>
            {ordered.map((row) => (
              <Stack
                key={row.dataKey}
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ minWidth: 168 }}
              >
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: '2px',
                    bgcolor: row.color,
                    flexShrink: 0,
                  }}
                />
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
                  {row.name}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
                >
                  {`${formatKwh(row.value, lng)} ${unitStr}`}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        <Box sx={{ width: '100%', height: { xs: 260, sm: 320 } }}>
          <ResponsiveContainer>
            <BarChart
              data={rows}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              stackOffset={stackBySign ? 'sign' : 'none'}
            >
              <CartesianGrid stroke={theme.palette.divider} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                axisLine={{ stroke: theme.palette.divider }}
                tickLine={false}
                minTickGap={16}
              />
              <YAxis
                tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={48}
                tickFormatter={(v) => formatKwh(v, lng)}
              />
              <Tooltip content={renderTooltip} />
              <Legend wrapperStyle={{ paddingTop: 8 }} />
              {series.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stackId="a"
                  fill={s.color}
                  radius={stackBySign ? [2, 2, 2, 2] : [4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Box>
      </Stack>
    </Paper>
  );
}
