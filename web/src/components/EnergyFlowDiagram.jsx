import { Paper, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { splitEnergyDashboardTotals } from '../api/energyModel.js';
import { SOLAR_POWER_ICON_PATH_D } from './flowDiagramCommon.jsx';
import { formatKwh, formatWatts } from '../format.js';

/**
 * Energy distribution diagram modelled on Home Assistant's Energy dashboard.
 *
 * Layout (800 × 688 viewBox; on small screens a tighter horizontal viewBox
 * zooms the graph to match HA’s edge-to-edge use of the card):
 *
 *   CO₂-neutral      PV         Gas
 *                  / | \         |
 *        Netz ────/──┼──\\──── Home (source ring)
 *            \\  /   |   \\
 *             Batterie
 *
 *  - Netz and Batterie bubbles show two values each: ← imported / → returned
 *    and ↓ charged / ↑ discharged respectively, mirroring HA exactly.
 *  - Battery: optional segmented ring (ticks 0–100%) when `batteryChargeFraction`
 *    is set. SOC % label is only in the native hover tooltip (`<title>`), not
 *    drawn as extra text inside the bubble.
 *  - Home has a coloured ring whose arc segments sum to the total
 *    consumption, weighted by source (grid / solar / battery).
 *  - CO₂→grid: static, no motion dots. Path stroke reflects period kWh. With
 *    `liveFlowW`, electric paths get W labels and moving dots from instant power;
 *    gas→home is never labelled in W (gas is m³, shown on the gas node). Without
 *    `liveFlowW`, dot motion uses period kWh (CO₂: line only, no dots).
 *  - Flow magnitudes use `splitEnergyDashboardTotals` in `energyModel.js`
 *    (same ordering as `powerTimeline.js`; approximate for long ranges).
 *
 * props.values: {
 *   solar, gridIn, gridOut, batteryIn, batteryOut, home, gas,
 *   co2Free,
 * }
 *
 * Some straight edges set `labelT` (0–1, position **along the segment**) and
 * optional `labelNudge: { x, y }` (perpendicular / fine shift in viewBox units)
 * so two nearby labels (e.g. net→home vs solar→battery) are not on the same
 * centre. Dots / animation still use the true midpoint of the path.
 */
/** Native HA fits nodes closer to the card edge; a tight viewBox ≈-zooms the fixed 800×688 layout. */
const VIEWBOX_COMPACT = '68 0 674 688';
const VIEWBOX_DEFAULT = '0 0 800 688';

export function EnergyFlowDiagram({
  values = {},
  liveFlowW = null,
  batteryChargeFraction = null,
}) {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const viewBox = isCompact ? VIEWBOX_COMPACT : VIEWBOX_DEFAULT;
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)', {
    noSsr: true,
    defaultMatches: false,
  });
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const c = theme.palette.energy ?? {
    grid: '#4f8cb9',
    solar: '#f2a825',
    battery: '#8e4fb9',
    gas: '#c45a5a',
    home: '#3aa07a',
    co2Neutral: '#57c786',
  };

  const solar = nn(values.solar);
  const gridIn = nn(values.gridIn);
  const gridOut = nn(values.gridOut);
  const batteryIn = nn(values.batteryIn);
  const batteryOut = nn(values.batteryOut);
  const gas = nn(values.gas);

  const {
    solarToGrid,
    solarToBattery,
    solarToHome: solarToHomeSplit,
    gridToBattery,
    batteryToGrid,
    batteryToHome,
    gridToHome,
  } = splitEnergyDashboardTotals(solar, gridIn, gridOut, batteryIn, batteryOut);

  const splitSum = solarToHomeSplit + gridToHome + batteryToHome;
  const homeTotal =
    values.home != null ? Math.max(0, nn(values.home)) : splitSum;
  const ringScale = splitSum > 0 ? homeTotal / splitSum : 0;
  const ringSegments = buildRingSegments({
    gridIn: gridToHome * ringScale,
    solarToHome: solarToHomeSplit * ringScale,
    batteryOut: batteryToHome * ringScale,
    colors: c,
  });

  const co2Free = values.co2Free != null ? nn(values.co2Free) : null;
  const showCo2 = co2Free != null && co2Free > 0;

  const unit = t('units.kwh');
  const fmt = (v) => formatKwh(v, lng);

  const POS = {
    co2:     { cx: 140, cy: 110, r: 52 },
    pv:      { cx: 400, cy: 110, r: 58 },
    gas:     { cx: 660, cy: 110, r: 52 },
    grid:    { cx: 140, cy: 340, r: 64 },
    home:    { cx: 660, cy: 340, r: 78 },
    battery: { cx: 400, cy: 560, r: 64 },
  };

  // Flow edges. `value` drives opacity; stroke width stays thin (see FlowLine).
  const edges = [];
  const wOf = (key) => (liveFlowW ? liveFlowW[key] : undefined);
  if (showCo2) {
    edges.push({
      from: POS.co2,
      to: POS.grid,
      color: c.co2Neutral,
      value: co2Free,
      noDots: true,
    });
  }
  // PV: solar export, direct use, and solar-fed charging only.
  // Solar → grid / → home: same S-curve construction as battery → grid / → home (see `routeFor` generic).
  edges.push({
    from: POS.pv,
    to: POS.grid,
    color: c.solar,
    value: solarToGrid,
    watts: wOf('solarToGrid'),
  });
  edges.push({
    from: POS.pv,
    to: POS.home,
    color: c.solar,
    value: solarToHomeSplit,
    watts: wOf('solarToHome'),
  });
  edges.push({
    from: POS.pv,
    to: POS.battery,
    color: c.solar,
    value: solarToBattery,
    watts: wOf('solarToBattery'),
    // Off the geometric centre: lower on the segment + slight nudge to the **left** of the vertical.
    labelT: 0.57,
    labelNudge: { x: -8, y: 0 },
  });
  // Grid → Home: straight line (unchanged; solar paths use the mirrored battery curves, not a hub at y=340).
  // Off centre: closer to the grid (lower `labelT`) + slight **up** (above the line).
  edges.push({
    from: POS.grid,
    to: POS.home,
    color: c.grid,
    value: gridToHome,
    watts: wOf('gridToHome'),
    labelT: 0.4,
    labelNudge: { x: 0, y: -7 },
  });
  edges.push({
    from: POS.grid,
    to: POS.battery,
    color: c.grid,
    value: gridToBattery,
    watts: wOf('gridToBattery'),
  });
  // Battery → Home and battery export to grid (paths always visible).
  edges.push({
    from: POS.battery,
    to: POS.home,
    color: c.battery,
    value: batteryToHome,
    watts: wOf('batteryToHome'),
  });
  edges.push({
    from: POS.battery,
    to: POS.grid,
    color: c.battery,
    value: batteryToGrid,
    watts: wOf('batteryToGrid'),
  });
  // Gas → Home (period volume m³, not electric W — no `watts` live label)
  edges.push({
    from: POS.gas,
    to: POS.home,
    color: c.gas,
    value: gas,
  });

  const maxEdge = Math.max(
    0.0001,
    ...edges.filter((e) => !e.noDots).map((e) => e.value || 0),
  );
  const maxW = liveFlowW
    ? Math.max(
        1,
        liveFlowW.solarToGrid,
        liveFlowW.solarToBattery,
        liveFlowW.solarToHome,
        liveFlowW.gridToHome,
        liveFlowW.gridToBattery,
        liveFlowW.batteryToHome,
        liveFlowW.batteryToGrid,
      )
    : null;

  return (
    <Paper
      sx={{
        p: { xs: 0.75, sm: 2.5 },
        px: { xs: 0.5, sm: 2.5 },
      }}
    >
      <Stack spacing={{ xs: 0.5, sm: 1.5 }}>
        <Typography
          variant="subtitle1"
          component="h2"
          sx={{ fontWeight: 700, px: { xs: 0.5, sm: 0 } }}
        >
          {t('summary.distribution')}
        </Typography>
        <svg
          viewBox={viewBox}
          role="img"
          aria-label={t('summary.distribution')}
          style={{ width: '100%', height: 'auto', display: 'block' }}
          overflow="visible"
        >
          {/* Flow lines go first so nodes paint on top of them. */}
          {edges.map((e, idx) => (
            <FlowLine
              key={idx}
              pathId={`energy-flow-path-${idx}`}
              edge={e}
              maxEdge={maxEdge}
              maxWForDots={maxW}
              reduceMotion={reduceMotion}
              theme={theme}
              wUnit={t('units.w')}
              language={lng}
              isCompact={isCompact}
            />
          ))}

          {/* Top row */}
          {showCo2 && (
            <SingleNode
              pos={POS.co2}
              color={c.co2Neutral}
              icon={<LeafIcon color={c.co2Neutral} size={isCompact ? 32 : 28} />}
              label={t('summary.flow.co2Free')}
              primary={`${fmt(co2Free)} ${unit}`}
              theme={theme}
              isCompact={isCompact}
              labelAbove
            />
          )}
          <SingleNode
            pos={POS.pv}
            color={c.solar}
            icon={<SolarIcon color={c.solar} size={isCompact ? 32 : 28} />}
            label={t('summary.flow.pv')}
            primary={`${fmt(solar)} ${unit}`}
            theme={theme}
            isCompact={isCompact}
            labelAbove
          />
          <SingleNode
            pos={POS.gas}
            color={c.gas}
            icon={<GasIcon color={c.gas} size={isCompact ? 32 : 28} />}
            label={t('summary.flow.gas')}
            primary={`${fmt(gas)} ${t('units.m3')}`}
            theme={theme}
            isCompact={isCompact}
            labelAbove
          />

          {/* Middle row */}
          <DualArrowNode
            pos={POS.grid}
            color={c.grid}
            icon={<GridIcon color={c.grid} size={isCompact ? 32 : 28} />}
            label={t('summary.flow.grid')}
            lines={[
              { arrow: '←', value: gridIn, color: c.grid },
              { arrow: '→', value: gridOut, color: c.grid },
            ]}
            unit={unit}
            fmt={fmt}
            theme={theme}
            isCompact={isCompact}
          />
          <RingNode
            pos={POS.home}
            color={c.home}
            icon={<HomeIcon color={c.home} size={isCompact ? 32 : 28} />}
            label={t('summary.flow.home')}
            primary={`${fmt(homeTotal)} ${unit}`}
            segments={ringSegments}
            theme={theme}
            isCompact={isCompact}
          />

          {/* Bottom row */}
          <BatterySegmentedNode
            pos={POS.battery}
            color={c.battery}
            icon={<BatteryIcon color={c.battery} size={isCompact ? 32 : 28} />}
            label={t('summary.flow.battery')}
            lines={[
              { arrow: '↓', value: batteryIn, color: c.battery },
              { arrow: '↑', value: batteryOut, color: c.battery },
            ]}
            unit={unit}
            fmt={fmt}
            theme={theme}
            isCompact={isCompact}
            chargeFraction={batteryChargeFraction}
            socLabel={
              batteryChargeFraction != null && Number.isFinite(batteryChargeFraction)
                ? t('summary.flow.batterySoc', {
                    pct: Math.round(Math.max(0, Math.min(1, batteryChargeFraction)) * 100),
                  })
                : null
            }
          />
        </svg>
      </Stack>
    </Paper>
  );
}

// --------------------------------------------------------------------------- //
// Internals
// --------------------------------------------------------------------------- //

/**
 * Shrink a font size so numeric labels do not run into the ring stroke. Uses
 * chord width at `y` inside a disc of effective radius (pos.r - innerMargin).
 */
function fitTextStackToCircle(
  pos,
  innerMargin,
  lineSpecs,
  baseSize,
  minSize,
  /** Slightly wider than 0.5 to match real “700” digit width + locale separators. */
  options = {},
) {
  const { charW = 0.57, edgePad = 2.5 } = options;
  const r = pos.r - innerMargin;
  if (r <= 0) return minSize;
  const pad = edgePad;
  const fits = (s) => {
    for (const { text, yFromCenter } of lineSpecs) {
      if (!text) continue;
      const y = Math.abs(yFromCenter);
      if (y >= r - pad) return false;
      const halfW = Math.sqrt(r * r - y * y) - pad;
      if (text.length * s * charW > 2 * halfW) return false;
    }
    return true;
  };
  if (fits(baseSize)) {
    return Math.max(minSize, Math.round(baseSize * 10) / 10);
  }
  let lo = minSize;
  let hi = baseSize;
  for (let i = 0; i < 14; i += 1) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return Math.max(minSize, Math.round(lo * 10) / 10);
}

function nn(v) {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function buildRingSegments({ gridIn, solarToHome, batteryOut, colors }) {
  const total = gridIn + solarToHome + batteryOut;
  if (total <= 0) return [];
  const segs = [
    { key: 'solar', value: solarToHome, color: colors.solar },
    { key: 'grid', value: gridIn, color: colors.grid },
    { key: 'battery', value: batteryOut, color: colors.battery },
  ].filter((s) => s.value > 0);
  return segs.map((s) => ({ ...s, fraction: s.value / total }));
}

function FlowLine({
  pathId,
  edge,
  maxEdge,
  maxWForDots,
  reduceMotion,
  theme,
  wUnit,
  language,
  isCompact = false,
}) {
  const { from, to, color, value = 0, via, noDots = false, watts: edgeW } = edge;
  const hasFlowKwh = value > 0;
  const kwhRatio = hasFlowKwh ? Math.min(1, value / maxEdge) : 0;
  const useWatts = maxWForDots != null && edgeW !== undefined && !noDots;
  const wActive = useWatts && edgeW > 0;
  const wRatio = wActive ? Math.min(1, edgeW / maxWForDots) : 0;
  // Period kWh still drives line strength; dots/labels use W when `liveFlowW` is set.
  const idleOpacity = theme.palette.mode === 'dark' ? 0.44 : 0.4;
  let strokeOpacity = hasFlowKwh
    ? Math.min(0.98, 0.66 + kwhRatio * 0.3)
    : idleOpacity;
  if (noDots && hasFlowKwh) {
    strokeOpacity = Math.min(0.58, idleOpacity + 0.12 + kwhRatio * 0.1);
  }
  const strokeWidth = isCompact ? 2.1 : 1.75;
  const wFontPx = isCompact ? 13.5 : 11;
  const wLabelStrokeW = isCompact ? 6.2 : 5.5;
  const dotR = isCompact ? 3.6 : 3.2;

  // Offset endpoints to the circle borders (+ a 2px gap) so lines visibly
  // land on the rim instead of disappearing into the centre of each node.
  const geo = routeFor(from, to, via, {
    startPad: 2,
    endPad: 2,
    labelT: edge.labelT,
    labelNudge: edge.labelNudge,
  });
  const d = geo.d;
  const showDots = noDots
    ? false
    : useWatts
      ? wActive
      : hasFlowKwh;
  const dotCount = showDots ? 1 : 0;
  const animRatio = wActive ? wRatio : kwhRatio;
  const dur = 6.8 + (1 - animRatio) * 3.4;
  // Live mode: one label per path, including 0 W (matches line colour; paper “gap”).
  const showWLabel = useWatts;
  const labelHalo = theme.palette.background.paper;
  const wText = `${formatWatts(edgeW, language)} ${wUnit}`;
  const lx = geo.lmx;
  const ly = geo.lmy;

  return (
    <g>
      <path
        id={pathId}
        d={d}
        stroke={color}
        strokeOpacity={strokeOpacity}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        fill="none"
      />
      {showDots && dotCount > 0 && reduceMotion && (
        <circle cx={geo.mx} cy={geo.my} r={dotR} fill={color} opacity={0.88} />
      )}
      {showDots && dotCount > 0 && !reduceMotion && (
        <circle r={dotR} fill={color} opacity={0.9}>
          <animateMotion dur={`${dur}s`} repeatCount="indefinite" rotate="auto">
            <mpath href={`#${pathId}`} />
          </animateMotion>
        </circle>
      )}
      {showWLabel && (
        <text
          x={lx}
          y={ly}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={color}
          stroke={labelHalo}
          strokeWidth={wLabelStrokeW}
          strokeLinejoin="round"
          paintOrder="stroke fill"
          style={{
            font: `600 ${wFontPx}px Inter, system-ui, sans-serif`,
            fontFeatureSettings: '"tnum"',
          }}
        >
          {wText}
        </text>
      )}
    </g>
  );
}

/**
 * Compute a path that starts on circle `a`'s border, follows either a
 * straight line or a central S-curve, and ends on circle `b`'s border.
 *
 * `mx, my` — midpoint (t=0.5) for flow dots / static marker (stable, no
 * getPointAtLength). On straight segments, `labelT` (0–1) and `labelNudge`
 * place the live W label on the line but not necessarily at the centre; curves
 * only use the nudge offset from the construction midpoint.
 */
function routeFor(
  a,
  b,
  via,
  { startPad = 0, endPad = 0, labelT, labelNudge } = {},
) {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const tDot = 0.5;
  const tLab = labelT == null || Number.isNaN(Number(labelT)) ? tDot : Number(labelT);
  const nudgeX = labelNudge?.x ?? 0;
  const nudgeY = labelNudge?.y ?? 0;

  // Horizontal middle row (grid ↔ home): straight line between rims.
  if (Math.abs(dy) < 8) {
    const sign = Math.sign(dx) || 1;
    const sx = a.cx + sign * (a.r + startPad);
    const sy = a.cy;
    const ex = b.cx - sign * (b.r + endPad);
    const ey = b.cy;
    return {
      d: `M ${sx} ${sy} L ${ex} ${ey}`,
      mx: sx + tDot * (ex - sx),
      my: sy,
      lmx: sx + tLab * (ex - sx) + nudgeX,
      lmy: sy + nudgeY,
    };
  }

  // Pure vertical (PV ↕ Battery, CO₂ ↕ Grid, Gas ↕ Home).
  if (Math.abs(dx) < 8) {
    const sign = Math.sign(dy) || 1;
    const sx = a.cx;
    const sy = a.cy + sign * (a.r + startPad);
    const ex = b.cx;
    const ey = b.cy - sign * (b.r + endPad);
    return {
      d: `M ${sx} ${sy} L ${ex} ${ey}`,
      mx: sx,
      my: sy + tDot * (ey - sy),
      lmx: sx + nudgeX,
      lmy: sy + tLab * (ey - sy) + nudgeY,
    };
  }

  // Generic S-curve (solar → grid / → home, battery → grid / → home, etc.):
  // top and bottom `from` nodes share cx=400, so these pairs are vertical mirrors.
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const sx = a.cx + ux * (a.r + startPad);
  const sy = a.cy + uy * (a.r + startPad);
  const ex = b.cx - ux * (b.r + endPad);
  const ey = b.cy - uy * (b.r + endPad);
  const midX = (sx + ex) / 2;
  const midMx = (sx + ex) / 2;
  const midMy = (sy + ey) / 2;
  return {
    d: `M ${sx} ${sy} C ${midX} ${sy}, ${midX} ${ey}, ${ex} ${ey}`,
    mx: midMx,
    my: midMy,
    lmx: midMx + nudgeX,
    lmy: midMy + nudgeY,
  };
}

// --------------------------------------------------------------------------- //
// Nodes
// --------------------------------------------------------------------------- //

function NodeCircle({ pos, color }) {
  return (
    <>
      <circle cx={pos.cx} cy={pos.cy} r={pos.r - 2} fill={`${color}14`} />
      <circle
        cx={pos.cx}
        cy={pos.cy}
        r={pos.r}
        fill="transparent"
        stroke={color}
        strokeWidth={3}
      />
    </>
  );
}

function NodeLabel({ pos, text, color, placement = 'below', isCompact = false }) {
  const fs = isCompact ? 15.5 : 13;
  // “Above” baseline must clear the top stroke; subscripts (CO₂) and cap height
  // can otherwise sit on the ring, especially on small (r=52) nodes in compact.
  const aboveLift = (isCompact ? 10 : 4) + (pos.r <= 54 ? 4 : 0);
  const y =
    placement === 'above'
      ? pos.cy - pos.r - 6 - aboveLift
      : pos.cy + pos.r + (isCompact ? 24 : 22);
  return (
    <text
      x={pos.cx}
      y={y}
      textAnchor="middle"
      fill={color}
      style={{ font: `500 ${fs}px Inter, sans-serif` }}
    >
      {text}
    </text>
  );
}

const ICON_NUDGE = { default: 16, compact: 18 };
const ICON_NUDGE_GRID = { default: 26, compact: 30 };

const INSET_THIN_STROKE = 2.5;
const INSET_THICK_RING = 3.8;

function SingleNode({ pos, color, icon, label, primary, theme, labelAbove, isCompact = false }) {
  const pfs0 = isCompact ? 20 : 18;
  // Smaller top-row nodes (CO₂, gas) have a slimmer horizontal chord; sit the
  // kWh line slightly higher in compact to stay inside the stroke.
  const small = pos.r <= 54;
  const yOff =
    isCompact && small
      ? 21
      : isCompact
        ? 24
        : small
          ? 20
          : 22;
  const pfs = fitTextStackToCircle(
    pos,
    INSET_THIN_STROKE + (small ? 1.4 : 0),
    [{ text: String(primary), yFromCenter: yOff }],
    pfs0,
    small && isCompact ? 8.5 : 10,
    {
      charW: small ? 0.6 : 0.57,
      edgePad: small && isCompact ? 3.5 : 2.5,
    },
  );
  const inudge = isCompact ? ICON_NUDGE.compact : ICON_NUDGE.default;
  return (
    <g>
      <NodeCircle pos={pos} color={color} />
      <g transform={`translate(${pos.cx}, ${pos.cy - inudge})`}>{icon}</g>
      <text
        x={pos.cx}
        y={pos.cy + yOff}
        textAnchor="middle"
        fill={theme.palette.text.primary}
        style={{
          font: `700 ${pfs}px Inter, sans-serif`,
          fontFeatureSettings: '"tnum"',
        }}
      >
        {primary}
      </text>
      <NodeLabel
        pos={pos}
        text={label}
        color={theme.palette.text.secondary}
        isCompact={isCompact}
        placement={labelAbove ? 'above' : 'below'}
      />
    </g>
  );
}

function DualArrowNode({ pos, color, icon, label, lines, unit, fmt, theme, isCompact = false }) {
  const fs0 = isCompact ? 16.5 : 15;
  const lineStep = isCompact ? 25 : 22;
  const lineSpecs = lines.map((l, i) => ({
    text: `${l.arrow} ${fmt(l.value)} ${unit}`,
    yFromCenter: 6 + i * lineStep,
  }));
  const fs = fitTextStackToCircle(
    pos,
    INSET_THIN_STROKE,
    lineSpecs,
    fs0,
    9.5,
  );
  const inudge = isCompact ? ICON_NUDGE_GRID.compact : ICON_NUDGE_GRID.default;
  return (
    <g>
      <NodeCircle pos={pos} color={color} />
      <g transform={`translate(${pos.cx}, ${pos.cy - inudge})`}>{icon}</g>
      {lines.map((l, i) => (
        <text
          key={i}
          x={pos.cx}
          y={pos.cy + 6 + i * lineStep}
          textAnchor="middle"
          fill={theme.palette.text.primary}
          style={{
            font: `600 ${fs}px Inter, sans-serif`,
            fontFeatureSettings: '"tnum"',
          }}
        >
          <tspan fill={l.color} style={{ fontWeight: 700 }}>
            {l.arrow}{' '}
          </tspan>
          <tspan>{`${fmt(l.value)} ${unit}`}</tspan>
        </text>
      ))}
      <NodeLabel pos={pos} text={label} color={theme.palette.text.secondary} isCompact={isCompact} />
    </g>
  );
}

const BATTERY_SOC_TICKS = 20;
const BATTERY_TICK_GAP_DEG = 2;

/**
 * Discrete ticks around the battery node; fill level follows `chargeFraction`
 * (0–1). When unknown, `chargeFraction` may be null and ticks stay dim (empty).
 */
function batterySocTickArcs(cx, cy, r, fraction, theme, strokeColor) {
  const n = BATTERY_SOC_TICKS;
  const slot = 360 / n;
  const span = Math.max(0.4, slot - BATTERY_TICK_GAP_DEG);
  const f =
    fraction != null && Number.isFinite(fraction)
      ? Math.max(0, Math.min(1, fraction))
      : 0;
  const dimOp = theme.palette.mode === 'dark' ? 0.2 : 0.19;
  const arcs = [];
  for (let i = 0; i < n; i++) {
    const start = -90 + i * slot + BATTERY_TICK_GAP_DEG / 2;
    const end = start + span;
    const t0 = i / n;
    const t1 = (i + 1) / n;
    const lit = Math.max(0, Math.min(1, (f - t0) / Math.max(1e-9, t1 - t0)));
    const op = dimOp + (0.94 - dimOp) * lit;
    arcs.push({
      d: arcPath(cx, cy, r, start, end),
      opacity: op,
      stroke: strokeColor,
    });
  }
  return arcs;
}

function BatterySegmentedNode({
  pos,
  color,
  icon,
  label,
  lines,
  unit,
  fmt,
  theme,
  isCompact = false,
  chargeFraction,
  socLabel,
}) {
  const ringWidth = 5;
  const tickArcs = batterySocTickArcs(
    pos.cx,
    pos.cy,
    pos.r,
    chargeFraction,
    theme,
    color,
  );
  const aria =
    socLabel != null
      ? `${label}: ${socLabel}`
      : `${label}: ${fmt(lines[0]?.value ?? 0)} ${unit} ${lines[0]?.arrow ?? ''}, ${fmt(lines[1]?.value ?? 0)} ${unit} ${lines[1]?.arrow ?? ''}`;

  const rowH = isCompact ? 22 : 20;
  const bfs0 = isCompact ? 16 : 14;
  const bspec = lines.map((l2, j) => ({
    text: `${l2.arrow} ${fmt(l2.value)} ${unit}`,
    yFromCenter: 4 + j * rowH,
  }));
  const bfs = fitTextStackToCircle(
    pos,
    INSET_THICK_RING,
    bspec,
    bfs0,
    8.5,
  );

  return (
    <g aria-label={aria}>
      {socLabel != null ? <title>{socLabel}</title> : null}
      <circle cx={pos.cx} cy={pos.cy} r={pos.r - 2} fill={`${color}14`} />
      <circle
        cx={pos.cx}
        cy={pos.cy}
        r={pos.r}
        fill="transparent"
        stroke={`${color}44`}
        strokeWidth={ringWidth}
      />
      {tickArcs.map((a, i) => (
        <path
          key={i}
          d={a.d}
          stroke={a.stroke}
          strokeOpacity={a.opacity}
          strokeWidth={ringWidth}
          fill="none"
          strokeLinecap="butt"
        />
      ))}
      <g
        transform={`translate(${pos.cx}, ${
          pos.cy - (isCompact ? 32 : 28)
        })`}
      >
        {icon}
      </g>
      {lines.map((l, i) => (
        <text
          key={i}
          x={pos.cx}
          y={pos.cy + 4 + i * rowH}
          textAnchor="middle"
          fill={theme.palette.text.primary}
          style={{
            font: `600 ${bfs}px Inter, sans-serif`,
            fontFeatureSettings: '"tnum"',
          }}
        >
          <tspan fill={l.color} style={{ fontWeight: 700 }}>
            {l.arrow}{' '}
          </tspan>
          <tspan>{`${fmt(l.value)} ${unit}`}</tspan>
        </text>
      ))}
      <NodeLabel pos={pos} text={label} color={theme.palette.text.secondary} isCompact={isCompact} />
    </g>
  );
}

function RingNode({ pos, color, icon, label, primary, segments, theme, isCompact = false }) {
  const ringRadius = pos.r;
  const ringWidth = 5;
  const yOff = isCompact ? 25 : 22;
  const hfs0 = isCompact ? 25 : 22;
  const hfs = fitTextStackToCircle(
    pos,
    INSET_THICK_RING,
    [{ text: String(primary), yFromCenter: yOff }],
    hfs0,
    12,
  );

  // SVG arc segments around the node to show consumption breakdown.
  const arcs = [];
  let angle = -90;
  for (const s of segments) {
    const start = angle;
    const end = angle + s.fraction * 360;
    arcs.push({ d: arcPath(pos.cx, pos.cy, ringRadius, start, end), color: s.color });
    angle = end;
  }

  return (
    <g>
      <circle
        cx={pos.cx}
        cy={pos.cy}
        r={pos.r - 2}
        fill={`${color}14`}
      />
      {/* Base ring — drawn first so segments paint over it. */}
      <circle
        cx={pos.cx}
        cy={pos.cy}
        r={pos.r}
        fill="transparent"
        stroke={`${color}44`}
        strokeWidth={ringWidth}
      />
      {arcs.map((a, i) => (
        <path
          key={i}
          d={a.d}
          stroke={a.color}
          strokeWidth={ringWidth}
          fill="none"
          strokeLinecap="butt"
        />
      ))}

      <g
        transform={`translate(${pos.cx}, ${
          pos.cy - (isCompact ? 19 : 16)
        })`}
      >
        {icon}
      </g>
      <text
        x={pos.cx}
        y={pos.cy + yOff}
        textAnchor="middle"
        fill={theme.palette.text.primary}
        style={{
          font: `700 ${hfs}px Inter, sans-serif`,
          fontFeatureSettings: '"tnum"',
        }}
      >
        {primary}
      </text>
      <NodeLabel pos={pos} text={label} color={theme.palette.text.secondary} isCompact={isCompact} />
    </g>
  );
}

function arcPath(cx, cy, r, startDeg, endDeg) {
  // Clamp so full circles get drawn as two semicircles (SVG can't draw a
  // 360° arc in a single command — start and end coincide).
  if (endDeg - startDeg >= 359.9) {
    return fullCirclePath(cx, cy, r);
  }
  const s = polarToCartesian(cx, cy, r, startDeg);
  const e = polarToCartesian(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`;
}

function fullCirclePath(cx, cy, r) {
  return [
    `M ${cx - r} ${cy}`,
    `A ${r} ${r} 0 1 1 ${cx + r} ${cy}`,
    `A ${r} ${r} 0 1 1 ${cx - r} ${cy}`,
  ].join(' ');
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

// --------------------------------------------------------------------------- //
// Inline SVG icons. Kept as local components so we don't mount DOM-dependent
// @mui/icons inside the SVG tree.
// --------------------------------------------------------------------------- //

function iconProps(color, size = 28) {
  const o = size / 2;
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    x: -o,
    y: -o,
    fill: 'none',
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
}

function LeafIcon({ color, size = 28 }) {
  return (
    <svg {...iconProps(color, size)}>
      <path d="M20 4c0 8-6 14-14 14 0-8 6-14 14-14z" fill={`${color}33`} />
      <path d="M6 18c6-6 10-10 14-14" />
    </svg>
  );
}

/** Same glyph as MUI `SolarPower`; inline SVG so size is correct inside the parent `<svg>`. */
function SolarIcon({ color, size = 28 }) {
  const o = size / 2;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" x={-o} y={-o} fill={color}>
      <path d={SOLAR_POWER_ICON_PATH_D} />
    </svg>
  );
}

function GasIcon({ color, size = 28 }) {
  return (
    <svg {...iconProps(color, size)}>
      <path
        d="M12 3s5 5 5 10a5 5 0 1 1-10 0c0-3 2-5 2-5s1 2 1 3 1-3 2-8z"
        fill={`${color}33`}
      />
    </svg>
  );
}

function GridIcon({ color, size = 28 }) {
  return (
    <svg {...iconProps(color, size)}>
      <path d="M6 4l6 6 6-6" />
      <path d="M8 10v10h8V10" fill={`${color}33`} />
      <path d="M10 14h4" />
    </svg>
  );
}

function HomeIcon({ color, size = 28 }) {
  return (
    <svg {...iconProps(color, size)}>
      <path d="M3 12l9-8 9 8" fill="none" />
      <path d="M5 10v10h14V10" fill={`${color}22`} />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}

function BatteryIcon({ color, size = 28 }) {
  return (
    <svg {...iconProps(color, size)}>
      <rect x="3" y="7" width="16" height="10" rx="2" fill={`${color}22`} />
      <rect x="19" y="10" width="2" height="4" fill={color} stroke="none" />
      <path d="M7 12h8" />
    </svg>
  );
}
