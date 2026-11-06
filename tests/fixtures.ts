/**
 * Deterministic fixtures shaped exactly like the payloads observed from
 * Antigravity 2.28.2. Crafted rather than recorded, so no real conversation
 * content or account data can leak into the repository.
 */

type Json = Record<string, unknown>;

let counter = 0;

function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

/** A completed planner response carrying provider-reported usage. */
export function plannerStep(options: {
  input: number | string;
  output: number | string;
  cacheRead?: number | string;
  cacheCreation?: number | string;
  model?: string;
  thinking?: string;
  response?: string;
  createdAt?: string;
  omitUsage?: boolean;
}): unknown {
  const createdAt = options.createdAt ?? '2026-11-01T12:00:00.000Z';
  const modelUsage: Json = {
    model: options.model ?? 'MODEL_PLACEHOLDER_M318',
    inputTokens: String(options.input),
    outputTokens: String(options.output),
    thinkingOutputTokens: '10',
    responseOutputTokens: '20',
    apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
    messageId: nextId('bot'),
  };
  if (options.cacheRead !== undefined) {
    modelUsage.cacheReadTokens = String(options.cacheRead);
  }
  if (options.cacheCreation !== undefined) {
    modelUsage.cacheCreationTokens = String(options.cacheCreation);
  }

  return {
    type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
    status: 'CORTEX_STEP_STATUS_DONE',
    metadata: {
      createdAt,
      source: 'CORTEX_STEP_SOURCE_MODEL',
      executionId: nextId('exec'),
      modelUsage: options.omitUsage ? undefined : modelUsage,
      generatorModel: modelUsage.model,
    },
    plannerResponse: {
      response: options.response ?? 'Done.',
      thinking: options.thinking ?? '',
      messageId: modelUsage.messageId,
      stopReason: 'STOP_REASON_STOP_PATTERN',
    },
  };
}

/** A user turn, optionally carrying the composer's selected model. */
export function userInputStep(options: { text?: string; planModel?: string; createdAt?: string } = {}): unknown {
  return {
    type: 'CORTEX_STEP_TYPE_USER_INPUT',
    status: 'CORTEX_STEP_STATUS_DONE',
    metadata: {
      createdAt: options.createdAt ?? '2026-11-01T11:59:00.000Z',
      source: 'CORTEX_STEP_SOURCE_USER_EXPLICIT',
      executionId: nextId('exec'),
    },
    userInput: {
      items: [{ text: options.text ?? 'Please continue.' }],
      userResponse: options.text ?? 'Please continue.',
      userConfig: {
        plannerConfig: {
          planModel: options.planModel ?? 'MODEL_PLACEHOLDER_M318',
          useAiCredits: false,
        },
      },
    },
  };
}

/** A compaction checkpoint. Tokens are not reported on this step type. */
export function checkpointStep(options: { summary?: string; endIndex?: number } = {}): unknown {
  return {
    type: 'CORTEX_STEP_TYPE_CHECKPOINT',
    status: 'CORTEX_STEP_STATUS_DONE',
    metadata: {
      createdAt: '2026-11-01T12:30:00.000Z',
      executionId: nextId('exec'),
      retryInfos: [],
    },
    checkpoint: {
      checkpointIndex: 1,
      includedStepIndexEnd: options.endIndex ?? 10,
      sessionSummary: options.summary ?? '### Summary\nWork in progress.',
    },
  };
}

/** A tool step with a command and captured output. */
export function runCommandStep(options: { command?: string; output?: string } = {}): unknown {
  return {
    type: 'CORTEX_STEP_TYPE_RUN_COMMAND',
    status: 'CORTEX_STEP_STATUS_DONE',
    metadata: {
      createdAt: '2026-11-01T12:10:00.000Z',
      executionId: nextId('exec'),
      toolCall: { id: nextId('call'), name: 'run_command', argumentsJson: '{"CommandLine":"echo hi"}' },
    },
    runCommand: {
      commandLine: options.command ?? 'echo hi',
      combinedOutput: options.output ?? 'hi',
      exitCode: 0,
    },
  };
}

/** An image-generation step. */
export function generateImageStep(): unknown {
  return {
    type: 'CORTEX_STEP_TYPE_GENERATE_IMAGE',
    status: 'CORTEX_STEP_STATUS_DONE',
    metadata: { createdAt: '2026-11-01T12:20:00.000Z', executionId: nextId('exec') },
    generateImage: { model: 'MODEL_PLACEHOLDER_M21', path: 'chart.png' },
  };
}

/** A `GetAllCascadeTrajectories` response. */
export function trajectoriesPayload(
  entries: Array<{
    id: string;
    title: string;
    stepCount: number;
    status?: string;
    lastModified?: string;
  }>,
): unknown {
  const summaries: Json = {};
  for (const entry of entries) {
    summaries[entry.id] = {
      summary: entry.title,
      stepCount: entry.stepCount,
      lastModifiedTime: entry.lastModified ?? '2026-11-01T15:00:00.000Z',
      trajectoryId: `${entry.id}-trajectory`,
      status: entry.status ?? 'CASCADE_RUN_STATUS_IDLE',
      createdTime: '2026-11-01T10:00:00.000Z',
      annotations: { title: entry.title },
      trajectoryMetadata: { projectId: 'outside-of-project' },
      trajectoryType: 'CORTEX_TRAJECTORY_TYPE_CASCADE',
    };
  }
  return { trajectorySummaries: summaries };
}

/** A `GetAvailableModels` response. */
export function modelsPayload(
  models: Array<{
    catalogId: string;
    model: string;
    displayName?: string;
    maxTokens?: number;
    maxOutputTokens?: number;
    supportsThinking?: boolean;
  }>,
): unknown {
  const entries: Json = {};
  for (const model of models) {
    entries[model.catalogId] = {
      maxTokens: model.maxTokens,
      maxOutputTokens: model.maxOutputTokens,
      model: model.model,
      displayName: model.displayName,
      supportsThinking: model.supportsThinking,
      quotaInfo: { remainingFraction: 1, resetTime: '2026-11-01T20:48:20Z' },
    };
  }
  return { response: { models: entries } };
}

/** A `GetUserStatus` response with an account block and a model picker. */
export function userStatusPayload(options: {
  name?: string;
  email?: string;
  entries?: Array<{ label: string; model: string; remainingFraction?: number; resetTime?: string }>;
} = {}): unknown {
  return {
    userStatus: {
      name: options.name ?? 'Test User',
      email: options.email ?? 'test@example.com',
      planStatus: {
        planInfo: {
          planName: 'Pro',
          teamsTier: 'TEAMS_TIER_PRO',
          monthlyPromptCredits: '50000',
          monthlyFlowCredits: '150000',
        },
      },
      userTier: { id: 'g1-pro-tier', name: 'Google AI Pro' },
      cascadeModelConfigData: {
        clientModelConfigs: (options.entries ?? [
          { label: 'Gemini 3.8 Flash (High)', model: 'MODEL_PLACEHOLDER_M318', remainingFraction: 0.836511 },
          { label: 'Claude Opus 4.6 (Thinking)', model: 'MODEL_PLACEHOLDER_M26', remainingFraction: 1 },
        ]).map((entry) => ({
          label: entry.label,
          modelOrAlias: { model: entry.model },
          quotaInfo: {
            remainingFraction: entry.remainingFraction ?? 1,
            resetTime: entry.resetTime ?? '2026-11-01T20:48:20Z',
          },
          supportsImages: true,
        })),
      },
    },
  };
}

/** Reset the id counter so fixture output is stable across tests. */
export function resetFixtures(): void {
  counter = 0;
}
