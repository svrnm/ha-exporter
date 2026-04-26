import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ParkOutlinedIcon from '@mui/icons-material/ParkOutlined';
import SavingsOutlinedIcon from '@mui/icons-material/SavingsOutlined';
import SensorsOutlinedIcon from '@mui/icons-material/SensorsOutlined';
import WbSunnyOutlinedIcon from '@mui/icons-material/WbSunnyOutlined';
import EnergySavingsLeafOutlinedIcon from '@mui/icons-material/EnergySavingsLeafOutlined';
import ElectricBoltOutlinedIcon from '@mui/icons-material/ElectricBoltOutlined';
import { useLayoutEffect, useRef, useState } from 'react';
import { Box, IconButton, Paper, Skeleton, Stack, Tooltip, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { formatCurrency, formatKwh, formatNumber, formatWatts } from '../format.js';

/**
 * @param {{
 *   liveFlowW: null | {
 *     solarToHome: number, gridToHome: number, batteryToHome: number,
 *   },
 *   solarTotalLifeKwh: number,
 *   metricsLife: import('../api/summaryMetrics.js').SummaryMetricsSlice | null,
 *   currency: string,
 *   loading: boolean,
 * }} props
 */
export function SummaryHeroWidgets({
  liveFlowW,
  solarTotalLifeKwh,
  metricsLife,
  currency,
  loading,
}) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const lng = i18n.language;
  const c = theme.palette.energy ?? {};

  const fmtMoney = (v) =>
    v != null && Number.isFinite(v) ? formatCurrency(v, lng, currency) : '—';
  const fmtKg = (v) =>
    v != null && Number.isFinite(v)
      ? `${formatNumber(v, lng, { maximumFractionDigits: 2 })} ${t('units.kgCo2')}`
      : '—';
  const fmtTrees = (v) =>
    v != null && Number.isFinite(v)
      ? `${formatNumber(v, lng, { maximumFractionDigits: 1 })} ${t('units.treeYears')}`
      : '—';
  /** Trees hero tile: tagline already names the unit; show count only. */
  const fmtTreesCount = (v) =>
    v != null && Number.isFinite(v) ? formatNumber(v, lng, { maximumFractionDigits: 1 }) : '—';

  const solarW = liveFlowW?.solarToHome ?? null;
  const batteryW = liveFlowW?.batteryToHome ?? null;
  const gridW = liveFlowW?.gridToHome ?? null;
  const hasLiveSplit = liveFlowW != null;
  const totalW =
    hasLiveSplit && [solarW, batteryW, gridW].some((v) => v != null && Number.isFinite(v))
      ? (solarW ?? 0) + (batteryW ?? 0) + (gridW ?? 0)
      : null;

  const splitParts = [
    { key: 'solar', label: t('summary.flow.pv'), w: solarW, color: c.solar },
    { key: 'battery', label: t('summary.flow.battery'), w: batteryW, color: c.battery },
    { key: 'grid', label: t('summary.flow.grid'), w: gridW, color: c.grid },
  ];

  return (
    <Box
      sx={{
        display: 'grid',
        gap: { xs: 1.5, sm: 2 },
        gridTemplateColumns: {
          xs: '1fr',
          sm: 'repeat(2, minmax(0, 1fr))',
          md: 'repeat(5, minmax(0, 1fr))',
        },
      }}
    >
      <Paper
        sx={{
          p: { xs: 1.75, sm: 2 },
          height: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
        }}
      >
        {loading ? (
          <Stack spacing={1} sx={{ flex: 1, minHeight: 0, minWidth: 0 }}>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Skeleton variant="rounded" width={44} height={44} sx={{ flexShrink: 0 }} />
              <Skeleton variant="text" sx={{ flex: 1 }} height={32} />
            </Stack>
            <Skeleton variant="text" width="75%" height={14} />
            <Skeleton variant="rounded" width="100%" height={40} />
          </Stack>
        ) : !hasLiveSplit ? (
          <Stack spacing={1} sx={{ flex: 1, minHeight: 0, minWidth: 0 }}>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Tooltip title={t('summary.heroCurrentViewUnavailable')}>
                <Box
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: 1.5,
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                    bgcolor: 'action.hover',
                    color: 'text.disabled',
                  }}
                >
                  <SensorsOutlinedIcon sx={{ fontSize: 24 }} />
                </Box>
              </Tooltip>
              <Typography variant="h6" className="num" color="text.disabled" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                —
              </Typography>
            </Stack>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontWeight: 600, lineHeight: 1.3, display: 'block' }}
            >
              {t('summary.heroStatConsumptionTagline')}
            </Typography>
          </Stack>
        ) : (
          <Stack spacing={1} sx={{ flex: 1, minHeight: 0, minWidth: 0 }}>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ minWidth: 0 }}>
              <Tooltip title={t('summary.heroCurrentView')}>
                <Box
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: 1.5,
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                    bgcolor: 'action.selected',
                    color: 'primary.main',
                  }}
                >
                  <ElectricBoltOutlinedIcon sx={{ fontSize: 24 }} />
                </Box>
              </Tooltip>
              <Typography
                variant="h6"
                className="num"
                sx={{
                  fontWeight: 700,
                  lineHeight: 1.2,
                  fontFeatureSettings: '"tnum"',
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {totalW != null ? `${formatWatts(totalW, lng)} ${t('units.w')}` : '—'}
              </Typography>
              <Tooltip title={t('summary.heroConsumptionFootnote')}>
                <IconButton
                  size="small"
                  aria-label={t('summary.heroConsumptionFootnote')}
                  sx={{ flexShrink: 0, mr: -0.75 }}
                >
                  <InfoOutlinedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            </Stack>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontWeight: 600, lineHeight: 1.3, display: 'block' }}
            >
              {t('summary.heroStatConsumptionTagline')}
            </Typography>
            <LiveConsumptionSplitBar segments={splitParts} lng={lng} t={t} />
          </Stack>
        )}
      </Paper>

      <HeroStat
        tagline={t('summary.heroStatSolarTagline')}
        tooltip={`${t('summary.heroSolarProduction')} · ${t('summary.heroAllStoredCaption')}`}
        icon={<WbSunnyOutlinedIcon sx={{ fontSize: 24 }} />}
        loading={loading}
        value={
          solarTotalLifeKwh > 0
            ? `${formatKwh(solarTotalLifeKwh, lng)} ${t('units.kwh')}`
            : solarTotalLifeKwh === 0
              ? `0 ${t('units.kwh')}`
              : '—'
        }
        accent={c.solar}
      />
      <HeroStat
        tagline={t('summary.heroStatTreesTagline')}
        tooltip={`${t('summary.insightTrees')} · ${t('summary.heroAllStoredCaption')}`}
        icon={<ParkOutlinedIcon sx={{ fontSize: 24 }} />}
        loading={loading}
        value={fmtTreesCount(metricsLife?.treesEquivalent)}
        valueAriaLabel={fmtTrees(metricsLife?.treesEquivalent)}
        accent={c.home ?? theme.palette.secondary.main}
      />
      <HeroStat
        tagline={t('summary.heroStatCo2Tagline')}
        tooltip={`${t('summary.insightCo2Saved')} · ${t('summary.heroAllStoredCaption')}`}
        icon={<EnergySavingsLeafOutlinedIcon sx={{ fontSize: 24 }} />}
        loading={loading}
        value={fmtKg(metricsLife?.co2AvoidedKg)}
        accent={c.co2Neutral ?? theme.palette.success.light}
      />
      <HeroStat
        tagline={t('summary.heroStatSavingsTagline')}
        tooltip={`${t('summary.insightTotalSavings')} · ${t('summary.heroAllStoredCaption')}`}
        icon={<SavingsOutlinedIcon sx={{ fontSize: 24 }} />}
        loading={loading}
        value={fmtMoney(metricsLife?.footerSavings)}
        accent={c.solar ?? theme.palette.success.main}
        valueColor="success.main"
      />
    </Box>
  );
}

/** In-bar label when segment is at least this wide (px); otherwise value is tooltip-only. */
const CONSUMPTION_BAR_LABEL_MIN_PX = 58;

/**
 * Full-width stacked bar: segment width ∝ watts (solar, battery, grid).
 *
 * @param {{
 *   segments: Array<{ key: string, label: string, w: number | null, color?: string }>,
 *   lng: string,
 *   t: import('i18next').TFunction,
 * }} props
 */
function LiveConsumptionSplitBar({ segments, lng, t }) {
  const barRef = useRef(null);
  const [barPx, setBarPx] = useState(0);

  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return undefined;
    const read = () => setBarPx(el.getBoundingClientRect().width);
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const wattsList = segments.map((s) =>
    Math.max(0, s.w != null && Number.isFinite(s.w) ? s.w : 0),
  );
  const total = wattsList.reduce((a, b) => a + b, 0);

  return (
    <Box
      ref={barRef}
      sx={{
        display: 'flex',
        width: '100%',
        height: 40,
        borderRadius: 1,
        overflow: 'hidden',
        border: 1,
        borderColor: 'divider',
      }}
    >
      {total <= 0 ? (
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'action.hover',
          }}
        >
          <Typography variant="caption" color="text.secondary" className="num">
            0 {t('units.w')}
          </Typography>
        </Box>
      ) : (
        segments.map((s, i) => {
          const wn = wattsList[i];
          if (wn <= 0) return null;
          const pct = (wn / total) * 100;
          const segPx = (barPx * pct) / 100;
          const showLabel =
            barPx > 32 ? segPx >= CONSUMPTION_BAR_LABEL_MIN_PX : pct >= 14;
          const text = `${formatWatts(wn, lng)} ${t('units.w')}`;
          const tip = `${s.label}: ${text}`;

          const segment = (
            <Box
              aria-label={tip}
              sx={{
                width: `${pct}%`,
                flexShrink: 0,
                minWidth: 0,
                bgcolor: s.color || 'grey.600',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxSizing: 'border-box',
                px: 0.5,
              }}
            >
              {showLabel ? (
                <Typography
                  variant="caption"
                  className="num"
                  sx={{
                    fontWeight: 700,
                    lineHeight: 1.15,
                    color: 'rgba(255,255,255,0.95)',
                    textShadow: '0 1px 3px rgba(0,0,0,0.55)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: '100%',
                  }}
                >
                  {text}
                </Typography>
              ) : null}
            </Box>
          );

          return (
            <Tooltip key={s.key} title={tip} disableHoverListener={showLabel} enterTouchDelay={0}>
              {segment}
            </Tooltip>
          );
        })
      )}
    </Box>
  );
}

function HeroStat({
  tagline,
  tooltip,
  icon,
  value,
  loading,
  accent,
  valueColor = 'text.primary',
  valueAriaLabel,
}) {
  return (
    <Paper
      sx={{
        p: { xs: 1.75, sm: 2 },
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      <Stack spacing={1} sx={{ flex: 1, minHeight: 0, minWidth: 0 }}>
        {loading ? (
          <>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Skeleton variant="rounded" width={44} height={44} sx={{ flexShrink: 0 }} />
              <Skeleton variant="text" sx={{ flex: 1 }} height={32} />
            </Stack>
            <Skeleton variant="text" width="70%" height={14} />
          </>
        ) : (
          <>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ minWidth: 0 }}>
              <Tooltip title={tooltip}>
                <Box
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: 1.5,
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: accent ? `${accent}22` : 'action.hover',
                    color: accent || 'text.primary',
                    flexShrink: 0,
                  }}
                >
                  {icon}
                </Box>
              </Tooltip>
              <Typography
                variant="h6"
                className="num"
                aria-label={valueAriaLabel}
                sx={{
                  fontWeight: 700,
                  fontFeatureSettings: '"tnum"',
                  color: valueColor,
                  wordBreak: 'break-word',
                  lineHeight: 1.2,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {value}
              </Typography>
            </Stack>
            {tagline ? (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontWeight: 600, lineHeight: 1.3, display: 'block' }}
              >
                {tagline}
              </Typography>
            ) : null}
          </>
        )}
      </Stack>
    </Paper>
  );
}
