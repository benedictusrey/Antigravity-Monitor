import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shouldFetchSteps } from '../src/app/monitor';

const base = {
  hasCached: true,
  cachedSignature: 'a|1|t|idle',
  signature: 'a|1|t|idle',
  inFlight: false,
  lastFetchAt: 1_000,
  now: 10_000,
  floorMs: 2_000,
};

test('an unchanged conversation is never re-read', () => {
  assert.equal(shouldFetchSteps(base), false);
});

test('a changed conversation is read once the floor has elapsed', () => {
  assert.equal(shouldFetchSteps({ ...base, signature: 'a|2|t|running' }), true);
});

test('a changed conversation is held back inside the floor window', () => {
  assert.equal(
    shouldFetchSteps({ ...base, signature: 'a|2|t|running', lastFetchAt: 9_500, now: 10_000 }),
    false,
  );
});

test('a conversation with no cached reading is always read', () => {
  assert.equal(
    shouldFetchSteps({ ...base, hasCached: false, cachedSignature: null, lastFetchAt: 10_000, now: 10_000 }),
    true,
  );
});

test('a read already in flight is not duplicated', () => {
  assert.equal(shouldFetchSteps({ ...base, inFlight: true, signature: 'a|2|t|running' }), false);
});

test('the first ever read is not blocked by the floor', () => {
  assert.equal(
    shouldFetchSteps({
      hasCached: false,
      cachedSignature: null,
      signature: 'x',
      inFlight: false,
      lastFetchAt: 0,
      now: 1,
      floorMs: 15_000,
    }),
    true,
  );
});
