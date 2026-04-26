import { useState } from 'react';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import PaidOutlinedIcon from '@mui/icons-material/PaidOutlined';
import ParkOutlinedIcon from '@mui/icons-material/ParkOutlined';
import SavingsOutlinedIcon from '@mui/icons-material/SavingsOutlined';
import EnergySavingsLeafOutlinedIcon from '@mui/icons-material/EnergySavingsLeafOutlined';
import {
  Box,
  Divider,
  IconButton,
  Paper,
  Popover,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { formatCurrency, formatNumber } from '../format.js';

/**
 * @param {{
 *   metricsSelection: import('../api/summaryMetrics.js').SummaryMetricsSlice | null,
 *   metricsLife: import('../api/summaryMetrics.js').SummaryMetricsSlice | null,
 *   selectionLabel: string,
 *   currency: string,
 *   loading?: boolean,
 * }} props
 */
export function SummaryInsightBoxes({
  metricsSelection,
  metricsLife,
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
      today: fmtMoney(metricsSelection?.footerCost),
      total: fmtMoney(metricsLife?.footerCost),
      valueColor: 'text.primary',
      info: null,
    },
    {
      key: 'savings',
      title: t('summary.insightTotalSavings'),
      icon: <SavingsOutlinedIcon sx={{ fontSize: 22 }} />,
      accent: c.solar ?? theme.palette.success.main,
      today: fmtMoney(metricsSelection?.footerSavings),
      total: fmtMoney(metricsLife?.footerSavings),
      valueColor: 'success.main',
      info: null,
    },
    {
      key: 'co2',
      title: t('summary.insightCo2Saved'),
      icon: <EnergySavingsLeafOutlinedIcon sx={{ fontSize: 22 }} />,
      accent: c.co2Neutral ?? theme.palette.success.light,
      today: fmtKg(metricsSelection?.co2AvoidedKg),
      total: fmtKg(metricsLife?.co2AvoidedKg),
      valueColor: 'text.primary',
      info: t('summary.insightCo2Footnote'),
    },
    {
      key: 'trees',
      title: t('summary.insightTrees'),
      icon: <ParkOutlinedIcon sx={{ fontSize: 22 }} />,
      accent: c.home ?? theme.palette.secondary.main,
      today: fmtTrees(metricsSelection?.treesEquivalent),
      total: fmtTrees(metricsLife?.treesEquivalent),
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
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1.25} alignItems="flex-start">
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
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
              <Typography
                variant="subtitle2"
                color="text.secondary"
                sx={{ fontWeight: 500, lineHeight: 1.3, flex: 1, minWidth: 0 }}
              >
                {card.title}
              </Typography>
              <Box
                sx={{
                  width: 34,
                  height: 34,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {card.info ? (
                  <InsightFootnote body={card.info} ariaLabel={t('summary.insightMethodAria')} />
                ) : null}
              </Box>
            </Stack>
          </Box>
        </Stack>

        {loading ? (
          <Stack spacing={1.5} sx={{ pt: 0.25 }}>
            <Box>
              <Skeleton variant="text" width="32%" height={14} sx={{ mb: 0.5 }} />
              <Skeleton variant="text" width="75%" height={36} />
            </Box>
            <Divider sx={{ borderColor: 'divider' }} />
            <Box>
              <Skeleton variant="text" width="40%" height={14} sx={{ mb: 0.5 }} />
              <Skeleton variant="text" width="75%" height={36} />
            </Box>
          </Stack>
        ) : (
          <Stack spacing={1.5} sx={{ pt: 0.25 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
                {selectionLabel}
              </Typography>
              <Typography
                variant="h5"
                className="num"
                sx={{
                  fontWeight: 700,
                  lineHeight: 1.15,
                  fontFeatureSettings: '"tnum"',
                  color: card.valueColor,
                  wordBreak: 'break-word',
                }}
              >
                {card.today}
              </Typography>
            </Box>
            <Divider sx={{ borderColor: 'divider' }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
                {t('summary.insightAllData')}
              </Typography>
              <Typography
                variant="h5"
                className="num"
                sx={{
                  fontWeight: 700,
                  lineHeight: 1.15,
                  fontFeatureSettings: '"tnum"',
                  color: card.valueColor,
                  wordBreak: 'break-word',
                }}
              >
                {card.total}
              </Typography>
            </Box>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
