import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Monitor, matchConversationByTitle } from '../src/app/monitor';
import { dedupeBackends } from '../src/core/select';
import { emptyUsage } from '../src/core/usage';

function monitorWith(onSnapshot: (snapshot: unknown) => void = () => undefined) {
  return new Monitor({
    logger: () => undefined,
    getConfig: () => ({ pollIntervalMs: 2000, warningThreshold: 80, showQuota: true,
      maskPersonalInfo: true, maxPayloadMb: 128, displayMode: 'full' }),
    onSnapshot, recordUsage: () => undefined, usageSummary: emptyUsage,
  });
}

test('a running backend that refuses every request is unauthorized, not standby', () => {
  const internal = monitorWith() as any;
  internal.statuses = new Map([
    ['http:64401', { id: 'http:64401', reachable: false, failureReason: 'unauthorized' }],
    ['https:64401', { id: 'https:64401', reachable: false, failureReason: 'unauthorized' }],
  ]);
  assert.equal(internal.deriveStatus(null, null), 'unauthorized');
});

test('a backend that answers normally is not reported as unauthorized', () => {
  const internal = monitorWith() as any;
  internal.statuses = new Map([['http:1', { id: 'http:1', reachable: false, failureReason: 'timeout' }]]);
  assert.notEqual(internal.deriveStatus(null, null), 'unauthorized');
});

test('a change to discovery notes alone is published', () => {
  const published: unknown[] = [];
  const internal = monitorWith((snapshot) => published.push(snapshot)) as any;
  internal.publish();
  const before = published.length;
  internal.discoveryNotes = ['pid 1 (language_server.exe) exposes no listening port'];
  internal.publish();
  assert.equal(published.length, before + 1);
});

test('a 401 on one scheme still identifies the process when the other scheme cannot connect', () => {
  const base = { kind: 'legacy' as const, pid: 7, owner: 'app' as const, reachable: false, latencyMs: null,
    conversationCount: 0, runningCount: 0, lastActivityMs: 0 };
  const [chosen] = dedupeBackends([
    { ...base, id: 'https:63955', scheme: 'https', port: 63955, failureReason: 'unavailable' },
    { ...base, id: 'http:63955', scheme: 'http', port: 63955, failureReason: 'unauthorized' },
  ]);
  assert.equal(chosen.failureReason, 'unauthorized');
});

test('a poll whose backend is refusing requests reports the token problem, not a missing backend', async () => {
  const internal = monitorWith() as any;
  internal.needDiscovery = false;
  internal.instances.set('https:63954', { target: { id: 'https:63954' }, status: { id: 'https:63954', reachable: false },
    conversations: [], activeConversationId: null, observedConversationId: null, previousStepCounts: new Map(),
    retryAt: Date.now() + 60_000 });
  internal.statuses = new Map([['https:63954', { id: 'https:63954', reachable: false, failureReason: 'unauthorized' }]]);
  await assert.rejects(internal.pollOnce(internal.generation, new AbortController().signal), (error: Error) => /request token/.test(error.message));
});

test('provideToken attaches an in-memory renderer token and clears unauthorized backoff', () => {
  const internal = monitorWith() as any;
  const instance = {
    target: { id: 'https:58551', kind: 'legacy', scheme: 'https', host: '127.0.0.1', port: 58551, token: null, pid: 1, appDataDir: null, owner: 'app' },
    status: { id: 'https:58551', port: 58551, reachable: false, failureReason: 'unauthorized' },
    conversations: [], activeConversationId: null, observedConversationId: null, previousStepCounts: new Map(),
    retryAt: Date.now() + 60_000,
  };
  internal.instances.set('https:58551', instance);
  internal.statuses = new Map([['https:58551', instance.status]]);
  internal.provideToken(58551, 'renderer-token-abc');
  assert.equal(instance.target.token, 'renderer-token-abc');
  assert.equal(instance.retryAt, 0);
  internal.stop();
});

test('invokeRpc falls back to rpcFallback when direct loopback RPC returns unauthorized', async () => {
  const http = await import('node:http');
  const server = http.createServer((_req, res) => { res.writeHead(401).end(); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  try {
    let fallbackCalled = false;
    const monitor = new Monitor({
      logger: () => undefined,
      getConfig: () => ({ pollIntervalMs: 2000, warningThreshold: 80, showQuota: true,
        maskPersonalInfo: true, maxPayloadMb: 128, displayMode: 'full' }),
      onSnapshot: () => undefined,
      recordUsage: () => undefined,
      usageSummary: emptyUsage,
      rpcFallback: async (_target, method) => {
        fallbackCalled = method === 'GetUnleashData';
        return { ok: true } as any;
      },
    }) as any;
    const result = await monitor.invokeRpc(
      { id: `http:${port}`, kind: 'legacy', scheme: 'http', host: '127.0.0.1', port, token: null, pid: 1, appDataDir: null, owner: 'app' },
      'GetUnleashData',
      {},
      { timeoutMs: 2000 },
    );
    assert.equal(fallbackCalled, true);
    assert.deepEqual(result, { ok: true });
    monitor.stop();
  } finally {
    server.close();
  }
});

test('provideTarget connects to an explicit loopback target without process discovery and clears unauthorized state', async () => {
  const http = await import('node:http');
  let seenToken: string | undefined;
  const server = http.createServer((req, res) => {
    seenToken = req.headers['x-codeium-csrf-token'] as string | undefined;
    if (seenToken !== 'env-tok-999') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end('{"code":"unauthenticated"}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        trajectorySummaries: {},
        userStatus: { email: 'dev@example.com', planStatus: { planInfo: { planName: 'Pro' } }, cascadeModelConfigData: {} },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    let lastSnapshot: any = null;
    const monitor = monitorWith((s) => {
      lastSnapshot = s;
    }) as any;
    monitor.provideTarget(port, 'env-tok-999', 'http', 'app');
    monitor.observeConversation(port, '11111111-2222-3333-4444-555555555555', 'conversation', null);
    await monitor.discover();
    assert.equal(seenToken, 'env-tok-999');
    assert.equal(monitor.statuses.get(`hub:${port}`)?.reachable, true);
    assert.equal(monitor.instances.get(`hub:${port}`)?.observedConversationId, '11111111-2222-3333-4444-555555555555');
    assert.equal(lastSnapshot?.status !== 'unauthorized', true);
    monitor.stop();
  } finally {
    server.close();
  }
});

test('observeConversation correlates extensionView pageTitle to matching conversation on shared profiles', () => {
  const conversations: any[] = [
    { id: 'c1', title: 'Antigravity Monitor Authorization and Startup Fix', status: 'running', stepCount: 10, lastModified: '2026-11-28T12:00:00Z' },
    { id: 'c2', title: 'Wood Defect Engine ROI Refinement', status: 'idle', stepCount: 5, lastModified: '2026-11-28T10:00:00Z' },
  ];
  assert.equal(
    matchConversationByTitle(conversations, 'Wood Defect Engine ROI Refinement - Segmented_Validation - Antigravity')?.id,
    'c2',
  );
  const monitor = monitorWith() as any;
  monitor.instances.set('hub:http:54849', {
    target: { id: 'hub:http:54849', kind: 'hub', scheme: 'http', host: '127.0.0.1', port: 54849, token: 't', pid: 1, appDataDir: null, owner: 'ide' },
    status: { id: 'hub:http:54849', kind: 'hub', scheme: 'http', port: 54849, pid: 1, appDataDir: null, app: 'ide', reachable: true, conversationCount: 2, runningCount: 1, lastActivityMs: 1, failureReason: null },
    conversations,
    activeConversationId: 'c1',
    observedConversationId: null,
    previousStepCounts: new Map(),
    retryAt: 0,
  });
  monitor.observeConversation(54849, null, 'unknown', null, 'Wood Defect Engine ROI Refinement - Segmented_Validation - Antigravity');
  const inst = monitor.instances.get('hub:http:54849');
  assert.equal(inst.activeConversationId, 'c2');
  assert.equal(inst.observedTitle, 'Wood Defect Engine ROI Refinement - Segmented_Validation - Antigravity');
  monitor.stop();
});
