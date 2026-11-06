import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseQuotaSummary, quotaAt, quotaBucket, resolveQuotaGroup } from '../src/core/quota';
import { snippetPreferences } from '../src/core/snippet';
import { Monitor } from '../src/app/monitor';

const now = Date.parse('2026-11-06T00:00:00Z');
const payload = { response: { groups: [
  { displayName: 'Gemini Models', buckets: [
    { bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.9838725, resetTime: '2026-11-11T03:56:03Z' },
    { bucketId: 'gemini-5h', window: '5h', remainingFraction: 0.9461716 },
  ] },
  { displayName: 'Claude and GPT models', buckets: [
    { bucketId: '3p-weekly', window: 'weekly', remainingFraction: 1 },
    { bucketId: '3p-5h', window: '5h', remainingFraction: 0 },
  ] },
] } };

test('live quota groups retain precision and never mix model families', () => {
  const groups = parseQuotaSummary(payload);
  assert.ok(Math.abs(resolveQuotaGroup(groups, 'Gemini 3.8 Flash High')!.buckets[0].percent! - 98.38725) < 1e-9);
  assert.equal(resolveQuotaGroup(groups, 'Claude Sonnet')?.buckets[0].percent, 100);
  assert.equal(resolveQuotaGroup(groups, 'GPT-OSS')?.buckets[1].percent, 0);
  assert.equal(resolveQuotaGroup(groups, 'Unknown model'), null);
  assert.equal(resolveQuotaGroup(groups, null), null);
});

test('malformed quota numbers never become full or zero allowances', () => {
  for (const value of [null, undefined, -1, 1.2, 'unknown', Infinity]) {
    const groups = parseQuotaSummary({ response: { groups: [{ displayName: 'Gemini', buckets: [
      { window: 'weekly', remainingFraction: value },
    ] }] } });
    assert.equal(groups[0].buckets[0].percent, null);
  }
  assert.deepEqual(parseQuotaSummary(null), []);
});

test('cached quota expires without pretending a successful refresh', () => {
  const state = { groups: parseQuotaSummary(payload), observedAt: now, status: 'live' as const, error: null };
  assert.equal(quotaAt(state, now + 5000).status, 'live');
  assert.equal(quotaAt({ ...state, error: 'timeout' }, now + 5000).status, 'cached');
  assert.equal(quotaAt(state, now + 15000).status, 'cached');
  assert.equal(quotaAt(state, now + 31000).status, 'unavailable');
  assert.ok(Math.abs(quotaBucket(state, 'Gemini', 'weekly', now)!.percent! - 98.38725) < 1e-9);
  assert.equal(quotaBucket(state, 'Gemini', 'weekly', now + 31000), null);
});

test('disabled and reset-expired buckets are unavailable rather than fabricated', () => {
  const state = { groups: parseQuotaSummary({ response: { groups: [{ displayName: 'Gemini', buckets: [
    { window: 'weekly', remainingFraction: 1, disabled: true },
    { window: '5h', remainingFraction: 0.5, resetTime: '2026-11-05T00:00:00Z' },
  ] }] } }), observedAt: now, status: 'live' as const, error: null };
  assert.equal(quotaBucket(state, 'Gemini', 'weekly', now), null);
  assert.equal(quotaBucket(state, 'Gemini', '5h', now), null);
});

test('snippet presets preserve defaults and custom choices remain independent', () => {
  assert.equal(snippetPreferences({ displayMode: 'essentials', snippetWeekly: true }).snippetWeekly, false);
  assert.equal(snippetPreferences({ displayMode: 'essentials' }).snippetRemaining, false);
  const custom = snippetPreferences({ displayMode: 'custom', snippetContext: false, snippetWeekly: true });
  assert.equal(custom.snippetContext, false);
  assert.equal(custom.snippetWeekly, true);
  assert.equal(custom.snippetFiveHour, false);
});

test('quota polling publishes a fast backend while another request and trajectory remain pending', async () => {
  const rpc = require('../src/core/rpc') as { callRpc: (...args: any[]) => Promise<unknown> };
  const original = rpc.callRpc;
  let finishSlow!: (value: unknown) => void;
  const slow = new Promise((resolve) => { finishSlow = resolve; });
  let requests = 0;
  rpc.callRpc = async (target, method, body) => {
    requests += 1;
    assert.equal(method, 'RetrieveUserQuotaSummary');
    assert.equal(body.forceRefresh, true);
    return target.id === 'fast' ? payload : slow;
  };
  const monitor = new Monitor({
    logger: () => undefined,
    getConfig: () => ({ pollIntervalMs: 2000, warningThreshold: 80, showQuota: true, maskPersonalInfo: true, maxPayloadMb: 128, displayMode: 'full' }),
    onSnapshot: () => undefined, recordUsage: () => undefined,
    usageSummary: () => ({ days: [], todayTokens: 0, todayCostUsd: null, monthTokens: 0, monthCostUsd: null, priced: false }),
  });
  const internal = monitor as any;
  let publications = 0;
  internal.publish = () => { publications += 1; };
  internal.polling = true;
  for (const id of ['fast', 'slow']) internal.instances.set(id, { target: { id }, status: { reachable: true } });
  try {
    const cycle = internal.quotaCycle();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(internal.quotas.has('fast'), true);
    assert.equal(internal.quotas.has('slow'), false);
    assert.equal(publications, 1);
    await internal.quotaCycle();
    assert.equal(requests, 2, 'overlapping quota rounds are not started');
    finishSlow(payload);
    await cycle;
    assert.equal(internal.quotas.has('slow'), true);
    const observedAt = internal.quotas.get('fast').observedAt;
    rpc.callRpc = async () => { throw new Error('offline'); };
    await internal.quotaCycle();
    assert.equal(internal.quotas.get('fast').status, 'cached');
    assert.equal(internal.quotas.get('fast').observedAt, observedAt, 'failure cannot advance freshness');
  } finally {
    finishSlow(payload);
    monitor.stop();
    rpc.callRpc = original;
  }
});
