import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ParkOutlinedIcon from '@mui/icons-material/ParkOutlined';
import SavingsOutlinedIcon from '@mui/icons-material/SavingsOutlined';
import ShowChartOutlinedIcon from '@mui/icons-material/ShowChartOutlined';
import SolarPowerIcon from '@mui/icons-material/SolarPower';
import EnergySavingsLeafOutlinedIcon from '@mui/icons-material/EnergySavingsLeafOutlined';
import { useState } from 'react';
import { Box, IconButton, Paper, Popover, Skeleton, Stack, Tooltip, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { formatCurrency, formatKwh, formatNumber } from '../format.js';

/**
 * @param {{
 *   solarTotalLifeKwh: number,
 *   metricsLife: import('../api/summaryMetrics.js').SummaryMetricsSlice | null,
 *   currency: string,
 *   loading: boolean,
 * }} props
 */
export function SummaryHeroWidgets({
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
  /** Number only; currency symbol and context are in the tagline (same for all-time and range). */
  const fmtMoneyValue = (v) =>
    v != null && Number.isFinite(v)
      ? formatNumber(v, lng, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '—';
  const fmtKg = (v) =>
    v != null && Number.isFinite(v)
      ? `${formatNumber(v, lng, { maximumFractionDigits: 2 })} ${t('units.kgCo2')}`
      : '—';
  /** Hero tile: numeric mass only; tagline names kg CO₂ avoided. */
  const fmtKgValue = (v) =>
    v != null && Number.isFinite(v)
      ? formatNumber(v, lng, { maximumFractionDigits: 2 })
      : '—';
  const fmtTrees = (v) =>
    v != null && Number.isFinite(v)
      ? `${formatNumber(v, lng, { maximumFractionDigits: 1 })} ${t('units.treeYears')}`
      : '—';
  /** Trees hero tile: tagline already names the unit; show count only. */
  const fmtTreesCount = (v) =>
    v != null && Number.isFinite(v) ? formatNumber(v, lng, { maximumFractionDigits: 1 }) : '—';

  return (
    <Stack spacing={{ xs: 1.25, sm: 1.5 }} sx={{ width: '100%', minWidth: 0 }}>
      <Box component="header" sx={{ minWidth: 0 }}>
        <Stack
          direction="row"
          alignItems="flex-start"
          spacing={1.5}
          useFlexGap
          sx={{ minWidth: 0 }}
        >
          <ShowChartOutlinedIcon
            sx={{ color: 'text.secondary', fontSize: 20, flexShrink: 0, mt: 0.25 }}
            aria-hidden
          />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              variant="overline"
              color="text.secondary"
              component="h2"
              sx={{ fontWeight: 700, letterSpacing: 0.08, lineHeight: 1.35, display: 'block' }}
            >
              {t('summary.sectionTotalYieldTitle')}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ lineHeight: 1.4, display: 'block' }}
            >
              {t('summary.heroAllStoredCaption')}
            </Typography>
          </Box>
        </Stack>
      </Box>
      <Box
        sx={{
          display: 'grid',
          width: '100%',
          minWidth: 0,
          gap: { xs: 1, sm: 1.15, md: 1.25 },
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        }}
      >
      <HeroStat
        tagline={t('summary.heroStatSolarTagline')}
        tooltip={`${t('summary.heroSolarProduction')} · ${t('summary.heroAllStoredCaption')}`}
        icon={<SolarPowerIcon sx={{ fontSize: 20 }} />}
        compact
        loading={loading}
        value={
          solarTotalLifeKwh > 0
            ? formatKwh(solarTotalLifeKwh, lng)
            : solarTotalLifeKwh === 0
              ? formatKwh(0, lng)
              : '—'
        }
        valueAriaLabel={
          solarTotalLifeKwh >= 0 && Number.isFinite(solarTotalLifeKwh)
            ? `${formatKwh(solarTotalLifeKwh, lng)} ${t('units.kwh')}`
            : undefined
        }
        accent={c.solar}
      />
      <HeroStat
        tagline={t('summary.heroStatTreesTagline')}
        tooltip={`${t('summary.insightTrees')} · ${t('summary.heroAllStoredCaption')}`}
        icon={<ParkOutlinedIcon sx={{ fontSize: 20 }} />}
        compact
        loading={loading}
        value={fmtTreesCount(metricsLife?.treesEquivalent)}
        valueAriaLabel={fmtTrees(metricsLife?.treesEquivalent)}
        accent={c.home ?? theme.palette.secondary.main}
      />
      <HeroStat
        tagline={t('summary.heroStatCo2Tagline')}
        tooltip={`${t('summary.insightCo2Saved')} · ${t('summary.heroAllStoredCaption')}`}
        icon={<EnergySavingsLeafOutlinedIcon sx={{ fontSize: 20 }} />}
        compact
        loading={loading}
        value={fmtKgValue(metricsLife?.co2AvoidedKg)}
        valueAriaLabel={
          metricsLife?.co2AvoidedKg != null && Number.isFinite(metricsLife.co2AvoidedKg)
            ? fmtKg(metricsLife.co2AvoidedKg)
            : undefined
        }
        accent={c.co2Neutral ?? theme.palette.success.light}
      />
      <HeroStat
        tagline={t('summary.heroStatSavingsTagline')}
        tooltip={`${t('summary.insightTotalSavings')} · ${t('summary.heroAllStoredCaption')}`}
        icon={<SavingsOutlinedIcon sx={{ fontSize: 20 }} />}
        compact
        loading={loading}
        value={fmtMoneyValue(metricsLife?.footerSavings)}
        valueAriaLabel={
          metricsLife?.footerSavings != null && Number.isFinite(metricsLife.footerSavings)
            ? fmtMoney(metricsLife.footerSavings)
            : undefined
        }
        accent={c.solar ?? theme.palette.success.main}
        valueColor="success.main"
      />
      </Box>
    </Stack>
  );
}

/**
 * Shared tile for header metrics (lifetime hero row and range insight row).
 *
 * @param {{ valueSuffix?: string, info?: string, infoAriaLabel?: string }} [extra] — optional
 *   second part of the value (e.g. `kg CO₂`) and an info popover.
 */
export function HeroStat({
  tagline,
  tooltip,
  icon,
  value,
  loading,
  accent,
  valueColor = 'text.primary',
  valueAriaLabel,
  valueSuffix = null,
  info = null,
  infoAriaLabel = '',
  compact = false,
}) {
  const theme = useTheme();
  const showValueSuffix =
    valueSuffix != null && String(valueSuffix) !== '' && value != null && String(value) !== '—';
  const iconPx = compact ? 36 : 44;
  const pad = compact
    ? { xs: 1.15, sm: 1.25 }
    : { xs: 1.75, sm: 2 };
  const rowGap = compact ? 1 : 1.25;
  const valueVariant = compact ? 'subtitle1' : 'h6';
  return (
    <Paper
      sx={{
        p: pad,
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      {loading ? (
        <Stack direction="row" alignItems="center" spacing={rowGap} sx={{ minWidth: 0 }}>
          <Skeleton
            variant="rounded"
            width={iconPx}
            height={iconPx}
            sx={{ flexShrink: 0, borderRadius: 1.5 }}
          />
          <Stack spacing={0.4} sx={{ flex: 1, minWidth: 0 }}>
            <Skeleton variant="text" width={compact ? 72 : 88} height={compact ? 22 : 28} />
            <Skeleton variant="text" width="80%" height={compact ? 12 : 14} />
          </Stack>
        </Stack>
      ) : (
        <Stack
          direction="row"
          alignItems="center"
          spacing={rowGap}
          sx={{ minWidth: 0, width: '100%' }}
        >
          <Tooltip title={tooltip}>
            <Box
              sx={{
                width: iconPx,
                height: iconPx,
                borderRadius: 1.5,
                display: 'grid',
                placeItems: 'center',
                bgcolor: accent ? alpha(accent, 0.12) : theme.palette.action.hover,
                color: accent || 'text.primary',
                flexShrink: 0,
                '& .MuiSvgIcon-root': { fontSize: compact ? 20 : 24 },
              }}
            >
              {icon}
            </Box>
          </Tooltip>
          <Stack
            spacing={compact ? 0.2 : 0.25}
            sx={{ flex: 1, minWidth: 0, alignItems: 'flex-start' }}
          >
            {showValueSuffix ? (
              <Box
                role="group"
                aria-label={valueAriaLabel}
                sx={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 0.5,
                  flexWrap: 'nowrap',
                  minWidth: 0,
                  maxWidth: '100%',
                }}
              >
                <Typography
                  variant={valueVariant}
                  className="num"
                  component="span"
                  sx={{
                    m: 0,
                    fontWeight: 700,
                    lineHeight: 1.2,
                    fontFeatureSettings: '"tnum"',
                    color: valueColor,
                    flex: '0 1 auto',
                    minWidth: 0,
                    whiteSpace: 'nowrap',
                    ...(compact ? { fontSize: '0.95rem' } : null),
                  }}
                >
                  {value}
                </Typography>
                <Typography
                  variant="body2"
                  component="span"
                  className="num"
                  color="text.secondary"
                  sx={{
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    ...(compact ? { fontSize: '0.75rem' } : null),
                  }}
                >
                  {valueSuffix}
                </Typography>
              </Box>
            ) : (
              <Typography
                variant={valueVariant}
                className="num"
                component="p"
                aria-label={valueAriaLabel}
                sx={{
                  m: 0,
                  fontWeight: 700,
                  fontFeatureSettings: '"tnum"',
                  color: valueColor,
                  lineHeight: 1.2,
                  minWidth: 0,
                  wordBreak: 'break-word',
                  ...(compact ? { fontSize: '0.95rem' } : null),
                }}
              >
                {value}
              </Typography>
            )}
            {tagline ? (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  fontWeight: 600,
                  lineHeight: 1.3,
                  ...(compact ? { fontSize: '0.7rem' } : null),
                }}
              >
                {tagline}
              </Typography>
            ) : null}
          </Stack>
          {info ? <HeroStatInfo body={info} ariaLabel={infoAriaLabel} /> : null}
        </Stack>
      )}
    </Paper>
  );
}

function HeroStatInfo({ body, ariaLabel }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);
  if (!body) return null;
  return (
    <>
      <IconButton
        size="small"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="true"
        sx={{
          flexShrink: 0,
          alignSelf: 'center',
          color: 'text.secondary',
          '&:hover': { color: 'primary.main', bgcolor: 'action.selected' },
        }}
      >
        <InfoOutlinedIcon sx={{ fontSize: 18 }} />
      </IconButton>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              maxWidth: 360,
              p: 2,
              borderRadius: 2,
              border: 1,
              borderColor: 'divider',
            },
          },
        }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
          {body}
        </Typography>
      </Popover>
    </>
  );
}
