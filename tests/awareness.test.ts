import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Monitor } from '../src/app/monitor';
import { trajectoriesPayload } from './fixtures';

test('observing a new thread clears the previous chat before the next backend poll', async () => {
  const monitor = new Monitor({
    logger: () => undefined,
    getConfig: () => ({ pollIntervalMs: 2000, warningThreshold: 80, showQuota: true,
      maskPersonalInfo: true, maxPayloadMb: 128, displayMode: 'full' }),
    onSnapshot: () => undefined, recordUsage: () => undefined,
    usageSummary: () => ({ days: [], todayTokens: 0, todayCostUsd: null, monthTokens: 0,
      monthCostUsd: null, priced: false }),
  });
  // Exercise the real polling policy without spawning discovery or contacting a backend.
  const internal = monitor as any;
  const instance = {
    target: { port: 50062, id: 'test-backend' }, status: {}, conversations: [],
    activeConversationId: 'old', observedConversationId: null,
    previousStepCounts: new Map(), retryAt: 0,
  };
  internal.instances.set('test-backend', instance);
  let publishes = 0;
  internal.publish = () => { publishes += 1; };
  internal.schedule = () => undefined;
  internal.call = async () => trajectoriesPayload([
    { id: 'old', title: 'Background chat', stepCount: 100, status: 'CASCADE_RUN_STATUS_RUNNING' },
  ]);
  internal.refreshAnalysis = () => { throw new Error('new thread must not read the old trajectory'); };
  monitor.observeConversation(50062, null, 'new-thread');
  assert.equal(instance.activeConversationId, null);
  assert.equal(publishes, 1);
  await internal.pollInstance(instance, new AbortController().signal);
  assert.equal(instance.activeConversationId, null);
  monitor.observeConversation(50062, null, 'new-thread');
  assert.equal(publishes, 1, 'observation heartbeats do not trigger duplicate refreshes');
  internal.pinnedConversationId = 'a-pinned-chat';
  internal.focusTargetId = 'another-backend';
  await internal.pollInstance(instance, new AbortController().signal);
  assert.equal(instance.activeConversationId, null, 'a pin in another backend cannot select this backend’s old chat');
  monitor.stop();
});

test('an explicitly observed conversation not yet in summaries never selects a background chat', async () => {
  const monitor = new Monitor({
    logger: () => undefined,
    getConfig: () => ({ pollIntervalMs: 2000, warningThreshold: 80, showQuota: true,
      maskPersonalInfo: true, maxPayloadMb: 128, displayMode: 'full' }),
    onSnapshot: () => undefined, recordUsage: () => undefined,
    usageSummary: () => ({ days: [], todayTokens: 0, todayCostUsd: null, monthTokens: 0,
      monthCostUsd: null, priced: false }),
  });
  const internal = monitor as any;
  const instance = {
    target: { port: 50062, id: 'test-backend' }, status: {}, conversations: [],
    activeConversationId: 'old', observedConversationId: 'new-id',
    observationState: 'conversation', observedAt: Date.now(),
    previousStepCounts: new Map(), retryAt: 0,
  };
  internal.call = async () => trajectoriesPayload([{ id: 'old', title: 'Background', stepCount: 10 }]);
  internal.instances.set('test-backend', instance);
  internal.refreshAnalysis = () => { throw new Error('must wait for the selected conversation'); };
  await internal.pollInstance(instance, new AbortController().signal);
  assert.equal(instance.activeConversationId, null);
  monitor.stop();
});

test('standby discovery failure reports disconnected rather than error, and pinning preserves cached analysis', async () => {
  const monitor = new Monitor({
    logger: () => undefined,
    getConfig: () => ({ pollIntervalMs: 2000, warningThreshold: 80, showQuota: true,
      maskPersonalInfo: true, maxPayloadMb: 128, displayMode: 'full' }),
    onSnapshot: () => undefined, recordUsage: () => undefined,
    usageSummary: () => ({ days: [], todayTokens: 0, todayCostUsd: null, monthTokens: 0,
      monthCostUsd: null, priced: false }),
  });
  const internal = monitor as any;
  internal.lastFailureKind = 'discovery';
  internal.lastError = 'No Antigravity backend answered';
  assert.equal(internal.deriveStatus(null, null), 'disconnected');

  internal.analysisCache.set('c1', { signature: 'sig', analysis: { used: 100 }, error: null, fetchedAt: Date.now(), durationMs: 10 });
  internal.schedule = () => undefined;
  monitor.pinConversation(null);
  assert.equal(internal.analysisCache.has('c1'), true, 'unpinning must not wipe unrelated cached trajectories');
  monitor.stop();
});

test('pollInstance records previousStepCounts during new-thread state and records running peer usage', async () => {
  const recorded: any[] = [];
  const monitor = new Monitor({
    logger: () => undefined,
    getConfig: () => ({
      pollIntervalMs: 2000, warningThreshold: 80, showQuota: true, maskPersonalInfo: true,
      maxPayloadMb: 128, displayMode: 'full',
    }),
    onSnapshot: () => undefined,
    recordUsage: (record) => recorded.push(record),
    usageSummary: () => ({ days: [], todayTokens: 0, todayCostUsd: null, monthTokens: 0, monthCostUsd: null, priced: false }),
  });
  const internal = monitor as any;
  const target = { id: 'p1', pid: 1, port: 40000, scheme: 'https', host: '127.0.0.1', token: 't', kind: 'hub', owner: 'app' };
  const state: any = {
    target,
    status: { id: 'p1', kind: 'hub', scheme: 'https', port: 40000, pid: 1, owner: 'app', reachable: true, conversationCount: 1, runningCount: 0, lastActivityMs: 1, failureReason: null },
    conversations: [],
    activeConversationId: null,
    observedConversationId: null,
    observationState: 'new-thread',
    observedAt: Date.now(),
    previousStepCounts: new Map(),
    retryAt: 0,
  };
  internal.instances.set('p1', state);
  internal.focusTargetId = 'p1';
  let peerSteps = 2;
  internal.call = async (_t: any, method: string, params: any) => {
    if (method === 'GetAllCascadeTrajectories') {
      return {
        trajectorySummaries: {
          main: { summary: 'Main', stepCount: 10, status: 'CASCADE_RUN_STATUS_RUNNING', lastModifiedTime: '2026-11-17T00:00:00Z' },
          sub: { summary: 'Sub', stepCount: peerSteps, status: 'CASCADE_RUN_STATUS_RUNNING', lastModifiedTime: '2026-11-17T00:00:01Z' },
        },
      };
    }
    const inputTokens = params.cascadeId === 'sub' ? peerSteps * 100 : 1000;
    return {
      steps: [{ type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', metadata: { createdAt: '2026-11-17T00:00:00Z', modelUsage: { inputTokens, outputTokens: 50, model: 'MODEL_PLACEHOLDER_M318' } } }],
    };
  };

  await internal.pollInstance(state, new AbortController().signal);
  assert.equal(state.previousStepCounts.get('main'), 10, 'new-thread return must still track step counts');

  state.observationState = 'conversation';
  state.observedConversationId = 'main';
  await internal.pollInstance(state, new AbortController().signal);
  await new Promise((resolve) => setTimeout(resolve, 20));
  internal.analysisCache.get('sub').fetchedAt = 0;
  peerSteps = 3;
  await internal.pollInstance(state, new AbortController().signal);
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.ok(recorded.some((r) => r.input === 100), 'running peer delta should be recorded in daily usage');
  monitor.stop();
});
