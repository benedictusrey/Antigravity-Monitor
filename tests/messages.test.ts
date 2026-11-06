import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseMessage } from '../src/core/messages';

test('simple notifications are accepted', () => {
  assert.deepEqual(parseMessage({ type: 'ready' }), { type: 'ready' });
  assert.deepEqual(parseMessage({ type: 'refresh' }), { type: 'refresh' });
  assert.deepEqual(parseMessage({ type: 'diagnostics' }), { type: 'diagnostics' });
});

test('selection messages carry a bounded identifier', () => {
  assert.deepEqual(parseMessage({ type: 'selectBackend', id: 'https:50062' }), {
    type: 'selectBackend',
    id: 'https:50062',
  });
  assert.deepEqual(parseMessage({ type: 'selectSession', id: 'd2681d8c-9ebd' }), {
    type: 'selectSession',
    id: 'd2681d8c-9ebd',
  });
});

test('selection messages without a usable identifier are dropped', () => {
  assert.equal(parseMessage({ type: 'selectBackend' }), null);
  assert.equal(parseMessage({ type: 'selectBackend', id: '' }), null);
  assert.equal(parseMessage({ type: 'selectBackend', id: 42 }), null);
  assert.equal(parseMessage({ type: 'selectBackend', id: 'x'.repeat(201) }), null);
});

test('setting updates require a known key and a typed value', () => {
  assert.deepEqual(parseMessage({ type: 'updateSetting', key: 'showQuota', value: false }), {
    type: 'updateSetting',
    key: 'showQuota',
    value: false,
  });
  assert.deepEqual(parseMessage({ type: 'updateSetting', key: 'pollIntervalMs', value: 3000 }), {
    type: 'updateSetting',
    key: 'pollIntervalMs',
    value: 3000,
  });
});

test('the display mode is the only string setting, and only two values exist', () => {
  assert.deepEqual(parseMessage({ type: 'updateSetting', key: 'displayMode', value: 'essentials' }), {
    type: 'updateSetting',
    key: 'displayMode',
    value: 'essentials',
  });
  assert.deepEqual(parseMessage({ type: 'updateSetting', key: 'displayMode', value: 'full' }), {
    type: 'updateSetting',
    key: 'displayMode',
    value: 'full',
  });
  assert.equal(parseMessage({ type: 'updateSetting', key: 'displayMode', value: 'fancy' }), null);
  assert.equal(parseMessage({ type: 'updateSetting', key: 'showQuota', value: 'true' }), null);
});

test('setting updates reject unknown keys', () => {
  assert.equal(parseMessage({ type: 'updateSetting', key: 'executeCommand', value: true }), null);
  assert.equal(parseMessage({ type: 'updateSetting', key: 'constructor', value: true }), null);
});

test('setting updates reject unusable values', () => {
  assert.equal(parseMessage({ type: 'updateSetting', key: 'showQuota', value: 'yes' }), null);
  assert.equal(parseMessage({ type: 'updateSetting', key: 'pollIntervalMs', value: Number.NaN }), null);
  assert.equal(parseMessage({ type: 'updateSetting', key: 'pollIntervalMs', value: null }), null);
  assert.equal(parseMessage({ type: 'updateSetting', key: 'pollIntervalMs' }), null);
  assert.equal(parseMessage({ type: 'updateSetting', key: 'pollIntervalMs', value: false }), null);
  assert.equal(parseMessage({ type: 'updateSetting', key: 'pollIntervalMs', value: -1 }), null);
  assert.equal(parseMessage({ type: 'updateSetting', key: 'snippetWeekly', value: 100 }), null);
  assert.deepEqual(parseMessage({ type: 'updateSetting', key: 'snippetWeekly', value: true }),
    { type: 'updateSetting', key: 'snippetWeekly', value: true });
  assert.deepEqual(parseMessage({ type: 'updateSetting', key: 'displayMode', value: 'custom' }),
    { type: 'updateSetting', key: 'displayMode', value: 'custom' });
});

test('unknown or malformed messages are dropped', () => {
  assert.equal(parseMessage(null), null);
  assert.equal(parseMessage(undefined), null);
  assert.equal(parseMessage('refresh'), null);
  assert.equal(parseMessage([{ type: 'refresh' }]), null);
  assert.equal(parseMessage({ type: 'openFile' }), null);
  assert.equal(parseMessage({}), null);
});
