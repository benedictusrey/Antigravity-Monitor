/**
 * Presentation helpers.
 *
 * Deliberately locale-pinned to `en` so that numbers, dates, and durations read
 * identically in the status bar, the tooltip, and the dashboard regardless of
 * the host operating system's regional settings.
 */

const LOCALE = 'en-US';

const integerFormatter = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  // A grouped decimal would render 999.999 as "1,000.0k"; grouping only makes
  // sense for whole numbers, so the compact formatter opts out.
  useGrouping: false,
});

/** Placeholder rendered wherever a value is genuinely unknown. */
export const EMPTY = '\u2014';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Compact token count: `842`, `16.4k`, `1.0M`.
 *
 * One decimal is kept for the `k` and `M` ranges so that `1.0M` stays visibly
 * distinct from `999.0k`, and so the magnitude never has to be inferred.
 */
export function formatTokens(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) {
    return EMPTY;
  }
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs < 1000) {
    return sign + integerFormatter.format(Math.round(abs));
  }
  if (abs < 1_000_000) {
    return `${sign}${decimalFormatter.format(abs / 1000)}k`;
  }
  if (abs < 1_000_000_000) {
    return `${sign}${decimalFormatter.format(abs / 1_000_000)}M`;
  }
  return `${sign}${decimalFormatter.format(abs / 1_000_000_000)}B`;
}

/** Exact token count with thousands separators, for detail rows. */
export function formatExact(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) {
    return EMPTY;
  }
  return integerFormatter.format(Math.round(value));
}

/** Percentage with a single decimal: `16.7%`. */
export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (!isFiniteNumber(value)) {
    return EMPTY;
  }
  const clamped = Math.max(0, value);
  if (clamped >= 100) {
    return '100%';
  }
  const text = clamped.toFixed(digits);
  // Trim a trailing `.0` at small magnitudes where it adds no information.
  return `${text.replace(/\.0$/, '')}%`;
}

/** Whole percentage for quota-style bars: `84%`. */
export function formatPercentWhole(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) {
    return EMPTY;
  }
  return `${Math.round(Math.max(0, Math.min(100, value)))}%`;
}

/** Elapsed duration in a form suited to a log line: `820ms`, `1.4s`, `2m 05s`. */
export function formatDuration(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms) || ms < 0) {
    return EMPTY;
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) {
    return `${decimalFormatter.format(ms / 1000)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** Countdown to an absolute timestamp: `4h 06m`, `3d 2h`, `<1m`. */
export function formatCountdown(targetMs: number, nowMs = Date.now()): string {
  if (!isFiniteNumber(targetMs)) {
    return EMPTY;
  }
  const remaining = targetMs - nowMs;
  if (remaining <= 0) {
    return 'now';
  }
  const totalMinutes = Math.floor(remaining / 60000);
  if (totalMinutes < 1) {
    return '<1m';
  }
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** Wall-clock time for "last updated" stamps: `15:42:07`. */
export function formatTime(iso: string | number | null | undefined): string {
  const date = toDate(iso);
  if (!date) {
    return EMPTY;
  }
  return date.toLocaleTimeString(LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** Calendar day header: `2 Nov 2026`. */
export function formatDate(iso: string | number | null | undefined): string {
  const date = toDate(iso);
  if (!date) {
    return EMPTY;
  }
  return date.toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Compact weekday label for chart axes: `Mon`. */
export function formatWeekday(iso: string | number | null | undefined): string {
  const date = toDate(iso);
  if (!date) {
    return EMPTY;
  }
  return date.toLocaleDateString(LOCALE, { weekday: 'short' });
}

/** Relative age such as `just now`, `4m ago`, `2h ago`. */
export function formatAge(iso: string | number | null | undefined, nowMs = Date.now()): string {
  const date = toDate(iso);
  if (!date) {
    return EMPTY;
  }
  const delta = nowMs - date.getTime();
  if (delta < 45_000) {
    return 'just now';
  }
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

/** US-dollar amount for estimates: `$0.42`, `$1,204.10`. */
export function formatUsd(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) {
    return EMPTY;
  }
  if (value > 0 && value < 0.01) {
    return '<$0.01';
  }
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** `2026-11-02` in local time — the storage key for daily usage buckets. */
export function toDayKey(value: Date | number = Date.now()): string {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Build the trailing `count` day keys, oldest first, ending today. */
export function recentDayKeys(count: number, nowMs = Date.now()): string[] {
  const keys: string[] = [];
  const base = new Date(nowMs);
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() - offset);
    keys.push(toDayKey(day));
  }
  return keys;
}

function toDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? new Date(value) : null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}
