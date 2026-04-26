import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { Box, IconButton, Paper, Popover, Stack, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatKwh, formatWatts } from '../format.js';

/**
 * Recharts' default tooltip sets text color to the bar/segment color (`entry.color`),
 * which is often a dark swatch and reads as black on dark `background.paper`.
 */
function DeviceBarTooltipContent({ active, payload, label, valueUnit = 'kwh' }) {
  const { t, i18n } = useTranslation();
  if (!active || !payload?.length) return null;
  const row = payload[0];
  const v = row?.value;
  const name = label != null && String(label) !== '' ? label : row?.name;
  const valueLine =
    v == null || !Number.isFinite(Number(v))
      ? '—'
      : valueUnit === 'watt'
        ? `${formatWatts(Number(v), i18n.language)} ${t('units.w')}`
        : `${formatKwh(Number(v), i18n.language)} ${t('units.kwh')}`;
  return (
    <Box
      sx={{
        px: 1.25,
        py: 1,
        minWidth: 120,
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        color: 'text.primary',
        boxShadow: 2,
      }}
    >
      {name != null && String(name) !== '' ? (
        <Typography variant="caption" color="text.secondary" display="block" noWrap sx={{ maxWidth: 280 }}>
          {name}
        </Typography>
      ) : null}
      <Typography variant="body2" className="num" color="text.primary" sx={{ fontWeight: 600, mt: name ? 0.25 : 0 }}>
        {valueLine}
      </Typography>
    </Box>
  );
}

const MIN_BAR_KWH = 0.000_001;
const MIN_BAR_W = 0.5;
const BAR_H = 22;
const H_PAD = 100;

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
 * All tracked devices, sorted by value, as horizontal bars (Energy dashboard style).
 * `valueUnit`: `kwh` (default) for period energy, or `watt` for instant power.
 * Optional `titleInfo` shows an info icon (popover) next to the title.
 */
export function DeviceKwhBarChart({
  devices,
  title,
  headerAction = null,
  titleInfo = null,
  valueUnit = 'kwh',
  emptyText = null,
}) {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const isWatt = valueUnit === 'watt';
  const minV = isWatt ? MIN_BAR_W : MIN_BAR_KWH;
  const axisLabel = isWatt ? t('units.w') : t('units.kwh');
  const emptyDefault = isWatt ? t('now.devicesEmptyWatts') : t('electricity.devicesEmpty');
  const empty = emptyText ?? emptyDefault;

  const data = useMemo(() => {
    return (devices ?? [])
      .filter((d) => d.value > minV)
      .map((d) => ({ name: d.name, value: d.value }))
      .sort((a, b) => b.value - a.value);
  }, [devices, minV]);

  const xMax = useMemo(() => {
    const m = data.reduce((a, d) => Math.max(a, d.value), 0);
    return m > 0 ? m * 1.08 : 1;
  }, [data]);

  const h = Math.max(220, H_PAD + data.length * BAR_H);

  /** Recharts cursor fill must be a valid color — do not append hex digits to MUI’s `action.hover` (it is `rgba(...)` and becomes invalid + reads as black). */
  const tooltipCursorFill = useMemo(
    () =>
      theme.palette.mode === 'dark'
        ? alpha(theme.palette.common.white, 0.1)
        : alpha(theme.palette.common.black, 0.06),
    [theme],
  );

  return (
    <Paper sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack spacing={1.5}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          gap={1}
          sx={{ minWidth: 0 }}
        >
          <Stack direction="row" alignItems="center" gap={0.5} sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {title}
            </Typography>
            {titleInfo ? <DeviceChartTitleInfo titleInfo={titleInfo} /> : null}
          </Stack>
          {headerAction}
        </Stack>
        {data.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {empty}
          </Typography>
        ) : (
          <Box sx={{ width: '100%', height: h }}>
            <ResponsiveContainer>
              <BarChart
                layout="vertical"
                data={data}
                margin={{ top: 4, right: 16, left: 4, bottom: 28 }}
                barCategoryGap={4}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  horizontal={false}
                  stroke={theme.palette.divider}
                />
                <XAxis
                  type="number"
                  domain={[0, xMax]}
                  tickFormatter={(v) => {
                    if (v == null || !Number.isFinite(Number(v))) return '';
                    return isWatt
                      ? formatWatts(Number(v), i18n.language)
                      : formatKwh(Number(v), i18n.language);
                  }}
                  tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
                  tickLine={{ stroke: theme.palette.divider }}
                  label={{
                    value: axisLabel,
                    position: 'insideBottomRight',
                    offset: -4,
                    style: { fill: theme.palette.text.secondary, fontSize: 11 },
                  }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={200}
                  tick={{ fontSize: 11, fill: theme.palette.text.primary }}
                  tickFormatter={(v) =>
                    String(v).length > 32 ? `${String(v).slice(0, 30)}…` : v
                  }
                />
                <Tooltip
                  cursor={{ fill: tooltipCursorFill }}
                  content={(props) => <DeviceBarTooltipContent {...props} valueUnit={valueUnit} />}
                />
                <Bar
                  dataKey="value"
                  radius={[0, 3, 3, 0]}
                  stroke={theme.palette.text.primary}
                  strokeOpacity={0.35}
                  strokeWidth={0.5}
                  isAnimationActive={false}
                >
                  {data.map((_, i) => (
                    <Cell
                      key={i}
                      fill={BAR_TINTS[i % BAR_TINTS.length]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Box>
        )}
      </Stack>
    </Paper>
  );
}

function DeviceChartTitleInfo({ titleInfo }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);
  return (
    <>
      <IconButton
        size="small"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        aria-label={titleInfo.ariaLabel}
        aria-expanded={open}
        aria-haspopup="true"
        sx={{
          flexShrink: 0,
          color: 'text.secondary',
          '&:hover': { color: 'primary.main', bgcolor: 'action.selected' },
        }}
      >
        <InfoOutlinedIcon sx={{ fontSize: 20 }} />
      </IconButton>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              maxWidth: 400,
              p: 2,
              borderRadius: 2,
              border: 1,
              borderColor: 'divider',
            },
          },
        }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
          {titleInfo.text}
        </Typography>
      </Popover>
    </>
  );
}
