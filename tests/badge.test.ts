import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

/**
 * The badge lives outside `src/` and is ESM, so it is imported at runtime.
 * `new Function` keeps TypeScript from rewriting `import()` into `require()`.
 */
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<any>;

async function loadBadgeModule() {
  const file = path.resolve(__dirname, '..', '..', 'tools', 'cdp-badge.mjs');
  return dynamicImport(pathToFileURL(file).href);
}

function snapshot(
  percent: number | null,
  source: 'measured' | 'estimated' = 'measured',
  displayMode: 'essentials' | 'full' = 'full',
  quotaPercent: number | null = 83.65,
) {
  const capacity = 1_048_576;
  return {
    quota: { observedAt: Date.now(), status: 'live', error: null, groups: [{
      id: 'gemini', label: 'Gemini Models', buckets: quotaPercent === null ? [] : [{
        id: 'gemini-5h', window: '5h', percent: quotaPercent,
        resetsAt: new Date(Date.now() + 4 * 3600 * 1000 + 30_000).toISOString(), enabled: true,
      }],
    }] },
    prefs: { warningThreshold: 80, displayMode },
    generatedAt: Date.parse('2026-11-02T03:00:00Z'),
    models:
      quotaPercent === null
        ? []
        : [
            {
              modelId: 'MODEL_PLACEHOLDER_M318',
              label: 'Gemini 3.8 Flash (High)',
              quotaPercent,
              resetsAt: new Date(Date.now() + 4 * 3600 * 1000 + 30_000).toISOString(),
              active: true,
            },
          ],
    conversation: {
      id: 'c1',
      title: 'Parser integration tests',
      modelName: 'Gemini 3.8 Flash (High)',
      modelId: 'MODEL_PLACEHOLDER_M318',
      usage:
        percent === null
          ? null
          : {
              used: 187_199,
              capacity,
              remaining: capacity - 187_199,
              percent,
              source,
              measuredAt: '2026-11-02T02:59:30Z',
            },
    },
  };
}

test('both densities are sent so a click needs no round trip', async () => {
  const { toPayload } = await loadBadgeModule();
  const payload = toPayload(snapshot(17.9));

  assert.equal(payload.show, true);
  assert.equal(payload.density, 'full');
  assert.equal(payload.essentials, '17.9%');
  assert.equal(payload.full, '17.9% · 861.4k left');
  assert.equal(payload.aria, 'Context window 17.9% used');
  assert.match(payload.title, /187\.2k \/ 1\.0M/);
  assert.match(payload.title, /measured/);

  const serialised = JSON.stringify(payload);
  assert.ok(!serialised.includes('MODEL_PLACEHOLDER'), 'model id stays out of the page');
  assert.ok(!/token|csrf/i.test(serialised), 'no credential material crosses the bridge');
});

test('the starting density follows the setting', async () => {
  const { toPayload } = await loadBadgeModule();
  assert.equal(toPayload(snapshot(17.9, 'measured', 'essentials')).density, 'essentials');
  assert.equal(toPayload(snapshot(17.9, 'measured', 'full')).density, 'full');
});

test('an estimate is marked in both densities', async () => {
  const { toPayload } = await loadBadgeModule();
  const payload = toPayload(snapshot(17.9, 'estimated'));
  assert.equal(payload.essentials, '~17.9%');
  assert.match(payload.full, /^~17\.9%/);
});

test('warning bands change the dot only', async () => {
  const { toPayload } = await loadBadgeModule();
  assert.equal(toPayload(snapshot(17.9)).color, 'currentColor');
  assert.equal(toPayload(snapshot(85)).color, '#d29922');
  assert.equal(toPayload(snapshot(96)).color, '#e5534b');
});

test('nothing is rendered without a reading', async () => {
  const { toPayload } = await loadBadgeModule();

  assert.deepEqual(toPayload(null), { show: false });
  assert.deepEqual(toPayload({}), { show: false });
  assert.deepEqual(toPayload({ conversation: null }), { show: false });
  assert.deepEqual(toPayload(snapshot(null)), { show: false });
});

test('a percentage is rounded to one decimal and never shows 100.0', async () => {
  const { toPayload } = await loadBadgeModule();
  assert.equal(toPayload(snapshot(22.33)).essentials, '22.3%');
  assert.equal(toPayload(snapshot(99.96)).essentials, '100%');
  assert.equal(toPayload(snapshot(100)).essentials, '100%');
});

test('a missing remaining figure drops the suffix instead of printing a placeholder', async () => {
  const { toPayload } = await loadBadgeModule();
  const withoutRemaining: any = snapshot(17.9);
  withoutRemaining.conversation.usage.remaining = null;
  assert.equal(toPayload(withoutRemaining).full, '17.9%');
});

test('the card is pre-formatted so the page holds no rules', async () => {
  const { toPayload } = await loadBadgeModule();
  const card = toPayload(snapshot(17.9)).card;

  assert.equal(card.title, 'Parser integration tests');
  assert.equal(card.percentText, '17.9%');
  assert.equal(card.percent, 17.9);
  assert.equal(card.volumeText, '187.2k / 1.0M');
  assert.equal(card.remainingText, '861.4k left');
  assert.equal(card.model, 'Gemini 3.8 Flash (High)');
  assert.equal(card.sourceLabel, 'Measured');
  assert.deepEqual(card.session, { percent: 83.65, resetText: '4h 00m' });
  assert.equal(card.limits, null, 'weekly stays out of the payload unless the page supplied it');
  assert.match(card.updatedText, /^\d{2}:\d{2}:\d{2}$/);
});

test('the card keeps a full 5-hour quota, because the card is the detail view', async () => {
  const { toPayload } = await loadBadgeModule();
  const card = toPayload(snapshot(17.9, 'measured', 'full', 100)).card;
  assert.deepEqual(card.session, { percent: 100, resetText: '4h 00m' });
  assert.equal(toPayload(snapshot(17.9, 'measured', 'full', null)).card.session, null);
});

test('missing weekly quota stays absent instead of reading legacy caches', async () => {
  const { toPayload } = await loadBadgeModule();
  assert.equal(toPayload(snapshot(17.9)).card.limits, null);
  const expired = snapshot(17.9);
  expired.quota.groups[0].buckets.push({ id: 'gemini-weekly', window: 'weekly', percent: 80,
    resetsAt: new Date(Date.now() - 60_000).toISOString(), enabled: true });
  assert.equal(toPayload(expired).card.limits, null);
});

test('a cached weekly countdown ages instead of lying', async () => {
  const { toPayload } = await loadBadgeModule();
  const state = snapshot(17.9);
  state.quota.groups[0].buckets.push({ id: 'gemini-weekly', window: 'weekly', percent: 80,
    resetsAt: new Date(Date.now() + 4 * 86400000 + 15 * 3600000).toISOString(), enabled: true });
  const weekly = toPayload(state).card.limits.weekly;
  assert.match(weekly.resetText, /^4d (14h|15h)/);
  assert.equal(weekly.percent, 80);
});

test('the card marks an estimate', async () => {
  const { toPayload } = await loadBadgeModule();
  assert.equal(toPayload(snapshot(17.9, 'estimated')).card.sourceLabel, 'Estimated');
});

test('the DevTools port file is read defensively', async () => {
  const { readDevtoolsPort } = await loadBadgeModule();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-badge-'));
  const good = path.join(dir, 'good');
  const bad = path.join(dir, 'bad');

  fs.writeFileSync(good, '53254\n/devtools/browser/d40dd214\n');
  fs.writeFileSync(bad, 'not-a-port\n');

  assert.equal(readDevtoolsPort(good), 53254);
  assert.equal(readDevtoolsPort(bad), null);
  assert.equal(readDevtoolsPort(path.join(dir, 'missing')), null);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('candidate endpoints cover supported desktop and Insiders hosts in order', async () => {
  const { devtoolsEndpoints, resolveCandidateEndpoints } = await loadBadgeModule();
  const env = { APPDATA: 'C:\\Users\\test\\AppData\\Roaming' };
  const endpoints = devtoolsEndpoints(env, 'win32');
  const files = endpoints.map((entry: any) => entry.file);

  assert.equal(files.length, 4);
  assert.match(files[0], /Antigravity\\DevToolsActivePort$/);
  assert.match(files[1], /Antigravity IDE\\DevToolsActivePort$/);
  assert.match(files[2], /Code\\DevToolsActivePort$/);
  assert.match(files[3], /Code - Insiders\\DevToolsActivePort$/);
  assert.deepEqual(devtoolsEndpoints({}, 'win32'), []);
  assert.deepEqual(
    endpoints.map((entry: any) => entry.app),
    ['app', 'ide', 'vscode', 'vscode'],
  );
  assert.deepEqual(resolveCandidateEndpoints([], endpoints, () => null), [{ port: 9222, app: null }]);
  assert.deepEqual(resolveCandidateEndpoints([9222, 9223], endpoints, () => 9222), [
    { port: 9222, app: 'app' },
    { port: 9223, app: null },
  ]);
});

test('a CDP port list accepts only real ports', async () => {
  const { parsePortList } = await loadBadgeModule();
  assert.deepEqual(parsePortList('9222, 9223'), [9222, 9223]);
  assert.deepEqual(parsePortList('9222,9222,0,70000,abc'), [9222]);
  assert.deepEqual(parsePortList(''), []);
});

test('the product name identifies the installation', async () => {
  const { appFromProductName } = await loadBadgeModule();
  assert.equal(appFromProductName('Antigravity'), 'app');
  assert.equal(appFromProductName('Antigravity IDE'), 'ide');
  assert.equal(appFromProductName('Visual Studio Code'), 'vscode');
  assert.equal(appFromProductName('Code'), 'vscode');
  assert.equal(appFromProductName('Something else'), null);
  assert.equal(appFromProductName(null), null);
});

test('the open conversation is read from the page URL', async () => {
  const { conversationIdFromUrl } = await loadBadgeModule();
  assert.equal(
    conversationIdFromUrl('https://127.0.0.1:50062/c/071afef0-1ced-45ff-a48f-561043f6c279?section=outside'),
    '071afef0-1ced-45ff-a48f-561043f6c279',
  );
  assert.equal(
    conversationIdFromUrl('https://127.0.0.1:50062/chat/071afef0-1ced-45ff-a48f-561043f6c279'),
    '071afef0-1ced-45ff-a48f-561043f6c279',
  );
  assert.equal(
    conversationIdFromUrl('https://127.0.0.1:50062/thread/071afef0-1ced-45ff-a48f-561043f6c279'),
    '071afef0-1ced-45ff-a48f-561043f6c279',
  );
  assert.equal(
    conversationIdFromUrl('vscode-webview://abc/index.html?conversationId=071afef0-1ced-45ff-a48f-561043f6c279'),
    '071afef0-1ced-45ff-a48f-561043f6c279',
  );
  assert.equal(
    conversationIdFromUrl('vscode-webview://abc/index.html?cascadeId=071afef0-1ced-45ff-a48f-561043f6c279'),
    '071afef0-1ced-45ff-a48f-561043f6c279',
  );
  assert.equal(conversationIdFromUrl('https://127.0.0.1:50062/'), null);
  assert.equal(conversationIdFromUrl(''), null);
});

test('a renderer follows the backend on its own port', async () => {
  const { chooseInstance } = await loadBadgeModule();
  const snapshot = instancesSnapshot();

  const chosen = chooseInstance(snapshot, { backendPort: 50096, appHint: 'app' });
  assert.equal(chosen.backend.id, 'hub:50096');
  assert.equal(chosen.backend.app, 'ide');
});

test('an owner match resolves only when it is unambiguous', async () => {
  const { chooseInstance } = await loadBadgeModule();
  const snapshot = instancesSnapshot();

  assert.equal(chooseInstance(snapshot, { backendPort: null, appHint: 'app' }).backend.id, 'https:50062');

  const twoVscode = instancesSnapshot();
  twoVscode.instances.push({
    quota: twoVscode.quota,
    backend: { ...twoVscode.instances[2].backend, id: 'vscode:2', port: 56416 },
    status: 'ok',
    conversation: null,
    observedConversationId: null,
  });
  assert.equal(chooseInstance(twoVscode, { backendPort: null, appHint: 'vscode' }), null);
});

test('the open conversation identifies the backend when the port does not', async () => {
  const { chooseInstance } = await loadBadgeModule();
  const snapshot = instancesSnapshot();
  const chosen = chooseInstance(snapshot, {
    backendPort: null,
    appHint: null,
    conversationId: 'c1',
  });
  assert.equal(chosen.backend.id, 'https:50062');
});

test('one instance is never left unmapped', async () => {
  const { chooseInstance } = await loadBadgeModule();
  const snapshot = instancesSnapshot();
  snapshot.instances = [snapshot.instances[0]];
  assert.equal(chooseInstance(snapshot, { backendPort: 9999, appHint: 'ide' }).backend.id, 'https:50062');
});

test('the card carries the app it belongs to', async () => {
  const { toPayload } = await loadBadgeModule();
  const payload = toPayload(snapshot(17.9), 'Antigravity IDE');
  assert.equal(payload.card.app, 'Antigravity IDE');
  assert.match(payload.title, /Antigravity IDE/);
  assert.equal(payload.card.title, 'Parser integration tests');
});

function instancesSnapshot() {
  const base = snapshot(17.9);
  return {
    ...base,
    instances: [
      {
        backend: { id: 'https:50062', port: 50062, app: 'app', reachable: true },
        quota: base.quota,
        status: 'ok',
        conversation: base.conversation,
        observedConversationId: null,
      },
      {
        backend: { id: 'hub:50096', port: 50096, app: 'ide', reachable: true },
        quota: base.quota,
        status: 'ok',
        conversation: null,
        observedConversationId: null,
      },
      {
        backend: { id: 'hub:56415', port: 56415, app: 'vscode', reachable: true },
        quota: base.quota,
        status: 'ok',
        conversation: null,
        observedConversationId: null,
      },
    ],
  };
}

test('new-thread and unknown renderer states never reuse a previous measurement', async () => {
  const { rendererPayload } = await loadBadgeModule();
  const state = instancesSnapshot();
  for (const viewState of ['new-thread', 'unknown', 'conversation']) {
    const payload = rendererPayload(state, state.instances[0], {
      viewState, conversationId: 'different-conversation', contextKey: 'route-2',
    });
    assert.equal(payload.card.percent, null);
    assert.doesNotMatch(JSON.stringify(payload), /Parser|187\.2k|17\.9%/);
    assert.equal(payload.contextKey, 'route-2');
  }
});

test('a matched visible conversation retains its measurement and account weekly quota', async () => {
  const { rendererPayload } = await loadBadgeModule();
  const state = instancesSnapshot();
  state.quota.groups[0].buckets.push({ id: 'gemini-weekly', window: 'weekly', percent: 72,
    resetsAt: new Date(Date.now() + 3 * 86400000).toISOString(), enabled: true });
  state.instances[0].quota = state.quota;
  const payload = rendererPayload(state, state.instances[0], {
    viewState: 'conversation', conversationId: 'c1', contextKey: 'route-1',
  });
  assert.equal(payload.card.percentText, '17.9%');
  assert.equal(payload.card.limits.weekly.percent, 72);
  const fresh = rendererPayload(state, state.instances[0], {
    viewState: 'new-thread', conversationId: null, contextKey: 'home', modelName: 'Gemini Flash',
  });
  assert.equal(fresh.card.limits.weekly.percent, 72);
  assert.equal(fresh.card.percent, null);
});

test('renderer context distinguishes home, exact routes, hash routes, and unknown webviews', async () => {
  const { RENDERER_CONTEXT, PROBE, INSTALL, BadgeInjector } = await loadBadgeModule();
  const id = '071afef0-1ced-45ff-a48f-561043f6c279';
  const read = (href: string) => runInNewContext(RENDERER_CONTEXT, {
    URL, location: { href }, window: {},
    performance: { getEntriesByType: () => [] },
    document: { querySelector: (selector: string) => selector.includes('agent-input-box') ? {} : null },
  });
  assert.equal(read('http://127.0.0.1:50062/').viewState, 'new-thread');
  assert.equal(read('http://127.0.0.1:50062/new').conversationId, null);
  assert.equal(read('http://127.0.0.1:50062/c/' + id).conversationId, id);
  assert.equal(read('http://127.0.0.1:50062/#/c/' + id).conversationId, id);
  assert.equal(read('vscode-webview://abc/index.html?conversationId=' + id).conversationId, id);
  assert.equal(read('vscode-webview://abc/index.html').viewState, 'unknown');
  assert.notEqual(read('http://127.0.0.1:50062/').contextKey,
    read('http://127.0.0.1:50062/c/' + id).contextKey);

  // PROBE falls back to Ask placeholder or contenteditable + Turbo/model trigger when data-testid attributes are absent.
  const matchedAskBox = runInNewContext(PROBE, {
    document: {
      querySelector: (sel: string) => sel.includes('Ask') ? {} : null,
      querySelectorAll: () => [],
    },
  });
  assert.equal(matchedAskBox, true);
  const matchedRichTurbo = runInNewContext(PROBE, {
    document: {
      querySelector: (sel: string) => sel === '[contenteditable="true"], textarea' ? {} : null,
      querySelectorAll: () => [{ textContent: 'Turbo' }],
    },
  });
  assert.equal(matchedRichTurbo, true);
  const rejectedEmpty = runInNewContext(PROBE, {
    document: {
      querySelector: () => null,
      querySelectorAll: () => [{ textContent: 'Turbo' }],
    },
  });
  assert.equal(rejectedEmpty, false);

  // BadgeInjector status tracks reachable ports vs composer pages accurately.
  const injector = new BadgeInjector();
  assert.deepEqual(injector.getStatus(), { state: 'no-devtools', attached: 0, reachablePorts: 0, probedPages: 0 });
  injector.reachablePorts = 1;
  injector.probedPages = 2;
  assert.deepEqual(injector.getStatus(), { state: 'no-composer', attached: 0, reachablePorts: 1, probedPages: 2 });
  injector.stop();

  // INSTALL replaces prior MutationObserver, aborts old global listeners on upgrade, and walks ancestors in placePill.
  assert.match(INSTALL, /__agmObserver\.disconnect\(\)/);
  assert.match(INSTALL, /__agmAbort\.abort\(\)/);
  assert.match(INSTALL, /tiers = \[/);
});
