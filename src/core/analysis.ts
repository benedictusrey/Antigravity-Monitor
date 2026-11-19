/**
 * Trajectory analysis: turns an ordered step array into a context-window
 * reading.
 *
 * Two rules dominate the design.
 *
 * 1. Provider-reported counts beat estimates, and the *latest* valid
 *    `modelUsage` snapshot replaces earlier ones rather than accumulating. Each
 *    snapshot describes the entire prompt for that request, so adding snapshots
 *    together would double-count history.
 *
 * 2. Nothing is coerced. A malformed snapshot is skipped and counted, not read
 *    as zero, because a plausible-looking wrong number is worse than a gap.
 */

import { asArray, asRecord, asString, dig, safeInt } from './values';

export const STEP = {
  userInput: 'CORTEX_STEP_TYPE_USER_INPUT',
  plannerResponse: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
  checkpoint: 'CORTEX_STEP_TYPE_CHECKPOINT',
} as const;

export interface MeasuredUsage {
  /** Fresh, non-cached prompt tokens. */
  input: number;
  /** Tokens read from the prompt cache. Still occupies the context window. */
  cacheRead: number;
  /** Tokens written to the prompt cache. */
  cacheCreate: number;
  /** Output tokens, inclusive of thinking. */
  output: number;
  /** Total context occupied by this request. */
  total: number;
  /** Measured output generation rate in tokens/sec, when timing is valid. */
  tokPerSec: number | null;
  modelId: string | null;
  measuredAt: string | null;
}

export interface ConversationTotals {
  input: number;
  cacheRead: number;
  cacheCreate: number;
  output: number;
  calls: number;
}

export type UsageSource = 'measured' | 'estimated' | 'none';

export interface ConversationAnalysis {
  /** Model of the latest response, else the model selected in the composer. */
  modelId: string | null;
  /** Most recently selected or generating model across the trajectory. */
  selectedModelId: string | null;
  /** Latest provider-reported snapshot, if one exists. */
  measured: MeasuredUsage | null;
  /** Context used, measured or estimated. `null` when nothing is known. */
  used: number | null;
  source: UsageSource;
  /** Tokens contributed by estimation after the last measured snapshot. */
  estimatedDelta: number;
  totals: ConversationTotals;
  plannerCount: number;
  malformedSnapshots: number;
  userTurns: number;
  checkpoints: number;
  imageSteps: number;
  stepCount: number;
  lastActivityAt: string | null;
  lastUserInputAt: string | null;
  lastPlannerAt: string | null;
}

const EMPTY_TOTALS: ConversationTotals = { input: 0, cacheRead: 0, cacheCreate: 0, output: 0, calls: 0 };

/**
 * Analyse a full trajectory.
 *
 * @param steps Ordered step array, exactly as the backend returns it. Array
 *   order is authoritative: this build exposes no step index field.
 */
export function analyzeSteps(steps: readonly unknown[]): ConversationAnalysis {
  let measured: MeasuredUsage | null = null;
  let measuredIndex = -1;
  let planModel: string | null = null;
  let planModelIndex = -1;
  let generatorModel: string | null = null;
  let generatorModelIndex = -1;
  let plannerCount = 0;
  let malformedSnapshots = 0;
  let userTurns = 0;
  let checkpoints = 0;
  let imageSteps = 0;
  let lastActivityAt: string | null = null;
  let lastUserInputAt: string | null = null;
  let lastPlannerAt: string | null = null;
  const totals: ConversationTotals = { ...EMPTY_TOTALS };

  for (let index = 0; index < steps.length; index += 1) {
    const step = asRecord(steps[index]);
    if (!step) {
      continue;
    }
    const type = asString(step.type) ?? '';
    const metadata = asRecord(step.metadata);
    const createdAt = metadata ? asString(metadata.createdAt) : null;
    if (createdAt && (lastActivityAt === null || createdAt > lastActivityAt)) {
      lastActivityAt = createdAt;
    }

    const stepGeneratorModel = metadata
      ? (asString(metadata.generatorModel) ?? asString(dig(metadata, 'requestedModel', 'model')))
      : null;
    if (stepGeneratorModel) {
      generatorModel = stepGeneratorModel;
      generatorModelIndex = index;
    }

    if (isImageStep(step, type)) {
      imageSteps += 1;
    }

    if (type === STEP.userInput) {
      userTurns += 1;
      lastUserInputAt = createdAt ?? lastUserInputAt;
      const nextPlanModel =
        asString(dig(step, 'userInput', 'userConfig', 'plannerConfig', 'planModel')) ??
        asString(dig(step, 'userInput', 'lastUserConfig', 'plannerConfig', 'planModel'));
      if (nextPlanModel) {
        planModel = nextPlanModel;
        planModelIndex = index;
      }
      continue;
    }

    if (type === STEP.checkpoint) {
      checkpoints += 1;
      continue;
    }

    const usage = metadata ? metadata.modelUsage : null;
    const isPlanner = type === STEP.plannerResponse;
    if (!isPlanner && (usage === null || usage === undefined)) {
      continue;
    }

    if (isPlanner) {
      plannerCount += 1;
    }
    if (usage === null || usage === undefined) {
      continue;
    }
    const parsed = parseModelUsage(usage, createdAt, metadata);
    if (!parsed) {
      malformedSnapshots += 1;
      continue;
    }
    if (!isPlanner) {
      plannerCount += 1;
    }

    measured = parsed;
    measuredIndex = index;
    lastPlannerAt = createdAt ?? lastPlannerAt;
    totals.input += parsed.input;
    totals.cacheRead += parsed.cacheRead;
    totals.cacheCreate += parsed.cacheCreate;
    totals.output += parsed.output;
    totals.calls += 1;
  }

  const baselineTotal = measured ? measured.total : 0;
  const estimatedDelta = estimateTokens(steps, measuredIndex + 1);

  let used: number | null;
  let source: UsageSource;
  if (measured) {
    used = baselineTotal + estimatedDelta;
    source = estimatedDelta > 0 ? 'estimated' : 'measured';
  } else if (estimatedDelta > 0) {
    used = estimatedDelta;
    source = 'estimated';
  } else {
    used = null;
    source = 'none';
  }

  const newerSelected =
    planModelIndex > measuredIndex || generatorModelIndex > measuredIndex
      ? (generatorModelIndex > planModelIndex ? generatorModel : planModel) ?? generatorModel ?? planModel
      : null;
  const selectedModelId = newerSelected ?? measured?.modelId ?? generatorModel ?? planModel;

  return {
    modelId: measured?.modelId ?? selectedModelId,
    selectedModelId,
    measured,
    used,
    source,
    estimatedDelta,
    totals,
    plannerCount,
    malformedSnapshots,
    userTurns,
    checkpoints,
    imageSteps,
    stepCount: steps.length,
    lastActivityAt,
    lastUserInputAt,
    lastPlannerAt,
  };
}

/**
 * Parse one `modelUsage` block.
 *
 * `outputTokens` already includes `thinkingOutputTokens` and
 * `responseOutputTokens`, so only the aggregate is used; summing the parts would
 * double-count reasoning.
 */
export function parseModelUsage(
  usage: unknown,
  measuredAt: string | null,
  metadata?: Record<string, unknown> | null,
): MeasuredUsage | null {
  const record = asRecord(usage);
  if (!record) {
    return null;
  }
  const input = safeInt(record.inputTokens) ?? safeInt(record.promptTokens);
  const output = safeInt(record.outputTokens) ?? safeInt(record.completionTokens);
  if (input === null || output === null) {
    return null;
  }
  const cacheRead = safeInt(record.cacheReadTokens) ?? safeInt(record.cachedInputTokens) ?? 0;
  const cacheCreate = safeInt(record.cacheCreationTokens) ?? safeInt(record.cacheWriteTokens) ?? 0;
  const total = input + cacheRead + cacheCreate + output;
  if (!Number.isSafeInteger(total)) {
    return null;
  }
  return {
    input,
    cacheRead,
    cacheCreate,
    output,
    total,
    tokPerSec: computeTokPerSec(record, output, metadata ?? null),
    modelId: asString(record.model),
    measuredAt,
  };
}

function computeTokPerSec(
  record: Record<string, unknown>,
  output: number,
  metadata: Record<string, unknown> | null,
): number | null {
  if (!metadata || output <= 0) {
    return null;
  }
  const finishedIso = asString(metadata.finishedGeneratingAt) ?? asString(metadata.completedAt);
  const finishedMs = finishedIso ? Date.parse(finishedIso) : NaN;
  if (!Number.isFinite(finishedMs)) {
    return null;
  }
  // Prefer visible response decode speed when thinking and response tokens are split (or zero thinking);
  // sub-500ms windows fall through to full turn time to avoid clock-quantization spikes.
  const streamedTokens = safeInt(record.responseOutputTokens) ?? ((safeInt(record.thinkingOutputTokens) ?? 0) === 0 ? output : null);
  const viewableIso = asString(metadata.viewableAt);
  const viewableMs = viewableIso ? Date.parse(viewableIso) : NaN;
  if (streamedTokens !== null && streamedTokens > 0 && Number.isFinite(viewableMs) && finishedMs - viewableMs >= 500) {
    return Math.round((streamedTokens / ((finishedMs - viewableMs) / 1000)) * 10) / 10;
  }
  const createdIso = asString(metadata.createdAt);
  const createdMs = createdIso ? Date.parse(createdIso) : NaN;
  if (Number.isFinite(createdMs) && finishedMs - createdMs >= 250) {
    return Math.round((output / ((finishedMs - createdMs) / 1000)) * 10) / 10;
  }
  return null;
}

function isImageStep(step: Record<string, unknown>, type: string): boolean {
  if (type.includes('IMAGE') || type.includes('GENERATE')) {
    return true;
  }
  return asRecord(step.generateImage) !== null;
}

/**
 * Estimate the tokens contributed by steps that have no provider snapshot yet.
 *
 * ASCII runs at roughly four characters per token; non-ASCII text tokenises
 * closer to one and a half. This is a deliberate approximation used only to
 * bridge the gap while a response streams, and it is always labelled as such.
 */
export function estimateTokens(steps: readonly unknown[], fromIndex: number): number {
  let ascii = 0;
  let nonAscii = 0;
  const start = Math.max(0, fromIndex);

  for (let index = start; index < steps.length; index += 1) {
    const step = asRecord(steps[index]);
    if (!step) {
      continue;
    }
    for (const text of textFieldsOf(step)) {
      for (const character of text) {
        if (character.codePointAt(0)! < 128) {
          ascii += 1;
        } else {
          nonAscii += 1;
        }
      }
    }
  }

  return Math.ceil(ascii / 4 + nonAscii / 1.5);
}

/**
 * Every text field that legitimately occupies context, in one place.
 * Deliberately an allow-list: walking generic string values would count ids,
 * timestamps, and signatures as prompt content.
 */
function textFieldsOf(step: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (value: unknown): void => {
    const text = asString(value);
    if (text) {
      out.push(text);
    }
  };

  // `userResponse` is the concatenation of `items`, so reading both would
  // double the estimate. Prefer the concatenated form and fall back to parts.
  const userResponse = asString(dig(step, 'userInput', 'userResponse'));
  if (userResponse) {
    push(userResponse);
  } else {
    for (const item of asArray(dig(step, 'userInput', 'items'))) {
      push(dig(item, 'text'));
    }
  }

  push(dig(step, 'plannerResponse', 'response'));
  push(dig(step, 'plannerResponse', 'thinking'));

  push(dig(step, 'metadata', 'toolCall', 'argumentsJson'));

  push(dig(step, 'runCommand', 'commandLine'));
  push(dig(step, 'runCommand', 'combinedOutput'));
  push(dig(step, 'viewFile', 'absolutePathUri'));
  push(dig(step, 'viewFile', 'content'));
  push(dig(step, 'systemMessage', 'message'));
  push(dig(step, 'systemMessage', 'agentMessage'));
  push(dig(step, 'errorMessage', 'error'));
  push(dig(step, 'checkpoint', 'sessionSummary'));

  const generic = asRecord(step.generic);
  if (generic) {
    push(generic.args);
    push(generic.result);
  }
  const codeAction = asRecord(step.codeAction);
  if (codeAction) {
    const spec = codeAction.actionSpec;
    if (typeof spec === 'string') {
      push(spec);
    } else if (spec && typeof spec === 'object') {
      try {
        const serialized = JSON.stringify(spec);
        if (serialized.length > 0 && serialized.length <= 200_000) out.push(serialized);
      } catch {
        // Ignore unserializable object.
      }
    }
  }
  const invokeSubagent = asRecord(step.invokeSubagent);
  if (invokeSubagent) {
    push(invokeSubagent.prompt);
    push(invokeSubagent.role);
  }

  return out;
}

/**
 * Detects context compression across observations of the same conversation.
 *
 * A drop is only trusted when both readings are provider-measured, the model is
 * unchanged, and the step count did not decrease — otherwise an undo would look
 * exactly like a compression event.
 */
export class CompressionDetector {
  private readonly previous = new Map<string, { total: number; stepCount: number; modelId: string | null }>();

  /** Record an observation; returns true when it represents a compression. */
  observe(conversationId: string, analysis: ConversationAnalysis): boolean {
    const prior = this.previous.get(conversationId);
    const current =
      analysis.measured && analysis.source === 'measured'
        ? { total: analysis.measured.total, stepCount: analysis.stepCount, modelId: analysis.modelId }
        : null;

    if (!current) {
      return false;
    }

    let compressed = false;
    if (
      prior &&
      prior.modelId === current.modelId &&
      current.stepCount >= prior.stepCount &&
      prior.total - current.total > Math.max(5_000, prior.total * 0.1)
    ) {
      compressed = true;
    }

    this.previous.set(conversationId, current);
    return compressed;
  }

  forget(conversationId: string): void {
    this.previous.delete(conversationId);
  }

  clear(): void {
    this.previous.clear();
  }
}
