import { asArray, asRecord, asString, dig, finiteNumber } from './values';

export interface QuotaBucket {
  id: string;
  window: '5h' | 'weekly';
  percent: number | null;
  resetsAt: string | null;
  enabled: boolean;
}

export interface QuotaGroup {
  id: string;
  label: string;
  description?: string | null;
  buckets: QuotaBucket[];
}

export interface QuotaState {
  groups: QuotaGroup[];
  observedAt: number | null;
  status: 'live' | 'cached' | 'unavailable';
  error: string | null;
}

export const QUOTA_POLL_MS = 5_000;
export const QUOTA_LIVE_MS = 12_000;
export const QUOTA_EXPIRE_MS = 30_000;

export function emptyQuota(): QuotaState {
  return { groups: [], observedAt: null, status: 'unavailable', error: null };
}

/** Parse the same grouped RPC response used by Antigravity's Usage menu. */
export function parseQuotaSummary(payload: unknown): QuotaGroup[] {
  const groups: QuotaGroup[] = [];
  for (const value of asArray(dig(payload, 'response', 'groups')).slice(0, 24)) {
    const group = asRecord(value);
    const label = group ? asString(group.displayName) : null;
    if (!group || !label) continue;
    const buckets: QuotaBucket[] = [];
    for (const raw of asArray(group.buckets).slice(0, 16)) {
      const bucket = asRecord(raw);
      if (!bucket || (bucket.window !== 'weekly' && bucket.window !== '5h')) continue;
      const fraction = finiteNumber(bucket.remainingFraction);
      const reset = asString(bucket.resetTime);
      buckets.push({
        id: (asString(bucket.bucketId) ?? bucket.window).slice(0, 160),
        window: bucket.window,
        percent: fraction !== null && fraction >= 0 && fraction <= 1 ? fraction * 100 : null,
        resetsAt: reset && Number.isFinite(Date.parse(reset)) ? reset : null,
        enabled: bucket.disabled !== true,
      });
    }
    if (buckets.length) {
      const id = (asString(group.groupId) ?? label.toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 160);
      const description = asString(group.description)?.slice(0, 300) ?? null;
      if (!groups.some((entry) => entry.id === id)) {
        groups.push({ id, label: label.slice(0, 160), description, buckets });
      }
    }
  }
  return groups;
}

function isArgonGroup(group: QuotaGroup): boolean {
  return /argon/i.test(group.label) || group.buckets.some((bucket) => /argon/i.test(bucket.id));
}

function stripModelModifiers(modelName: string): string {
  return modelName
    .replace(/\s*\((?:high|medium|low|xhigh|thinking|orchestrator|argon)\)\s*/gi, ' ')
    .replace(/\s+(?:high|medium|low|xhigh|thinking|orchestrator)\s*$/i, '')
    .trim();
}

export interface QuotaGroupHint {
  resetsAt?: string | null;
  percent?: number | null;
}

/** Model families must never inherit another family's lower or fuller allowance. */
export function resolveQuotaGroup(
  groups: QuotaGroup[],
  modelName: string | null | undefined,
  hint?: QuotaGroupHint | null,
): QuotaGroup | null {
  if (!modelName && !hint?.resetsAt) return null;

  if (hint?.resetsAt) {
    const hintMs = Date.parse(hint.resetsAt);
    if (Number.isFinite(hintMs)) {
      const byReset = groups.filter((group) =>
        group.buckets.some((bucket) => bucket.resetsAt && Math.abs(Date.parse(bucket.resetsAt) - hintMs) <= 120_000),
      );
      if (byReset.length === 1) return byReset[0];
      if (byReset.length > 1 && typeof hint.percent === 'number') {
        const byPercent = byReset.filter((group) =>
          group.buckets.some((bucket) => bucket.percent !== null && Math.abs(bucket.percent - hint.percent!) <= 2),
        );
        if (byPercent.length === 1) return byPercent[0];
      }
    }
  }

  if (!modelName) return null;
  if (/argon/i.test(modelName)) {
    const argonMatches = groups.filter(isArgonGroup);
    return argonMatches.length === 1 ? argonMatches[0] : null;
  }

  const baseName = stripModelModifiers(modelName).toLowerCase();
  if (baseName.length >= 4) {
    const described = groups.filter(
      (group) => !isArgonGroup(group) && (group.description ?? '').toLowerCase().includes(baseName),
    );
    if (described.length === 1) return described[0];
  }

  const family = /gemini/i.test(modelName)
    ? 'gemini'
    : /claude|gpt|openai|opus|sonnet/i.test(modelName)
      ? 'third-party'
      : null;
  if (!family) return null;

  const matches = groups.filter((group) =>
    family === 'gemini'
      ? !isArgonGroup(group) && (/gemini/i.test(group.label) || group.buckets.some((bucket) => /^gemini-/.test(bucket.id)))
      : /claude|gpt/i.test(group.label) || group.buckets.some((bucket) => /^3p-/.test(bucket.id)),
  );
  return matches.length === 1 ? matches[0] : null;
}

export function quotaAt(state: QuotaState, now: number = Date.now()): QuotaState {
  const age = state.observedAt === null ? Infinity : now - state.observedAt;
  const status = age < 0 || age > QUOTA_EXPIRE_MS ? 'unavailable'
    : state.error || age > QUOTA_LIVE_MS ? 'cached' : 'live';
  return { ...state, status };
}

export function quotaBucket(
  state: QuotaState | null | undefined,
  modelName: string | null | undefined,
  window: QuotaBucket['window'],
  now: number = Date.now(),
  hint?: QuotaGroupHint | null,
): QuotaBucket | null {
  if (!state || quotaAt(state, now).status === 'unavailable') return null;
  const bucket = resolveQuotaGroup(state.groups, modelName, hint)?.buckets.find((entry) => entry.window === window);
  if (!bucket?.enabled || bucket.percent === null) return null;
  if (bucket.resetsAt && Date.parse(bucket.resetsAt) <= now) return null;
  return bucket;
}
