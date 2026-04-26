import { useMemo } from 'react';
import DateRangeOutlinedIcon from '@mui/icons-material/DateRangeOutlined';
import { Alert, Box, Skeleton, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { useInstance } from '../layout/InstanceContext.jsx';
import { useEnergyBundle, useLatestStates, useLatestStatistics } from '../api/hooks.js';
import {
  cumulativeFlowStatIdsForCoverage,
  gasSpendFromEnergyPrefs,
  maxStatisticCoverageLagMs,
  meanPriceByStatIdFromResults,
  mergeLatestStateUnitPrices,
  mergeMeanPriceMaps,
  mergeMeanPricesFromLatestStatistics,
  splitEnergyDashboardTotals,
  weightedFossilPercentForGrid,
  weightedGridImportPrice,
} from '../api/energyModel.js';
import { computeSummaryMetrics, totalsByStatFromResults } from '../api/summaryMetrics.js';
import { PartialHistoryHint } from '../components/PartialHistoryHint.jsx';
import {
  RangePicker,
  RANGES,
  StickyDateToolbar,
  customDayYmd,
  isCustomDayRangeValue,
  isSpanRangeValue,
  localDayBoundsFromYmd,
  parseSpanRangeValue,
  resolveRange,
} from '../components/RangePicker.jsx';
import { SummaryHeroWidgets } from '../components/SummaryHeroWidgets.jsx';
import { SummaryInsightBoxes } from '../components/SummaryInsightBoxes.jsx';
import { SummaryLivePowerBar } from '../components/SummaryLivePowerBar.jsx';
import { SourcesTable } from '../components/SourcesTable.jsx';
import { EnergyFlowDiagram } from '../components/EnergyFlowDiagram.jsx';
import {
  liveFlowSplitWatts,
  parseBatteryAvailableSensor,
  parseEnergyStateToKwh,
} from '../api/powerTimeline.js';
import { useUrlSyncedRange } from '../hooks/useUrlSyncedRange.js';

export function Summary() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const { selected } = useInstance();
  const [range, setRange] = useUrlSyncedRange();

  const { start, end } = useMemo(() => resolveRange(range), [range]);
  const { prefs, model, stats } = useEnergyBundle(selected, start, end);

  const lifeStart = '2000-01-01T00:00:00.000Z';
  const lifeEnd = resolveRange('today').end;
  const bundleLife = useEnergyBundle(selected, lifeStart, lifeEnd);

  const statsCoverageLagMs = useMemo(
    () =>
      maxStatisticCoverageLagMs(
        start,
        stats.results,
        cumulativeFlowStatIdsForCoverage(model),
      ),
    [start, stats.results, model],
  );
  const latestStates = useLatestStates(selected, { pollMs: 15_000 });
  const latestHourStats = useLatestStatistics(selected, { pollMs: 30_000 });

  const totalsByStat = useMemo(
    () => totalsByStatFromResults(stats.results),
    [stats.results],
  );

  const meanPriceByStat = useMemo(() => {
    let m = meanPriceByStatIdFromResults(stats.results);
    m = mergeMeanPricesFromLatestStatistics(m, model, latestHourStats.data ?? []);
    m = mergeLatestStateUnitPrices(m, model, latestStates.data?.byEntity);
    return m;
  }, [stats.results, model, latestStates.data?.byEntity, latestHourStats.data]);

  const meanPriceLife = useMemo(() => {
    let m = meanPriceByStatIdFromResults(bundleLife.stats.results);
    m = mergeMeanPricesFromLatestStatistics(m, model, latestHourStats.data ?? []);
    m = mergeLatestStateUnitPrices(m, model, latestStates.data?.byEntity);
    return m;
  }, [bundleLife.stats.results, model, latestStates.data?.byEntity, latestHourStats.data]);

  /** Tariff sensors often lack hourly stats in a narrow window; fall back to lifetime means. */
  const meanPriceByStatEff = useMemo(
    () => mergeMeanPriceMaps(meanPriceByStat, meanPriceLife),
    [meanPriceByStat, meanPriceLife],
  );

  const metricsSelection = useMemo(
    () =>
      computeSummaryMetrics(
        model,
        totalsByStat,
        meanPriceByStatEff,
        stats.results,
      ),
    [model, totalsByStat, meanPriceByStatEff, stats.results],
  );

  const selectionInsightLabel = useMemo(() => {
    if (range === 'today') return t('summary.insightToday');
    if (range === 'yesterday') return t('summary.insightYesterday');
    if (range === 'last7') return t('summary.insightLast7');
    if (range === 'last30') return t('summary.insightLast30');
    if (isSpanRangeValue(range)) {
      const p = parseSpanRangeValue(range);
      if (p) {
        const fmt = (ymd) => {
          const b = localDayBoundsFromYmd(ymd);
          if (!b) return ymd;
          const d = new Date(b.start);
          d.setHours(12, 0, 0, 0);
          return new Intl.DateTimeFormat(i18n.language, {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          }).format(d);
        };
        if (p.from === p.to) return fmt(p.from);
        return `${fmt(p.from)} – ${fmt(p.to)}`;
      }
    }
    if (isCustomDayRangeValue(range)) {
      const ymd = customDayYmd(range);
      const b = localDayBoundsFromYmd(ymd);
      if (b) {
        const d = new Date(b.start);
        d.setHours(12, 0, 0, 0);
        return new Intl.DateTimeFormat(i18n.language, {
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }).format(d);
      }
    }
    return t('summary.insightSelectedRange');
  }, [range, t, i18n.language]);

  const metricsLife = useMemo(
    () =>
      computeSummaryMetrics(
        model,
        totalsByStatFromResults(bundleLife.stats.results),
        meanPriceLife,
        bundleLife.stats.results,
      ),
    [model, bundleLife.stats.results, meanPriceLife],
  );

  const insightsLoading =
    prefs.isLoading ||
    stats.isLoading ||
    bundleLife.stats.isLoading ||
    latestHourStats.isLoading;

  const totalsLifeByStat = useMemo(
    () => totalsByStatFromResults(bundleLife.stats.results),
    [bundleLife.stats.results],
  );
  const solarTotalLife = sumList(model?.solar?.map((s) => totalsLifeByStat.get(s.stat)));

  const heroLoading = prefs.isLoading || bundleLife.stats.isLoading;

  const weightedImportPrice = useMemo(
    () =>
      model?.grid?.length
        ? weightedGridImportPrice(model, totalsByStat, meanPriceByStatEff)
        : null,
    [model, totalsByStat, meanPriceByStatEff],
  );

  const gasSpendInferred = useMemo(
    () =>
      model?.gas?.length
        ? gasSpendFromEnergyPrefs(model, totalsByStat, meanPriceByStatEff)
        : null,
    [model, totalsByStat, meanPriceByStatEff],
  );

  /** Optional HA Exporter integration override (takes precedence over dashboard). */
  const haExporterElecMean = useMemo(() => {
    const id = model?.electricityPriceEntity;
    if (!id) return null;
    return meanPriceByStatEff.get(id) ?? null;
  }, [model?.electricityPriceEntity, meanPriceByStatEff]);

  const haExporterGasMean = useMemo(() => {
    const id = model?.gasPriceEntity;
    if (!id) return null;
    return meanPriceByStatEff.get(id) ?? null;
  }, [model?.gasPriceEntity, meanPriceByStatEff]);

  const effectiveElecUnit = haExporterElecMean ?? weightedImportPrice;

  const solarTotal = sumList(model?.solar.map((s) => totalsByStat.get(s.stat)));
  const gridIn = sumList(model?.grid.map((g) => totalsByStat.get(g.from)));
  const gridOut = sumList(model?.grid.map((g) => totalsByStat.get(g.to)));
  const batteryIn = sumList(model?.battery.map((b) => totalsByStat.get(b.to)));
  const batteryOut = sumList(model?.battery.map((b) => totalsByStat.get(b.from)));
  const gasTotal = sumList(model?.gas.map((g) => totalsByStat.get(g.stat)));
  const home = Math.max(
    0,
    (solarTotal || 0) + (gridIn || 0) + (batteryOut || 0) -
      (gridOut || 0) - (batteryIn || 0),
  );

  // CO₂-neutral kWh: solar-to-home + battery discharge are always counted.
  // If the HA user configured Electricity Maps / CO₂ Signal, we add the
  // fossil-free share of grid imports; otherwise we leave grid un-credited
  // (we never guess a grid split without a reading).
  const co2Free = useMemo(() => {
    const { solarToHome } = splitEnergyDashboardTotals(
      solarTotal || 0,
      gridIn || 0,
      gridOut || 0,
      batteryIn || 0,
      batteryOut || 0,
    );
    const baseClean = solarToHome + (batteryOut || 0);
    const entity = model?.co2SignalEntity;
    if (entity) {
      const fossilPct = weightedFossilPercentForGrid(
        model,
        stats.results,
        entity,
      );
      if (fossilPct != null && Number.isFinite(fossilPct)) {
        const cleanFraction = Math.max(0, Math.min(1, 1 - fossilPct / 100));
        const total = baseClean + (gridIn || 0) * cleanFraction;
        return total > 0 ? total : null;
      }
    }
    return baseClean > 0 ? baseClean : null;
  }, [
    model?.co2SignalEntity,
    stats.results,
    solarTotal,
    gridIn,
    gridOut,
    batteryIn,
    batteryOut,
  ]);

  const c = theme.palette.energy || {};

  const liveFlowW = useMemo(
    () => liveFlowSplitWatts(model, latestStates.data?.byEntity),
    [model, latestStates.data?.byEntity],
  );

  const batteryFromAvailableEntity = useMemo(() => {
    const id = model?.batteryAvailableKwhEntity;
    if (!id || !latestStates.data?.byEntity) {
      return { kwh: null, socFraction: null };
    }
    return parseBatteryAvailableSensor(latestStates.data.byEntity.get(id));
  }, [model?.batteryAvailableKwhEntity, latestStates.data?.byEntity]);

  const batteryAvailableKwh = batteryFromAvailableEntity.kwh;
  const batterySocFromAvailableEntity = batteryFromAvailableEntity.socFraction;

  const batteryCapacityKwh = useMemo(() => {
    const id = model?.batteryCapacityKwhEntity;
    if (!id || !latestStates.data?.byEntity) return null;
    const row = latestStates.data.byEntity.get(id);
    if (!row || row.state == null || row.state === '') return null;
    return parseEnergyStateToKwh(
      String(row.state),
      row.attributes?.unit_of_measurement,
    );
  }, [model?.batteryCapacityKwhEntity, latestStates.data?.byEntity]);

  const batteryChargeFraction = useMemo(() => {
    if (batterySocFromAvailableEntity != null) {
      return Math.max(0, Math.min(1, batterySocFromAvailableEntity));
    }
    if (
      batteryAvailableKwh == null ||
      batteryCapacityKwh == null ||
      !Number.isFinite(batteryAvailableKwh) ||
      !Number.isFinite(batteryCapacityKwh) ||
      batteryCapacityKwh <= 0
    ) {
      return null;
    }
    return Math.max(0, Math.min(1, batteryAvailableKwh / batteryCapacityKwh));
  }, [
    batterySocFromAvailableEntity,
    batteryAvailableKwh,
    batteryCapacityKwh,
  ]);

  const gridCostFromHa = useMemo(() => {
    if (!model?.grid?.length) return null;
    let total = 0;
    let any = false;
    for (const g of model.grid) {
      if (!g.from || !g.fromCost) continue;
      const v = totalsByStat.get(g.fromCost);
      if (v != null && Number.isFinite(v)) {
        total += v;
        any = true;
      }
    }
    return any ? total : null;
  }, [model?.grid, totalsByStat]);

  const gasCostFromHa = useMemo(() => {
    if (!model?.gas?.length) return null;
    let total = 0;
    let any = false;
    for (const g of model.gas) {
      if (!g.cost) continue;
      const v = totalsByStat.get(g.cost);
      if (v != null && Number.isFinite(v)) {
        total += v;
        any = true;
      }
    }
    return any ? total : null;
  }, [model?.gas, totalsByStat]);

  const gridCostMoney =
    gridCostFromHa != null
      ? gridCostFromHa
      : effectiveElecUnit != null && gridIn > 0
        ? gridIn * effectiveElecUnit
        : null;

  const gasCostMoney =
    gasCostFromHa != null
      ? gasCostFromHa
      : gasSpendInferred != null
        ? gasSpendInferred
        : haExporterGasMean != null && gasTotal > 0
          ? gasTotal * haExporterGasMean
          : null;

  const pvSavings =
    effectiveElecUnit != null && solarTotal > 0
      ? solarTotal * effectiveElecUnit
      : null;
  const batSavings =
    effectiveElecUnit != null && batteryOut > 0
      ? batteryOut * effectiveElecUnit
      : null;

  const currency =
    model?.currency && /^[A-Z]{3}$/.test(model.currency)
      ? model.currency
      : 'EUR';

  const sourceRows = [];
  if (model?.solar.length) {
    sourceRows.push({
      label: t('summary.solarTotal'),
      value: solarTotal,
      accent: c.solar,
      cost: pvSavings,
      costKind: 'savings',
    });
  }
  if (model?.battery.length) {
    sourceRows.push({
      label: t('summary.batteryTotal'),
      value: batteryOut,
      accent: c.battery,
      cost: batSavings,
      costKind: 'savings',
    });
  }
  if (model?.grid.length) {
    sourceRows.push({
      label: t('summary.gridTotal'),
      value: gridIn,
      accent: c.grid,
      cost: gridCostMoney,
      costKind: 'spend',
    });
    if (gridOut) {
      sourceRows.push({
        label: t('summary.returned'),
        value: gridOut,
        accent: c.grid,
        cost: null,
        costKind: 'spend',
      });
    }
  }
  if (model?.gas.length) {
    sourceRows.push({
      label: t('summary.gasTotal'),
      value: gasTotal,
      accent: c.gas,
      unit: t('units.m3'),
      cost: gasCostMoney,
      costKind: 'spend',
    });
  }

  if (prefs.error && prefs.error.status === 404) {
    return (
      <Alert severity="info" sx={{ mt: 2 }}>
        {t('summary.noData')}
      </Alert>
    );
  }

  const loading = prefs.isLoading || stats.isLoading;

  return (
    <Stack spacing={{ xs: 2, sm: 2.5 }}>
      <StickyDateToolbar>
        <RangePicker
          value={range}
          onChange={setRange}
          ranges={RANGES}
          hint={!loading ? <PartialHistoryHint lagMs={statsCoverageLagMs} /> : null}
        />
      </StickyDateToolbar>

      <Box
        sx={{
          display: 'grid',
          gap: { xs: 2, sm: 2.5 },
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 2fr) minmax(0, 1fr)' },
        }}
      >
        <Box
          sx={{
            minWidth: 0,
            order: { xs: 1, md: 0 },
            display: 'flex',
            flexDirection: 'column',
            height: { md: '100%' },
            alignSelf: { md: 'stretch' },
          }}
        >
          <SummaryLivePowerBar
            liveFlowW={liveFlowW}
            loading={latestStates.isLoading && !latestStates.data}
          />
        </Box>
        <Box sx={{ minWidth: 0, order: { xs: 2, md: 0 } }}>
          <SummaryHeroWidgets
            solarTotalLifeKwh={solarTotalLife}
            metricsLife={metricsLife}
            currency={currency}
            loading={heroLoading}
          />
        </Box>
        <Box sx={{ minWidth: 0, order: { xs: 3, md: 0 } }}>
          {loading && !prefs.data ? (
            <Skeleton variant="rounded" height={360} />
          ) : (
            <EnergyFlowDiagram
              values={{
                solar: solarTotal,
                gridIn,
                gridOut,
                batteryIn,
                batteryOut,
                home,
                gas: gasTotal,
                co2Free,
              }}
              liveFlowW={liveFlowW}
              batteryChargeFraction={batteryChargeFraction}
            />
          )}
        </Box>
        <Stack
          spacing={1.25}
          sx={{ minWidth: 0, order: { xs: 4, md: 0 } }}
        >
          <Box>
            <Stack
              direction="row"
              alignItems="flex-start"
              spacing={1.5}
              useFlexGap
              sx={{ mb: 1.25, minWidth: 0 }}
            >
              <DateRangeOutlinedIcon
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
                  {t('summary.sectionRangeTitle')}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4, display: 'block' }}>
                  {selectionInsightLabel}
                </Typography>
              </Box>
            </Stack>
            <SummaryInsightBoxes
              metricsSelection={metricsSelection}
              currency={currency}
              loading={insightsLoading}
            />
          </Box>
          <SourcesTable rows={sourceRows} currency={currency} compact />
        </Stack>
      </Box>
    </Stack>
  );
}

function sumList(list) {
  if (!list) return 0;
  let total = 0;
  for (const n of list) if (n != null && Number.isFinite(n)) total += n;
  return total;
}
