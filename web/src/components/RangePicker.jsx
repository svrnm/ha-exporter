import {
  Box,
  FormControlLabel,
  IconButton,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import { useTranslation } from 'react-i18next';

export const RANGES = ['today', 'yesterday', 'last7', 'last30'];

/** Prefix for a single local-calendar-day (`day:2026-04-22`). */
export const DAY_RANGE_PREFIX = 'day:';
/** Inclusive start / inclusive end (`span:2026-04-10/2026-04-15`). */
export const SPAN_RANGE_PREFIX = 'span:';

export function isCustomDayRangeValue(value) {
  return typeof value === 'string' && value.startsWith(DAY_RANGE_PREFIX);
}

export function isSpanRangeValue(value) {
  return typeof value === 'string' && value.startsWith(SPAN_RANGE_PREFIX);
}

export function customDayYmd(value) {
  if (!isCustomDayRangeValue(value)) return '';
  return value.slice(DAY_RANGE_PREFIX.length);
}

/** @returns {{ from: string, to: string } | null}  `YYYY-MM-DD` */
export function parseSpanRangeValue(value) {
  if (!isSpanRangeValue(value)) return null;
  const rest = value.slice(SPAN_RANGE_PREFIX.length);
  const i = rest.indexOf('/');
  if (i < 0) return null;
  const from = rest.slice(0, i);
  const to = rest.slice(i + 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  if (from > to) return { from: to, to: from };
  return { from, to };
}

export function formatSpanRangeValue(fromYmd, toYmd) {
  return `${SPAN_RANGE_PREFIX}${fromYmd}/${toYmd}`;
}

export function ymdFromLocalDate(d) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

/**
 * @param {string} ymd
 * @returns {{ start: Date, end: Date } | null}  `end` is start of the next local day.
 */
export function localDayBoundsFromYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const start = new Date(y, mo, d, 0, 0, 0, 0);
  const end = new Date(y, mo, d + 1, 0, 0, 0, 0);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { start, end };
}

export function ymdAddDays(ymd, deltaDays) {
  const b = localDayBoundsFromYmd(ymd);
  if (!b) return null;
  const d = new Date(b.start);
  d.setDate(d.getDate() + deltaDays);
  return ymdFromLocalDate(d);
}

export function boundsYmdForPicker(now = new Date(), maxDayLookback = 30) {
  const maxD = ymdFromLocalDate(now);
  const minDate = new Date(now);
  minDate.setDate(minDate.getDate() - maxDayLookback);
  return { minD: ymdFromLocalDate(minDate), maxD };
}

/**
 * @param {string} value
 * @param {Date} [now]
 * @param {number} [maxDayLookback=30]
 */
export function isValidUrlRangeString(value, now = new Date(), maxDayLookback = 30) {
  const { minD, maxD } = boundsYmdForPicker(now, maxDayLookback);
  if (RANGES.includes(value)) return true;
  if (isCustomDayRangeValue(value)) {
    const y = customDayYmd(value);
    if (!localDayBoundsFromYmd(y)) return false;
    return y >= minD && y <= maxD;
  }
  if (isSpanRangeValue(value)) {
    const p = parseSpanRangeValue(value);
    if (!p) return false;
    if (!localDayBoundsFromYmd(p.from) || !localDayBoundsFromYmd(p.to)) return false;
    if (p.from < minD || p.to > maxD) return false;
    return p.from <= p.to;
  }
  return false;
}

/** Inclusive end calendar day of an exclusive `end` ISO (same as HA-style ranges). */
function inclusiveEndYmdFromExclusiveEnd(iso) {
  const t = new Date(iso);
  t.setTime(t.getTime() - 1);
  return ymdFromLocalDate(t);
}

function presetSpanYmds(preset, now) {
  const { start, end } = resolveRange(preset, now);
  return {
    from: ymdFromLocalDate(new Date(start)),
    to: inclusiveEndYmdFromExclusiveEnd(end),
  };
}

/**
 * @returns {true} when chart axes should bucket by day (not by hour).
 */
export function isDailyAggregateRange(value) {
  if (value === 'last7' || value === 'last30') return true;
  if (isSpanRangeValue(value)) {
    const p = parseSpanRangeValue(value);
    if (!p) return false;
    return p.from < p.to;
  }
  return false;
}

/**
 * True when 5-minute statistics are available for the full selection (HA retention).
 */
export function allowsFiveMinuteForRange(value, now = new Date(), maxAgeDays = 10) {
  if (value === 'today' || value === 'yesterday') return true;
  if (isCustomDayRangeValue(value)) {
    const b = localDayBoundsFromYmd(customDayYmd(value));
    if (!b) return false;
    const today0 = new Date(now);
    today0.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((today0 - b.start) / 86_400_000);
    return diffDays >= 0 && diffDays <= maxAgeDays;
  }
  if (isSpanRangeValue(value)) {
    const p = parseSpanRangeValue(value);
    if (!p) return false;
    const b = localDayBoundsFromYmd(p.to);
    if (!b) return false;
    const today0 = new Date(now);
    today0.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((today0 - b.start) / 86_400_000);
    return diffDays >= 0 && diffDays <= maxAgeDays;
  }
  return false;
}

/**
 * @param {string} range
 * @param {Date} [now]
 * @returns {{ start: string, end: string } ISO, end exclusive
 */
export function resolveRange(range, now = new Date()) {
  if (isSpanRangeValue(range)) {
    const p = parseSpanRangeValue(range);
    if (!p) {
      return { start: new Date(now).toISOString(), end: new Date(now).toISOString() };
    }
    const a0 = localDayBoundsFromYmd(p.from);
    const b0 = localDayBoundsFromYmd(p.to);
    if (a0 && b0) {
      return { start: a0.start.toISOString(), end: b0.end.toISOString() };
    }
  }
  if (isCustomDayRangeValue(range)) {
    const ymd = customDayYmd(range);
    const b = localDayBoundsFromYmd(ymd);
    if (b) {
      return { start: b.start.toISOString(), end: b.end.toISOString() };
    }
  }

  const end = new Date(now);
  end.setMinutes(0, 0, 0);
  end.setHours(end.getHours() + 1);
  const start = new Date(end);

  switch (range) {
    case 'today': {
      const t0 = new Date(now);
      t0.setHours(0, 0, 0, 0);
      return { start: t0.toISOString(), end: end.toISOString() };
    }
    case 'yesterday': {
      const s = new Date(now);
      s.setHours(0, 0, 0, 0);
      s.setDate(s.getDate() - 1);
      const yEnd = new Date(s);
      yEnd.setDate(yEnd.getDate() + 1);
      return { start: s.toISOString(), end: yEnd.toISOString() };
    }
    case 'last7': {
      start.setDate(start.getDate() - 7);
      break;
    }
    case 'last30': {
      start.setDate(start.getDate() - 30);
      break;
    }
    default: {
      start.setHours(0, 0, 0, 0);
    }
  }

  return { start: start.toISOString(), end: end.toISOString() };
}

function ymdYesterday(now) {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return ymdFromLocalDate(d);
}

/**
 * @returns {{ kind: 'single', d: string } | { kind: 'span', from: string, to: string }}
 */
export function getRangeDisplayYmds(value, now = new Date()) {
  if (value === 'last7' || value === 'last30') {
    return { kind: 'span', ...presetSpanYmds(value, now) };
  }
  if (isSpanRangeValue(value)) {
    const p = parseSpanRangeValue(value);
    if (p) return { kind: 'span', from: p.from, to: p.to };
  }
  if (isCustomDayRangeValue(value)) {
    return { kind: 'single', d: customDayYmd(value) };
  }
  if (value === 'today') {
    return { kind: 'single', d: ymdFromLocalDate(now) };
  }
  if (value === 'yesterday') {
    return { kind: 'single', d: ymdYesterday(now) };
  }
  return { kind: 'single', d: ymdFromLocalDate(now) };
}

/**
 * @param {object} props
 * @param {string} props.value
 * @param {(v: string) => void} props.onChange
 * @param {string[]} [props.ranges]
 * @param {unknown} [props.label]  `false` hides label
 * @param {number} [props.maxDayLookback=30]
 * @param {import('react').ReactNode} [props.rowExtra]
 */
export function RangePicker({
  value,
  onChange,
  ranges = RANGES,
  label = false,
  maxDayLookback = 30,
  rowExtra = null,
}) {
  const { t } = useTranslation();
  const now = new Date();
  const { minD, maxD } = boundsYmdForPicker(now, maxDayLookback);
  const display = getRangeDisplayYmds(value, now);

  const presetActive = ranges.includes(value) ? value : null;
  const parsedSpan = isSpanRangeValue(value) ? parseSpanRangeValue(value) : null;
  const showRangeUI = value === 'last7' || value === 'last30' || parsedSpan != null;

  const clampToBounds = (ymd) => {
    if (ymd < minD) return minD;
    if (ymd > maxD) return maxD;
    return ymd;
  };

  const emitSingle = (d) => {
    const y = clampToBounds(d);
    const todayY = ymdFromLocalDate(now);
    const yestY = ymdYesterday(now);
    if (y === todayY) onChange('today');
    else if (y === yestY) onChange('yesterday');
    else onChange(`${DAY_RANGE_PREFIX}${y}`);
  };

  const emitSpan = (from, to) => {
    let a = from <= to ? from : to;
    let b = from <= to ? to : from;
    if (a < minD) a = minD;
    if (b > maxD) b = maxD;
    if (a > b) [a, b] = [b, a];
    onChange(formatSpanRangeValue(a, b));
  };

  const onPrev = () => {
    if (display.kind === 'single') {
      const next = ymdAddDays(display.d, -1);
      if (next && next >= minD) emitSingle(next);
      return;
    }
    const { from, to } = display;
    const nf = ymdAddDays(from, -1);
    const nt = ymdAddDays(to, -1);
    if (nf && nt && nf >= minD) {
      emitSpan(nf, nt);
    }
  };

  const onNext = () => {
    if (display.kind === 'single') {
      const next = ymdAddDays(display.d, 1);
      if (next && next <= maxD) emitSingle(next);
      return;
    }
    const { from, to } = display;
    const nf = ymdAddDays(from, 1);
    const nt = ymdAddDays(to, 1);
    if (nf && nt && nt <= maxD) {
      emitSpan(nf, nt);
    }
  };

  const prevDisabled =
    display.kind === 'single'
      ? display.d <= minD
      : display.from <= minD;
  const nextDisabled =
    display.kind === 'single'
      ? display.d >= maxD
      : display.to >= maxD;

  const onRangeModeChange = (checked) => {
    if (checked) {
      if (value === 'last7' || value === 'last30') {
        return;
      }
      if (display.kind === 'single') {
        const d = display.d;
        onChange(formatSpanRangeValue(d, d));
        return;
      }
      return;
    }
    if (value === 'last7' || value === 'last30') {
      const { to } = presetSpanYmds(value, now);
      emitSingle(to);
      return;
    }
    if (isSpanRangeValue(value)) {
      const p = parseSpanRangeValue(value);
      if (p) emitSingle(p.to);
    }
  };

  const rangeSwitchChecked = showRangeUI;
  const rangeSwitchDisabled = value === 'last7' || value === 'last30';

  const centerDates = (
    <Box
      sx={{
        display: 'inline-flex',
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'nowrap',
        justifyContent: 'center',
        gap: 1,
        minWidth: 0,
        flexShrink: 0,
      }}
    >
      <Tooltip title={t('range.prev')}>
        <span>
          <IconButton
            size="small"
            onClick={onPrev}
            disabled={prevDisabled}
            aria-label={t('range.prevAria')}
            sx={{ flexShrink: 0 }}
          >
            <ChevronLeft fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      {showRangeUI ? (
        <>
          <TextField
            type="date"
            size="small"
            value={display.from}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const vv = clampToBounds(v);
              emitSpan(vv, display.to);
            }}
            inputProps={{ min: minD, max: maxD }}
            sx={{
              flexShrink: 0,
              width: 158,
              minWidth: 158,
              '& .MuiOutlinedInput-root': { height: 32, alignItems: 'center' },
            }}
          />
          <Typography
            variant="body2"
            color="text.secondary"
            component="span"
            sx={{ flexShrink: 0, alignSelf: 'center' }}
          >
            {t('range.rangeTo')}
          </Typography>
          <TextField
            type="date"
            size="small"
            value={display.to}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const vv = clampToBounds(v);
              emitSpan(display.from, vv);
            }}
            inputProps={{ min: minD, max: maxD }}
            sx={{
              flexShrink: 0,
              width: 158,
              minWidth: 158,
              '& .MuiOutlinedInput-root': { height: 32, alignItems: 'center' },
            }}
          />
        </>
      ) : (
        <TextField
          type="date"
          size="small"
          value={display.d}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            emitSingle(v);
          }}
          inputProps={{ min: minD, max: maxD }}
          sx={{
            flexShrink: 0,
            width: 158,
            minWidth: 158,
            '& .MuiOutlinedInput-root': { height: 32, alignItems: 'center' },
          }}
        />
      )}
      <Tooltip title={t('range.next')}>
        <span>
          <IconButton
            size="small"
            onClick={onNext}
            disabled={nextDisabled}
            aria-label={t('range.nextAria')}
            sx={{ flexShrink: 0 }}
          >
            <ChevronRight fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={rangeSwitchChecked}
            disabled={rangeSwitchDisabled}
            onChange={(_, c) => onRangeModeChange(c)}
          />
        }
        label={t('range.dateRange')}
        sx={{
          m: 0,
          flexShrink: 0,
          '& .MuiFormControlLabel-label': { fontSize: '0.8125rem' },
        }}
      />
    </Box>
  );

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'nowrap',
        alignItems: 'center',
        gap: 1.5,
        width: '100%',
        minWidth: 0,
        py: 0.25,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        '& .MuiTypography-body2': { lineHeight: 1.2 },
      }}
    >
      {label !== false && (
        <Typography
          variant="body2"
          color="text.secondary"
          component="span"
          sx={{ flexShrink: 0, lineHeight: 1.2, alignSelf: 'center' }}
        >
          {label ?? t('range.label')}
        </Typography>
      )}
      <ToggleButtonGroup
        value={presetActive}
        exclusive
        size="small"
        onChange={(_, v) => v && onChange(v)}
        sx={{ flexShrink: 0 }}
      >
        {ranges.map((r) => (
          <ToggleButton key={r} value={r}>
            {t(`range.${r}`)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {centerDates}
      {rowExtra != null && (
        <Box
          sx={{
            display: 'inline-flex',
            flexDirection: 'row',
            alignItems: 'center',
            flexShrink: 0,
            flexWrap: 'nowrap',
            gap: 1.5,
            marginLeft: 'auto',
          }}
        >
          {rowExtra}
        </Box>
      )}
    </Box>
  );
}
