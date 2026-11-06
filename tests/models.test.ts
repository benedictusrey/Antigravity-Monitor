import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildCatalog,
  estimateCost,
  parseUserStatus,
  priceFor,
  quotaFor,
  resolveModel,
  shortModelId,
} from '../src/core/models';
import { modelsPayload, userStatusPayload } from './fixtures';

const CATALOG = modelsPayload([
  { catalogId: 'gemini-3.8-flash-high', model: 'MODEL_PLACEHOLDER_M318', displayName: 'Gemini 3.8 Flash (High)', maxTokens: 1_048_576, maxOutputTokens: 65_536, supportsThinking: true },
  { catalogId: 'claude-opus-4-6-thinking', model: 'MODEL_PLACEHOLDER_M26', displayName: 'Claude Opus 4.6 (Thinking)', maxTokens: 250_000, maxOutputTokens: 64_000, supportsThinking: true },
  { catalogId: 'gemini-3.8-flash-tiered', model: 'MODEL_PLACEHOLDER_M322', maxTokens: 1_048_576, maxOutputTokens: 65_536, supportsThinking: true },
]);

test('the catalogue is keyed by backend placeholder id', () => {
  const catalog = buildCatalog(CATALOG);
  assert.equal(catalog.size, 3);
  assert.equal(catalog.get('MODEL_PLACEHOLDER_M318')?.contextLimit, 1_048_576);
  assert.equal(catalog.get('MODEL_PLACEHOLDER_M318')?.name, 'Gemini 3.8 Flash (High)');
  assert.equal(catalog.get('MODEL_PLACEHOLDER_M318')?.source, 'live');
});

test('a catalogue entry without a display name still resolves to a usable spec', () => {
  const catalog = buildCatalog(CATALOG);
  const spec = catalog.get('MODEL_PLACEHOLDER_M322');
  assert.equal(spec?.name, 'M322');
  assert.equal(spec?.contextLimit, 1_048_576);
});

test('a duplicate placeholder keeps the more complete record', () => {
  const catalog = buildCatalog(
    modelsPayload([
      { catalogId: 'a', model: 'MODEL_PLACEHOLDER_M318', maxTokens: 1_048_576 },
      { catalogId: 'b', model: 'MODEL_PLACEHOLDER_M318', displayName: 'Gemini 3.8 Flash (High)', maxTokens: 1_048_576, maxOutputTokens: 65_536 },
    ]),
  );
  assert.equal(catalog.get('MODEL_PLACEHOLDER_M318')?.name, 'Gemini 3.8 Flash (High)');
  assert.equal(catalog.get('MODEL_PLACEHOLDER_M318')?.maxOutput, 65_536);
});

test('buildCatalog tolerates a malformed payload', () => {
  assert.equal(buildCatalog(null).size, 0);
  assert.equal(buildCatalog({}).size, 0);
  assert.equal(buildCatalog({ response: { models: 'nope' } }).size, 0);
});

test('resolveModel prefers live data, then the static fallback, then honesty', () => {
  const catalog = buildCatalog(CATALOG);

  const live = resolveModel('MODEL_PLACEHOLDER_M318', catalog);
  assert.equal(live?.source, 'live');
  assert.equal(live?.contextLimit, 1_048_576);

  const fallback = resolveModel('MODEL_PLACEHOLDER_M421', catalog);
  assert.equal(fallback?.source, 'fallback');
  assert.equal(fallback?.name, 'Gemini 4 Argon');

  const unknown = resolveModel('MODEL_PLACEHOLDER_M999', catalog);
  assert.equal(unknown?.source, 'unknown');
  assert.equal(unknown?.contextLimit, null, 'capacity must never be invented');
  assert.equal(unknown?.name, 'M999');
});

test('shortModelId strips only the placeholder prefix', () => {
  assert.equal(shortModelId('MODEL_PLACEHOLDER_M318'), 'M318');
  assert.equal(shortModelId('MODEL_OPENAI_GPT_OSS_120B_MEDIUM'), 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM');
});

test('parseUserStatus extracts the account and the live picker', () => {
  const catalog = buildCatalog(CATALOG);
  const { account, picker } = parseUserStatus(
    userStatusPayload({
      name: 'Test User',
      email: 'test@example.com',
      entries: [
        { label: 'Gemini 3.8 Flash (High)', model: 'MODEL_PLACEHOLDER_M318', remainingFraction: 0.836511 },
        { label: 'Claude Opus 4.6 (Thinking)', model: 'MODEL_PLACEHOLDER_M26', remainingFraction: 1 },
      ],
    }),
    catalog,
  );

  assert.equal(account?.name, 'Test User');
  assert.equal(account?.email, 'test@example.com');
  assert.equal(account?.planName, 'Pro');
  assert.equal(account?.tierName, 'Google AI Pro');
  assert.equal(account?.monthlyPromptCredits, 50_000);

  assert.equal(picker.length, 2);
  assert.equal(picker[0].label, 'Gemini 3.8 Flash (High)');
  assert.ok(Math.abs((picker[0].quotaPercent ?? 0) - 83.6511) < 0.001);
  assert.equal(picker[0].contextLimit, 1_048_576);
  assert.equal(picker[1].quotaPercent, 100);
});

test('parseUserStatus survives a response with no account block', () => {
  const result = parseUserStatus({}, buildCatalog(CATALOG));
  assert.equal(result.account, null);
  assert.deepEqual(result.picker, []);
});

test('quotaFor matches the active model', () => {
  const { picker } = parseUserStatus(userStatusPayload(), buildCatalog(CATALOG));
  assert.equal(quotaFor('MODEL_PLACEHOLDER_M318', picker)?.label, 'Gemini 3.8 Flash (High)');
  assert.equal(quotaFor('MODEL_PLACEHOLDER_M999', picker), null);
  assert.equal(quotaFor(null, picker), null);
});

test('pricing follows the published cutover dates', () => {
  const before = priceFor('MODEL_PLACEHOLDER_M421', Date.parse('2026-11-02T00:00:00Z'));
  assert.deepEqual(before, { input: 2, output: 10, cacheRead: 0.1 });

  const after = priceFor('MODEL_PLACEHOLDER_M421', Date.parse('2026-12-01T00:00:00Z'));
  assert.deepEqual(after, { input: 4, output: 20, cacheRead: 0.2 });
});

test('Flash pricing steps up in 2027', () => {
  assert.equal(priceFor('MODEL_PLACEHOLDER_M318', Date.parse('2026-12-31T23:00:00Z'))?.input, 0.75);
  assert.equal(priceFor('MODEL_PLACEHOLDER_M318', Date.parse('2027-01-01T00:00:00Z'))?.input, 1.5);
});

test('models without a published rate resolve to no price', () => {
  assert.equal(priceFor('MODEL_PLACEHOLDER_M26', Date.now()), null);
  assert.equal(priceFor(null, Date.now()), null);
});

test('cost estimation combines fresh input, cached input, and output', () => {
  const cost = estimateCost({ input: 1_000_000, cacheRead: 1_000_000, output: 1_000_000 }, 'MODEL_PLACEHOLDER_M421', Date.parse('2026-11-02T00:00:00Z'));
  assert.ok(cost !== null);
  assert.ok(Math.abs(cost - (2 + 0.1 + 10)) < 1e-9);
});

test('cost estimation declines when the model has no rate', () => {
  assert.equal(estimateCost({ input: 1_000_000, cacheRead: 0, output: 0 }, 'MODEL_PLACEHOLDER_M26'), null);
});
