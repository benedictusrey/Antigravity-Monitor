import assert from 'node:assert/strict';
import { test } from 'node:test';

import { recentDayKeys } from '../src/core/format';
import { addUsage, emptyUsage, summariseUsage } from '../src/core/usage';

const NOW = new Date(2026, 10, 2, 12, 0, 0).getTime();
const KEYS = recentDayKeys(14, NOW);
const TODAY = KEYS[KEYS.length - 1];

test('observations accumulate per day and per model', () => {
  const buckets = new Map();
  addUsage(buckets, { day: TODAY, modelId: 'MODEL_PLACEHOLDER_M318', input: 1000, cacheRead: 0, cacheCreate: 0, output: 500 });
  addUsage(buckets, { day: TODAY, modelId: 'MODEL_PLACEHOLDER_M318', input: 200, cacheRead: 100, cacheCreate: 0, output: 50 });

  const summary = summariseUsage(buckets, 14, NOW);
  assert.equal(summary.todayTokens, 1850);
  assert.equal(summary.days.length, 14);
  assert.equal(summary.days[13].day, TODAY);
});

test('negative deltas are clamped rather than subtracting', () => {
  const buckets = new Map();
  addUsage(buckets, { day: TODAY, modelId: null, input: -100, cacheRead: -1, cacheCreate: -1, output: -5 });
  const summary = summariseUsage(buckets, 14, NOW);
  assert.equal(summary.todayTokens, 0);
});

test('cost is estimated only for models with a published rate', () => {
  const buckets = new Map();
  addUsage(buckets, { day: TODAY, modelId: 'MODEL_PLACEHOLDER_M318', input: 1_000_000, cacheRead: 0, cacheCreate: 0, output: 0 });

  const summary = summariseUsage(buckets, 14, NOW);
  assert.equal(summary.priced, true);
  // Gemini 3.8 Flash introductory input rate is $0.75 per million tokens.
  assert.ok(Math.abs((summary.todayCostUsd ?? 0) - 0.75) < 1e-9);
  assert.ok(Math.abs((summary.monthCostUsd ?? 0) - 0.75) < 1e-9);
});

test('an unpriced model reports no cost but still counts tokens', () => {
  const buckets = new Map();
  addUsage(buckets, { day: TODAY, modelId: 'MODEL_PLACEHOLDER_M26', input: 5000, cacheRead: 0, cacheCreate: 0, output: 1000 });

  const summary = summariseUsage(buckets, 14, NOW);
  assert.equal(summary.todayTokens, 6000);
  assert.equal(summary.todayCostUsd, null);
  assert.equal(summary.priced, false);
});

test('days outside the window are excluded from the series', () => {
  const buckets = new Map();
  addUsage(buckets, { day: '2026-01-01', modelId: 'MODEL_PLACEHOLDER_M318', input: 999_999, cacheRead: 0, cacheCreate: 0, output: 0 });

  const summary = summariseUsage(buckets, 14, NOW);
  assert.equal(summary.todayTokens, 0);
  assert.equal(summary.monthTokens, 0);
  assert.ok(summary.days.every((day) => day.tokens === 0));
});

test('the monthly total includes days before the visible window', () => {
  const buckets = new Map();
  addUsage(buckets, { day: '2026-11-01', modelId: 'MODEL_PLACEHOLDER_M26', input: 1000, cacheRead: 0, cacheCreate: 0, output: 0 });
  addUsage(buckets, { day: TODAY, modelId: 'MODEL_PLACEHOLDER_M26', input: 500, cacheRead: 0, cacheCreate: 0, output: 0 });

  const summary = summariseUsage(buckets, 14, NOW);
  assert.equal(summary.monthTokens, 1500);
});

test('an empty store yields zeros, not undefined', () => {
  const summary = emptyUsage(14, NOW);
  assert.equal(summary.todayTokens, 0);
  assert.equal(summary.todayCostUsd, null);
  assert.equal(summary.days.length, 14);
  assert.equal(summary.priced, false);
});

test('malformed keys are ignored', () => {
  const buckets = new Map([['not-a-key', { input: 10, cacheRead: 0, cacheCreate: 0, output: 0 }]]);
  const summary = summariseUsage(buckets, 14, NOW);
  assert.equal(summary.todayTokens, 0);
});
