import { Box, Paper, Stack, Tooltip, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { formatHour, formatDay, formatNumber } from '../format.js';
import { isDailyAggregateRange } from './RangePicker.jsx';

/**
 * Visualise burner-on minutes per bucket as a row of intensity-shaded cells.
 *
 * @param {{
 *   title: string,
 *   buckets: Array<{ start: string, end: string }>,
 *   minutesByStart: Map<string, number>,
 *   bucketDurationMinutes: number,
 *   range: string,
 * }} props
 */
export function BurnerTimelineStrip({
  title,
  buckets,
  minutesByStart,
  bucketDurationMinutes,
  range,
}) {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const dailyAggregate = isDailyAggregateRange(range);
  const accent = theme.palette.energy?.gas ?? theme.palette.primary.main;

  if (!buckets.length) return null;

  return (
    <Paper sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack spacing={1.25}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: `repeat(${buckets.length}, 1fr)`,
            gap: '2px',
            width: '100%',
            height: 28,
          }}
        >
          {buckets.map((b) => {
            const minutes = minutesByStart.get(b.start) ?? 0;
            const intensity =
              bucketDurationMinutes > 0
                ? Math.min(1, minutes / bucketDurationMinutes)
                : 0;
            const bg =
              intensity > 0
                ? alpha(accent, 0.15 + 0.75 * intensity)
                : alpha(theme.palette.divider, 0.3);
            const label = dailyAggregate
              ? formatDay(b.start, lng)
              : formatHour(b.start, lng);
            return (
              <Tooltip
                key={b.start}
                title={t('gas.burner.tooltip', {
                  bucket: label,
                  minutes: formatNumber(minutes, lng, {
                    maximumFractionDigits: 1,
                  }),
                })}
                disableInteractive
                arrow
              >
                <Box sx={{ bgcolor: bg, borderRadius: '2px' }} />
              </Tooltip>
            );
          })}
        </Box>
      </Stack>
    </Paper>
  );
}
