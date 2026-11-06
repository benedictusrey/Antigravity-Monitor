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
}

export interface PickerModel {
  modelId: string | null;
  label: string;
  quotaPercent: number | null;
  resetsAt: string | null;
  contextLimit: number | null;
  maxOutput: number | null;
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
  MODEL_PLACEHOLDER_M318: { name: 'Gemini 3.8 Flash (High)', contextLimit: 1_048_576, maxOutput: 65_536, thinking: true },
  MODEL_PLACEHOLDER_M319: { name: 'Gemini 3.8 Flash (Medium)', contextLimit: 1_048_576, maxOutput: 65_536, thinking: true },
  MODEL_PLACEHOLDER_M320: { name: 'Gemini 3.8 Flash (Low)', contextLimit: 1_048_576, maxOutput: 65_536, thinking: true },
  MODEL_PLACEHOLDER_M322: { name: 'Gemini 3.8 Flash', contextLimit: 1_048_576, maxOutput: 65_536, thinking: true },
  MODEL_PLACEHOLDER_M421: { name: 'Gemini 4 Argon', contextLimit: 1_048_576, maxOutput: 65_536, thinking: true },
  MODEL_PLACEHOLDER_M26: { name: 'Claude Opus 4.6 (Thinking)', contextLimit: 250_000, maxOutput: 64_000, thinking: true },
  MODEL_PLACEHOLDER_M35: { name: 'Claude Sonnet 4.6 (Thinking)', contextLimit: 250_000, maxOutput: 64_000, thinking: true },
  MODEL_PLACEHOLDER_M21: { name: 'Gemini 3.1 Flash Image', contextLimit: 65_536, maxOutput: 65_536, thinking: null },
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
  MODEL_PLACEHOLDER_M421: 'gemini-4-argon',
};

/** Short, stable label used when the catalogue has no display name. */
export function shortModelId(id: string): string {
  return id.replace(/^MODEL_PLACEHOLDER_/, '');
}

/**
 * Build a lookup keyed by backend placeholder id from a `GetAvailableModels`
 * response. Entries that carry neither a display name nor a usable capacity are
 * still recorded, so the id is known to exist even if it is not renderable.
 */
export function buildCatalog(payload: unknown): Map<string, ModelSpec> {
  const catalog = new Map<string, ModelSpec>();
  const models = asRecord(dig(payload, 'response', 'models'));
  if (!models) {
    return catalog;
  }

  for (const entry of Object.values(models)) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const id = firstString(record.model);
    if (!id) {
      continue;
    }
    const contextLimit = safeInt(record.maxTokens);
    const maxOutput = safeInt(record.maxOutputTokens);
    const displayName = firstString(record.displayName);
    const thinking = typeof record.supportsThinking === 'boolean' ? record.supportsThinking : null;

    // A later catalogue entry for the same placeholder should not erase a
    // display name or capacity that an earlier one supplied.
    const existing = catalog.get(id);
    const next: ModelSpec = {
      id,
      name: displayName ?? existing?.name ?? shortModelId(id),
      contextLimit: contextLimit ?? existing?.contextLimit ?? null,
      maxOutput: maxOutput ?? existing?.maxOutput ?? null,
      thinking: thinking ?? existing?.thinking ?? null,
      source: 'live',
    };
    if (!existing || scoreModel(next) >= scoreModel(existing)) {
      catalog.set(id, next);
    }
  }

  return catalog;
}

function scoreModel(spec: ModelSpec): number {
  let score = 0;
  if (spec.name !== shortModelId(spec.id)) {
    score += 4;
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
  const live = catalog.get(id);
  if (live) {
    return live;
  }
  const fallback = FALLBACK_MODELS[id];
  if (fallback) {
    return { id, ...fallback, source: 'fallback' };
  }
  return { id, name: shortModelId(id), contextLimit: null, maxOutput: null, thinking: null, source: 'unknown' };
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
    const modelId = firstString(dig(record, 'modelOrAlias', 'model'));
    const label = firstString(record.label, record.modelId) ?? (modelId ? shortModelId(modelId) : null);
    if (!label) {
      continue;
    }
    const fraction = finiteNumber(dig(record, 'quotaInfo', 'remainingFraction'));
    const spec = resolveModel(modelId, catalog);
    picker.push({
      modelId,
      label,
      quotaPercent: fraction === null ? null : clampPercent(fraction * 100),
      resetsAt: asString(dig(record, 'quotaInfo', 'resetTime')),
      contextLimit: spec?.contextLimit ?? null,
      maxOutput: spec?.maxOutput ?? null,
    });
  }

  return { account, picker };
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

/** Resolve the applicable price for a model at a given instant. */
export function priceFor(modelId: string | null, atMs = Date.now()): Price | null {
  if (!modelId) {
    return null;
  }
  const family = PRICE_FAMILY_BY_MODEL[modelId];
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
export function estimateCost(tokens: TokenCounts, modelId: string | null, atMs = Date.now()): number | null {
  const price = priceFor(modelId, atMs);
  if (!price) {
    return null;
  }
  const fresh = (tokens.input / 1_000_000) * price.input;
  const cached = (tokens.cacheRead / 1_000_000) * price.cacheRead;
  const output = (tokens.output / 1_000_000) * price.output;
  return fresh + cached + output;
}

/** True when at least one currently priced model exists in the catalogue. */
export function hasPricedModel(modelIds: Array<string | null>): boolean {
  return modelIds.some((id) => priceFor(id) !== null);
}
