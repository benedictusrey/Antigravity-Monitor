/**
 * Daily usage accounting, shared by the extension and the companion dashboard.
 *
 * Kept free of `vscode` so both hosts can record the same numbers the same way:
 * a token recorded in one place must never disagree with the other.
 */

import { recentDayKeys, toDayKey } from './format';
import { estimateCost } from './models';

export interface UsageRecord {
  day: string;
  modelId: string | null;
  input: number;
  cacheRead: number;
  cacheCreate: number;
  output: number;
}

export interface UsageBucket {
  input: number;
  cacheRead: number;
  cacheCreate: number;
  output: number;
}

export interface UsageDay {
  day: string;
  tokens: number;
  costUsd: number | null;
}

export interface UsageSummary {
  days: UsageDay[];
  todayTokens: number;
  todayCostUsd: number | null;
  monthTokens: number;
  monthCostUsd: number | null;
  /** False when no model in the window has a published rate. */
  priced: boolean;
}

export const EMPTY_BUCKET: UsageBucket = { input: 0, cacheRead: 0, cacheCreate: 0, output: 0 };

export function usageKey(day: string, modelId: string | null): string {
  return `${day}|${modelId ?? 'unknown'}`;
}

/** Add one observation, clamping negatives so a rewind can never subtract. */
export function addUsage(buckets: Map<string, UsageBucket>, record: UsageRecord): void {
  const key = usageKey(record.day, record.modelId);
  const existing = buckets.get(key) ?? { ...EMPTY_BUCKET };
  buckets.set(key, {
    input: existing.input + Math.max(0, record.input),
    cacheRead: existing.cacheRead + Math.max(0, record.cacheRead),
    cacheCreate: existing.cacheCreate + Math.max(0, record.cacheCreate),
    output: existing.output + Math.max(0, record.output),
  });
}

/** Summarise the trailing window plus the current calendar month. */
export function summariseUsage(
  buckets: ReadonlyMap<string, UsageBucket>,
  days = 14,
  nowMs = Date.now(),
): UsageSummary {
  const keys = recentDayKeys(days, nowMs);
  const monthPrefix = toDayKey(nowMs).slice(0, 7);
  const byDay = new Map<string, { tokens: number; cost: number | null }>();
  for (const key of keys) {
    byDay.set(key, { tokens: 0, cost: null });
  }

  let monthTokens = 0;
  let monthCost: number | null = null;
  let priced = false;

  for (const [key, bucket] of buckets) {
    const separator = key.indexOf('|');
    if (separator < 0) {
      continue;
    }
    const day = key.slice(0, separator);
    const modelId = key.slice(separator + 1);
    const tokens = bucket.input + bucket.cacheRead + bucket.cacheCreate + bucket.output;
    const cost = estimateCost({ input: bucket.input, cacheRead: bucket.cacheRead, output: bucket.output }, modelId);

    if (day.startsWith(monthPrefix)) {
      monthTokens += tokens;
      if (cost !== null) {
        monthCost = (monthCost ?? 0) + cost;
        priced = true;
      }
    }

    const entry = byDay.get(day);
    if (!entry) {
      continue;
    }
    entry.tokens += tokens;
    if (cost !== null) {
      entry.cost = (entry.cost ?? 0) + cost;
    }
  }

  const series: UsageDay[] = keys.map((key) => {
    const entry = byDay.get(key) ?? { tokens: 0, cost: null };
    return { day: key, tokens: entry.tokens, costUsd: entry.cost };
  });
  const today = series[series.length - 1];

  return {
    days: series,
    todayTokens: today?.tokens ?? 0,
    todayCostUsd: today?.costUsd ?? null,
    monthTokens,
    monthCostUsd: monthCost,
    priced,
  };
}

/** Empty summary used before any observation has been made. */
export function emptyUsage(days = 14, nowMs = Date.now()): UsageSummary {
  return summariseUsage(new Map(), days, nowMs);
}
