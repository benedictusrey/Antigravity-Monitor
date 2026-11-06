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

    if (isImageStep(step, type)) {
      imageSteps += 1;
    }

    if (type === STEP.userInput) {
      userTurns += 1;
      lastUserInputAt = createdAt ?? lastUserInputAt;
      planModel =
        asString(dig(step, 'userInput', 'userConfig', 'plannerConfig', 'planModel')) ??
        asString(dig(step, 'userInput', 'lastUserConfig', 'plannerConfig', 'planModel')) ??
        planModel;
      continue;
    }

    if (type === STEP.checkpoint) {
      checkpoints += 1;
      continue;
    }

    if (type !== STEP.plannerResponse) {
      continue;
    }

    plannerCount += 1;
    const usage = metadata ? metadata.modelUsage : null;
    if (usage === null || usage === undefined) {
      continue;
    }
    const parsed = parseModelUsage(usage, createdAt);
    if (!parsed) {
      malformedSnapshots += 1;
      continue;
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

  return {
    modelId: measured?.modelId ?? planModel,
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
export function parseModelUsage(usage: unknown, measuredAt: string | null): MeasuredUsage | null {
  const record = asRecord(usage);
  if (!record) {
    return null;
  }
  const input = safeInt(record.inputTokens);
  const output = safeInt(record.outputTokens);
  if (input === null || output === null) {
    return null;
  }
  const cacheRead = safeInt(record.cacheReadTokens) ?? 0;
  const cacheCreate = safeInt(record.cacheCreationTokens) ?? 0;
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
    modelId: asString(record.model),
    measuredAt,
  };
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
    push(codeAction.actionSpec);
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
