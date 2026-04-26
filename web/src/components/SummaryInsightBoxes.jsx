import PaidOutlinedIcon from '@mui/icons-material/PaidOutlined';
import ParkOutlinedIcon from '@mui/icons-material/ParkOutlined';
import SavingsOutlinedIcon from '@mui/icons-material/SavingsOutlined';
import EnergySavingsLeafOutlinedIcon from '@mui/icons-material/EnergySavingsLeafOutlined';
import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { formatCurrency, formatNumber } from '../format.js';
import { HeroStat } from './SummaryHeroWidgets.jsx';

/**
 * Same {@link HeroStat} presentation as the all-time row: number in the value
 * line, long descriptive tagline (units / € in the caption, not inline).
 */
export function SummaryInsightBoxes({ metricsSelection, currency, loading }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const lng = i18n.language;
  const c = theme.palette.energy ?? {};

  const fmtMoney = (v) =>
    v != null && Number.isFinite(v) ? formatCurrency(v, lng, currency) : '—';
  const fmtMoneyValue = (v) =>
    v != null && Number.isFinite(v)
      ? formatNumber(v, lng, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '—';
  const fmtKg = (v) =>
    v != null && Number.isFinite(v)
      ? `${formatNumber(v, lng, { maximumFractionDigits: 2 })} ${t('units.kgCo2')}`
      : '—';
  const fmtKgValue = (v) =>
    v != null && Number.isFinite(v)
      ? formatNumber(v, lng, { maximumFractionDigits: 2 })
      : '—';
  const fmtTrees = (v) =>
    v != null && Number.isFinite(v)
      ? `${formatNumber(v, lng, { maximumFractionDigits: 1 })} ${t('units.treeYears')}`
      : '—';
  const fmtTreesCount = (v) =>
    v != null && Number.isFinite(v) ? formatNumber(v, lng, { maximumFractionDigits: 1 }) : '—';

  const scopeRange = t('summary.sectionRangeTitle');
  const tip = (longLabel) => `${longLabel} · ${scopeRange}`;

  return (
    <Box
      sx={{
        display: 'grid',
        gap: { xs: 1, sm: 1.15, md: 1.25 },
        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(2, minmax(0, 1fr))' },
      }}
    >
      <HeroStat
        tagline={t('summary.insightTotalCost')}
        tooltip={tip(t('summary.insightTotalCost'))}
        icon={<PaidOutlinedIcon sx={{ fontSize: 20 }} />}
        compact
        loading={loading}
        value={fmtMoneyValue(metricsSelection?.footerCost)}
        valueAriaLabel={fmtMoney(metricsSelection?.footerCost)}
        accent={c.grid ?? theme.palette.primary.main}
      />
      <HeroStat
        tagline={t('summary.heroStatSavingsTagline')}
        tooltip={tip(t('summary.insightTotalSavings'))}
        icon={<SavingsOutlinedIcon sx={{ fontSize: 20 }} />}
        compact
        loading={loading}
        value={fmtMoneyValue(metricsSelection?.footerSavings)}
        valueAriaLabel={fmtMoney(metricsSelection?.footerSavings)}
        accent={c.solar ?? theme.palette.success.main}
        valueColor="success.main"
      />
      <HeroStat
        tagline={t('summary.heroStatCo2Tagline')}
        tooltip={tip(t('summary.insightCo2Saved'))}
        icon={<EnergySavingsLeafOutlinedIcon sx={{ fontSize: 20 }} />}
        compact
        loading={loading}
        value={fmtKgValue(metricsSelection?.co2AvoidedKg)}
        valueAriaLabel={
          metricsSelection?.co2AvoidedKg != null && Number.isFinite(metricsSelection.co2AvoidedKg)
            ? fmtKg(metricsSelection.co2AvoidedKg)
            : undefined
        }
        accent={c.co2Neutral ?? theme.palette.success.light}
      />
      <HeroStat
        tagline={t('summary.heroStatTreesTagline')}
        tooltip={tip(t('summary.insightTrees'))}
        icon={<ParkOutlinedIcon sx={{ fontSize: 20 }} />}
        compact
        loading={loading}
        value={fmtTreesCount(metricsSelection?.treesEquivalent)}
        valueAriaLabel={fmtTrees(metricsSelection?.treesEquivalent)}
        accent={c.home ?? theme.palette.secondary.main}
      />
    </Box>
  );
}
