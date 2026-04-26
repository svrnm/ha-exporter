import { useId, useMemo } from 'react';
import { Box, Paper, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Layer, Rectangle, ResponsiveContainer, Sankey, Tooltip } from 'recharts';
import { formatKwh, formatWatts } from '../format.js';

const MAX_DEVICE_NODES = 7;
const MIN_VISIBLE_KWH = 0.01;
const MIN_VISIBLE_W = 1;
/** Min chart height; Sankey with many nodes needs room so labels do not overlap. */
const CHART_MIN_H = 720;
/** Vertical space budget per Recharts node (two label lines + padding). */
const CHART_PER_NODE = 52;
const CHART_H_EXTRA = 168;

/**
 * Energy flow Sankey: sources → home → devices, or hierarchical `graphData`
 * from `buildHierarchicalSankeyData`. Coloured flows + node labels (name + kWh or W).
 */
export function PowerFlowSankey({
  totals,
  devices,
  locale,
  title,
  emptyText,
  headerAction = null,
  graphData = null,
  /** @type {'kwh' | 'watts'} */ valueUnit = 'kwh',
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const titleFinal = title ?? t('now.sankey.title');
  const emptyFinal = emptyText ?? t('now.sankey.empty');
  const c = theme.palette.energy ?? {};
  const minV = valueUnit === 'watts' ? MIN_VISIBLE_W : MIN_VISIBLE_KWH;
  const fmt = (v) =>
    valueUnit === 'watts'
      ? `${formatWatts(v, locale)} ${t('units.w')}`
      : `${formatKwh(v, locale)} ${t('units.kwh')}`;

  const data = useMemo(() => {
    if (graphData?.links?.length > 0) {
      return { nodes: graphData.nodes, links: graphData.links };
    }

    const nodes = [];
    const links = [];
    const add = (node) => {
      nodes.push(node);
      return nodes.length - 1;
    };

    const gridIdx =
      totals.gridIn > minV
        ? add({ name: t('summary.flow.grid'), color: c.grid })
        : -1;
    const solarIdx =
      totals.solarToHome > minV
        ? add({ name: t('summary.flow.pv'), color: c.solar })
        : -1;
    const batteryIdx =
      totals.batteryOut > minV
        ? add({ name: t('summary.flow.battery'), color: c.battery })
        : -1;
    const homeIdx = add({ name: t('summary.flow.home'), color: c.home });

    if (gridIdx >= 0) {
      links.push({ source: gridIdx, target: homeIdx, value: totals.gridIn, color: c.grid });
    }
    if (solarIdx >= 0) {
      links.push({ source: solarIdx, target: homeIdx, value: totals.solarToHome, color: c.solar });
    }
    if (batteryIdx >= 0) {
      links.push({ source: batteryIdx, target: homeIdx, value: totals.batteryOut, color: c.battery });
    }

    const sortedDevices = devices
      .filter((d) => d.value > minV)
      .sort((a, b) => b.value - a.value);
    const topDevices = sortedDevices.slice(0, MAX_DEVICE_NODES);
    const tailDevices = sortedDevices.slice(MAX_DEVICE_NODES);
    const tailSum = tailDevices.reduce((acc, d) => acc + d.value, 0);

    let trackedSum = 0;
    for (const d of topDevices) {
      const idx = add({ name: d.name, color: theme.palette.text.primary });
      links.push({ source: homeIdx, target: idx, value: d.value, color: c.home });
      trackedSum += d.value;
    }
    if (tailSum > minV) {
      const idx = add({
        name: t('now.sankey.others', { count: tailDevices.length }),
        color: theme.palette.text.secondary,
      });
      links.push({ source: homeIdx, target: idx, value: tailSum, color: c.home });
      trackedSum += tailSum;
    }

    const untracked = Math.max(0, totals.home - trackedSum);
    if (untracked > minV) {
      const idx = add({ name: t('now.sankey.untracked'), color: theme.palette.text.disabled });
      links.push({
        source: homeIdx,
        target: idx,
        value: untracked,
        color: theme.palette.action.disabledBackground,
      });
    }

    return { nodes, links };
  }, [graphData, totals, devices, t, c, theme, minV]);

  const hasFlow = data.links.some((l) => l.value > 0);
  const chartH = useMemo(
    () =>
      Math.max(
        CHART_MIN_H,
        data.nodes.length * CHART_PER_NODE + CHART_H_EXTRA,
      ),
    [data.nodes.length],
  );

  return (
    <Paper sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack spacing={1.5}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {titleFinal}
          </Typography>
          {headerAction}
        </Stack>
        {!hasFlow ? (
          <Typography variant="body2" color="text.secondary">
            {emptyFinal}
          </Typography>
        ) : (
          <Box sx={{ width: '100%', height: chartH }}>
            <ResponsiveContainer width="100%" height="100%">
              <Sankey
                data={data}
                nameKey="name"
                nodePadding={22}
                nodeWidth={12}
                margin={{ top: 16, right: 200, left: 56, bottom: 16 }}
                link={<SankeyLink />}
                node={<SankeyNode locale={locale} theme={theme} valueUnit={valueUnit} />}
              >
                <Tooltip
                  contentStyle={{
                    background: theme.palette.background.paper,
                    border: `1px solid ${theme.palette.divider}`,
                    borderRadius: 8,
                  }}
                  labelStyle={{ color: theme.palette.text.secondary }}
                  itemStyle={{ color: theme.palette.text.primary }}
                  formatter={(value) => [fmt(value), '']}
                />
              </Sankey>
            </ResponsiveContainer>
          </Box>
        )}
      </Stack>
    </Paper>
  );
}

function SankeyLink(props) {
  const {
    sourceX,
    targetX,
    sourceY,
    targetY,
    sourceControlX,
    targetControlX,
    linkWidth,
    payload,
    index,
  } = props;
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)', {
    noSsr: true,
    defaultMatches: false,
  });
  const pathId = `${useId().replace(/:/g, '')}-link-${index ?? 0}`;
  const colour = payload?.color ?? 'rgba(255,255,255,0.35)';
  const d = `M${sourceX},${sourceY}C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`;
  const value = Number(payload?.value) || linkWidth || 0;
  const strokeOpacity = Math.min(0.78, 0.32 + 0.12 * Math.sqrt(Math.max(value, 0.001)));
  const dur = 5.5 + Math.max(0, 2.8 - Math.min(linkWidth, 8) * 0.18);

  return (
    <g>
      <path
        id={pathId}
        d={d}
        stroke={colour}
        strokeWidth={2}
        fill="none"
        strokeOpacity={strokeOpacity}
        strokeLinecap="round"
      />
      {!reduceMotion && (
        <circle r={2.75} fill={colour} opacity={0.92}>
          <animateMotion dur={`${dur}s`} repeatCount="indefinite" rotate="auto">
            <mpath href={`#${pathId}`} />
          </animateMotion>
        </circle>
      )}
    </g>
  );
}

function SankeyNode(props) {
  const { x, y, width, height, index, payload, containerWidth, locale, theme, valueUnit = 'kwh' } = props;
  const { t } = useTranslation();
  const isSource = x < containerWidth / 2;
  const labelX = isSource ? x - 8 : x + width + 8;
  const textAnchor = isSource ? 'end' : 'start';
  const color = payload?.color ?? theme.palette.text.primary;
  const value = payload?.value ?? 0;
  const labelY = y + height / 2 - 6;
  const valueLine =
    valueUnit === 'watts'
      ? `${formatWatts(value, locale)} ${t('units.w')}`
      : `${formatKwh(value, locale)} ${t('units.kwh')}`;

  return (
    <Layer key={`node-${index}`}>
      <Rectangle
        x={x}
        y={y}
        width={width}
        height={Math.max(height, 2)}
        fill={color}
        fillOpacity={0.9}
        stroke="none"
      />
      <text
        x={labelX}
        y={labelY}
        textAnchor={textAnchor}
        dominantBaseline="middle"
        fill={theme.palette.text.primary}
        style={{ font: '500 12px Inter, sans-serif' }}
      >
        {payload?.name}
      </text>
      <text
        x={labelX}
        y={labelY + 14}
        textAnchor={textAnchor}
        dominantBaseline="middle"
        fill={theme.palette.text.secondary}
        style={{ font: '400 11px Inter, sans-serif', fontFeatureSettings: '"tnum"' }}
      >
        {valueLine}
      </text>
    </Layer>
  );
}
