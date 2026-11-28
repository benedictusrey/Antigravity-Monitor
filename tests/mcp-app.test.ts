import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { test } from 'node:test';

import { pathToFileURL } from 'node:url';
import { projectCompanionSnapshot } from '../src/app/snapshot';

const root = path.resolve(__dirname, '..', '..');
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

async function withMcpServer(fn: (rpc: (method: string, params?: unknown) => Promise<any>) => Promise<void>) {
  const child = spawn(process.execPath, [path.join(root, 'tools', 'mcp-app-server.mjs')], {
    cwd: root,
    env: { ...process.env, ANTIGRAVITY_LS_ADDRESS: '', ANTIGRAVITY_CSRF_TOKEN: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map<number, (msg: any) => void>();
  let nextId = 1;
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    const parsed = JSON.parse(line);
    const resolve = pending.get(parsed.id);
    if (resolve) {
      pending.delete(parsed.id);
      resolve(parsed);
    }
  });
  const rpc = (method: string, params?: unknown) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP timeout for ${method}`));
      }, 5000);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  try {
    await fn(rpc);
  } finally {
    rl.close();
    child.kill();
  }
}

test('plugin manifest files exist and declare valid MCP server and SessionStart hook', () => {
  const pluginJson = JSON.parse(fs.readFileSync(path.join(root, 'plugin', 'plugin.json'), 'utf8'));
  const mcpJson = JSON.parse(fs.readFileSync(path.join(root, 'plugin', 'mcp_config.json'), 'utf8'));
  const hooksJson = JSON.parse(fs.readFileSync(path.join(root, 'plugin', 'hooks.json'), 'utf8'));

  assert.equal(pluginJson.name, 'antigravity-monitor');
  assert.equal(pluginJson.version, '1.4.0');
  assert.equal(fs.existsSync(path.join(root, 'plugin', pluginJson.logo)), true);
  assert.equal(mcpJson.mcpServers.monitor.args[0], '${PLUGIN_ROOT}/tools/mcp-app-server.mjs');
  assert.ok(Array.isArray(hooksJson['antigravity-monitor-session-bridge'].SessionStart));
});

test('mcp-app-server speaks JSON-RPC 2.0 and exposes Antigravity aux_pane + global entrypoints and self-contained HTML', async () => {
  await withMcpServer(async (rpc) => {
    const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } });
    assert.equal(init.result.serverInfo.name, 'antigravity-monitor');
    assert.equal(init.result.serverInfo.version, '1.4.0');

    const tools = await rpc('tools/list');
    const openTool = tools.result.tools.find((t: any) => t.name === 'open_monitor');
    const snapTool = tools.result.tools.find((t: any) => t.name === 'get_snapshot');
    const cmdTool = tools.result.tools.find((t: any) => t.name === 'send_command');
    assert.equal(openTool._meta.ui.resourceUri, 'ui://antigravity-monitor/dashboard.html');
    assert.deepEqual(
      openTool._meta['com.google.antigravity/ui'].entrypoints.map((e: any) => e.type),
      ['aux_pane', 'global'],
    );
    assert.deepEqual(snapTool._meta.ui.visibility, ['app']);
    assert.deepEqual(cmdTool._meta.ui.visibility, ['app']);

    const res = await rpc('resources/read', { uri: 'ui://antigravity-monitor/dashboard.html' });
    const item = res.result.contents[0];
    assert.equal(item.mimeType, 'text/html;profile=mcp-app');
    assert.match(item.text, /<style>/);
    assert.match(item.text, /acquireVsCodeApi/);
    assert.doesNotMatch(item.text, /\{\{cssUri\}\}|\{\{jsUri\}\}|http-equiv="Content-Security-Policy"/);
  });
});

test('parseMessage accepts relaunchIde command alongside relaunchApp', async () => {
  const { parseMessage } = await import('../src/core/messages');
  assert.deepEqual(parseMessage({ type: 'relaunchIde' }), { type: 'relaunchIde' });
  assert.deepEqual(parseMessage({ type: 'relaunchApp' }), { type: 'relaunchApp' });
});

test('isLiveSnapshot and selectPreferredSnapshot prefer live companion snapshot (active thread) over embedded fallback', async () => {
  const mod = await dynamicImport(pathToFileURL(path.join(root, 'tools', 'mcp-app-server.mjs')).href);
  assert.equal(mod.isLiveSnapshot({ status: 'ok' }), true);
  assert.equal(mod.isLiveSnapshot({ status: 'no-conversation' }), true);
  assert.equal(mod.isLiveSnapshot({ status: 'unauthorized' }), false);
  assert.equal(mod.isLiveSnapshot({ status: 'disconnected' }), false);
  assert.equal(mod.isLiveSnapshot({ status: 'ready' }), false);
  assert.equal(mod.isLiveSnapshot(null), false);

  const companionLive = { status: 'ok', conversation: { title: 'Visible Active Thread' } };
  const embeddedLive = { status: 'ok', conversation: { title: 'Most Recent Stale Thread' } };
  assert.equal(mod.selectPreferredSnapshot(companionLive, embeddedLive), companionLive);
  assert.equal(mod.selectPreferredSnapshot({ status: 'unauthorized' }, embeddedLive), embeddedLive);
  assert.equal(mod.selectPreferredSnapshot(null, embeddedLive), embeddedLive);
  assert.deepEqual(mod.validateTokenPayload({ port: 62254, token: 'tok', conversationId: 'conv-123' }), {
    port: 62254,
    token: 'tok',
    scheme: 'http',
    conversationId: 'conv-123',
  });
});

test('MCP token bridge accepts valid JSON token payloads and rejects malformed input', async () => {
  const mod = await dynamicImport(pathToFileURL(path.join(root, 'tools', 'mcp-app-server.mjs')).href);
  let captured: any = null;
  const srv = mod.startTokenBridgeServer((payload: any) => {
    captured = payload;
  });
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
  const addr = srv.address() as any;
  try {
    const badCt = await fetch(`http://127.0.0.1:${addr.port}/api/token`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{"port":62254,"token":"abc"}',
    });
    assert.equal(badCt.status, 415);

    const badToken = await fetch(`http://127.0.0.1:${addr.port}/api/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ port: 62254, token: 'bad token' }),
    });
    assert.equal(badToken.status, 400);

    const okResp = await fetch(`http://127.0.0.1:${addr.port}/api/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ port: 62254, token: 'csrf-ok-123', scheme: 'http' }),
    });
    assert.equal(okResp.status, 204);
    assert.deepEqual(captured, { port: 62254, token: 'csrf-ok-123', scheme: 'http' });
  } finally {
    srv.close();
  }
});

test('plugin hooks.json registers SessionStart and PreInvocation auth bridge hooks and executes cleanly', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(root, 'plugin', 'hooks.json'), 'utf8'));
  const entry = hooks['antigravity-monitor-session-bridge'];
  assert.ok(entry);
  assert.ok(Array.isArray(entry.SessionStart) && entry.SessionStart.length > 0);
  assert.ok(Array.isArray(entry.PreInvocation) && entry.PreInvocation.length > 0);
  for (const eventName of ['SessionStart', 'PreInvocation'] as const) {
    const cmd = entry[eventName][0].command;
    assert.match(cmd, /plugin-session-hook\.mjs/);
    const res = spawnSync(cmd, {
      cwd: root,
      shell: true,
      encoding: 'utf8',
      env: { ...process.env, PLUGIN_ROOT: root, ANTIGRAVITY_LS_ADDRESS: '', ANTIGRAVITY_CSRF_TOKEN: '' },
      timeout: 5000,
    });
    assert.equal(res.status, 0, `${eventName} hook failed: ${res.stderr}`);
    assert.equal(res.stdout.trim(), '{}');
  }
});

test('shouldReauthCompanion enforces unauthorized state, cached target, and cooldown', async () => {
  const mod = await dynamicImport(pathToFileURL(path.join(root, 'tools', 'mcp-app-server.mjs')).href);
  const target = { port: 62254, token: 'csrf-ok-123', scheme: 'http' };
  assert.equal(mod.shouldReauthCompanion({ status: 'unauthorized' }, target, 5000, 0), true);
  assert.equal(mod.shouldReauthCompanion({ status: 'unauthorized' }, target, 5000, 3500), false);
  assert.equal(mod.shouldReauthCompanion({ status: 'ok' }, target, 5000, 0), false);
  assert.equal(mod.shouldReauthCompanion({ status: 'unauthorized' }, null, 5000, 0), false);
});

test('install-windows.ps1 patches Antigravity Desktop and IDE shortcuts and restores them on uninstall', () => {
  const ps1 = fs.readFileSync(path.join(root, 'tools', 'install-windows.ps1'), 'utf8');
  assert.match(ps1, /function Update-AppShortcutFlags/);
  assert.match(ps1, /--remote-debugging-port=9222 --remote-debugging-address=127\.0\.0\.1/);
  assert.match(ps1, /--remote-debugging-port=9223 --remote-debugging-address=127\.0\.0\.1/);
  assert.match(ps1, /Update-AppShortcutFlags[\s\S]*?-Remove/);
});

test('shouldAutoRelaunchAppProcess triggers once for missing DevTools or updater restarts and skips invalid/debuggable processes', async () => {
  const platform = await dynamicImport(pathToFileURL(path.join(root, 'tools', 'platform.mjs')).href);
  const attempted = new Set<number>();

  assert.equal(platform.shouldAutoRelaunchAppProcess('"C:\\Program Files\\Antigravity.exe"', 1234, attempted), true);
  assert.equal(
    platform.shouldAutoRelaunchAppProcess('"Antigravity.exe" --remote-debugging-port=9222 --updated', 1234, attempted),
    true,
  );
  assert.equal(
    platform.shouldAutoRelaunchAppProcess('"Antigravity.exe" --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1', 1234, attempted),
    false,
  );

  attempted.add(1234);
  assert.equal(platform.shouldAutoRelaunchAppProcess('"Antigravity.exe"', 1234, attempted), false);
  assert.equal(platform.shouldAutoRelaunchAppProcess('"Antigravity.exe"', 0, attempted), false);
  assert.equal(platform.shouldAutoRelaunchAppProcess('', 5678, attempted), false);
});

test('dashboard.js defines host in contextCellContent, avoids bare host ReferenceError, and surfaces primary Relaunch Antigravity action', async () => {
  const mod = await dynamicImport(pathToFileURL(path.join(root, 'tools', 'mcp-app-server.mjs')).href);
  const vm = await import('node:vm');
  const dashboardJs = fs.readFileSync(path.join(root, 'media', 'dashboard.js'), 'utf8');
  assert.match(dashboardJs, /const host = document\.body\.dataset\.host;/);
  assert.match(dashboardJs, /Antigravity running · Relaunch to connect/);
  assert.match(dashboardJs, /btn btn--small btn--primary[\s\S]*?text:\s*relaunchingApp \? 'Relaunching Antigravity…' : 'Relaunch Antigravity'/);

  // Execute dashboard.js in a minimal DOM sandbox with an unauthorized snapshot to prove no ReferenceError occurs.
  const html = mod.buildSelfContainedAppHtml();
  assert.ok(html.includes('Antigravity running · Relaunch to connect'));

  const nodesById = new Map<string, any>();
  const makeClassList = () => ({
    add() {},
    remove() {},
    toggle() {},
    contains() { return false; },
  });
  const makeNode = (tag: string) => {
    const node: any = {
      tagName: tag.toUpperCase(),
      className: '',
      classList: makeClassList(),
      textContent: '',
      title: '',
      hidden: false,
      style: { setProperty() {} },
      dataset: {},
      children: [],
      attributes: new Map<string, string>(),
      setAttribute(k: string, v: string) {
        this.attributes.set(k, String(v));
        if (k === 'id') nodesById.set(String(v), this);
        if (k === 'hidden') this.hidden = true;
      },
      removeAttribute(k: string) {
        this.attributes.delete(k);
        if (k === 'hidden') this.hidden = false;
      },
      getAttribute(k: string) {
        return this.attributes.get(k) ?? null;
      },
      appendChild(child: any) {
        this.children.push(child);
        return child;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      getBoundingClientRect() {
        return { left: 0, width: 60 };
      },
      addEventListener() {},
      contains() {
        return false;
      },
      focus() {},
      get firstChild() {
        return this.children[0] ?? null;
      },
      removeChild(c: any) {
        const idx = this.children.indexOf(c);
        if (idx >= 0) this.children.splice(idx, 1);
      },
    };
    return node;
  };
  for (const id of [
    'status-chip', 'status-pill', 'status-text', 'subtitle', 'footer-note', 'btn-theme', 'btn-close-panel',
    'btn-follow', 'btn-copy', 'btn-refresh', 'tab-indicator', 'tab-overview', 'tab-sessions',
    'tab-models', 'tab-settings', 'pane-overview', 'pane-sessions', 'pane-models', 'pane-settings',
  ]) {
    const n = makeNode('div');
    n.offsetWidth = 60;
    nodesById.set(id, n);
  }
  const tabBar = makeNode('div');
  tabBar.getBoundingClientRect = () => ({ left: 0, width: 300 });
  const listeners = new Map<string, Function[]>();
  const body = makeNode('body');
  body.dataset.host = 'mcp-app';
  const documentMock: any = {
    documentElement: makeNode('html'),
    body,
    hidden: false,
    activeElement: null,
    getElementById: (id: string) => nodesById.get(id) ?? null,
    querySelector: (sel: string) => (sel === '.tabs' ? tabBar : null),
    querySelectorAll: (sel: string) => (sel === '[data-tab]' ? [] : sel === '[data-pane]' ? [] : []),
    createElement: (tag: string) => makeNode(tag),
    createTextNode: (text: string) => ({ nodeType: 3, textContent: String(text) }),
    addEventListener: () => {},
  };
  const context: any = {
    document: documentMock,
    location: { search: '' },
    URLSearchParams,
    acquireVsCodeApi: () => ({ postMessage: () => {}, getState: () => ({}), setState: () => {} }),
    addEventListener: (type: string, fn: Function) => {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    Intl,
    Date,
    Math,
    JSON,
    Map,
    Set,
    Array,
    Object,
    String,
    Number,
    Boolean,
  };
  context.window = context;
  vm.runInNewContext(dashboardJs, context);

  const onMessage = listeners.get('message')?.[0];
  assert.ok(onMessage);
  onMessage({
    data: {
      type: 'snapshot',
      snapshot: {
        status: 'unauthorized',
        lastError: 'No attached renderer for this backend port',
        generatedAt: Date.now(),
        prefs: { warningThreshold: 80, showQuota: true, maskPersonalInfo: true, maxPayloadMb: 128, displayMode: 'full', pollIntervalMs: 2000 },
        backends: [{ id: 'https:56431', app: 'app', scheme: 'https', port: 56431, active: false, reachable: false, conversations: 0, running: 0 }],
        instances: [],
        sessions: [],
        models: [],
        quota: { groups: [], status: 'unavailable' },
        usage: { todayTokens: 0, monthTokens: 0, byModel: {} },
        badge: { state: 'no-devtools', attached: 0, reachablePorts: 0, probedPages: 0, relaunching: false },
        conversation: null,
      },
    },
  });

  const collectText = (n: any): string =>
    n ? (n.textContent || '') + ' ' + (n.children || []).map(collectText).join(' ') : '';
  const overviewText = collectText(nodesById.get('pane-overview'));
  assert.match(overviewText, /Authorization needed/);
  assert.match(overviewText, /Relaunch Antigravity/);
  assert.doesNotMatch(overviewText, /No attached renderer for this backend port/);
});

test('monitor-server.mjs guards auto-relaunch so Antigravity never cold-launches when not running', () => {
  const serverSrc = fs.readFileSync(path.join(root, 'tools', 'monitor-server.mjs'), 'utf8');
  assert.match(serverSrc, /if \(\$guis\.Count -eq 0\) \{ exit 0 \}/);
  assert.match(serverSrc, /relaunchDesktopApp\(\{\s*requireRunning:\s*true\s*\}\)/);
});

test('dashboard.js settings clamp numeric inputs and emit <=2 messages per snippet toggle', () => {
  const dashboardJs = fs.readFileSync(path.join(root, 'media', 'dashboard.js'), 'utf8');
  assert.match(dashboardJs, /Math\.min\(spec\.max,\s*Math\.max\(spec\.min,\s*Math\.round\(parsed\)\)\)/);
  const snippetBlock = /for \(const \[key, label, fallback\] of SNIPPET_FIELDS\)[\s\S]*?snippets\.appendChild/.exec(dashboardJs)?.[0] ?? '';
  assert.ok(snippetBlock.length > 0);
  const sends = snippetBlock.match(/send\(/g) ?? [];
  assert.equal(sends.length, 2, 'only sends toggled key + optional displayMode=custom');
});

test('dashboard.css removes decorative pulsing-dot animations and dead overview-grid rule', () => {
  const css = fs.readFileSync(path.join(root, 'media', 'dashboard.css'), 'utf8');
  assert.doesNotMatch(css, /chip-halo|live-halo|\.overview-grid/);
  assert.match(css, /\.band-split\s*\{[\s\S]*?box-shadow:\s*var\(--panel-shadow\)/);
});

test('cdp-badge.mjs openInAppPanel accepts native plugin outcomes and mcp-app-server.mjs guards state writes', () => {
  const badgeSrc = fs.readFileSync(path.join(root, 'tools', 'cdp-badge.mjs'), 'utf8');
  assert.match(badgeSrc, /outcome === 'plugin-window' \|\| outcome === 'plugin-panel'/);
  const serverSrc = fs.readFileSync(path.join(root, 'tools', 'mcp-app-server.mjs'), 'utf8');
  assert.match(serverSrc, /if \(!stateDirty\) return;/);
  assert.match(serverSrc, /const delivered = await postLoopbackJson\(COMPANION_PORT, '\/api\/command', parsed\)/);
});

test('projectCompanionSnapshot isolates Antigravity IDE from Desktop conversations and keeps IDE telemetry live', () => {
  const localPrefs: any = {
    pollIntervalMs: 2000,
    warningThreshold: 80,
    showQuota: true,
    maskPersonalInfo: true,
    maxPayloadMb: 128,
    displayMode: 'full',
    snippetContext: true,
    snippetRemaining: true,
    snippetFiveHour: false,
    snippetWeekly: false,
    snippetModel: false,
    snippetResets: false,
    snippetTokPerSec: false,
  };
  const desktopConv: any = { id: 'desk-1', title: 'Desktop Thread', status: 'running', stepCount: 4, lastModified: null, createdAt: null, modelId: null, modelName: 'Gemini 4 Neon', usage: null, compressed: false, imageSteps: 0, totals: { input: 0, cacheRead: 0, cacheCreate: 0, output: 0, calls: 0, costUsd: null } };
  const ideConv: any = { id: 'ide-1', title: 'IDE Thread', status: 'idle', stepCount: 2, lastModified: null, createdAt: null, modelId: null, modelName: 'Gemini 4 Neon', usage: null, compressed: false, imageSteps: 0, totals: { input: 0, cacheRead: 0, cacheCreate: 0, output: 0, calls: 0, costUsd: null } };
  const companion: any = {
    schemaVersion: 1,
    generatedAt: Date.now(),
    status: 'ok',
    backend: { id: 'https:54015', kind: 'legacy', scheme: 'https', port: 54015, pid: 1, app: 'app', reachable: true, conversations: 1, running: 1, lastActivityMs: 2, active: true },
    backends: [
      { id: 'https:54015', kind: 'legacy', scheme: 'https', port: 54015, pid: 1, app: 'app', reachable: true, conversations: 1, running: 1, lastActivityMs: 2, active: true },
      { id: 'hub:http:53430', kind: 'hub', scheme: 'http', port: 53430, pid: 2, app: 'ide', reachable: true, conversations: 1, running: 0, lastActivityMs: 1, active: false },
    ],
    instances: [
      { backend: { id: 'https:54015', kind: 'legacy', scheme: 'https', port: 54015, pid: 1, app: 'app', reachable: true, conversations: 1, running: 1, lastActivityMs: 2, active: true }, status: 'ok', conversation: desktopConv, observedConversationId: 'desk-1' },
      { backend: { id: 'hub:http:53430', kind: 'hub', scheme: 'http', port: 53430, pid: 2, app: 'ide', reachable: true, conversations: 1, running: 0, lastActivityMs: 1, active: false }, status: 'ok', conversation: ideConv, observedConversationId: 'ide-1' },
    ],
    conversation: desktopConv,
    sessions: [
      { id: 'desk-1', title: 'Desktop Thread', status: 'running', stepCount: 4, lastModified: null, modelName: 'Gemini 4 Neon', percent: 10, active: true, app: 'app', backendId: 'https:54015' },
      { id: 'ide-1', title: 'IDE Thread', status: 'idle', stepCount: 2, lastModified: null, modelName: 'Gemini 4 Neon', percent: 5, active: false, app: 'ide', backendId: 'hub:http:53430' },
    ],
    models: [],
    account: null,
    usage: { days: [], todayTokens: 0, todayCostUsd: null, monthTokens: 0, monthCostUsd: null, priced: false },
    prefs: { ...localPrefs, displayMode: 'essentials' },
    lastError: null,
    discoveryNotes: [],
    stale: false,
  };

  const ideView = projectCompanionSnapshot(companion, 'ide', localPrefs);
  assert.ok(ideView);
  assert.equal(ideView.backend?.id, 'hub:http:53430');
  assert.equal(ideView.conversation?.id, 'ide-1');
  assert.equal(ideView.prefs.displayMode, 'full');
  assert.equal(ideView.sessions[0].id, 'ide-1');
  assert.equal(ideView.sessions[0].active, true);
  assert.equal(ideView.sessions[1].active, false);

  const withoutIde: any = { ...companion, instances: [companion.instances[0]] };
  assert.equal(projectCompanionSnapshot(withoutIde, 'ide', localPrefs), null);
});

test('dashboard.js editor unauthorized state never prompts for an IDE relaunch', () => {
  const vm = require('node:vm');
  const dashboardJs = fs.readFileSync(path.join(root, 'media', 'dashboard.js'), 'utf8');
  const nodesById = new Map<string, any>();
  const makeNode = (tag: string) => {
    const node: any = {
      tagName: tag.toUpperCase(),
      children: [] as any[],
      style: {},
      dataset: {},
      className: '',
      textContent: '',
      hidden: false,
      title: '',
      offsetWidth: 40,
      offsetLeft: 0,
      classList: { toggle() {}, add() {}, remove() {} },
      setAttribute(k: string, v: string) { this[k] = v; },
      removeAttribute(k: string) { delete this[k]; },
      getAttribute(k: string) { return this[k] ?? null; },
      addEventListener() {},
      appendChild(child: any) { if (child) this.children.push(child); return child; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      getBoundingClientRect() { return { left: 0, width: 60 }; },
    };
    return node;
  };
  for (const id of [
    'status-chip', 'status-pill', 'status-text', 'subtitle', 'footer-note', 'btn-theme', 'btn-close-panel',
    'btn-follow', 'btn-copy', 'btn-refresh', 'tab-indicator', 'tab-overview', 'tab-sessions',
    'tab-models', 'tab-settings', 'pane-overview', 'pane-sessions', 'pane-models', 'pane-settings',
  ]) {
    nodesById.set(id, makeNode('div'));
  }
  const tabBar = makeNode('div');
  tabBar.getBoundingClientRect = () => ({ left: 0, width: 300 });
  const listeners = new Map<string, Function[]>();
  const body = makeNode('body');
  body.dataset.host = 'editor';
  const context: any = {
    document: {
      documentElement: makeNode('html'),
      body,
      hidden: false,
      activeElement: null,
      getElementById: (id: string) => nodesById.get(id) ?? null,
      querySelector: (sel: string) => (sel === '.tabs' ? tabBar : null),
      querySelectorAll: () => [],
      createElement: (tag: string) => makeNode(tag),
      createTextNode: (text: string) => ({ nodeType: 3, textContent: String(text) }),
      addEventListener: () => {},
    },
    location: { search: '' },
    URLSearchParams,
    acquireVsCodeApi: () => ({ postMessage: () => {}, getState: () => ({}), setState: () => {} }),
    addEventListener: (type: string, fn: Function) => {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    Intl,
    Date,
    Math,
    JSON,
    Map,
    Set,
    Array,
    Object,
    String,
    Number,
    Boolean,
  };
  context.window = context;
  vm.runInNewContext(dashboardJs, context);
  listeners.get('message')?.[0]({
    data: {
      type: 'snapshot',
      snapshot: {
        status: 'unauthorized',
        lastError: 'No attached renderer',
        generatedAt: Date.now(),
        prefs: { warningThreshold: 80, showQuota: true, maskPersonalInfo: true, maxPayloadMb: 128, displayMode: 'full', pollIntervalMs: 2000 },
        backends: [{ id: 'hub:http:53430', app: 'ide', scheme: 'http', port: 53430, active: false, reachable: false, conversations: 0, running: 0 }],
        instances: [],
        sessions: [],
        models: [],
        quota: { groups: [], status: 'unavailable' },
        usage: { todayTokens: 0, monthTokens: 0, byModel: {} },
        conversation: null,
      },
    },
  });
  const collectText = (n: any): string => (n ? (n.textContent || '') + ' ' + (n.children || []).map(collectText).join(' ') : '');
  const overviewText = collectText(nodesById.get('pane-overview'));
  assert.match(overviewText, /no IDE relaunch needed/i);
  assert.doesNotMatch(overviewText, /Relaunch Antigravity/);
  assert.match(nodesById.get('subtitle')?.textContent ?? '', /Waiting for monitor bridge/);
});
