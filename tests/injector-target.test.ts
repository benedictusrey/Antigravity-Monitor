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

test('openMonitorInSidePanel focuses an existing side-panel tab, prefers the native plugin launcher, and ignores chat links', async () => {
  const file = path.resolve(__dirname, '..', '..', 'tools', 'cdp-badge.mjs');
  const badge = await dynamicImport(pathToFileURL(file).href);

  const mkEl = (opts: {
    text?: string;
    tid?: string;
    closestSel?: string[];
    rect?: { top: number; left: number };
    onClick?: () => void;
    children?: Record<string, any[]>;
    parent?: any;
  }) => {
    const el: any = {
      textContent: opts.text ?? '',
      offsetParent: {},
      parentElement: opts.parent ?? null,
      getAttribute: (k: string) => (k === 'data-testid' ? opts.tid ?? '' : ''),
      closest: (sel: string) => (opts.closestSel ?? []).some((s) => sel.includes(s)) ? {} : null,
      getBoundingClientRect: () => opts.rect ?? { top: 200, left: 100 },
      querySelector: () => null,
      querySelectorAll: (sel: string) => (opts.children?.[sel] ?? []),
      click: () => opts.onClick?.(),
    };
    return el;
  };

  let chatClicked = false;
  let tabClicked = false;
  let newTabClicked = false;
  let pluginClicked = false;

  const chatBtn = mkEl({ text: 'Antigravity Monitor', closestSel: ['conversation-view'], onClick: () => { chatClicked = true; } });
  const sideTab = mkEl({ text: 'Antigravity Monitor', rect: { top: 36, left: 1200 }, onClick: () => { tabClicked = true; } });
  const newTabBtn = mkEl({ tid: 'side-panel-new-tab-button', onClick: () => { newTabClicked = true; } });
  let hasTab = true;
  const tabStrip: any = {
    contains: (target: any) => (hasTab && target === sideTab) || target === newTabBtn,
    querySelectorAll: () => (hasTab ? [sideTab] : []),
  };
  newTabBtn.parentElement = tabStrip;
  sideTab.parentElement = tabStrip;

  const sidebarPlugin = mkEl({ tid: 'plugin-sidebar-mcp-app-item', text: 'Antigravity Monitor', onClick: () => { pluginClicked = true; } });
  const noopDoc = {
    body: { appendChild: () => {}, querySelectorAll: () => [] },
    createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {} }),
    addEventListener: () => {},
    querySelector: (sel: string) => (sel.includes('side-panel-new-tab-button') ? newTabBtn : null),
    querySelectorAll: (sel: string) => {
      if (sel.includes('plugin-sidebar-mcp-app-item')) return hasTab ? [] : [sidebarPlugin];
      return hasTab ? [chatBtn, sideTab] : [chatBtn];
    },
  };

  const win1: any = { location: { href: 'http://127.0.0.1:58551/' } };
  const openFn = vm.runInNewContext(`(${badge.SIDE_PANEL_OPENER})`, {
    window: win1,
    document: noopDoc,
    Event: class {},
    KeyboardEvent: class {},
    setTimeout,
    clearTimeout,
  });
  const res1 = await openFn('http://127.0.0.1:4599');
  assert.equal(res1, 'focused');
  assert.equal(chatClicked, false);
  assert.equal(tabClicked, true);
  assert.equal(newTabClicked, false);

  hasTab = false;
  const res2 = await openFn('http://127.0.0.1:4599');
  assert.equal(res2, 'plugin-window');
  assert.equal(pluginClicked, true);
  assert.equal(newTabClicked, false);
});

test('Antigravity IDE extensionView loopback iframes are attachable, keep live context, and render payload', async () => {
  const file = path.resolve(__dirname, '..', '..', 'tools', 'cdp-badge.mjs');
  const badge = await dynamicImport(pathToFileURL(file).href);

  assert.equal(
    badge.isAttachableTarget({
      type: 'iframe',
      url: 'http://127.0.0.1:53430/?extensionView=true&hostVariant=antigravity-ide&appName=Antigravity+IDE',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/page/1',
    }, 'http://127.0.0.1:4599'),
    true,
  );
  assert.equal(
    badge.isAttachableTarget({
      type: 'iframe',
      url: 'vscode-webview://1234/index.html',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/page/2',
    }, 'http://127.0.0.1:4599'),
    false,
  );
  assert.equal(
    badge.isAttachableTarget({
      type: 'iframe',
      url: 'http://127.0.0.1:4599/',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/page/3',
    }, 'http://127.0.0.1:4599'),
    false,
  );
  assert.equal(
    badge.isAttachableTarget({
      type: 'iframe',
      url: 'https://example.com/embed',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/page/4',
    }, 'http://127.0.0.1:4599'),
    false,
  );

  const endpoints = badge.resolveCandidateEndpoints([], [], () => null);
  assert.ok(endpoints.some((entry: { port: number; app: string | null }) => entry.port === 9223 && entry.app === 'ide'));

  const ctx = vm.runInNewContext(`(${badge.readRendererContext.toString()})()`, {
    URL,
    location: { href: 'http://127.0.0.1:53430/?extensionView=true&hostVariant=antigravity-ide&appName=Antigravity+IDE' },
    document: {
      querySelector: (sel: string) => (sel.includes('composer') ? {} : null),
    },
    performance: { getEntriesByType: () => [] },
    window: { __APP_CONFIG__: { productName: 'Antigravity', csrfToken: 'tok' } },
  });
  assert.equal(ctx.extensionView, true);
  assert.equal(ctx.viewState, 'unknown');
  assert.equal(ctx.port, 53430);
  assert.equal(ctx.productName, 'Antigravity IDE');

  const payload = badge.rendererPayload(
    { status: 'ok', prefs: { displayMode: 'essentials' } },
    {
      backend: { id: 'hub:http:53430', app: 'ide', reachable: true },
      conversation: {
        id: 'conv-ide-1',
        title: 'Wood Defect Engine ROI Refinement',
        modelName: 'Gemini 4 Neon',
        usage: { used: 120000, capacity: 1000000, percent: 12, remaining: 880000, input: 1000, cacheRead: 118000, cacheCreate: 0, output: 1000, tokPerSec: 180, source: 'measured', measuredAt: null },
        totals: { input: 1000, cacheRead: 118000, cacheCreate: 0, output: 1000, calls: 2, costUsd: null },
        compressed: false,
        imageSteps: 0,
      },
    },
    { viewState: 'unknown', extensionView: true, conversationId: null, contextKey: '1', modelName: null },
  );
  assert.equal(payload.show, true);
  assert.equal(payload.essentials, '12%');
});

test('placePill anchors the badge directly left of the send-button wrapper inside .agy-composer-footer', async () => {
  const file = path.resolve(__dirname, '..', '..', 'tools', 'cdp-badge.mjs');
  const badge = await dynamicImport(pathToFileURL(file).href);

  const children: any[] = [];
  const leftGroup = { id: 'left', parentElement: null as any, nextSibling: null as any };
  const rightGroup = { id: 'right', parentElement: null as any, nextSibling: null as any };
  const footer: any = {
    children: [leftGroup, rightGroup],
    get lastElementChild() { return this.children[this.children.length - 1] ?? null; },
    insertBefore(node: any, ref: any) {
      const idx = this.children.indexOf(ref);
      const oldIdx = this.children.indexOf(node);
      if (oldIdx >= 0) this.children.splice(oldIdx, 1);
      const targetIdx = idx >= 0 ? this.children.indexOf(ref) : this.children.length;
      this.children.splice(targetIdx, 0, node);
      node.parentElement = this;
      for (let i = 0; i < this.children.length; i++) {
        this.children[i].nextSibling = this.children[i + 1] ?? null;
      }
    },
  };
  leftGroup.parentElement = footer;
  rightGroup.parentElement = footer;

  const makeNode = (tag: string) => {
    const n: any = {
      tagName: tag.toUpperCase(),
      style: {},
      children: [],
      attributes: {} as Record<string, string>,
      parentElement: null as any,
      nextSibling: null as any,
      setAttribute(k: string, v: string) { this.attributes[k] = v; },
      hasAttribute(k: string) { return k in this.attributes; },
      removeAttribute(k: string) { delete this.attributes[k]; },
      appendChild(c: any) { this.children.push(c); return c; },
      addEventListener() {},
      remove() { children.push('removed'); },
    };
    return n;
  };

  let timerFn: any = null;
  const ctx: any = {
    URL,
    Node: { prototype: { insertBefore() {}, appendChild() {} } },
    performance: { getEntriesByType: () => [] },
    window: { __agmGuard: true } as any,
    location: { href: 'http://127.0.0.1:53430/?extensionView=true' },
    document: {
      body: { appendChild: () => {}, querySelectorAll: () => [] },
      createElement: makeNode,
      querySelector: (sel: string) => (sel === '.agy-composer-footer' ? footer : null),
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    addEventListener: () => {},
    matchMedia: () => ({ matches: true }),
    setInterval: (fn: any) => { timerFn = fn; return 1; },
    clearInterval: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    MutationObserver: class { observe() {} disconnect() {} },
    Date,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Math,
  };
  ctx.window = ctx;
  ctx.window.__APP_CONFIG__ = { productName: 'Antigravity' };
  const expectedContext = vm.runInNewContext(`(${badge.readRendererContext.toString()})()`, ctx);
  vm.runInNewContext(badge.INSTALL, ctx);
  ctx.window.__agmApply({
    show: true,
    contextKey: expectedContext.contextKey,
    modelKey: expectedContext.modelName || '',
    color: '#4daafc',
    essentials: '12%',
    title: 'IDE Context',
    aria: 'IDE Context',
    snippetValues: { context: '12%', fiveHour: '5h 18%', tokPerSec: '240 tok/s' },
    snippetPrefs: { snippetContext: false, snippetRemaining: false, snippetFiveHour: true, snippetWeekly: false, snippetModel: false, snippetResets: false, snippetTokPerSec: true },
    density: 'custom',
    card: { app: 'Antigravity IDE', title: 'Test', ratio: '12%', used: '12k', capacity: '100k' },
  });
  assert.equal(footer.children.length, 3);
  assert.equal(footer.children[0], leftGroup);
  assert.equal(footer.children[2], rightGroup);
  assert.equal(footer.children[1].attributes['data-agm-badge'], '');
  assert.equal(footer.children[1].nextSibling, rightGroup);
  void timerFn;
});
