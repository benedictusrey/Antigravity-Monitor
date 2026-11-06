#!/usr/bin/env node
/**
 * Antigravity Monitor companion.
 *
 * The Antigravity desktop app has no extension host, so the VSIX cannot run
 * inside it. This process gives the same monitor a surface of its own: it runs
 * the vscode-free `Monitor`, serves the same dashboard assets, and opens them in
 * a chromeless window. Works with either app, or with neither IDE running.
 *
 *   node tools/monitor-server.mjs [--port 4599] [--no-open]
 *
 * Zero dependencies. Single instance: a second launch refuses rather than
 * polling every backend twice alongside the first.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BadgeInjector, parsePortList } from './cdp-badge.mjs';
import { openCommand } from './platform.mjs';
import { loadState, mergeConfig, sanitiseBuckets, saveState, serialiseBuckets, statePath } from './state.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = path.join(root, 'out', 'src');
const packageManifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageVersion = packageManifest.version;

function load(relative) {
  return require(path.join(build, relative));
}

const { Monitor } = load(path.join('app', 'monitor.js'));
const { parseMessage } = load(path.join('core', 'messages.js'));
const { addUsage, summariseUsage } = load(path.join('core', 'usage.js'));
const { SNIPPET_DEFAULTS } = load(path.join('core', 'snippet.js'));

const argv = process.argv.slice(2);
const portIndex = argv.indexOf('--port');
const port = Number(portIndex >= 0 ? argv[portIndex + 1] : process.env.PORT ?? 4599);
const shouldOpen = !argv.includes('--no-open');

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error(`Invalid port. Use --port <1024-65535>.`);
  process.exit(1);
}

const cdpIndex = argv.indexOf('--cdp-port');
const cdpPorts = cdpIndex >= 0 ? parsePortList(argv[cdpIndex + 1]) : [];
if (cdpIndex >= 0 && cdpPorts.length === 0) {
  console.error('Invalid CDP port. Use --cdp-port <1-65535>[,<port>...].');
  process.exit(1);
}

let monitor = null;
const badge = argv.includes('--no-badge')
  ? null
  : new BadgeInjector({
      logger: (message) => console.log(`[badge] ${message}`),
      ports: cdpPorts,
      onUpdateSetting: (key, value) => {
        const message = parseMessage({ type: 'updateSetting', key, value });
        if (message) applyCommand(message);
      },
      onObserved: (port, conversationId, viewState) => monitor?.observeConversation(port, conversationId, viewState),
      onRefresh: () => {
        console.log('[badge] refresh requested');
        monitor?.refreshNow();
      },
    });

const CONFIG_DEFAULTS = {
  ...SNIPPET_DEFAULTS,
  pollIntervalMs: 2000,
  warningThreshold: 80,
  showQuota: true,
  maskPersonalInfo: true,
  maxPayloadMb: 128,
  displayMode: 'full',
};

const stateFile = statePath();
const stored = loadState(stateFile);
const config = mergeConfig(CONFIG_DEFAULTS, stored.config);
const buckets = sanitiseBuckets(stored.buckets);
let latest = null;

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) {
    return;
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushState();
  }, 4000);
  saveTimer.unref?.();
}

function flushState() {
  try {
    saveState(stateFile, {
      config,
      buckets: serialiseBuckets(buckets),
      limits: null,
    });
  } catch (error) {
    console.error(`[state] could not save: ${error.message}`);
  }
}

const monitorInstance = new Monitor({
  logger: (message) => console.log(`[monitor] ${message}`),
  getConfig: () => config,
  onSnapshot: (snapshot) => {
    latest = snapshot;
    badge?.update(snapshot);
  },
  recordUsage: (record) => {
    addUsage(buckets, record);
    scheduleSave();
  },
  usageSummary: () => summariseUsage(buckets),
});
monitor = monitorInstance;

const nonce = randomBytes(24).toString('base64');

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
};

/**
 * Transport shim: gives the unchanged dashboard the two host APIs it expects —
 * `acquireVsCodeApi` and a stream of `message` events.
 */
const SHIM = `(function () {
  function pull() {
    fetch('/api/snapshot', { cache: 'no-store' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        if (data && data.snapshot) window.postMessage({ type: 'snapshot', snapshot: data.snapshot }, '*');
      })
      .catch(function () {});
  }
  window.acquireVsCodeApi = function () {
    var memory = {};
    return {
      postMessage: function (message) {
        if (message && message.type === 'ready') { pull(); return; }
        fetch('/api/command', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(message),
        }).catch(function () {});
      },
      getState: function () {
        try { return JSON.parse(sessionStorage.getItem('agm') || '{}'); } catch (error) { return memory; }
      },
      setState: function (state) {
        try { sessionStorage.setItem('agm', JSON.stringify(state)); } catch (error) { memory = state; }
      },
    };
  };
  setInterval(pull, 1500);
})();`;

function renderShell() {
  const template = fs.readFileSync(path.join(root, 'media', 'dashboard.html'), 'utf8');
  const replaced = template
    .replaceAll('{{cspSource}}', "'self'")
    .replaceAll('{{nonce}}', nonce)
    .replaceAll('{{host}}', 'companion')
    .replaceAll('{{cssUri}}', '/media/dashboard.css')
    .replaceAll('{{jsUri}}', '/media/dashboard.js')
    // The shim fetches snapshots over HTTP; the webview build does not need this.
    .replace("default-src 'none';", "default-src 'none'; connect-src 'self';");

  const scriptTag = `<script nonce="${nonce}" src="/media/dashboard.js"></script>`;
  return replaced.replace(scriptTag, `<script nonce="${nonce}">${SHIM}</script>\n  ${scriptTag}`);
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 16 * 1024) {
        reject(new Error('body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function applyCommand(message) {
  switch (message.type) {
    case 'refresh':
      monitor.refreshNow();
      return;
    case 'selectBackend':
      monitor.selectBackend(message.id);
      return;
    case 'selectSession':
      monitor.pinConversation(message.id);
      return;
    case 'updateSetting':
      config[message.key] = message.value;
      scheduleSave();
      monitor.updatePreferences();
      return;
    default:
      // `ready` and `diagnostics` need no server action.
      return;
  }
}

const server = http.createServer((request, response) => {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!hosts.has(request.headers.host ?? '')) {
    sendJson(response, 403, { error: 'forbidden host' });
    return;
  }
  let url;
  try { url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`); }
  catch { sendJson(response, 400, { error: 'bad request URL' }); return; }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { service: 'antigravity-monitor', version: packageVersion, build: packageManifest.monitorBuild, pid: process.pid });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/') {
    response.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
    response.end(renderShell());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/snapshot') {
    sendJson(response, 200, { snapshot: latest });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/command') {
    // Loopback JSON endpoint: refuse anything a browser would not send same-origin.
    const origin = request.headers.origin;
    if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
      sendJson(response, 403, { error: 'forbidden' });
      return;
    }
    if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      sendJson(response, 415, { error: 'JSON required' });
      return;
    }
    readBody(request)
      .then((body) => {
        const message = parseMessage(JSON.parse(body || '{}'));
        if (message) {
          applyCommand(message);
        }
        response.writeHead(204);
        response.end();
      })
      .catch(() => {
        sendJson(response, 400, { error: 'bad request' });
      });
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/media/')) {
    const name = url.pathname.slice('/media/'.length);
    const file = path.join(root, 'media', name);
    if (!['dashboard.css', 'dashboard.js', 'icon.png', 'icon.svg'].includes(name)) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    try {
      const body = fs.readFileSync(file);
      response.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('not found');
    }
    return;
  }

  response.writeHead(404);
  response.end('not found');
});

function openWindow(url) {
  if (process.platform !== 'win32') {
    const command = openCommand(process.platform, url);
    const child = spawn(command.file, command.args, { detached: true, stdio: 'ignore' });
    child.on('error', () => console.error(`Could not open a browser. Open ${url} manually.`));
    child.unref();
    return;
  }
  const candidates = [
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean);

  const browser = candidates.find((candidate) => fs.existsSync(candidate));
  const child = browser
    ? spawn(browser, [`--app=${url}`, '--window-size=640,900'], { detached: true, stdio: 'ignore' })
    : spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
  child.unref();
  child.on('error', () => console.error(`Could not open a browser. Open ${url} manually.`));
}

server.on('error', async (error) => {
  if (error.code === 'EADDRINUSE') {
    const url = `http://127.0.0.1:${port}`;
    try {
      const health = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) }).then(response => response.json());
      if (health.service !== 'antigravity-monitor') throw new Error('Unrecognized service');
      console.log(`Antigravity Monitor companion is already running on port ${port}.`);
      if (shouldOpen) openWindow(url);
      process.exit(0);
    } catch {
      console.error(`Port ${port} belongs to an unavailable or unrelated service.`);
      process.exit(1);
    }
  }
  console.error(error);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}`;
  console.log('Antigravity Monitor companion');
  console.log(`  ${url}${shouldOpen ? '' : ' (window not opened)'}`);
  console.log(`  badge: ${badge ? 'looking for a renderer' : 'disabled'}`);
  console.log('  Ctrl+C to stop.');
  monitor.start();
  if (shouldOpen) {
    openWindow(url);
  }
});

function shutdown() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  flushState();
  badge?.stop();
  monitor.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
