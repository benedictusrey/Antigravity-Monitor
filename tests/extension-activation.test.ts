import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import { createVscodeMock, installVscodeMock } from './vscode-mock';

test('activation wires up commands, the status bar, and an output channel', () => {
  const mock = createVscodeMock();
  installVscodeMock(mock);

  // Required after the mock is installed: the module imports `vscode` at load.
  const extension = require('../src/app/extension') as typeof import('../src/app/extension');

  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-store-'));
  const context = {
    subscriptions: [] as Array<{ dispose(): void }>,
    workspaceState: {
      get: (_key: string, fallback: unknown) => fallback,
      update: async () => undefined,
    },
    globalStorageUri: { fsPath: storage },
    extensionUri: { fsPath: path.resolve(__dirname, '..', '..') },
  };

  extension.activate(context as never);

  assert.deepEqual(
    mock.registrations.map((registration) => registration.id).sort(),
    [
      'antigravityMonitor.openDashboard',
      'antigravityMonitor.refresh',
      'antigravityMonitor.selectBackend',
      'antigravityMonitor.showDiagnostics',
    ],
  );

  assert.equal(mock.statusBarItems.length, 1, 'exactly one status bar item');
  assert.match(String(mock.statusBarItems[0].text), /Starting/);
  assert.equal(mock.statusBarItems[0].command, 'antigravityMonitor.openDashboard');

  assert.ok(
    mock.outputLines.some((line) => line.includes('activating')),
    'activation is logged to the output channel',
  );

  extension.deactivate();
  // Teardown must be idempotent: VS Code can call it more than once.
  extension.deactivate();

  fs.rmSync(storage, { recursive: true, force: true });
});
