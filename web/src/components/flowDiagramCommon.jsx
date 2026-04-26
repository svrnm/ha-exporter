// Shared primitives for both the historical energy flow diagram
// (EnergyFlowDiagram.jsx) and the live power flow diagram
// (LivePowerFlow.jsx). Geometry + node rendering are identical between the
// two — only the values and value formatting differ.

/** Matches `EnergyFlowDiagram` SVG; keep viewBox height ≥ ~688 so bottom labels fit. */
export const NODE_POSITIONS = {
  co2:     { cx: 140, cy: 110, r: 52 },
  pv:      { cx: 400, cy: 110, r: 58 },
  gas:     { cx: 660, cy: 110, r: 52 },
  grid:    { cx: 140, cy: 340, r: 64 },
  home:    { cx: 660, cy: 340, r: 78 },
  battery: { cx: 400, cy: 560, r: 64 },
};

/**
 * Compute a path that starts on circle `a`'s border, follows either a
 * straight line or a central S-curve, and ends on circle `b`'s border.
 * Returns both the path string and the approximate midpoint (for drawing
 * a flow marker dot). No getPointAtLength — we pick the geometric centre
 * of the construction because it's stable during SSR/hydration.
 */
export function routeFor(a, b, via, { startPad = 0, endPad = 0 } = {}) {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;

  if (Math.abs(dy) < 8) {
    const sign = Math.sign(dx) || 1;
    const sx = a.cx + sign * (a.r + startPad);
    const sy = a.cy;
    const ex = b.cx - sign * (b.r + endPad);
    const ey = b.cy;
    return {
      d: `M ${sx} ${sy} L ${ex} ${ey}`,
      mx: (sx + ex) / 2,
      my: (sy + ey) / 2,
      sx, sy, ex, ey,
    };
  }
  if (Math.abs(dx) < 8) {
    const sign = Math.sign(dy) || 1;
    const sx = a.cx;
    const sy = a.cy + sign * (a.r + startPad);
    const ex = b.cx;
    const ey = b.cy - sign * (b.r + endPad);
    return {
      d: `M ${sx} ${sy} L ${ex} ${ey}`,
      mx: (sx + ex) / 2,
      my: (sy + ey) / 2,
      sx, sy, ex, ey,
    };
  }
  if (via === 'left-hub' || via === 'right-hub') {
    const hubY = 340;
    const hubX = 400;
    const signY = Math.sign(hubY - a.cy) || 1;
    const signX = Math.sign(b.cx - hubX) || 1;
    const sx = a.cx;
    const sy = a.cy + signY * (a.r + startPad);
    const ex = b.cx - signX * (b.r + endPad);
    const ey = b.cy;
    const c1x = a.cx;
    const c1y = hubY;
    const c2x = hubX;
    const c2y = hubY;
    return {
      d: `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ex} ${ey}`,
      mx: (a.cx + b.cx) / 2,
      my: hubY,
      sx, sy, ex, ey,
    };
  }

  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const sx = a.cx + ux * (a.r + startPad);
  const sy = a.cy + uy * (a.r + startPad);
  const ex = b.cx - ux * (b.r + endPad);
  const ey = b.cy - uy * (b.r + endPad);
  const midX = (sx + ex) / 2;
  return {
    d: `M ${sx} ${sy} C ${midX} ${sy}, ${midX} ${ey}, ${ex} ${ey}`,
    mx: (sx + ex) / 2,
    my: (sy + ey) / 2,
    sx, sy, ex, ey,
  };
}

export function nn(v) {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// --------------------------------------------------------------------------- //
// Inline SVG icons. Kept as SVG-native components so they compose inside the
// parent <svg> without needing foreignObject. Placed at (0,0) — callers
// wrap them in <g transform="translate(...)" />.
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

export function LeafIcon({ color }) {
  return (
    <svg {...iconProps(color)}>
      <path d="M20 4c0 8-6 14-14 14 0-8 6-14 14-14z" fill={`${color}33`} />
      <path d="M6 18c6-6 10-10 14-14" />
    </svg>
  );
}

export function SolarIcon({ color }) {
  return (
    <svg {...iconProps(color)}>
      <path d="M3 19h18" />
      <path d="M5 19l2-10h10l2 10" fill={`${color}33`} />
      <path d="M9 9v10M15 9v10M7 14h10" />
    </svg>
  );
}

export function GasIcon({ color }) {
  return (
    <svg {...iconProps(color)}>
      <path
        d="M12 3s5 5 5 10a5 5 0 1 1-10 0c0-3 2-5 2-5s1 2 1 3 1-3 2-8z"
        fill={`${color}33`}
      />
    </svg>
  );
}

export function GridIcon({ color }) {
  return (
    <svg {...iconProps(color)}>
      <path d="M6 4l6 6 6-6" />
      <path d="M8 10v10h8V10" fill={`${color}33`} />
      <path d="M10 14h4" />
    </svg>
  );
}

export function HomeIcon({ color }) {
  return (
    <svg {...iconProps(color)}>
      <path d="M3 12l9-8 9 8" fill="none" />
      <path d="M5 10v10h14V10" fill={`${color}22`} />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}

export function BatteryIcon({ color }) {
  return (
    <svg {...iconProps(color)}>
      <rect x="3" y="7" width="16" height="10" rx="2" fill={`${color}22`} />
      <rect x="19" y="10" width="2" height="4" fill={color} stroke="none" />
      <path d="M7 12h8" />
    </svg>
  );
}

// --------------------------------------------------------------------------- //
// Node rendering
// --------------------------------------------------------------------------- //

export function NodeCircle({ pos, color }) {
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

export function NodeLabel({ pos, text, color }) {
  return (
    <text
      x={pos.cx}
      y={pos.cy + pos.r + 22}
      textAnchor="middle"
      fill={color}
      style={{ font: '500 13px Inter, sans-serif' }}
    >
      {text}
    </text>
  );
}
