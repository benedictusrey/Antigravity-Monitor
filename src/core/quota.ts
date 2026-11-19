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

const STOP_TOKENS = new Set([
  'gemini', 'claude', 'gpt', 'openai', 'models', 'model', 'quota', 'quotas', 'limit', 'limits', 'pool', 'for',
]);

function normalizeBucketWindow(value: unknown): QuotaBucket['window'] | null {
  const key = asString(value)?.toLowerCase().trim();
  if (!key) return null;
  if (key === 'weekly' || key === 'week' || key === '7d' || key === '1w') return 'weekly';
  if (key === '5h' || key === 'five_hour' || key === '5_hour' || key === 'five-hour' || key === '5-hour' || key === 'session') return '5h';
  return null;
}

/** Parse the same grouped RPC response used by Antigravity's Usage menu. */
export function parseQuotaSummary(payload: unknown): QuotaGroup[] {
  const groups: QuotaGroup[] = [];
  const rawGroups = dig(payload, 'response', 'groups') ?? dig(payload, 'groups');
  for (const value of asArray(rawGroups).slice(0, 24)) {
    const group = asRecord(value);
    const label = group ? asString(group.displayName) : null;
    if (!group || !label) continue;
    const buckets: QuotaBucket[] = [];
    for (const raw of asArray(group.buckets).slice(0, 16)) {
      const bucket = asRecord(raw);
      const win = bucket ? normalizeBucketWindow(bucket.window) : null;
      if (!bucket || !win) continue;
      const fraction = finiteNumber(bucket.remainingFraction);
      const reset = asString(bucket.resetTime);
      buckets.push({
        id: (asString(bucket.bucketId) ?? win).slice(0, 160),
        window: win,
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

function stripEffortModifiers(name: string): string {
  return name
    .replace(/\s*\((?:high|medium|low|xhigh|thinking)\)\s*/gi, ' ')
    .replace(/\s+(?:high|medium|low|xhigh|thinking)\s*$/i, '')
    .trim();
}

function normalizeWords(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isGenericFamilyGroup(group: QuotaGroup): boolean {
  return /\bmodels\b/i.test(group.label) || /^gemini$/i.test(group.label.trim()) || /claude|gpt/i.test(group.label);
}

function dedicatedTokens(group: QuotaGroup): string[] {
  if (isGenericFamilyGroup(group)) return [];
  return normalizeWords(group.label)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_TOKENS.has(token) && !/^\d+$/.test(token));
}

function isDedicatedGroup(group: QuotaGroup): boolean {
  return dedicatedTokens(group).length > 0;
}

function describedMembers(group: QuotaGroup): string[] {
  const match = /models within this group:\s*([^.;]+)/i.exec(group.description ?? '');
  if (!match) return [];
  return match[1]
    .split(',')
    .map((entry) => normalizeWords(stripEffortModifiers(entry)))
    .filter((entry) => entry.length >= 3);
}

function modelMatchesDedicated(group: QuotaGroup, modelName: string): boolean {
  const tokens = dedicatedTokens(group);
  if (tokens.length === 0) return false;
  const hay = ` ${normalizeWords(modelName)} `;
  return tokens.every((token) => hay.includes(` ${token} `));
}

function inferModelFamily(modelName: string): 'gemini' | 'third-party' | null {
  if (/gemini/i.test(modelName)) return 'gemini';
  if (/claude|gpt|openai|opus|sonnet|anthropic|\bo[134]\b/i.test(modelName)) return 'third-party';
  return null;
}

function groupMatchesFamily(group: QuotaGroup, family: 'gemini' | 'third-party'): boolean {
  if (family === 'gemini') {
    return !isDedicatedGroup(group) && (/gemini/i.test(group.label) || group.buckets.some((bucket) => /^gemini-/.test(bucket.id)));
  }
  return /claude|gpt/i.test(group.label) || group.buckets.some((bucket) => /^3p-/.test(bucket.id));
}

function isCompatibleWithModel(group: QuotaGroup, modelName: string | null | undefined, dedicatedMatches: QuotaGroup[]): boolean {
  if (!modelName) return true;
  if (dedicatedMatches.length > 0) {
    return dedicatedMatches.includes(group);
  }
  if (isDedicatedGroup(group)) {
    return modelMatchesDedicated(group, modelName);
  }
  const family = inferModelFamily(modelName);
  return family ? groupMatchesFamily(group, family) : true;
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

  const dedicatedMatches = modelName ? groups.filter((group) => modelMatchesDedicated(group, modelName)) : [];

  if (modelName) {
    const cleanModel = normalizeWords(stripEffortModifiers(modelName));
    if (cleanModel) {
      const explicitMatches = groups.filter((group) =>
        describedMembers(group).some((member) => cleanModel === member || cleanModel.startsWith(`${member} `)),
      );
      if (explicitMatches.length === 1) return explicitMatches[0];
    }
    if (dedicatedMatches.length === 1) return dedicatedMatches[0];
  }

  if (hint?.resetsAt) {
    const hintMs = Date.parse(hint.resetsAt);
    if (Number.isFinite(hintMs)) {
      let candidates = groups.filter((group) =>
        group.buckets.some((bucket) => bucket.resetsAt && Math.abs(Date.parse(bucket.resetsAt) - hintMs) <= 120_000),
      );
      if (candidates.length > 1 && typeof hint.percent === 'number') {
        const byPercent = candidates.filter((group) =>
          group.buckets.some((bucket) => bucket.percent !== null && Math.abs(bucket.percent - hint.percent!) <= 2),
        );
        if (byPercent.length > 0) candidates = byPercent;
      }
      if (candidates.length > 1 && modelName) {
        const compatible = candidates.filter((group) => isCompatibleWithModel(group, modelName, dedicatedMatches));
        if (compatible.length > 0) candidates = compatible;
      }
      if (candidates.length === 1) return candidates[0];
    }
  }

  if (!modelName) return null;
  const family = inferModelFamily(modelName);
  if (!family) return null;
  const matches = groups.filter((group) => groupMatchesFamily(group, family));
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
