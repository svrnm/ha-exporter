import {
  ResponsiveContainer,
  LineChart,
  Line,
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

/**
 * Line chart sharing the time-series merge logic with HourlyBarChart.
 * Positive and negative values both render — handy for grid in/out.
 */
export function HourlyLineChart({ title, series, range = 'today', unit }) {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const dailyAggregate = isDailyAggregateRange(range);

  const rows = merge(series);

  return (
    <Paper sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        <Box sx={{ width: '100%', height: { xs: 240, sm: 300 } }}>
          <ResponsiveContainer>
            <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
              />
              <Tooltip
                contentStyle={{
                  background: theme.palette.background.paper,
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: 8,
                }}
                labelStyle={{ color: theme.palette.text.secondary }}
                itemStyle={{ color: theme.palette.text.primary }}
                formatter={(v) =>
                  `${formatKwh(v, lng)} ${unit ?? t('units.kwh')}`
                }
              />
              <Legend wrapperStyle={{ paddingTop: 8 }} />
              {series.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </Stack>
    </Paper>
  );

  function merge(all) {
    const map = new Map();
    for (const s of all) {
      for (const d of s.data ?? []) {
        let key = d.start;
        let labelDate = d.start;
        if (dailyAggregate) {
          const day = new Date(d.start);
          day.setHours(0, 0, 0, 0);
          key = day.toISOString();
          labelDate = key;
        }
        if (!map.has(key)) {
          map.set(key, {
            start: key,
            label: dailyAggregate ? formatDay(labelDate, lng) : formatHour(labelDate, lng),
          });
        }
        const row = map.get(key);
        const signed = s.signed === 'negative' ? -Math.abs(d.value) : d.value;
        row[s.key] = (row[s.key] ?? 0) + (Number(signed) || 0);
      }
    }
    return Array.from(map.values()).sort((a, b) => (a.start < b.start ? -1 : 1));
  }
}
