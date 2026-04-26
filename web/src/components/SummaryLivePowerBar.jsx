import BoltOutlined from '@mui/icons-material/BoltOutlined';
import DateRangeOutlined from '@mui/icons-material/DateRangeOutlined';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import {
  Box,
  Paper,
  Skeleton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatWatts, formatWh } from '../format.js';

const SEGMENT_LABEL_MIN_PX = 50;
const BAR_H = 44;
const MARKER_W = 4;
/** Small radius so the home seam and narrow export slivers stay visible; large radii + overflow hidden can hide the line. */
const BAR_OUTER_RADIUS_PX = 4;
/** Reserves width on the right of the bar row so the home value can extend without being clipped. */
const CHART_END_RESERVE = 2.5;
const UNIT_STORAGE = 'dahoamboard:summaryPowerBar:unit';

function readStoredUnit() {
  try {
    const v = localStorage.getItem(UNIT_STORAGE);
    if (v === 'w' || v === 'wh') return v;
  } catch {
    // ignore
  }
  return 'w';
}

function kwhToWh(n) {
  if (n == null || !Number.isFinite(n)) return 0;
  return n * 1000;
}

function gridColTemplate(g, b, s, s2b, s2g) {
  return [g, b, s, s2b, s2g]
    .map(
      (w) =>
        `minmax(0, ${String(Number.isFinite(w) && w > 0 ? w : 0.0001)}fr)`,
    )
    .join(' ');
}

/**
 * Live or range-split bar: grid / battery / solar to home, seam, solar to battery & grid.
 *
 * @param {object} props
 * @param {null|{solarToGrid: number, solarToBattery: number, solarToHome: number, gridToHome: number, batteryToHome: number}} props.liveFlowW
 * @param {{solarToGrid: number, solarToBattery: number, solarToHome: number, gridToHome: number, batteryToHome: number, ...}} props.rangeFlowKwh — kWh totals from the same split as the Sankey, for the selected range
 * @param {boolean} props.liveLoading
 * @param {boolean} props.rangeLoading
 */
export function SummaryLivePowerBar({
  liveFlowW,
  rangeFlowKwh,
  liveLoading,
  rangeLoading,
}) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const lng = i18n.language;
  const c = theme.palette.energy ?? {};

  const [unit, setUnit] = useState(() => readStoredUnit());

  const useWh = unit === 'wh';
  const dataLoading = useWh ? rangeLoading : liveLoading;

  const { g, b, s, s2b, s2g, homeTotal, total } = useMemo(() => {
    if (useWh && rangeFlowKwh) {
      const w = (v) => Math.max(0, kwhToWh(v));
      const gg = w(rangeFlowKwh.gridToHome);
      const bb = w(rangeFlowKwh.batteryToHome);
      const ss = w(rangeFlowKwh.solarToHome);
      const t2b = w(rangeFlowKwh.solarToBattery);
      const t2g = w(rangeFlowKwh.solarToGrid);
      const h = gg + bb + ss;
      const t0 = h + t2b + t2g;
      return { g: gg, b: bb, s: ss, s2b: t2b, s2g: t2g, homeTotal: h, total: t0 };
    }
    if (!useWh && liveFlowW) {
      const gg = Math.max(0, liveFlowW.gridToHome);
      const bb = Math.max(0, liveFlowW.batteryToHome);
      const ss = Math.max(0, liveFlowW.solarToHome);
      const t2b = Math.max(0, liveFlowW.solarToBattery);
      const t2g = Math.max(0, liveFlowW.solarToGrid);
      const h = gg + bb + ss;
      const t0 = h + t2b + t2g;
      return { g: gg, b: bb, s: ss, s2b: t2b, s2g: t2g, homeTotal: h, total: t0 };
    }
    return { g: 0, b: 0, s: 0, s2b: 0, s2g: 0, homeTotal: 0, total: 0 };
  }, [useWh, rangeFlowKwh, liveFlowW]);

  /** X-position of the home seam as % of bar width (must match `gridColTemplate` fr math, not only (g+b+s)/total). */
  const homeSeamLeftPct = useMemo(() => {
    const frW = (w) => (Number.isFinite(w) && w > 0 ? w : 0.0001);
    const a = frW(g);
    const b0 = frW(b);
    const s0 = frW(s);
    const t2b0 = frW(s2b);
    const t2g0 = frW(s2g);
    const all = a + b0 + s0 + t2b0 + t2g0;
    if (all <= 0) return 0;
    return (100 * (a + b0 + s0)) / all;
  }, [g, b, s, s2b, s2g]);

  const segs = [
    { key: 'g', w: g, color: c.grid ?? '#4f8cb9', label: t('summary.livePowerBarSegGrid') },
    { key: 'b', w: b, color: c.battery ?? '#8e4fb9', label: t('summary.livePowerBarSegBattery') },
    { key: 's', w: s, color: c.solar ?? '#f2a825', label: t('summary.livePowerBarSegSolar') },
    { key: 's2b', w: s2b, color: c.battery ?? '#8e4fb9', label: t('summary.livePowerBarSegToBattery') },
    { key: 's2g', w: s2g, color: c.grid ?? '#4f8cb9', label: t('summary.livePowerBarSegToGrid') },
  ];

  const colTemplate = gridColTemplate(g, b, s, s2b, s2g);

  const barRowRef = useRef(null);
  const [barPx, setBarPx] = useState(0);
  useLayoutEffect(() => {
    const el = barRowRef.current;
    if (!el) return undefined;
    const read = () => setBarPx(el.getBoundingClientRect().width);
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [total, useWh, liveFlowW, colTemplate, rangeFlowKwh, dataLoading]);

  const persistUnit = (v) => {
    setUnit(v);
    try {
      localStorage.setItem(UNIT_STORAGE, v);
    } catch {
      // ignore
    }
  };

  return (
    <Paper
      sx={{
        p: 1.5,
        minWidth: 0,
        width: '100%',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        boxSizing: 'border-box',
        maxWidth: '100%',
      }}
    >
      <Box sx={{ mb: 1.25, minWidth: 0 }}>
        <Stack
          direction="row"
          alignItems="center"
          spacing={1.5}
          useFlexGap
          sx={{ minWidth: 0, width: '100%' }}
        >
          <ToggleButtonGroup
            value={unit}
            exclusive
            onChange={(_, v) => v != null && persistUnit(v)}
            size="small"
            aria-label={t('summary.livePowerBarToggleGroupAria')}
            sx={{
              flexShrink: 0,
              alignSelf: 'center',
              '& .MuiToggleButton-root': {
                py: 0.5,
                minWidth: 0,
                minHeight: 32,
                boxSizing: 'border-box',
              },
            }}
          >
            <ToggleButton
              value="w"
              title={t('summary.livePowerBarToggleWTooltip')}
              aria-label={`${t('summary.livePowerBarToggleW')}, ${t('summary.livePowerBarToggleWTooltip')}`}
              sx={{ px: 0.9 }}
            >
              <Stack direction="row" alignItems="center" spacing={0.35} useFlexGap>
                <BoltOutlined sx={{ fontSize: 18, opacity: 0.95 }} aria-hidden />
                <Typography
                  component="span"
                  variant="caption"
                  className="num"
                  fontWeight={800}
                  lineHeight={1}
                  letterSpacing={0.01}
                  sx={{ fontSize: 12, pt: 0.1 }}
                >
                  {t('summary.livePowerBarToggleW')}
                </Typography>
              </Stack>
            </ToggleButton>
            <ToggleButton
              value="wh"
              title={t('summary.livePowerBarToggleWhTooltip')}
              aria-label={`${t('summary.livePowerBarToggleWh')}, ${t('summary.livePowerBarToggleWhTooltip')}`}
              sx={{ px: 0.75 }}
            >
              <Stack direction="row" alignItems="center" spacing={0.3} useFlexGap>
                <DateRangeOutlined sx={{ fontSize: 18, opacity: 0.95 }} aria-hidden />
                <Typography
                  component="span"
                  variant="caption"
                  className="num"
                  fontWeight={800}
                  lineHeight={1}
                  letterSpacing={0.01}
                  sx={{ fontSize: 12, pt: 0.1 }}
                >
                  {t('summary.livePowerBarToggleWh')}
                </Typography>
              </Stack>
            </ToggleButton>
          </ToggleButtonGroup>
          <Typography
            variant="overline"
            color="text.secondary"
            component="h2"
            sx={{
              fontWeight: 700,
              /* overline default is all-caps; we want the same case as the translation. */
              textTransform: 'none',
              letterSpacing: 0.08,
              lineHeight: 1.2,
              m: 0,
              minWidth: 0,
              flex: 1,
              minHeight: 32,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {t(useWh ? 'summary.livePowerBarTitleWh' : 'summary.livePowerBarTitleW')}
          </Typography>
        </Stack>
      </Box>

      {dataLoading ? (
        <Skeleton
          variant="rounded"
          width="100%"
          height={BAR_H}
          sx={{ borderRadius: `${String(BAR_OUTER_RADIUS_PX)}px` }}
        />
      ) : !useWh && !liveFlowW ? (
        <Box
          sx={{
            minHeight: BAR_H,
            borderRadius: `${String(BAR_OUTER_RADIUS_PX)}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 1,
            borderColor: 'divider',
            bgcolor: 'action.hover',
            px: 1.5,
            boxSizing: 'border-box',
            minWidth: 0,
            maxWidth: '100%',
          }}
        >
          <Typography variant="caption" color="text.secondary" textAlign="center" sx={{ lineHeight: 1.4 }}>
            {t('summary.livePowerBarNoSensors')}
          </Typography>
        </Box>
      ) : total <= 0 ? (
        <Box
          sx={{
            height: BAR_H,
            borderRadius: `${String(BAR_OUTER_RADIUS_PX)}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 1,
            borderColor: 'divider',
            bgcolor: 'action.hover',
            boxSizing: 'border-box',
            minWidth: 0,
            maxWidth: '100%',
          }}
        >
          <Typography variant="caption" className="num" color="text.secondary">
            {useWh
              ? `${formatWh(0, lng)} ${t('units.wh')}`
              : `0 ${t('units.w')}`}
          </Typography>
        </Box>
      ) : (
        <Box
          role="group"
          aria-label={
            useWh
              ? t('summary.livePowerBarAriaWh', {
                  e: `${formatWh(homeTotal, lng)} ${t('units.wh')}`,
                })
              : t('summary.livePowerBarAria', {
                  w: `${formatWatts(homeTotal, lng)} ${t('units.w')}`,
                })
          }
          sx={{
            display: 'grid',
            gridTemplateColumns: colTemplate,
            gridTemplateRows: 'minmax(0, auto) minmax(0, auto)',
            width: '100%',
            minWidth: 0,
            maxWidth: '100%',
            minHeight: BAR_H + 48,
            columnGap: 0,
            rowGap: 0,
            alignContent: 'start',
            /* Extra space for long W/Wh (not clipping); row-1 bar still has its own overflow for corners. */
            pl: 0,
            pr: CHART_END_RESERVE,
            boxSizing: 'border-box',
            overflow: 'visible',
          }}
        >
          <Box
            ref={barRowRef}
            sx={(tt) => ({
              gridRow: 1,
              gridColumn: '1 / -1',
              position: 'relative',
              display: 'grid',
              gridTemplateColumns: colTemplate,
              minHeight: BAR_H,
              borderRadius: `${String(BAR_OUTER_RADIUS_PX)}px`,
              overflow: 'hidden',
              boxShadow: `inset 0 0 0 1px ${tt.palette.divider}`,
            })}
          >
            {segs.map((seg) => (
              <Box key={seg.key} sx={{ minWidth: 0, minHeight: 0, position: 'relative' }}>
                <BarSegment
                  seg={seg}
                  flowTotal={total}
                  barWpx={barPx}
                  lng={lng}
                  t={t}
                  barH={BAR_H}
                  useWh={useWh}
                />
              </Box>
            ))}
            {/*
              Seams must not rely on the s2b cell’s border: when s2b/s2g are tiny, that grid track
              is subpixel wide and the line disappears. Draw the home/export divider as an overlay
              at the same % as the home readout (homeSeamLeftPct) and the fr grid.
            */}
            {total > 0 && (
              <Box
                aria-hidden
                sx={(tt) => {
                  const light = tt.palette.mode === 'light';
                  const fill = light ? 'rgba(24, 28, 36, 0.52)' : 'rgba(255, 255, 255, 0.92)';
                  return {
                    position: 'absolute',
                    left: `${String(homeSeamLeftPct)}%`,
                    top: 0,
                    height: '100%',
                    width: `${String(MARKER_W)}px`,
                    transform: 'translateX(-50%)',
                    bgcolor: fill,
                    zIndex: 3,
                    pointerEvents: 'none',
                    boxShadow: light
                      ? '0 0 0 0.5px rgba(0,0,0,0.2)'
                      : '0 0 0 0.5px rgba(0,0,0,0.25), 0 0 3px rgba(0,0,0,0.2)',
                    borderRadius: 0.5,
                  };
                }}
              />
            )}
          </Box>

          {/*
            Do not place the home readout in grid column 4: when s2b/s2g are 0 that track is
            ~0.0001fr wide and the label breaks one character per line. Position on full-width
            row using the same fr weights as gridColTemplate.
          */}
          <Box
            sx={{
              gridRow: 2,
              gridColumn: '1 / -1',
              position: 'relative',
              minHeight: 40,
              width: '100%',
              minWidth: 0,
              mt: 0.5,
            }}
          >
            <Stack
              role="group"
              aria-label={
                useWh
                  ? t('summary.livePowerBarHomeEnergyWhAria', {
                      e: `${formatWh(homeTotal, lng)} ${t('units.wh')}`,
                    })
                  : t('summary.livePowerBarHomePowerAria', {
                      w: `${formatWatts(homeTotal, lng)} ${t('units.w')}`,
                    })
              }
              spacing={0.25}
              sx={{
                position: 'absolute',
                left: `${String(homeSeamLeftPct)}%`,
                top: 0,
                flexDirection: 'column',
                alignItems: 'center',
                maxWidth: 'min(200px, calc(100% - 16px))',
                width: 'max-content',
                transform: `translateX(calc(-50% + ${String(MARKER_W / 2)}px))`,
              }}
            >
              <HomeOutlinedIcon
                sx={{ fontSize: 18, color: 'text.secondary', display: 'block', flexShrink: 0 }}
                aria-hidden
              />
              <Typography
                variant="body2"
                className="num"
                color="text.primary"
                fontWeight={800}
                textAlign="center"
                component="p"
                sx={{
                  m: 0,
                  lineHeight: 1.2,
                  whiteSpace: 'nowrap',
                  maxWidth: '100%',
                }}
              >
                {useWh
                  ? `${formatWh(homeTotal, lng)} ${t('units.wh')}`
                  : `${formatWatts(homeTotal, lng)} ${t('units.w')}`}
              </Typography>
            </Stack>
          </Box>
        </Box>
      )}
    </Paper>
  );
}

/**
 * @param {{
 *   seg: { key: string, w: number, color: string, label: string },
 *   flowTotal: number,
 *   barWpx: number,
 *   lng: string,
 *   t: import('i18next').TFunction,
 *   barH: number,
 *   useWh: boolean,
 * }} p
 */
function BarSegment({ seg, flowTotal, barWpx, lng, t, barH, useWh }) {
  const { w, color, label, key: segKey } = seg;
  const u = t(useWh ? 'units.wh' : 'units.w');
  const fmtV = (v) => (useWh ? formatWh(v, lng) : formatWatts(v, lng));
  const tip = `${label}: ${fmtV(w)} ${u}`;
  const segPx = flowTotal > 0 && barWpx > 0 ? (barWpx * w) / flowTotal : 0;
  const inBar = w > 0 && segPx >= SEGMENT_LABEL_MIN_PX;

  const block = (
    <Box
      className="bar-seg"
      data-segment={segKey}
      sx={{
        width: '100%',
        minWidth: 0,
        minHeight: barH,
        height: '100%',
        bgcolor: w > 0 ? color : 'transparent',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxSizing: 'border-box',
        py: 0.5,
        px: 0.25,
        pointerEvents: w > 0 ? 'auto' : 'none',
        position: 'relative',
        zIndex: 0,
        overflow: 'hidden',
      }}
      role="img"
      aria-label={w > 0 ? tip : undefined}
    >
      {w > 0 && inBar ? (
        <>
          <Typography
            component="span"
            variant="caption"
            noWrap
            className="num"
            fontWeight={700}
            textAlign="center"
            sx={{
              lineHeight: 1.1,
              fontSize: '0.65rem',
              color: 'rgba(255,255,255,0.9)',
              textTransform: 'uppercase',
              letterSpacing: 0.03,
              textShadow: '0 1px 2px rgba(0,0,0,0.4)',
              maxWidth: '100%',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {label}
          </Typography>
          <Typography
            variant="body2"
            className="num"
            noWrap
            textAlign="center"
            fontWeight={700}
            sx={{
              color: 'rgba(255,255,255,0.98)',
              textShadow: '0 1px 3px rgba(0,0,0,0.5)',
              fontSize: { xs: '0.65rem', sm: '0.75rem' },
              lineHeight: 1.1,
              maxWidth: '100%',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {fmtV(w)} {u}
          </Typography>
        </>
      ) : null}
    </Box>
  );

  if (w <= 0) {
    return (
      <Box
        aria-hidden
        sx={{
          width: '100%',
          minWidth: 0,
          minHeight: barH,
          height: '100%',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      />
    );
  }
  if (inBar) {
    return block;
  }
  return <Tooltip title={tip} enterTouchDelay={0}>{block}</Tooltip>;
}
