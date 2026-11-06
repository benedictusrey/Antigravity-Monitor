import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Monitor } from '../src/app/monitor';
import { emptyUsage } from '../src/core/usage';
import { trajectoriesPayload } from './fixtures';

function setup() {
  const monitor = new Monitor({
    logger: () => undefined,
    getConfig: () => ({ pollIntervalMs: 2000, warningThreshold: 80, showQuota: true,
      maskPersonalInfo: true, maxPayloadMb: 128, displayMode: 'full' }),
    onSnapshot: () => undefined, recordUsage: () => undefined, usageSummary: emptyUsage,
  });
  const internal = monitor as any;
  internal.schedule = () => undefined;
  internal.scheduleQuota = () => undefined;
  internal.needDiscovery = false;
  internal.lastStatusRefresh = Date.now();
  internal.publish = () => undefined;
  const instances = ['slow', 'fast'].map((id, index) => ({
    target: { id, port: 50060 + index },
    status: { id, reachable: true, owner: 'app' }, conversations: [],
    activeConversationId: null, observedConversationId: null,
    previousStepCounts: new Map(), retryAt: 0,
  }));
  instances.forEach((instance) => internal.instances.set(instance.target.id, instance));
  return { monitor, internal, instances };
}

test('an unfinished trajectory never blocks other summaries or their analysis', async () => {
  const { monitor, internal } = setup();
  let finishSlow!: (value: unknown) => void;
  const pending = new Promise((resolve) => { finishSlow = resolve; });
  const summaryReads: string[] = [];
  let publications = 0;
  internal.publish = () => { publications += 1; };
  internal.call = async (target: { id: string }, method: string) => {
    if (method === 'GetAllCascadeTrajectories') {
      summaryReads.push(target.id);
      return trajectoriesPayload([{ id: target.id, title: target.id, stepCount: 1 }]);
    }
    return target.id === 'slow' ? pending : { steps: [] };
  };
  await internal.cycle(0);
  await internal.cycle(0);
  assert.deepEqual(summaryReads, ['slow', 'fast', 'slow', 'fast']);
  assert.ok(publications >= 2, 'completed summary cycles publish while the slow read remains pending');
  assert.ok(internal.analysisCache.has('fast'));
  assert.equal(internal.analysisCache.has('slow'), false);
  finishSlow({ steps: [] });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(internal.analysisCache.has('slow'));
  monitor.stop();
});

for (const invalidation of ['refresh', 'stop', 'remove', 'replace'] as const) {
  test(`${invalidation} discards a late trajectory result`, async () => {
    const { monitor, internal, instances } = setup();
    let finish!: (value: unknown) => void;
    internal.call = () => new Promise((resolve) => { finish = resolve; });
    const reading = internal.refreshAnalysis(instances[0].target, {
      id: 'chat', stepCount: 1, status: 'idle', lastModified: null,
    }, internal.analysisAborter.signal);
    if (invalidation === 'refresh') monitor.refreshNow();
    if (invalidation === 'stop') monitor.stop();
    if (invalidation === 'remove') internal.instances.delete('slow');
    if (invalidation === 'replace') instances[0].target = { id: 'slow', port: 60000 };
    finish({ steps: [] });
    await reading;
    assert.equal(internal.analysisCache.has('chat'), false);
    assert.equal(internal.inFlightSteps.size, 0);
    monitor.stop();
  });
}

test('an aborted read does not replace a valid cached measurement with a failure', async () => {
  const { monitor, internal, instances } = setup();
  const aborter = new AbortController();
  const previous = { signature: 'old', fetchedAt: 0, durationMs: 0, analysis: { used: 42 } };
  internal.analysisCache.set('chat', previous);
  internal.call = async () => { aborter.abort(); throw new Error('aborted'); };
  await internal.refreshAnalysis(instances[0].target, {
    id: 'chat', stepCount: 1, status: 'idle', lastModified: null,
  }, aborter.signal);
  assert.equal(internal.analysisCache.get('chat'), previous);
  monitor.stop();
});

test('a payload limit change retries a conversation cached as oversized', () => {
  const { monitor, internal } = setup();
  const config = internal.deps.getConfig();
  internal.deps.getConfig = () => config;
  const previous = { signature: 'chat|1||idle', analysis: null, error: 'too large', fetchedAt: 1, durationMs: 1 };
  internal.analysisCache.set('chat', previous);
  monitor.updatePreferences();
  assert.equal(internal.analysisCache.get('chat'), previous, 'unrelated preference updates retain analysis');
  const priorSignal = internal.analysisAborter.signal;
  config.maxPayloadMb = 256;
  monitor.updatePreferences();
  assert.equal(internal.analysisCache.has('chat'), false);
  assert.equal(priorSignal.aborted, true, 'old-limit reads cannot restore the fatal cache');
  monitor.stop();
});
