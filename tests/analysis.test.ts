import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CompressionDetector, analyzeSteps, estimateTokens, parseModelUsage } from '../src/core/analysis';
import {
  checkpointStep,
  generateImageStep,
  plannerStep,
  runCommandStep,
  userInputStep,
} from './fixtures';

test('the latest provider snapshot replaces earlier ones rather than accumulating', () => {
  const steps = [
    userInputStep({ text: 'first' }),
    plannerStep({ input: 1000, output: 100, cacheRead: 500 }),
    plannerStep({ input: 500, output: 50, cacheRead: 2000 }),
  ];

  const analysis = analyzeSteps(steps);

  assert.equal(analysis.measured?.total, 2550, '500 fresh + 2000 cache + 50 output');
  assert.equal(analysis.used, 2550);
  assert.equal(analysis.source, 'measured');
  assert.equal(analysis.plannerCount, 2);
  assert.equal(analysis.malformedSnapshots, 0);
});

test('cached input counts toward the context window', () => {
  const steps = [plannerStep({ input: 10, output: 10, cacheRead: 100_000 })];
  const analysis = analyzeSteps(steps);
  assert.equal(analysis.measured?.total, 100_020);
});

test('cache creation tokens are included and default to zero when absent', () => {
  const withCreation = analyzeSteps([plannerStep({ input: 100, output: 10, cacheCreation: 900 })]);
  assert.equal(withCreation.measured?.total, 1010);

  const withoutCreation = analyzeSteps([plannerStep({ input: 100, output: 10 })]);
  assert.equal(withoutCreation.measured?.total, 110);
  assert.equal(withoutCreation.measured?.cacheCreate, 0);
});

test('output tokens already include thinking and are not double counted', () => {
  const analysis = analyzeSteps([plannerStep({ input: 0, output: 300 })]);
  assert.equal(analysis.measured?.output, 300);
  assert.equal(analysis.measured?.total, 300);
});

test('conversation totals sum every response for usage reporting', () => {
  const steps = [
    plannerStep({ input: 100, output: 10, cacheRead: 50 }),
    runCommandStep(),
    plannerStep({ input: 200, output: 20, cacheRead: 150 }),
  ];
  const analysis = analyzeSteps(steps);
  assert.deepEqual(analysis.totals, {
    input: 300,
    cacheRead: 200,
    cacheCreate: 0,
    output: 30,
    calls: 2,
  });
});

test('a malformed snapshot is counted, not read as zero', () => {
  const steps = [plannerStep({ input: -5, output: 100 })];
  const analysis = analyzeSteps(steps);

  assert.equal(analysis.malformedSnapshots, 1);
  assert.equal(analysis.measured, null);
  assert.equal(analysis.totals.calls, 0);
  assert.equal(analysis.plannerCount, 1);
});

test('a response without usage is skipped without being called malformed', () => {
  const analysis = analyzeSteps([plannerStep({ input: 1, output: 1, omitUsage: true })]);
  assert.equal(analysis.plannerCount, 1);
  assert.equal(analysis.malformedSnapshots, 0);
  assert.equal(analysis.measured, null);
});

test('a later malformed snapshot does not discard the last valid one', () => {
  const steps = [
    plannerStep({ input: 1000, output: 100 }),
    plannerStep({ input: 'oops', output: 10 }),
  ];
  const analysis = analyzeSteps(steps);
  assert.equal(analysis.measured?.total, 1100);
  assert.equal(analysis.malformedSnapshots, 1);
});

test('a new user turn after a snapshot is reported as an estimate', () => {
  const steps = [
    plannerStep({ input: 1000, output: 100 }),
    userInputStep({ text: 'x'.repeat(400) }),
  ];
  const analysis = analyzeSteps(steps);

  assert.equal(analysis.source, 'estimated');
  assert.equal(analysis.measured?.total, 1100);
  assert.ok(analysis.estimatedDelta > 0);
  assert.equal(analysis.used, 1100 + analysis.estimatedDelta);
});

test('with no snapshot at all the reading is still produced as an estimate', () => {
  const steps = [userInputStep({ text: 'hello world' }), plannerStep({ input: 1, output: 1, omitUsage: true })];
  const analysis = analyzeSteps(steps);
  assert.equal(analysis.source, 'estimated');
  assert.ok((analysis.used ?? 0) > 0);
});

test('an empty trajectory reports nothing rather than zero', () => {
  const analysis = analyzeSteps([]);
  assert.equal(analysis.used, null);
  assert.equal(analysis.source, 'none');
  assert.equal(analysis.stepCount, 0);
});

test('the composer model is used before the first response arrives', () => {
  const analysis = analyzeSteps([userInputStep({ planModel: 'MODEL_PLACEHOLDER_M26' })]);
  assert.equal(analysis.modelId, 'MODEL_PLACEHOLDER_M26');
});

test('a response model overrides the composer model', () => {
  const analysis = analyzeSteps([
    userInputStep({ planModel: 'MODEL_PLACEHOLDER_M26' }),
    plannerStep({ input: 10, output: 1, model: 'MODEL_PLACEHOLDER_M318' }),
  ]);
  assert.equal(analysis.modelId, 'MODEL_PLACEHOLDER_M318');
});

test('image generation steps are counted without affecting context', () => {
  const analysis = analyzeSteps([
    plannerStep({ input: 100, output: 10 }),
    generateImageStep(),
    generateImageStep(),
  ]);
  assert.equal(analysis.imageSteps, 2);
  assert.equal(analysis.measured?.total, 110);
});

test('checkpoints are counted but do not override the displayed model', () => {
  const analysis = analyzeSteps([
    plannerStep({ input: 100, output: 10, model: 'MODEL_PLACEHOLDER_M318' }),
    checkpointStep(),
  ]);
  assert.equal(analysis.checkpoints, 1);
  assert.equal(analysis.modelId, 'MODEL_PLACEHOLDER_M318');
});

test('ASCII text is estimated near four characters per token', () => {
  const step = userInputStep({ text: 'a'.repeat(400) });
  assert.equal(estimateTokens([step], 0), 100);
});

test('non-ASCII text is estimated closer to one and a half characters per token', () => {
  const step = userInputStep({ text: '\u4f60'.repeat(150) });
  assert.equal(estimateTokens([step], 0), 100);
});

test('estimateTokens only reads fields that occupy context', () => {
  const step = runCommandStep({ command: 'ls', output: 'abc' });
  // 25 characters of tool-call arguments + 2 of command + 3 of output.
  assert.equal(estimateTokens([step], 0), Math.ceil(30 / 4));
});

test('parseModelUsage rejects structurally impossible snapshots', () => {
  assert.equal(parseModelUsage(null, null), null);
  assert.equal(parseModelUsage({ inputTokens: '1' }, null), null, 'missing output');
  assert.equal(parseModelUsage({ inputTokens: '1', outputTokens: '1' }, 'now')?.total, 2);
});

test('compression is detected from a measured drop', () => {
  const detector = new CompressionDetector();
  const before = analyzeSteps([plannerStep({ input: 100_000, output: 1_000 })]);

  assert.equal(detector.observe('a', before), false, 'first observation establishes a baseline');

  const after = analyzeSteps([plannerStep({ input: 70_000, output: 1_000 })]);
  assert.equal(detector.observe('a', after), true, '30% drop exceeds the threshold');
});

test('a modest drop is not reported as compression', () => {
  const detector = new CompressionDetector();
  detector.observe('a', analyzeSteps([plannerStep({ input: 100_000, output: 1_000 })]));
  const after = analyzeSteps([plannerStep({ input: 98_000, output: 1_000 })]);
  assert.equal(detector.observe('a', after), false);
});

test('an undo is never mistaken for compression', () => {
  const detector = new CompressionDetector();
  const before = analyzeSteps([
    plannerStep({ input: 100_000, output: 1_000 }),
    plannerStep({ input: 100_000, output: 1_000 }),
  ]);
  detector.observe('a', before);

  // Rewinding removes steps and shrinks the context, but the step count falls.
  const after = analyzeSteps([plannerStep({ input: 60_000, output: 1_000 })]);
  assert.equal(detector.observe('a', after), false);
});

test('compression is not detected across a model switch', () => {
  const detector = new CompressionDetector();
  detector.observe('a', analyzeSteps([plannerStep({ input: 100_000, output: 1_000, model: 'MODEL_PLACEHOLDER_M318' })]));
  const after = analyzeSteps([plannerStep({ input: 10_000, output: 1_000, model: 'MODEL_PLACEHOLDER_M26' })]);
  assert.equal(detector.observe('a', after), false);
});

test('estimated readings never trigger compression detection', () => {
  const detector = new CompressionDetector();
  detector.observe('a', analyzeSteps([plannerStep({ input: 100_000, output: 1_000 })]));
  const after = analyzeSteps([
    plannerStep({ input: 100_000, output: 1_000 }),
    userInputStep({ text: 'hello' }),
  ]);
  assert.equal(detector.observe('a', after), false);
});
