import ElectricBoltOutlined from '@mui/icons-material/ElectricBoltOutlined';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import { Box, Paper, Skeleton, Stack, Tooltip, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatWatts } from '../format.js';

const SEGMENT_LABEL_MIN_PX = 50;
const BAR_H = 44;
const MARKER_W = 4;

function gridColTemplate(g, b, s, s2b, s2g) {
  return [g, b, s, s2b, s2g]
    .map(
      (w) =>
        `minmax(0, ${String(Number.isFinite(w) && w > 0 ? w : 0.0001)}fr)`,
    )
    .join(' ');
}

/**
 * Live “energy now” bar: grid / battery / solar to home, home seam, solar to battery & grid.
 * Uses one CSS grid so the home readout and seam share the same column track (no % vs px drift).
 *
 * @param {{
 *   liveFlowW: null | {
 *     solarToGrid: number, solarToBattery: number, solarToHome: number,
 *     gridToHome: number, batteryToHome: number,
 *   },
 *   loading: boolean,
 * }} props
 */
export function SummaryLivePowerBar({ liveFlowW, loading }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const lng = i18n.language;
  const c = theme.palette.energy ?? {};

  const g = liveFlowW ? Math.max(0, liveFlowW.gridToHome) : 0;
  const b = liveFlowW ? Math.max(0, liveFlowW.batteryToHome) : 0;
  const s = liveFlowW ? Math.max(0, liveFlowW.solarToHome) : 0;
  const s2b = liveFlowW ? Math.max(0, liveFlowW.solarToBattery) : 0;
  const s2g = liveFlowW ? Math.max(0, liveFlowW.solarToGrid) : 0;
  const homeW = g + b + s;
  const total = g + b + s + s2b + s2g;

  const segs = [
    { key: 'g', w: g, color: c.grid, label: t('summary.livePowerBarSegGrid') },
    { key: 'b', w: b, color: c.battery, label: t('summary.livePowerBarSegBattery') },
    { key: 's', w: s, color: c.solar, label: t('summary.livePowerBarSegSolar') },
    { key: 's2b', w: s2b, color: c.battery, label: t('summary.livePowerBarSegToBattery') },
    { key: 's2g', w: s2g, color: c.grid, label: t('summary.livePowerBarSegToGrid') },
  ];

  const colTemplate = gridColTemplate(g, b, s, s2b, s2g);
  const hasExport = s2b > 0 || s2g > 0;

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
  }, [total, loading, liveFlowW, colTemplate]);

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
      }}
    >
      <Box sx={{ mb: 1.25, minWidth: 0 }}>
        <Stack
          direction="row"
          alignItems="flex-start"
          spacing={1.5}
          useFlexGap
          sx={{ minWidth: 0 }}
        >
          <ElectricBoltOutlined
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
              {t('summary.livePowerBarTitle')}
            </Typography>
          </Box>
        </Stack>
      </Box>

      {loading ? (
        <Skeleton variant="rounded" width="100%" height={BAR_H} />
      ) : !liveFlowW ? (
        <Box
          sx={{
            minHeight: BAR_H,
            borderRadius: 1.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 1,
            borderColor: 'divider',
            bgcolor: 'action.hover',
            px: 1.5,
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
            borderRadius: 1.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 1,
            borderColor: 'divider',
            bgcolor: 'action.hover',
          }}
        >
          <Typography variant="caption" className="num" color="text.secondary">
            0 {t('units.w')}
          </Typography>
        </Box>
      ) : (
        <Box
          role="group"
          aria-label={t('summary.livePowerBarAria', {
            w: `${formatWatts(homeW, lng)} ${t('units.w')}`,
          })}
          sx={{
            display: 'grid',
            gridTemplateColumns: colTemplate,
            gridTemplateRows: 'minmax(0, auto) minmax(0, auto)',
            width: '100%',
            minWidth: 0,
            minHeight: BAR_H + 44,
            columnGap: 0,
            rowGap: 0,
            alignContent: 'start',
          }}
        >
          {/*
            Inner grid, same Nfr columns: row-1 track widths match the outer grid 1:1, so
            the seam (border on solar→home) and the column-4 readout use one coordinate system.
          */}
          <Box
            ref={barRowRef}
            sx={(tt) => ({
              gridRow: 1,
              gridColumn: '1 / -1',
              display: 'grid',
              // Same Nfr as parent: seam + column 4 for home are one coordinate system.
              gridTemplateColumns: colTemplate,
              minHeight: BAR_H,
              borderRadius: 1.5,
              overflow: 'hidden',
              boxShadow: `inset 0 0 0 1px ${tt.palette.divider}`,
            })}
          >
            {segs.map((seg) => {
              // Seam on 4th column (start of “export”): 3/4 grid line, not inside col3’s box.
              const homeSeamOnLeft = hasExport && total > 0 && seg.key === 's2b';
              return (
                <Box
                  key={seg.key}
                  sx={{ minWidth: 0, minHeight: 0, position: 'relative' }}
                >
                  <BarSegment
                    seg={seg}
                    totalW={total}
                    barWpx={barPx}
                    lng={lng}
                    t={t}
                    barH={BAR_H}
                    homeSeamOnLeft={homeSeamOnLeft}
                  />
                </Box>
              );
            })}
          </Box>

          <Stack
            role="group"
            aria-label={t('summary.livePowerBarHomePowerAria', {
              w: `${formatWatts(homeW, lng)} ${t('units.w')}`,
            })}
            /* Stack does not map `alignItems` to CSS; flex default is stretch, so the icon was left. */
            spacing={0.25}
            sx={{
              gridRow: 2,
              gridColumn: hasExport ? 4 : '1 / 4',
              alignSelf: 'start',
              justifySelf: hasExport ? 'start' : 'center',
              width: 'max-content',
              maxWidth: 160,
              minWidth: 0,
              mt: 0.5,
              flexDirection: 'column',
              alignItems: 'center',
              /* Seams sit on 4th column’s left: center readout on that line (not the cell’s start). */
              transform: hasExport
                ? `translateX(calc(-50% + ${String(MARKER_W / 2)}px))`
                : 'none',
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
              sx={{ lineHeight: 1.1, whiteSpace: 'nowrap' }}
            >
              {formatWatts(homeW, lng)} {t('units.w')}
            </Typography>
          </Stack>
        </Box>
      )}
    </Paper>
  );
}

/**
 * @param {{
 *   seg: { key: string, w: number, color: string, label: string },
 *   totalW: number,
 *   barWpx: number,
 *   lng: string,
 *   t: import('i18next').TFunction,
 *   barH: number,
 *   homeSeamOnLeft: boolean,
 * }} p
 */
function BarSegment({ seg, totalW, barWpx, lng, t, barH, homeSeamOnLeft }) {
  const { w, color, label, key: segKey } = seg;
  const tip = `${label}: ${formatWatts(w, lng)} ${t('units.w')}`;
  const segPx = totalW > 0 && barWpx > 0 ? (barWpx * w) / totalW : 0;
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
        borderLeft: homeSeamOnLeft && w >= 0 ? `${String(MARKER_W)}px solid #fff` : 'none',
        boxShadow: homeSeamOnLeft
          ? '0 0 0 0.5px rgba(0,0,0,0.25), 0 1px 4px rgba(0,0,0,0.2)'
          : 'none',
        zIndex: homeSeamOnLeft ? 1 : 0,
        position: 'relative',
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
              fontSize: { xs: '0.7rem', sm: '0.8rem' },
              lineHeight: 1.1,
              maxWidth: '100%',
            }}
          >
            {formatWatts(w, lng)} {t('units.w')}
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
          borderLeft: homeSeamOnLeft ? `${String(MARKER_W)}px solid #fff` : 'none',
        }}
      />
    );
  }
  if (inBar) {
    return block;
  }
  return <Tooltip title={tip} enterTouchDelay={0}>{block}</Tooltip>;
}
