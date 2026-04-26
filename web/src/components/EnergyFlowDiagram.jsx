import { Paper, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { splitEnergyDashboardTotals } from '../api/energyModel.js';
import { formatKwh, formatWatts } from '../format.js';

/**
 * Energy distribution diagram modelled on Home Assistant's Energy dashboard.
 *
 * Layout (800 × 688 viewBox):
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
export function EnergyFlowDiagram({
  values = {},
  liveFlowW = null,
  batteryChargeFraction = null,
}) {
  const theme = useTheme();
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
    <Paper sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {t('summary.distribution')}
        </Typography>
        <svg
          viewBox="0 0 800 688"
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
            />
          ))}

          {/* Top row */}
          {showCo2 && (
            <SingleNode
              pos={POS.co2}
              color={c.co2Neutral}
              icon={<LeafIcon color={c.co2Neutral} />}
              label={t('summary.flow.co2Free')}
              primary={`${fmt(co2Free)} ${unit}`}
              theme={theme}
              labelAbove
            />
          )}
          <SingleNode
            pos={POS.pv}
            color={c.solar}
            icon={<SolarIcon color={c.solar} />}
            label={t('summary.flow.pv')}
            primary={`${fmt(solar)} ${unit}`}
            theme={theme}
            labelAbove
          />
          <SingleNode
            pos={POS.gas}
            color={c.gas}
            icon={<GasIcon color={c.gas} />}
            label={t('summary.flow.gas')}
            primary={`${fmt(gas)} ${t('units.m3')}`}
            theme={theme}
            labelAbove
          />

          {/* Middle row */}
          <DualArrowNode
            pos={POS.grid}
            color={c.grid}
            icon={<GridIcon color={c.grid} />}
            label={t('summary.flow.grid')}
            lines={[
              { arrow: '←', value: gridIn, color: c.grid },
              { arrow: '→', value: gridOut, color: c.grid },
            ]}
            unit={unit}
            fmt={fmt}
            theme={theme}
          />
          <RingNode
            pos={POS.home}
            color={c.home}
            icon={<HomeIcon color={c.home} />}
            label={t('summary.flow.home')}
            primary={`${fmt(homeTotal)} ${unit}`}
            segments={ringSegments}
            theme={theme}
          />

          {/* Bottom row */}
          <BatterySegmentedNode
            pos={POS.battery}
            color={c.battery}
            icon={<BatteryIcon color={c.battery} />}
            label={t('summary.flow.battery')}
            lines={[
              { arrow: '↓', value: batteryIn, color: c.battery },
              { arrow: '↑', value: batteryOut, color: c.battery },
            ]}
            unit={unit}
            fmt={fmt}
            theme={theme}
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
  const strokeWidth = 1.75;

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
        <circle cx={geo.mx} cy={geo.my} r={3.2} fill={color} opacity={0.88} />
      )}
      {showDots && dotCount > 0 && !reduceMotion && (
        <circle r={3.2} fill={color} opacity={0.9}>
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
          strokeWidth={5.5}
          strokeLinejoin="round"
          paintOrder="stroke fill"
          style={{
            font: '600 11px Inter, system-ui, sans-serif',
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

function NodeLabel({ pos, text, color, placement = 'below' }) {
  const y =
    placement === 'above'
      ? pos.cy - pos.r - 6
      : pos.cy + pos.r + 22;
  return (
    <text
      x={pos.cx}
      y={y}
      textAnchor="middle"
      fill={color}
      style={{ font: '500 13px Inter, sans-serif' }}
    >
      {text}
    </text>
  );
}

function SingleNode({ pos, color, icon, label, primary, theme, labelAbove }) {
  return (
    <g>
      <NodeCircle pos={pos} color={color} />
      <g transform={`translate(${pos.cx}, ${pos.cy - 16})`}>{icon}</g>
      <text
        x={pos.cx}
        y={pos.cy + 22}
        textAnchor="middle"
        fill={theme.palette.text.primary}
        style={{
          font: '700 18px Inter, sans-serif',
          fontFeatureSettings: '"tnum"',
        }}
      >
        {primary}
      </text>
      <NodeLabel
        pos={pos}
        text={label}
        color={theme.palette.text.secondary}
        placement={labelAbove ? 'above' : 'below'}
      />
    </g>
  );
}

function DualArrowNode({ pos, color, icon, label, lines, unit, fmt, theme }) {
  return (
    <g>
      <NodeCircle pos={pos} color={color} />
      <g transform={`translate(${pos.cx}, ${pos.cy - 26})`}>{icon}</g>
      {lines.map((l, i) => (
        <text
          key={i}
          x={pos.cx}
          y={pos.cy + 6 + i * 22}
          textAnchor="middle"
          fill={theme.palette.text.primary}
          style={{
            font: '600 15px Inter, sans-serif',
            fontFeatureSettings: '"tnum"',
          }}
        >
          <tspan fill={l.color} style={{ fontWeight: 700 }}>
            {l.arrow}{' '}
          </tspan>
          <tspan>{`${fmt(l.value)} ${unit}`}</tspan>
        </text>
      ))}
      <NodeLabel pos={pos} text={label} color={theme.palette.text.secondary} />
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
      <g transform={`translate(${pos.cx}, ${pos.cy - 28})`}>{icon}</g>
      {lines.map((l, i) => (
        <text
          key={i}
          x={pos.cx}
          y={pos.cy + 4 + i * 20}
          textAnchor="middle"
          fill={theme.palette.text.primary}
          style={{
            font: '600 14px Inter, sans-serif',
            fontFeatureSettings: '"tnum"',
          }}
        >
          <tspan fill={l.color} style={{ fontWeight: 700 }}>
            {l.arrow}{' '}
          </tspan>
          <tspan>{`${fmt(l.value)} ${unit}`}</tspan>
        </text>
      ))}
      <NodeLabel pos={pos} text={label} color={theme.palette.text.secondary} />
    </g>
  );
}

function RingNode({ pos, color, icon, label, primary, segments, theme }) {
  const ringRadius = pos.r;
  const ringWidth = 5;

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

      <g transform={`translate(${pos.cx}, ${pos.cy - 16})`}>{icon}</g>
      <text
        x={pos.cx}
        y={pos.cy + 22}
        textAnchor="middle"
        fill={theme.palette.text.primary}
        style={{
          font: '700 22px Inter, sans-serif',
          fontFeatureSettings: '"tnum"',
        }}
      >
        {primary}
      </text>
      <NodeLabel pos={pos} text={label} color={theme.palette.text.secondary} />
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

function iconProps(color) {
  return {
    width: 28,
    height: 28,
    viewBox: '0 0 24 24',
    x: -14,
    y: -14,
    fill: 'none',
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
}

function LeafIcon({ color }) {
  return (
    <svg {...iconProps(color)}>
      <path d="M20 4c0 8-6 14-14 14 0-8 6-14 14-14z" fill={`${color}33`} />
      <path d="M6 18c6-6 10-10 14-14" />
    </svg>
  );
}

function SolarIcon({ color }) {
  return (
    <svg {...iconProps(color)}>
      <path d="M3 19h18" />
      <path d="M5 19l2-10h10l2 10" fill={`${color}33`} />
      <path d="M9 9v10M15 9v10M7 14h10" />
    </svg>
  );
}

function GasIcon({ color }) {
  return (
    <svg {...iconProps(color)}>
      <path
        d="M12 3s5 5 5 10a5 5 0 1 1-10 0c0-3 2-5 2-5s1 2 1 3 1-3 2-8z"
        fill={`${color}33`}
      />
    </svg>
  );
}

function GridIcon({ color }) {
  return (
    <svg {...iconProps(color)}>
      <path d="M6 4l6 6 6-6" />
      <path d="M8 10v10h8V10" fill={`${color}33`} />
      <path d="M10 14h4" />
    </svg>
  );
}

function HomeIcon({ color }) {
  return (
    <svg {...iconProps(color)}>
      <path d="M3 12l9-8 9 8" fill="none" />
      <path d="M5 10v10h14V10" fill={`${color}22`} />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}

function BatteryIcon({ color }) {
  return (
    <svg {...iconProps(color)}>
      <rect x="3" y="7" width="16" height="10" rx="2" fill={`${color}22`} />
      <rect x="19" y="10" width="2" height="4" fill={color} stroke="none" />
      <path d="M7 12h8" />
    </svg>
  );
}
