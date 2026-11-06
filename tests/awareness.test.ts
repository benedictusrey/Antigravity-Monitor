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
