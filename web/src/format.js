// Intl helpers. All formatting goes through these so a locale switch
// propagates through the whole app without component-level plumbing.

export function formatNumber(value, locale, options) {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatKwh(value, locale) {
  return formatNumber(value, locale, {
    maximumFractionDigits: value != null && Math.abs(value) >= 100 ? 0 : 2,
  });
}

/**
 * Energy in Wh (e.g. from kWh · 1000) for the summary bar. Fine-grained for small
 * day totals; no decimals for large values to keep labels readable.
 * @param {number | null | undefined} wh
 * @param {string} locale
 */
export function formatWh(wh, locale) {
  if (wh == null || !Number.isFinite(wh)) return '—';
  const abs = Math.abs(wh);
  const maxFrac = abs < 10 ? 1 : 0;
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: maxFrac,
  }).format(wh);
}

/**
 * @param {number | null | undefined} valueW  Power in watts
 * @param {string} locale
 * @param {{ signed?: boolean }} [options]
 */
export function formatWatts(valueW, locale, options = {}) {
  if (valueW == null || !Number.isFinite(valueW)) return '—';
  const w = Math.round(valueW);
  const abs = Math.abs(w);
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    abs,
  );
  if (options.signed) {
    if (w > 0) return `+${n}`;
    if (w < 0) return `−${n}`;
    return '0';
  }
  return String(w);
}

export function formatCurrency(value, locale, currency = 'EUR') {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDateTimeShort(isoOrDate, locale) {
  if (!isoOrDate) return '';
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d?.getTime?.())) return '';
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function formatHour(isoOrDate, locale) {
  if (!isoOrDate) return '';
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d?.getTime?.())) return '';
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function formatDay(isoOrDate, locale) {
  if (!isoOrDate) return '';
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d?.getTime?.())) return '';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
  }).format(d);
}
