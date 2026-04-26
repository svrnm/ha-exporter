/**
 * Small helpers for validating query-string inputs. Kept dumb on purpose:
 * these endpoints are meant to be fronted by a reverse proxy, not exposed
 * directly to hostile traffic.
 */

export function requireString(val, name) {
  if (typeof val !== 'string' || val.trim() === '') {
    const err = new Error(`missing_query_param:${name}`);
    err.statusCode = 400;
    throw err;
  }
  return val.trim();
}

export function optionalIsoDate(val, fallback) {
  if (val == null || val === '') return fallback;
  const d = new Date(String(val));
  if (Number.isNaN(d.getTime())) {
    const err = new Error(`invalid_iso_date:${val}`);
    err.statusCode = 400;
    throw err;
  }
  return d.toISOString();
}

export function clampInt(val, { min, max, fallback }) {
  if (val == null || val === '') return fallback;
  const n = parseInt(String(val), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * Accept only a small allow-list of string values. Returns `fallback` if
 * nothing was provided, or throws a 400-style error if the caller passed an
 * unknown string.
 */
export function oneOf(val, allowed, { fallback } = {}) {
  if (val == null || val === '') return fallback;
  const s = String(val);
  if (!allowed.includes(s)) {
    const err = new Error(`invalid_enum:${s}`);
    err.statusCode = 400;
    throw err;
  }
  return s;
}
