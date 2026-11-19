/**
 * Model identity, context capacity, quotas, and API-equivalent pricing.
 *
 * Capacity is read from the live catalogue (`GetAvailableModels`), because the
 * installed IDE is the only authority on what the current build allows. The
 * static table below exists solely to keep the UI legible while the catalogue is
 * still loading or when an account exposes a model the catalogue omits; it is
 * never preferred over live data.
 */

import { asArray, asRecord, asString, dig, finiteNumber, firstString, safeInt } from './values';

export interface ModelSpec {
  /** Backend placeholder id, e.g. `MODEL_PLACEHOLDER_M318`. */
  id: string;
  /** Human-readable label, e.g. `Gemini 3.8 Flash (High)`. */
  name: string;
  contextLimit: number | null;
  maxOutput: number | null;
  thinking: boolean | null;
  source: 'live' | 'fallback' | 'unknown';
  tag?: string | null;
  provider?: string | null;
  isInternal?: boolean;
}

export interface PickerModel {
  modelId: string | null;
  label: string;
  quotaPercent: number | null;
  resetsAt: string | null;
  contextLimit: number | null;
  maxOutput: number | null;
  tag?: string | null;
}

export interface AccountInfo {
  name: string | null;
  email: string | null;
  planName: string | null;
  tierName: string | null;
  monthlyPromptCredits: number | null;
  monthlyFlowCredits: number | null;
}

export interface UserStatusSummary {
  account: AccountInfo | null;
  picker: PickerModel[];
}

export interface TokenCounts {
  input: number;
  cacheRead: number;
  output: number;
}

export interface Price {
  /** USD per million fresh input tokens. */
  input: number;
  /** USD per million output tokens, including thinking. */
  output: number;
  /** USD per million cache-read tokens. */
  cacheRead: number;
}

interface DatedPrice {
  /** ISO date from which this rate applies. */
  since: string;
  price: Price;
}

/**
 * Static fallbacks for placeholders observed in Antigravity 2.28.2.
 * Kept intentionally short: an unknown model degrades to "capacity unknown"
 * rather than borrowing another model's limit.
 */
const FALLBACK_MODELS: Record<string, Omit<ModelSpec, 'id' | 'source'>> = {
  MODEL_PLACEHOLDER_M18: { name: 'Gemini 3 Flash', contextLimit: 1_048_576, maxOutput: 65_536, thinking: true },
  MODEL_PLACEHOLDER_M21: { name: 'Gemini 3.1 Flash Image', contextLimit: 65_536, maxOutput: 65_536, thinking: null },
  MODEL_PLACEHOLDER_M26: { name: 'Claude Opus 4.6 (Thinking)', contextLimit: 250_000, maxOutput: 64_000, thinking: true },
  MODEL_PLACEHOLDER_M35: { name: 'Claude Sonnet 4.6 (Thinking)', contextLimit: 250_000, maxOutput: 64_000, thinking: true },
  MODEL_PLACEHOLDER_M50: { name: 'Gemini 3.1 Flash Lite', contextLimit: 1_048_576, maxOutput: 65_535, thinking: true },
  MODEL_PLACEHOLDER_M198: { name: 'Gemini 3.5 Flash Lite', contextLimit: 1_048_576, maxOutput: 65_535, thinking: true },
  MODEL_PLACEHOLDER_M318: { name: 'Gemini 3.8 Flash (High)', contextLimit: 1_048_576, maxOutput: 65_536, thinking: true },
  MODEL_PLACEHOLDER_M319: { name: 'Gemini 3.8 Flash (Medium)', contextLimit: 1_048_576, maxOutput: 65_536, thinking: true },
  MODEL_PLACEHOLDER_M320: { name: 'Gemini 3.8 Flash (Low)', contextLimit: 1_048_576, maxOutput: 65_536, thinking: true },
  MODEL_PLACEHOLDER_M322: { name: 'Gemini 3.8 Flash', contextLimit: 1_048_576, maxOutput: 65_536, thinking: true },
  MODEL_PLACEHOLDER_M400: { name: 'Claude Opus 5.5 (Low)', contextLimit: 1_000_000, maxOutput: 128_000, thinking: true },
  MODEL_PLACEHOLDER_M401: { name: 'Claude Opus 5.5 (Medium)', contextLimit: 1_000_000, maxOutput: 128_000, thinking: true },
  MODEL_PLACEHOLDER_M402: { name: 'Claude Opus 5.5 (High)', contextLimit: 1_000_000, maxOutput: 128_000, thinking: true },
  MODEL_PLACEHOLDER_M403: { name: 'Claude Sonnet 5.5 (Low)', contextLimit: 1_000_000, maxOutput: 128_000, thinking: true },
  MODEL_PLACEHOLDER_M404: { name: 'Claude Sonnet 5.5 (Medium)', contextLimit: 1_000_000, maxOutput: 128_000, thinking: true },
  MODEL_PLACEHOLDER_M405: { name: 'Claude Sonnet 5.5 (High)', contextLimit: 1_000_000, maxOutput: 128_000, thinking: true },
  MODEL_PLACEHOLDER_M417: { name: 'Gemini 4 Argon (High)', contextLimit: 1_048_576, maxOutput: 65_536, thinking: true },
  MODEL_PLACEHOLDER_M418: { name: 'Gemini 4 Argon (Medium)', contextLimit: 1_048_576, maxOutput: 65_536, thinking: true },
  MODEL_PLACEHOLDER_M419: { name: 'Gemini 4 Argon (Low)', contextLimit: 1_048_576, maxOutput: 65_536, thinking: true },
  MODEL_PLACEHOLDER_M421: { name: 'Gemini 4 Argon', contextLimit: 1_048_576, maxOutput: 65_536, thinking: true },
  MODEL_PLACEHOLDER_M525: { name: 'Gemini 4 Hydrogen (High)', contextLimit: 1_048_576, maxOutput: 262_144, thinking: true },
  MODEL_PLACEHOLDER_M526: { name: 'Gemini 4 Hydrogen (Medium)', contextLimit: 1_048_576, maxOutput: 262_144, thinking: true },
  MODEL_PLACEHOLDER_M527: { name: 'Gemini 4 Hydrogen (Low)', contextLimit: 1_048_576, maxOutput: 262_144, thinking: true },
  MODEL_PLACEHOLDER_M528: { name: 'Gemini 4 Hydrogen (XHigh)', contextLimit: 1_048_576, maxOutput: 262_144, thinking: true },
  MODEL_PLACEHOLDER_M530: { name: 'Gemini 4 Hydrogen (High)', contextLimit: 1_048_576, maxOutput: 262_144, thinking: true },
  MODEL_PLACEHOLDER_M531: { name: 'Gemini 4 Hydrogen (XHigh)', contextLimit: 1_048_576, maxOutput: 262_144, thinking: true },
  MODEL_PLACEHOLDER_M532: { name: 'Gemini 4 Neon (High)', contextLimit: 1_048_576, maxOutput: 262_144, thinking: true },
  MODEL_PLACEHOLDER_M533: { name: 'Gemini 4 Neon (Medium)', contextLimit: 1_048_576, maxOutput: 262_144, thinking: true },
  MODEL_PLACEHOLDER_M534: { name: 'Gemini 4 Neon (Low)', contextLimit: 1_048_576, maxOutput: 262_144, thinking: true },
  MODEL_PLACEHOLDER_M535: { name: 'Gemini 4 Neon (XHigh)', contextLimit: 1_048_576, maxOutput: 262_144, thinking: true },
  MODEL_PLACEHOLDER_M537: { name: 'Orchestrator (Neon)', contextLimit: 1_048_576, maxOutput: 262_144, thinking: true },
  MODEL_PLACEHOLDER_M578: { name: 'Gemini 4 Hydrogen Sonar', contextLimit: 1_048_576, maxOutput: 65_536, thinking: true },
  MODEL_PLACEHOLDER_M668: { name: 'Orchestrator (Argon)', contextLimit: 1_048_576, maxOutput: 65_536, thinking: true },
  MODEL_PLACEHOLDER_M669: { name: 'Gemini 4 Hydrogen (Orchestrator)', contextLimit: 1_048_576, maxOutput: 262_144, thinking: true },
  MODEL_PLACEHOLDER_M670: { name: 'Gemini 4 Carbon', contextLimit: 1_048_576, maxOutput: 262_144, thinking: true },
  MODEL_OPENAI_GPT_OSS_120B_MEDIUM: { name: 'GPT-OSS 120B (Medium)', contextLimit: 131_072, maxOutput: 32_768, thinking: true },
};

/**
 * Published Google Standard API rates, in USD per million tokens.
 *
 * These are reference rates for *estimating* what the same traffic would cost
 * through the public API. They are not Antigravity subscription charges, and
 * models without a published rate resolve to `null` rather than a guess.
 */
const PRICE_SCHEDULE: Record<string, DatedPrice[]> = {
  'gemini-3.8-flash': [
    { since: '2000-01-01', price: { input: 0.75, output: 3.75, cacheRead: 0.075 } },
    { since: '2027-01-01', price: { input: 1.5, output: 7.5, cacheRead: 0.15 } },
  ],
  'gemini-4-argon': [
    { since: '2000-01-01', price: { input: 2, output: 10, cacheRead: 0.1 } },
    { since: '2026-12-01', price: { input: 4, output: 20, cacheRead: 0.2 } },
  ],
};

const PRICE_FAMILY_BY_MODEL: Record<string, string> = {
  MODEL_PLACEHOLDER_M318: 'gemini-3.8-flash',
  MODEL_PLACEHOLDER_M319: 'gemini-3.8-flash',
  MODEL_PLACEHOLDER_M320: 'gemini-3.8-flash',
  MODEL_PLACEHOLDER_M322: 'gemini-3.8-flash',
  MODEL_PLACEHOLDER_M417: 'gemini-4-argon',
  MODEL_PLACEHOLDER_M418: 'gemini-4-argon',
  MODEL_PLACEHOLDER_M419: 'gemini-4-argon',
  MODEL_PLACEHOLDER_M421: 'gemini-4-argon',
  MODEL_PLACEHOLDER_M668: 'gemini-4-argon',
};

/** Short, stable label used when the catalogue has no display name. */
export function shortModelId(id: string): string {
  return id.replace(/^MODEL_PLACEHOLDER_/, '');
}

const UPPERCASE_WORDS: Record<string, string> = {
  gpt: 'GPT',
  oss: 'OSS',
  ai: 'AI',
  xhigh: 'XHigh',
};

function humanizeSlug(slug: string): string | null {
  if (!slug || slug.length < 4 || !/[-_]/.test(slug)) return null;
  const tokens = slug
    .split(/[-_]+/)
    .filter((part) => part.length > 0 && !/^(?:tiered|disabled)$/i.test(part));
  if (tokens.length < 2) return null;
  return tokens
    .map((part) => {
      const lower = part.toLowerCase();
      if (UPPERCASE_WORDS[lower]) return UPPERCASE_WORDS[lower];
      if (/^\d+(?:\.\d+)?$/.test(part)) return part;
      if (/^\d+b$/i.test(part)) return part.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/**
 * Build a lookup keyed by backend placeholder id from a `GetAvailableModels`
 * response. Entries that carry neither a display name nor a usable capacity are
 * still recorded, so the id is known to exist even if it is not renderable.
 */
export function buildCatalog(payload: unknown): Map<string, ModelSpec> {
  const catalog = new Map<string, ModelSpec>();
  const models = asRecord(dig(payload, 'response', 'models') ?? dig(payload, 'models'));
  if (!models) {
    return catalog;
  }

  for (const [catalogKey, entry] of Object.entries(models)) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const id = firstString(record.model);
    if (!id) {
      continue;
    }
    const contextLimit = safeInt(record.maxTokens) ?? safeInt(record.maxContextTokens) ?? safeInt(record.contextLimit);
    const maxOutput = safeInt(record.maxOutputTokens);
    const displayName = firstString(record.displayName);
    const slugName = displayName ? null : humanizeSlug(catalogKey);
    const thinking = typeof record.supportsThinking === 'boolean' ? record.supportsThinking : null;
    const tag = firstString(record.tagTitle);
    const provider = firstString(record.modelProvider);
    const isInternal = record.isInternal === true;

    // A later catalogue entry for the same placeholder should not erase a
    // display name or capacity that an earlier one supplied.
    const existing = catalog.get(id);
    const next: ModelSpec = {
      id,
      name: displayName ?? existing?.name ?? slugName ?? shortModelId(id),
      contextLimit: contextLimit ?? existing?.contextLimit ?? null,
      maxOutput: maxOutput ?? existing?.maxOutput ?? null,
      thinking: thinking ?? existing?.thinking ?? null,
      source: 'live',
      tag: tag ?? existing?.tag ?? null,
      provider: provider ?? existing?.provider ?? null,
      isInternal: existing?.isInternal ?? isInternal,
    };
    const nextExplicit = Boolean(displayName);
    const prevExplicit = Boolean(existing && existing.name !== shortModelId(existing.id) && existing.name !== slugName);
    if (!existing || scoreModel(next, nextExplicit) >= scoreModel(existing, prevExplicit)) {
      catalog.set(id, next);
    }
  }

  return catalog;
}

function scoreModel(spec: ModelSpec, explicitName = false): number {
  let score = 0;
  if (explicitName) {
    score += 8;
  } else if (spec.name !== shortModelId(spec.id)) {
    score += 2;
  }
  if (spec.contextLimit !== null) {
    score += 2;
  }
  if (spec.maxOutput !== null) {
    score += 1;
  }
  return score;
}

/** Resolve a model id to a spec, falling back without inventing capacity. */
export function resolveModel(id: string | null | undefined, catalog: Map<string, ModelSpec>): ModelSpec | null {
  if (!id) {
    return null;
  }
  const fallback = FALLBACK_MODELS[id];
  const live = catalog.get(id);
  if (live) {
    if (live.name === shortModelId(live.id) && fallback) {
      return { ...live, name: fallback.name };
    }
    return live;
  }
  if (fallback) {
    return { id, ...fallback, source: 'fallback' };
  }
  return { id, name: shortModelId(id), contextLimit: null, maxOutput: null, thinking: null, source: 'unknown' };
}

/** Normalize a display name (e.g. `Gemini 4 Hydrogen High` vs `Gemini 4 Hydrogen (High)`). */
export function normalizeModelKey(name: string | null | undefined): string {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Match a UI-observed model label back to a canonical catalog or picker spec. */
export function matchModelByName(
  label: string | null | undefined,
  catalog: Map<string, ModelSpec>,
  picker: readonly PickerModel[] = [],
): ModelSpec | null {
  const target = normalizeModelKey(label);
  if (!target) {
    return null;
  }
  for (const entry of picker) {
    if (normalizeModelKey(entry.label) === target && entry.modelId) {
      return resolveModel(entry.modelId, catalog);
    }
  }
  for (const spec of catalog.values()) {
    if (normalizeModelKey(spec.name) === target) {
      return spec;
    }
  }
  for (const [id, spec] of Object.entries(FALLBACK_MODELS)) {
    if (normalizeModelKey(spec.name) === target) {
      return { id, ...spec, source: 'fallback' };
    }
  }
  return null;
}

/**
 * Extract the account block and the per-model picker (with quotas) from a
 * `GetUserStatus` response. Every field is optional in practice.
 */
export function parseUserStatus(payload: unknown, catalog: Map<string, ModelSpec>): UserStatusSummary {
  const status = asRecord(dig(payload, 'userStatus'));
  if (!status) {
    return { account: null, picker: [] };
  }

  const planInfo = asRecord(dig(status, 'planStatus', 'planInfo'));
  const tier = asRecord(status.userTier);
  const account: AccountInfo = {
    name: firstString(status.name),
    email: firstString(status.email),
    planName: planInfo ? firstString(planInfo.planName) : null,
    tierName: tier ? firstString(tier.name) : null,
    monthlyPromptCredits: planInfo ? safeInt(planInfo.monthlyPromptCredits) : null,
    monthlyFlowCredits: planInfo ? safeInt(planInfo.monthlyFlowCredits) : null,
  };

  const configs = asArray(dig(status, 'cascadeModelConfigData', 'clientModelConfigs'));
  const picker: PickerModel[] = [];

  for (const entry of configs) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const modelId = firstString(dig(record, 'modelOrAlias', 'model'), dig(record, 'modelOrAlias', 'alias'), record.modelId);
    const label = firstString(record.label, record.modelId) ?? (modelId ? shortModelId(modelId) : null);
    if (!label) {
      continue;
    }
    const fraction = finiteNumber(dig(record, 'quotaInfo', 'remainingFraction'));
    const spec = resolveModel(modelId, catalog);
    const tag = firstString(record.tagTitle) ?? spec?.tag ?? null;
    picker.push({
      modelId,
      label,
      quotaPercent: fraction === null ? null : clampPercent(fraction * 100),
      resetsAt: asString(dig(record, 'quotaInfo', 'resetTime')),
      contextLimit: spec?.contextLimit ?? safeInt(record.maxContextTokens) ?? safeInt(record.maxTokens) ?? null,
      maxOutput: spec?.maxOutput ?? safeInt(record.maxOutputTokens) ?? null,
      tag,
    });
  }

  return { account, picker };
}

/** Merge labels/tags from `GetUserStatus` picker into the live catalogue when missing. */
export function mergePickerIntoCatalog(catalog: Map<string, ModelSpec>, picker: readonly PickerModel[]): void {
  for (const entry of picker) {
    if (!entry.modelId) continue;
    const existing = catalog.get(entry.modelId);
    if (!existing) {
      catalog.set(entry.modelId, {
        id: entry.modelId,
        name: entry.label,
        contextLimit: entry.contextLimit,
        maxOutput: entry.maxOutput,
        thinking: null,
        source: 'live',
        tag: entry.tag ?? null,
      });
    } else if (existing.name === shortModelId(existing.id) || (entry.tag && !existing.tag)) {
      catalog.set(entry.modelId, {
        ...existing,
        name: existing.name === shortModelId(existing.id) ? entry.label : existing.name,
        tag: existing.tag ?? entry.tag ?? null,
      });
    }
  }
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** Remaining quota for a model id, if the picker reports one. */
export function quotaFor(modelId: string | null, picker: PickerModel[]): PickerModel | null {
  if (!modelId) {
    return null;
  }
  return picker.find((entry) => entry.modelId === modelId) ?? null;
}

function priceFamilyForName(modelName: string | null | undefined): string | null {
  const normalized = normalizeModelKey(modelName);
  if (!normalized) return null;
  if (normalized.includes('gemini38flash')) return 'gemini-3.8-flash';
  if (normalized.includes('argon')) return 'gemini-4-argon';
  return null;
}

/** Resolve the applicable price for a model at a given instant. */
export function priceFor(modelId: string | null, atMs = Date.now(), modelName?: string | null): Price | null {
  if (!modelId && !modelName) {
    return null;
  }
  const family = (modelId ? PRICE_FAMILY_BY_MODEL[modelId] : null) ?? priceFamilyForName(modelName);
  if (!family) {
    return null;
  }
  const schedule = PRICE_SCHEDULE[family];
  if (!schedule || schedule.length === 0) {
    return null;
  }
  const at = new Date(atMs).toISOString().slice(0, 10);
  let applicable: Price | null = null;
  for (const entry of schedule) {
    if (entry.since <= at) {
      applicable = entry.price;
    }
  }
  return applicable;
}

/**
 * Estimate API-equivalent cost for a set of token counts, or `null` when the
 * model has no published rate. Cache creation is intentionally excluded: the
 * backend does not report a cache lifetime, so its fee cannot be computed.
 */
export function estimateCost(
  tokens: TokenCounts,
  modelId: string | null,
  atMs = Date.now(),
  modelName?: string | null,
): number | null {
  const price = priceFor(modelId, atMs, modelName);
  if (!price) {
    return null;
  }
  const fresh = (tokens.input / 1_000_000) * price.input;
  const cached = (tokens.cacheRead / 1_000_000) * price.cacheRead;
  const output = (tokens.output / 1_000_000) * price.output;
  return fresh + cached + output;
}
