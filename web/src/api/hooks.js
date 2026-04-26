import { useQuery, useQueries } from '@tanstack/react-query';
import { useApi } from './ApiContext.jsx';
import {
  allStatIdsFromModel,
  buildEnergyModel,
  normalizeCumulativeRowToKwh,
  normalizeCumulativeStatsToKwh,
  pointsToHourlyDeltas,
  resolveStatisticWindowTotal,
  totalStatisticPeriodTotal,
} from './energyModel.js';

/** Query key factory to keep cache keys consistent. */
export const qk = {
  instances: () => ['instances'],
  entities: (id) => ['entities', id],
  prefs: (id) => ['prefs', id],
  // Bump when /statistics response shape or window-total logic changes (invalidates old cache).
  stats: (id, statId, period, start, end) =>
    ['stats', 'v2', id, statId, period, start, end],
  latest: (id, period) => ['stats', 'latest', id, period],
  states: (id, entityId, start, end) =>
    ['states', id, entityId, start, end],
  latestStates: (id) => ['states', 'latest', id],
};

export function useInstances() {
  const api = useApi();
  return useQuery({
    queryKey: qk.instances(),
    queryFn: ({ signal }) => api.request('/instances', { signal }),
    select: (data) => data?.instances ?? [],
    // Poll a bit faster while the list is empty (e.g. right after a full
    // remote reset) so the first ingest shows up without a manual refresh.
    refetchInterval: (q) => {
      const n = q.state.data?.length;
      if (n === undefined) return 5_000;
      return n === 0 ? 5_000 : 60_000;
    },
    refetchOnWindowFocus: true,
  });
}

export function useEntities(instanceId) {
  const api = useApi();
  return useQuery({
    queryKey: qk.entities(instanceId),
    enabled: !!instanceId,
    queryFn: ({ signal }) =>
      api.request('/entities', { signal, query: { instance_id: instanceId } }),
  });
}

export function usePrefs(instanceId) {
  const api = useApi();
  return useQuery({
    queryKey: qk.prefs(instanceId),
    enabled: !!instanceId,
    retry: (failureCount, err) => err?.status !== 404 && failureCount < 2,
    queryFn: ({ signal }) =>
      api.request('/energy/prefs', { signal, query: { instance_id: instanceId } }),
    select: (data) => ({
      raw: data?.prefs ?? null,
      updatedAt: data?.updated_at ?? null,
      model: buildEnergyModel(data?.prefs),
    }),
  });
}

/**
 * Fetch a single statistic series. `period` picks between long-term hourly
 * buckets ('hour', the default) and short-term 5-minute buckets ('5minute')
 * which are only retained ~10 days server-side.
 */
export function useStatistics(instanceId, statisticId, start, end, options = {}) {
  const api = useApi();
  const period = options.period ?? 'hour';
  return useQuery({
    queryKey: qk.stats(instanceId, statisticId, period, start, end),
    enabled: !!instanceId && !!statisticId && !!start && !!end,
    queryFn: ({ signal }) =>
      api.request('/statistics', {
        signal,
        query: {
          instance_id: instanceId,
          statistic_id: statisticId,
          period,
          start,
          end,
          limit: 10000,
        },
      }),
    select: (data) => {
      const rawPoints = data?.points ?? [];
      const rawAnchor = data?.anchor ?? null;
      const rawFirst = data?.first ?? null;
      const rawLast = data?.last ?? null;
      const { points, anchor } = normalizeCumulativeStatsToKwh(
        rawPoints,
        rawAnchor,
      );
      const firstInWindow =
        rawFirst && typeof rawFirst === 'object'
          ? normalizeCumulativeRowToKwh(rawFirst)
          : null;
      const lastInWindow =
        rawLast && typeof rawLast === 'object'
          ? normalizeCumulativeRowToKwh(rawLast)
          : null;
      const deltaOpts = {
        maxDeltaKwh: period === '5minute' ? 25 / 12 : 250,
        firstInWindow,
        lastInWindow,
      };
      const deltas = pointsToHourlyDeltas(points, anchor, deltaOpts);
      const spanTotal = totalStatisticPeriodTotal(points, anchor, deltaOpts);
      return {
        points,
        anchor,
        first: firstInWindow,
        last: lastInWindow,
        deltas,
        period,
        total: resolveStatisticWindowTotal(spanTotal, deltas),
        unit: lastInWindow?.unit ?? points[points.length - 1]?.unit ?? 'kWh',
      };
    },
  });
}

/**
 * Fetch many statistics in parallel — used by pages that need to layer
 * multiple series on top of each other (e.g. stacked bars for grid+solar).
 *
 * Returns { results, isLoading, total } where results is an array aligned
 * with statIds and total sums across all of them.
 */
export function useManyStatistics(instanceId, statIds, start, end, options = {}) {
  const api = useApi();
  const period = options.period ?? 'hour';
  const list = statIds.filter(Boolean);
  const allow = options.enabled !== false;
  const queries = useQueries({
    queries: list.map((statId) => ({
      queryKey: qk.stats(instanceId, statId, period, start, end),
      enabled: allow && !!instanceId && !!statId && !!start && !!end,
      queryFn: ({ signal }) =>
        api.request('/statistics', {
          signal,
          query: {
            instance_id: instanceId,
            statistic_id: statId,
            period,
            start,
            end,
            limit: 10000,
          },
        }),
      select: (data) => {
        const rawPoints = data?.points ?? [];
        const rawAnchor = data?.anchor ?? null;
        const rawFirst = data?.first ?? null;
        const rawLast = data?.last ?? null;
        const { points, anchor } = normalizeCumulativeStatsToKwh(
          rawPoints,
          rawAnchor,
        );
        const firstInWindow =
          rawFirst && typeof rawFirst === 'object'
            ? normalizeCumulativeRowToKwh(rawFirst)
            : null;
        const lastInWindow =
          rawLast && typeof rawLast === 'object'
            ? normalizeCumulativeRowToKwh(rawLast)
            : null;
        const deltaOpts = {
          maxDeltaKwh: period === '5minute' ? 25 / 12 : 250,
          firstInWindow,
          lastInWindow,
        };
        const deltas = pointsToHourlyDeltas(points, anchor, deltaOpts);
        const spanTotal = totalStatisticPeriodTotal(points, anchor, deltaOpts);
        return {
          statId,
          points,
          anchor,
          first: firstInWindow,
          last: lastInWindow,
          deltas,
          period,
          total: resolveStatisticWindowTotal(spanTotal, deltas),
          unit: lastInWindow?.unit ?? points[points.length - 1]?.unit ?? 'kWh',
        };
      },
    })),
  });

  const isLoading = queries.some((q) => q.isLoading);
  const isError = queries.some((q) => q.isError);
  const results = queries.map((q, idx) => ({
    statId: list[idx],
    data: q.data,
    error: q.error,
  }));
  return { results, isLoading, isError, period };
}

export function useLatestStatistics(instanceId, options = {}) {
  const api = useApi();
  const period = options.period ?? 'hour';
  return useQuery({
    queryKey: qk.latest(instanceId, period),
    enabled: !!instanceId,
    refetchInterval: options.pollMs ?? 30_000,
    queryFn: ({ signal }) =>
      api.request('/statistics/latest', {
        signal,
        query: { instance_id: instanceId, period },
      }),
    select: (data) => data?.statistics ?? [],
  });
}

export function useStates(instanceId, entityId, start, end) {
  const api = useApi();
  return useQuery({
    queryKey: qk.states(instanceId, entityId, start, end),
    enabled: !!instanceId && !!entityId && !!start && !!end,
    queryFn: ({ signal }) =>
      api.request('/states', {
        signal,
        query: {
          instance_id: instanceId,
          entity_id: entityId,
          start,
          end,
          limit: 10000,
        },
      }),
    select: (data) => data?.states ?? [],
  });
}

/**
 * Fetch state history for many entities in parallel.
 *
 * Used by the Live page's power timeline where we overlay four signed power
 * sensors (grid / solar / battery-in / battery-out) on a single chart. Each
 * query shares caching keys with `useStates` so opening a single-entity view
 * next to this one is free.
 */
export function useManyStates(instanceId, entityIds, start, end, options = {}) {
  const api = useApi();
  const list = (entityIds ?? []).filter(Boolean);
  const queries = useQueries({
    queries: list.map((entityId) => ({
      queryKey: qk.states(instanceId, entityId, start, end),
      enabled: !!instanceId && !!entityId && !!start && !!end,
      refetchInterval: options.pollMs ?? 0,
      queryFn: ({ signal }) =>
        api.request('/states', {
          signal,
          query: {
            instance_id: instanceId,
            entity_id: entityId,
            start,
            end,
            limit: 20000,
          },
        }),
      select: (data) => ({
        entityId,
        states: data?.states ?? [],
      }),
    })),
  });

  const results = queries.map((q, idx) => ({
    entityId: list[idx],
    data: q.data,
    error: q.error,
    isLoading: q.isLoading,
  }));
  return {
    results,
    isLoading: queries.some((q) => q.isLoading),
    isError: queries.some((q) => q.isError),
  };
}

/**
 * Latest state (current snapshot) for every tracked entity of an instance.
 *
 * Polled on a short interval so the live-flow page feels live without
 * requiring websockets. Parses the stored JSON `attributes` on the way
 * through so callers can read `attributes.unit_of_measurement` directly.
 */
export function useLatestStates(instanceId, options = {}) {
  const api = useApi();
  return useQuery({
    queryKey: qk.latestStates(instanceId),
    enabled: !!instanceId,
    refetchInterval: options.pollMs ?? 15_000,
    queryFn: ({ signal }) =>
      api.request('/states/latest', {
        signal,
        query: { instance_id: instanceId },
      }),
    select: (data) => {
      const rows = data?.states ?? [];
      const byEntity = new Map();
      for (const r of rows) byEntity.set(r.entity_id, r);
      return { rows, byEntity };
    },
  });
}

/** Convenience: given an instance, load prefs + all referenced statistics. */
export function useEnergyBundle(instanceId, start, end, options = {}) {
  const prefs = usePrefs(instanceId);
  const model = prefs.data?.model;
  const ids = model ? allStatIdsFromModel(model) : [];
  const stats = useManyStatistics(instanceId, ids, start, end, options);
  return { prefs, model, stats };
}
