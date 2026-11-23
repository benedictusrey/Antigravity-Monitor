import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as vm from 'node:vm';
import { test } from 'node:test';

// The injector is ESM outside src/, so it is imported at runtime (see badge.test.ts).
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

test('the injector writes only into local/app page targets, never into workers or external browser tabs', async () => {
  const file = path.resolve(__dirname, '..', '..', 'tools', 'cdp-badge.mjs');
  const badge = await dynamicImport(pathToFileURL(file).href);
  assert.equal(badge.isAttachableTarget({ type: 'page', url: 'https://127.0.0.1:58551/c/abc', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/1' }, 'http://127.0.0.1:4599'), true);
  assert.equal(badge.isAttachableTarget({ type: 'page', url: 'vscode-webview://abc/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/2' }, 'http://127.0.0.1:4599'), true);
  assert.equal(badge.isAttachableTarget({ type: 'page', url: 'https://gemini.google.com/app', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/3' }, 'http://127.0.0.1:4599'), false);
  assert.equal(badge.isAttachableTarget({ type: 'page', url: 'http://127.0.0.1:4599/', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/4' }, 'http://127.0.0.1:4599'), false);
  assert.equal(badge.isAttachableTarget({ type: 'service_worker', webSocketDebuggerUrl: 'ws://x' }), false);
  assert.equal(badge.isAttachableTarget({ type: 'page' }), false);

  const externalProbe = vm.runInNewContext(badge.PROBE, {
    window: {},
    location: { protocol: 'https:', hostname: 'gemini.google.com' },
    document: { querySelector: () => ({}), querySelectorAll: () => [] },
  });
  assert.equal(externalProbe, false);
});

test('rendererPayload shows Authorization needed when the backend is unauthorized', async () => {
  const file = path.resolve(__dirname, '..', '..', 'tools', 'cdp-badge.mjs');
  const badge = await dynamicImport(pathToFileURL(file).href);
  const payload = badge.rendererPayload(
    { status: 'unauthorized', prefs: { displayMode: 'full' } },
    { backend: { id: 'https:58551', app: 'app', reachable: false }, conversation: null },
    { viewState: 'conversation', conversationId: '11111111-2222-3333-4444-555555555555', contextKey: '1', modelName: null },
  );
  assert.equal(payload.show, true);
  assert.equal(payload.essentials, 'Authorization needed');
  assert.equal(payload.card.sourceLabel, 'Auth');
});

test('devtoolsEndpoints discovers additional Antigravity channel directories automatically', async () => {
  const file = path.resolve(__dirname, '..', '..', 'tools', 'cdp-badge.mjs');
  const badge = await dynamicImport(pathToFileURL(file).href);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-cdp-'));
  try {
    const base = process.platform === 'darwin' ? path.join(root, 'Library', 'Application Support') : root;
    const canaryDir = path.join(base, 'Antigravity Canary');
    fs.mkdirSync(canaryDir, { recursive: true });
    fs.writeFileSync(path.join(canaryDir, 'DevToolsActivePort'), '9333\n/devtools/browser/test\n');
    const endpoints = badge.devtoolsEndpoints({ APPDATA: root, XDG_CONFIG_HOME: root }, process.platform, root);
    assert.ok(endpoints.some((entry: { file: string; app: string }) => entry.file.includes('Antigravity Canary') && entry.app === 'app'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('PROBE recognizes Antigravity pages via __APP_CONFIG__.productName on loopback even if DOM selectors change', async () => {
  const file = path.resolve(__dirname, '..', '..', 'tools', 'cdp-badge.mjs');
  const badge = await dynamicImport(pathToFileURL(file).href);
  const matched = vm.runInNewContext(badge.PROBE, {
    window: { __APP_CONFIG__: { productName: 'antigravity', appVersion: '2.35.0' } },
    location: { hostname: '127.0.0.1' },
    document: { querySelector: () => null, querySelectorAll: () => [] },
  });
  assert.equal(matched, true);
});

test('extractCsrfHeader captures loopback CSRF headers for the matching backend port only', async () => {
  const file = path.resolve(__dirname, '..', '..', 'tools', 'cdp-badge.mjs');
  const badge = await dynamicImport(pathToFileURL(file).href);
  assert.equal(
    badge.extractCsrfHeader({
      request: {
        url: 'https://127.0.0.1:58551/exa.language_server_pb.LanguageServerService/GetUserStatus',
        headers: { 'x-codeium-csrf-token': 'tok-123' },
      },
    }, 58551),
    'tok-123',
  );
  assert.equal(
    badge.extractCsrfHeader({
      request: {
        url: 'https://127.0.0.1:58551/api',
        headers: { 'X-Antigravity-Csrf-Token': 'future-tok-456' },
      },
    }, 58551),
    'future-tok-456',
  );
  assert.equal(
    badge.extractCsrfHeader({
      request: {
        url: 'https://example.com:58551/api',
        headers: { 'x-codeium-csrf-token': 'should-ignore' },
      },
    }, 58551),
    null,
  );
  assert.equal(
    badge.extractCsrfHeader({
      request: {
        url: 'https://127.0.0.1:9999/api',
        headers: { 'x-codeium-csrf-token': 'wrong-port' },
      },
    }, 58551),
    null,
  );
});
