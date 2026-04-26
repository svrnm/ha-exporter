import { useMemo } from 'react';
import {
  Area,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Box, Paper, Stack, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

/**
 * Power over time for the Live view.
 *
 * Three signed areas share the zero line:
 *   - solar         ≥ 0  (always above)
 *   - grid          ±    (import above 0, export below)
 *   - battery       ±    (discharge above, charge below)
 * Plus a consumption line riding on top of the positive stack.
 *
 * Implementation notes:
 *   - Grid and battery are pre-split into pos/neg companion series by
 *     `mergePowerTimeline` so Recharts can stack them into a single
 *     positive and a single negative half-stack.
 *   - Zero-line reference drawn explicitly — the two half-stacks mean the
 *     default x-axis ends up floating, which looks odd.
 *   - `dot={false}` everywhere because hundreds of samples per day.
 */
export function PowerTimelineChart({
  rows,
  colors,
  formatAxis,
  formatTooltipTime,
  title,
}) {
  const theme = useTheme();
  const { t } = useTranslation();

  const fmtKw = (v) => {
    const n = Number(v) || 0;
    if (Math.abs(n) < 1) return `${Math.round(n * 1000)} W`;
    return `${n.toFixed(Math.abs(n) < 10 ? 2 : 1)} kW`;
  };

  const minY = useMemo(() => {
    let m = 0;
    for (const r of rows) {
      const neg = (r.gridNeg || 0) + (r.batteryNeg || 0);
      if (neg < m) m = neg;
    }
    return Math.floor(m - 0.2);
  }, [rows]);
  const maxY = useMemo(() => {
    let m = 0;
    for (const r of rows) {
      const pos =
        (r.solarKw || 0) + (r.gridPos || 0) + (r.batteryPos || 0);
      if (pos > m) m = pos;
      if ((r.consumption || 0) > m) m = r.consumption || 0;
    }
    return Math.ceil(m + 0.3);
  }, [rows]);

  return (
    <Paper sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {title ?? t('now.timelineTitle')}
        </Typography>
        <Box
          component="ul"
          sx={{
            m: 0,
            p: 0,
            listStyle: 'none',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'center',
            columnGap: 2,
            rowGap: 0.5,
          }}
        >
          <Box component="li" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
            <Box
              component="span"
              aria-hidden
              sx={{
                display: 'inline-block',
                width: 12,
                height: 12,
                borderRadius: 0.5,
                bgcolor: colors.solar,
                flexShrink: 0,
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {t('now.series.solar')}
            </Typography>
          </Box>
          <Box component="li" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
            <Box
              component="span"
              aria-hidden
              sx={{
                display: 'inline-block',
                width: 12,
                height: 12,
                borderRadius: 0.5,
                bgcolor: colors.grid,
                flexShrink: 0,
                opacity: 0.9,
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {t('now.series.grid')}
            </Typography>
          </Box>
          <Box component="li" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
            <Box
              component="span"
              aria-hidden
              sx={{
                display: 'inline-block',
                width: 12,
                height: 12,
                borderRadius: 0.5,
                bgcolor: colors.battery,
                flexShrink: 0,
                opacity: 0.9,
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {t('now.series.battery')}
            </Typography>
          </Box>
          <Box component="li" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
            <Box
              component="svg"
              width={24}
              height={12}
              viewBox="0 0 24 12"
              aria-hidden
              sx={{ flexShrink: 0, display: 'block' }}
            >
              <line
                x1="0"
                y1="6"
                x2="24"
                y2="6"
                stroke={colors.home}
                strokeWidth="2.5"
                strokeDasharray="4 3"
              />
            </Box>
            <Typography variant="caption" color="text.secondary">
              {t('now.series.consumption')}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ width: '100%', height: { xs: 320, sm: 400 } }}>
          <ResponsiveContainer>
            <ComposedChart
              data={rows}
              margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
            >
              <CartesianGrid stroke={theme.palette.divider} vertical={false} />
              <XAxis
                dataKey="tsMs"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                axisLine={{ stroke: theme.palette.divider }}
                tickLine={false}
                minTickGap={48}
                tickFormatter={(v) => formatAxis(v)}
              />
              <YAxis
                domain={[minY, maxY]}
                tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={56}
                tickFormatter={(v) => `${v} kW`}
              />
              <ReferenceLine y={0} stroke={theme.palette.divider} />
              <Tooltip
                contentStyle={{
                  background: theme.palette.background.paper,
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: 8,
                }}
                labelStyle={{ color: theme.palette.text.secondary }}
                itemStyle={{ color: theme.palette.text.primary }}
                labelFormatter={(v) => formatTooltipTime(v)}
                formatter={(value, _name, ctx) => {
                  // Grid/battery negative halves share colour with their
                  // positive counterpart — display their magnitude (abs)
                  // in the tooltip so users see "export 1.3 kW" instead
                  // of "-1.3 kW" which reads like a bug.
                  const abs = Math.abs(Number(value) || 0);
                  return [fmtKw(abs), ctx?.name];
                }}
              />

              {/* Positive stack — sources supplying the home */}
              <Area
                type="stepAfter"
                dataKey="solarKw"
                name={t('now.series.solar')}
                stackId="pos"
                stroke="transparent"
                fill={colors.solar}
                fillOpacity={0.85}
                isAnimationActive={false}
              />
              <Area
                type="stepAfter"
                dataKey="gridPos"
                name={t('now.series.grid')}
                stackId="pos"
                stroke="transparent"
                fill={colors.grid}
                fillOpacity={0.85}
                isAnimationActive={false}
              />
              <Area
                type="stepAfter"
                dataKey="batteryPos"
                name={t('now.series.battery')}
                stackId="pos"
                stroke="transparent"
                fill={colors.battery}
                fillOpacity={0.85}
                isAnimationActive={false}
              />

              {/* Negative stack — sinks drawn below the zero line */}
              <Area
                type="stepAfter"
                dataKey="gridNeg"
                name={t('now.series.gridExport')}
                stackId="neg"
                stroke="transparent"
                fill={colors.grid}
                fillOpacity={0.55}
                isAnimationActive={false}
              />
              <Area
                type="stepAfter"
                dataKey="batteryNeg"
                name={t('now.series.batteryCharge')}
                stackId="neg"
                stroke="transparent"
                fill={colors.battery}
                fillOpacity={0.55}
                isAnimationActive={false}
              />

              {/* Consumption — a bright overlay line, no fill */}
              <Line
                type="monotone"
                dataKey="consumption"
                name={t('now.series.consumption')}
                stroke={colors.home}
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
              {rows.length > 1 && (
                <Brush
                  dataKey="tsMs"
                  height={40}
                  stroke={theme.palette.divider}
                  fill={alpha(theme.palette.action.hover, 0.25)}
                  travellerWidth={9}
                  tickFormatter={formatAxis}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </Box>
        {rows.length > 1 && (
          <Typography variant="caption" color="text.disabled" component="p" sx={{ m: 0, mt: 0.5, textAlign: 'center' }}>
            {t('now.timelineBrushHint')}
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}
