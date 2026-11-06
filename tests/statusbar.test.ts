import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createVscodeMock, installVscodeMock } from './vscode-mock';

function backend(app: 'app' | 'ide', port: number, active: boolean) {
  return {
    id: `${app}:${port}`,
    kind: 'hub' as const,
    scheme: 'http' as const,
    port,
    pid: null,
    app,
    reachable: true,
    conversations: 1,
    running: 0,
    lastActivityMs: 0,
    active,
  };
}

function conversation(title: string, percent: number, app: 'app' | 'ide') {
  return {
    id: `${app}-conversation`,
    title,
    status: 'idle' as const,
    stepCount: 130,
    lastModified: null,
    createdAt: null,
    modelId: 'MODEL_PLACEHOLDER_M318',
    modelName: 'Gemini 3.8 Flash (High)',
    usage: {
      used: 109_360,
      capacity: 1_048_576,
      percent,
      remaining: 939_216,
      input: 3_899,
      cacheRead: 99_962,
      cacheCreate: 0,
      output: 5_499,
      source: 'measured' as const,
      measuredAt: null,
    },
    compressed: false,
    imageSteps: 0,
    totals: {
      input: 3_899,
      cacheRead: 99_962,
      cacheCreate: 0,
      output: 5_499,
      calls: 64,
      costUsd: 0.58,
    },
  };
}

function snapshot() {
  const desktop = backend('app', 50062, true);
  const ide = backend('ide', 50096, false);
  return {
    schemaVersion: 1,
    generatedAt: Date.now(),
    status: 'ok',
    backend: desktop,
    backends: [desktop, ide],
    instances: [
      { backend: desktop, status: 'ok', conversation: conversation('Skills!', 10.43, 'app'), observedConversationId: 'app-conversation' },
      { backend: ide, status: 'ok', conversation: conversation('Review project setup', 11.7, 'ide'), observedConversationId: null },
    ],
    conversation: conversation('Skills!', 10.43, 'app'),
    sessions: [],
    models: [
      {
        modelId: 'MODEL_PLACEHOLDER_M318',
        label: 'Gemini 3.8 Flash (High)',
        quotaPercent: 98,
        resetsAt: new Date(Date.now() + 3.5 * 3600 * 1000).toISOString(),
        contextLimit: 1_048_576,
        maxOutput: 65_536,
        active: true,
      },
    ],
    account: null,
    usage: {
      days: [],
      todayTokens: 0,
      todayCostUsd: null,
      monthTokens: 0,
      monthCostUsd: null,
      priced: false,
    },
    prefs: {
      pollIntervalMs: 2000,
      warningThreshold: 80,
      showQuota: true,
      maskPersonalInfo: true,
      maxPayloadMb: 128,
      displayMode: 'full',
    },
    lastError: null,
    discoveryNotes: [],
    stale: false,
  };
}

test('the hover is structured and keeps model punctuation literal', () => {
  const mock = createVscodeMock();
  installVscodeMock(mock);
  const { tooltipFor } = require('../src/app/statusbar') as typeof import('../src/app/statusbar');
  const value = (tooltipFor(snapshot() as never) as unknown as { value: string }).value;

  assert.match(value, /\*\*Context window\*\*/);
  assert.match(value, /\$\(comment-discussion\) Skills!/);
  assert.match(value, /\*\*10\.4%\*\* used/);
  assert.match(value, /\| Model \| Gemini 3\.8 Flash \(High\) \|/);
  assert.ok(!value.includes('\\(High\\)'), 'parentheses must not be escaped');
  assert.ok(!value.includes('3\\.8'), 'the decimal point must not be escaped');
  assert.match(value, /5-hour quota/);
  assert.match(value, /Also running: Antigravity IDE 11\.7%/);
  assert.match(value, /Open dashboard/);
});

test('custom native status includes independent live 5h and weekly fields', () => {
  installVscodeMock(createVscodeMock());
  const { statusText, tooltipFor } = require('../src/app/statusbar') as typeof import('../src/app/statusbar');
  const state = {
    ...snapshot(),
    prefs: { ...snapshot().prefs, displayMode: 'custom', snippetContext: false, snippetRemaining: false, snippetFiveHour: true, snippetWeekly: true },
    quota: { observedAt: Date.now(), status: 'live', error: null, groups: [{ id: 'gemini', label: 'Gemini Models', buckets: [
      { id: 'gemini-5h', window: '5h', percent: 94.6, enabled: true, resetsAt: null },
      { id: 'gemini-weekly', window: 'weekly', percent: 98.4, enabled: true, resetsAt: null },
    ] }] },
  };
  assert.match(statusText(state as never), /5h 94\.6%.*Week 98\.4%/);
  assert.doesNotMatch(statusText(state as never), /10\.4%/);
  assert.match((tooltipFor(state as never) as unknown as { value: string }).value, /Weekly quota.*98\.4%/);
});
