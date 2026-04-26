import { useState } from 'react';
import DateRangeOutlinedIcon from '@mui/icons-material/DateRangeOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import PaidOutlinedIcon from '@mui/icons-material/PaidOutlined';
import ParkOutlinedIcon from '@mui/icons-material/ParkOutlined';
import SavingsOutlinedIcon from '@mui/icons-material/SavingsOutlined';
import EnergySavingsLeafOutlinedIcon from '@mui/icons-material/EnergySavingsLeafOutlined';
import {
  Box,
  IconButton,
  Paper,
  Popover,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { formatCurrency, formatNumber } from '../format.js';

/**
 * @param {{
 *   metricsSelection: import('../api/summaryMetrics.js').SummaryMetricsSlice | null,
 *   selectionLabel: string,
 *   currency: string,
 *   loading?: boolean,
 * }} props
 */
export function SummaryInsightBoxes({
  metricsSelection,
  selectionLabel,
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

  const cards = [
    {
      key: 'cost',
      title: t('summary.insightTotalCost'),
      icon: <PaidOutlinedIcon sx={{ fontSize: 22 }} />,
      accent: c.grid ?? theme.palette.primary.main,
      value: fmtMoney(metricsSelection?.footerCost),
      valueColor: 'text.primary',
      info: null,
    },
    {
      key: 'savings',
      title: t('summary.insightTotalSavings'),
      icon: <SavingsOutlinedIcon sx={{ fontSize: 22 }} />,
      accent: c.solar ?? theme.palette.success.main,
      value: fmtMoney(metricsSelection?.footerSavings),
      valueColor: 'success.main',
      info: null,
    },
    {
      key: 'co2',
      title: t('summary.insightCo2Saved'),
      icon: <EnergySavingsLeafOutlinedIcon sx={{ fontSize: 22 }} />,
      accent: c.co2Neutral ?? theme.palette.success.light,
      value: fmtKg(metricsSelection?.co2AvoidedKg),
      valueColor: 'text.primary',
      info: t('summary.insightCo2Footnote'),
    },
    {
      key: 'trees',
      title: t('summary.insightTrees'),
      icon: <ParkOutlinedIcon sx={{ fontSize: 22 }} />,
      accent: c.home ?? theme.palette.secondary.main,
      value: fmtTrees(metricsSelection?.treesEquivalent),
      valueColor: 'text.primary',
      info: t('summary.insightTreesFootnote'),
    },
  ];

  return (
    <Box
      sx={{
        display: 'grid',
        gap: { xs: 2, sm: 2.5 },
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
      }}
    >
      {cards.map((card) => (
        <InsightCard
          key={card.key}
          card={card}
          loading={loading}
          selectionLabel={selectionLabel}
          t={t}
        />
      ))}
    </Box>
  );
}

function InsightFootnote({ body, ariaLabel }) {
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
          ml: 0.25,
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

function InsightCard({ card, loading, selectionLabel, t }) {
  return (
    <Paper sx={{ p: { xs: 2, sm: 2.5 }, height: '100%' }}>
      <Stack spacing={1.25}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Tooltip title={card.title}>
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: 1.5,
                display: 'grid',
                placeItems: 'center',
                bgcolor: card.accent ? `${card.accent}22` : 'action.hover',
                color: card.accent || 'text.primary',
                flexShrink: 0,
              }}
            >
              {card.icon}
            </Box>
          </Tooltip>
          <Box sx={{ flex: 1 }} />
          {card.info ? (
            <InsightFootnote body={card.info} ariaLabel={t('summary.insightMethodAria')} />
          ) : (
            <Box sx={{ width: 34, height: 34, flexShrink: 0 }} />
          )}
        </Stack>

        {loading ? (
          <Stack direction="row" alignItems="center" spacing={1} sx={{ pt: 0.25 }}>
            <Skeleton variant="circular" width={22} height={22} />
            <Skeleton variant="text" sx={{ flex: 1 }} height={36} />
          </Stack>
        ) : (
          <Stack direction="row" alignItems="baseline" spacing={1} sx={{ minWidth: 0, pt: 0.25 }}>
            <Tooltip title={selectionLabel}>
              <IconButton
                size="small"
                aria-label={selectionLabel}
                sx={{ p: 0.35, color: 'text.disabled', flexShrink: 0, mt: -0.25 }}
              >
                <DateRangeOutlinedIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </Tooltip>
            <Typography
              variant="h5"
              className="num"
              sx={{
                fontWeight: 700,
                lineHeight: 1.15,
                fontFeatureSettings: '"tnum"',
                color: card.valueColor,
                wordBreak: 'break-word',
                flex: 1,
                minWidth: 0,
              }}
            >
              {card.value}
            </Typography>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
