import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';

import { isValidUrlRangeString } from '../components/RangePicker.jsx';

const PARAM = 'range';
const DEFAULT = 'today';

/**
 * Binds the energy `range` (preset or `day:YYYY-MM-DD`) to the `range` query
 * param so reloads and shared links keep the selection.
 * @returns {[string, (v: string) => void]}
 */
export function useUrlSyncedRange() {
  const [searchParams, setSearchParams] = useSearchParams();

  const range = useMemo(() => {
    const raw = searchParams.get(PARAM);
    if (raw == null || raw === '') return DEFAULT;
    if (isValidUrlRangeString(raw)) return raw;
    return DEFAULT;
  }, [searchParams]);

  useEffect(() => {
    const raw = searchParams.get(PARAM);
    if (raw != null && raw !== '' && !isValidUrlRangeString(raw)) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete(PARAM);
          return next;
        },
        { replace: true },
      );
    }
  }, [searchParams, setSearchParams]);

  const setRange = useCallback(
    (next) => {
      setSearchParams(
        (prev) => {
          const nextParams = new URLSearchParams(prev);
          if (next === DEFAULT) nextParams.delete(PARAM);
          else nextParams.set(PARAM, next);
          return nextParams;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return [range, setRange];
}
