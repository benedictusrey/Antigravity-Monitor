import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Monitor } from '../src/app/monitor';
import { createVscodeMock, installVscodeMock } from './vscode-mock';

test('inactive low models remain armed when the user switches to them', () => {
  const mock = createVscodeMock();
  installVscodeMock(mock);
  const extension = require('../src/app/extension') as typeof import('../src/app/extension');
  const originalStart = Monitor.prototype.start;
  let running!: Monitor;
  Monitor.prototype.start = function start(): void { running = this; };
  const context = {
    subscriptions: [],
    workspaceState: { get: (_key: string, fallback: unknown) => fallback, update: async () => undefined },
    globalStorageUri: { fsPath: '' }, extensionUri: { fsPath: '' },
  };
  try {
    extension.activate(context as never);
    const internal = running as any;
    const base = running.getSnapshot();
    const models = [
      { modelId: 'first', label: 'First', quotaPercent: 50 },
      { modelId: 'second', label: 'Second', quotaPercent: 10 },
    ];
    const emit = (modelId: string): void => internal.deps.onSnapshot({
      ...base, conversation: { modelId, usage: null }, models,
    });
    emit('first');
    assert.equal(mock.warnings.length, 0);
    emit('second');
    assert.equal(mock.warnings.length, 1);
    emit('second');
    assert.equal(mock.warnings.length, 1, 'repeated low readings warn once');
    models[1].quotaPercent = 50;
    emit('second');
    models[1].quotaPercent = 10;
    emit('second');
    assert.equal(mock.warnings.length, 2, 'recovery re-arms the active model');
    models[1].quotaPercent = 50;
    emit('first');
    models[1].quotaPercent = 10;
    emit('second');
    assert.equal(mock.warnings.length, 3, 'inactive recovery also re-arms a previously warned model');
  } finally {
    extension.deactivate();
    Monitor.prototype.start = originalStart;
  }
});
