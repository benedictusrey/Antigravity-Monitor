import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<any>;

async function loadStateModule() {
  const file = path.resolve(__dirname, '..', '..', 'tools', 'state.mjs');
  return dynamicImport(pathToFileURL(file).href);
}

const DEFAULTS = {
  pollIntervalMs: 2000,
  warningThreshold: 80,
  showQuota: true,
  maskPersonalInfo: true,
  maxPayloadMb: 128,
  displayMode: 'full',
};

test('stored config overrides defaults only where it is valid', async () => {
  const { mergeConfig } = await loadStateModule();

  const merged = mergeConfig(DEFAULTS, {
    pollIntervalMs: 5000,
    warningThreshold: 900,
    displayMode: 'essentials',
    showQuota: false,
    maskPersonalInfo: 'yes',
  });

  assert.equal(merged.pollIntervalMs, 5000);
  assert.equal(merged.warningThreshold, 100, 'clamped into range');
  assert.equal(merged.displayMode, 'essentials');
  assert.equal(merged.showQuota, false);
  assert.equal(merged.maskPersonalInfo, true, 'wrong type keeps the default');
});

test('unknown display modes fall back to the default', async () => {
  const { mergeConfig } = await loadStateModule();
  assert.equal(mergeConfig(DEFAULTS, { displayMode: 'fancy' }).displayMode, 'full');
  assert.equal(mergeConfig(DEFAULTS, {}).displayMode, 'full');
  assert.equal(mergeConfig(DEFAULTS, null).displayMode, 'full');
});

test('custom snippet flags survive the persisted configuration boundary', async () => {
  const { mergeConfig } = await loadStateModule();
  const value = mergeConfig(DEFAULTS, { displayMode: 'custom', snippetWeekly: true, snippetFiveHour: false, snippetModel: 'yes' });
  assert.equal(value.displayMode, 'custom');
  assert.equal(value.snippetWeekly, true);
  assert.equal(value.snippetFiveHour, false);
  assert.equal(value.snippetModel, undefined);
});

test('a corrupt config block is ignored wholesale', async () => {
  const { mergeConfig } = await loadStateModule();
  assert.deepEqual(mergeConfig(DEFAULTS, 'nope'), DEFAULTS);
  assert.deepEqual(mergeConfig(DEFAULTS, []), DEFAULTS);
});

test('state round-trips through disk', async () => {
  const { saveState, loadState } = await loadStateModule();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-state-'));
  const file = path.join(dir, 'state.json');

  saveState(file, {
    config: { displayMode: 'custom', snippetWeekly: true, snippetFiveHour: true, snippetModel: false },
    buckets: { '2026-11-02|MODEL_X': { input: 1, cacheRead: 2, cacheCreate: 0, output: 3 } },
    limits: { weekly: { percent: 80, resetText: '6d 15h' }, readAt: 1_760_000_000_000 },
  });
  const loaded = loadState(file);

  assert.equal(loaded.version, 1);
  assert.equal(loaded.config.displayMode, 'custom');
  assert.equal(loaded.config.snippetWeekly, true);
  assert.equal(loaded.config.snippetFiveHour, true);
  assert.equal(loaded.config.snippetModel, false);
  assert.equal(loaded.buckets['2026-11-02|MODEL_X'].output, 3);
  assert.equal(loaded.limits.weekly.percent, 80, 'weekly survives a restart');

  // Atomic write: the temp file must not survive.
  assert.deepEqual(fs.readdirSync(dir), ['state.json']);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a missing or corrupt file yields empty state instead of throwing', async () => {
  const { loadState } = await loadStateModule();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-state-'));
  const corrupt = path.join(dir, 'corrupt.json');
  fs.writeFileSync(corrupt, '{"version": 99, "config": {"displayMode": "essentials"}}');

  assert.deepEqual(loadState(path.join(dir, 'missing.json')), { version: 1, config: {}, buckets: {}, limits: null });
  assert.deepEqual(loadState(corrupt), { version: 1, config: {}, buckets: {}, limits: null }, 'future version ignored');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a tampered weekly reading is discarded, not displayed', async () => {
  const { sanitiseLimits } = await loadStateModule();

  assert.deepEqual(sanitiseLimits({ weekly: { percent: 80, resetText: '6d 15h' }, readAt: 1 }), {
    weekly: { percent: 80, resetText: '6d 15h' },
    readAt: 1,
  });
  assert.equal(sanitiseLimits({ weekly: { percent: 80, resetText: '6d' } }), null, 'no read time');
  assert.equal(sanitiseLimits({ weekly: { percent: -4 }, readAt: 1 }), null);
  assert.equal(sanitiseLimits({ weekly: { percent: 101 }, readAt: 1 }), null);
  assert.equal(sanitiseLimits({ readAt: 1 }), null);
  assert.equal(sanitiseLimits(null), null);
});

test('buckets with junk numbers are rebuilt rather than trusted', async () => {
  const { sanitiseBuckets } = await loadStateModule();

  const buckets = sanitiseBuckets({
    '2026-11-02|A': { input: 10, cacheRead: -5, cacheCreate: 'x', output: 3 },
    '2026-11-02|B': 'not a bucket',
  });

  assert.deepEqual(buckets.get('2026-11-02|A'), { input: 10, cacheRead: 0, cacheCreate: 0, output: 3 });
  assert.equal(buckets.has('2026-11-02|B'), false);
});
