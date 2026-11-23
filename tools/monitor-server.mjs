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

import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BadgeInjector, devtoolsEndpoints, parsePortList } from './cdp-badge.mjs';
import { antigravityInstallCandidates, applyAppUpdateCheck, openCommand, readAntigravityBuild } from './platform.mjs';
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
      dashboardUrl: `http://127.0.0.1:${port}`,
      onUpdateSetting: (key, value) => {
        const message = parseMessage({ type: 'updateSetting', key, value });
        if (message) applyCommand(message);
      },
      onObserved: (port, conversationId, viewState, modelName) =>
        monitor?.observeConversation(port, conversationId, viewState, modelName),
      onToken: (backendPort, token) => monitor?.provideToken(backendPort, token),
      onAppVersion: (version) => handleObservedAppVersion(version),
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
let knownAppBuild = stored.appBuild ?? null;
let appUpdate = null;
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
      appBuild: knownAppBuild,
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
  rpcFallback: badge ? (target, method, body, options) => badge.callRpc(target.port, method, body, options) : undefined,
});
monitor = monitorInstance;
latest = monitorInstance.getSnapshot();

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
        }).then(function (response) { if (response.ok) pull(); }).catch(function () {});
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

let relaunching = false;

function wakeBadgeAfterRelaunch() {
  for (const ms of [1500, 3500, 6000]) {
    const t = setTimeout(() => badge?.wake(), ms);
    t.unref?.();
  }
}

function relaunchDesktopApp() {
  if (relaunching) return;
  relaunching = true;
  const finish = () => {
    relaunching = false;
    wakeBadgeAfterRelaunch();
  };
  if (process.platform === 'win32') {
    const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const script = [
      "$guis = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'Antigravity.exe' -and $_.CommandLine -notmatch '--type=|sidecar_sdk|--import=' })",
      "$exe = ($guis | Select-Object -First 1).ExecutablePath",
      "if (-not $exe) { $exe = Join-Path $env:LOCALAPPDATA 'Programs\\antigravity\\Antigravity.exe' }",
      "if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { exit 1 }",
      "foreach ($g in $guis) { $p = Get-Process -Id $g.ProcessId -ErrorAction SilentlyContinue; if ($p) { [void]$p.CloseMainWindow(); if (-not $p.WaitForExit(2500)) { Stop-Process -Id $g.ProcessId -ErrorAction SilentlyContinue } } }",
      "$deadline = [DateTime]::UtcNow.AddSeconds(3)",
      "while ([DateTime]::UtcNow -lt $deadline) { if (-not (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'Antigravity.exe' -and $_.CommandLine -notmatch 'sidecar_sdk|--import=' })) { break }; Start-Sleep -Milliseconds 200 }",
      "Start-Process -FilePath $exe -ArgumentList '--remote-debugging-port=9222 --remote-debugging-address=127.0.0.1'",
    ].join('; ');
    execFile(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true }, (err) => {
      if (err) console.error(`[relaunch] ${err.message}`);
      finish();
    });
    return;
  }
  if (process.platform === 'darwin') {
    execFile('/usr/bin/osascript', ['-e', 'tell application "Antigravity" to quit'], () => {
      setTimeout(() => {
        const child = spawn('/usr/bin/open', ['-a', 'Antigravity', '--args', '--remote-debugging-port=9222', '--remote-debugging-address=127.0.0.1'], { detached: true, stdio: 'ignore' });
        child.on('error', () => {});
        child.unref();
        finish();
      }, 1500);
    });
    return;
  }
  finish();
}

function applyCommand(message) {
  switch (message.type) {
    case 'refresh':
      monitor.refreshNow();
      return;
    case 'relaunchApp':
      relaunchDesktopApp();
      return;
    case 'openInAppPanel':
      void badge?.openInAppPanel();
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
    const badgeStatus = badge
      ? { ...badge.getStatus(), relaunching }
      : { state: 'disabled', attached: 0, reachablePorts: 0, probedPages: 0, relaunching: false };
    if (badgeStatus.state === 'attached') {
      appUpdate = null;
    }
    sendJson(response, 200, { snapshot: latest ? { ...latest, badge: badgeStatus, appUpdate } : null });
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
      response.writeHead(200, {
        'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
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

const watchers = [];
let wakeTimer = null;
let updateTimer = null;
let updatePollInterval = null;

function refreshWindowsMonitorShortcuts(exePath) {
  if (process.platform !== 'win32' || !exePath) return;
  const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const scriptPath = path.join(root, 'tools', 'install-windows.ps1');
  execFile(
    ps,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath, '-RefreshShortcuts', '-AntigravityExe', exePath],
    { windowsHide: true },
    () => {},
  );
}

function handleObservedAppVersion(version) {
  if (!version) return;
  const previous = knownAppBuild?.appVersion ?? null;
  if (previous === version) return;
  knownAppBuild = { ...(knownAppBuild ?? { version: null, signature: '' }), appVersion: version };
  scheduleSave();
  if (previous) {
    console.log(`[app] Antigravity runtime updated (${previous} -> ${version}); refreshing monitor & badge.`);
    appUpdate = { version, previousVersion: previous, detectedAt: Date.now() };
    monitor.refreshNow();
    badge?.wake();
    wakeBadgeAfterRelaunch();
  }
}

function checkAntigravityUpdate(reason = 'poll') {
  const current = readAntigravityBuild();
  const result = applyAppUpdateCheck(knownAppBuild, appUpdate, current);
  if (result.knownBuild !== knownAppBuild) {
    knownAppBuild = result.knownBuild ? { ...result.knownBuild, appVersion: knownAppBuild?.appVersion ?? null } : null;
    scheduleSave();
  }
  appUpdate = result.notice;
  if (result.notify) {
    console.log(
      `[app] Antigravity updated (${result.previousVersion ?? 'previous'} -> ${result.version ?? 'new'}) via ${reason}; refreshing monitor & badge.`,
    );
    monitor.refreshNow();
    badge?.wake();
    wakeBadgeAfterRelaunch();
    if (current?.exePath) {
      refreshWindowsMonitorShortcuts(current.exePath);
    }
  } else if (result.settle) {
    monitor.nudgeDiscovery();
    badge?.wake();
  }
}

function scheduleUpdateCheck(reason, delayMs = 1500) {
  if (updateTimer) clearTimeout(updateTimer);
  updateTimer = setTimeout(() => {
    updateTimer = null;
    checkAntigravityUpdate(reason);
    monitor.nudgeDiscovery();
    badge?.wake();
  }, delayMs);
  updateTimer.unref?.();
}

function watchAntigravityLaunch() {
  const dirs = new Set(devtoolsEndpoints().map((entry) => path.dirname(entry.file)));
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      const watcher = fs.watch(dir, (_event, filename) => {
        if (filename && !String(filename).includes('DevToolsActivePort')) return;
        if (wakeTimer) clearTimeout(wakeTimer);
        wakeTimer = setTimeout(() => {
          wakeTimer = null;
          checkAntigravityUpdate('devtools');
          monitor.nudgeDiscovery();
          badge?.wake();
        }, 300);
        wakeTimer.unref?.();
      });
      watcher.on('error', () => {});
      watchers.push(watcher);
    } catch {
      // Directory missing or watch unsupported; discovery polling still runs.
    }
  }

  const installDirs = new Set(
    antigravityInstallCandidates()
      .map((candidate) => (process.platform === 'darwin' ? candidate : path.dirname(candidate)))
      .filter((dir) => fs.existsSync(dir)),
  );
  for (const dir of installDirs) {
    try {
      const watcher = fs.watch(dir, () => scheduleUpdateCheck('watch'));
      watcher.on('error', () => {});
      watchers.push(watcher);
    } catch {
      // Fall back to periodic build check below.
    }
  }
}

server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}`;
  console.log('Antigravity Monitor companion');
  console.log(`  ${url}${shouldOpen ? '' : ' (window not opened)'}`);
  console.log(`  badge: ${badge ? 'looking for a renderer' : 'disabled'}`);
  console.log('  Ctrl+C to stop.');
  watchAntigravityLaunch();
  checkAntigravityUpdate('startup');
  updatePollInterval = setInterval(() => checkAntigravityUpdate('timer'), 15_000);
  updatePollInterval.unref?.();
  monitor.start();
  if (shouldOpen) {
    openWindow(url);
  }
});

function shutdown() {
  if (wakeTimer) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }
  if (updateTimer) {
    clearTimeout(updateTimer);
    updateTimer = null;
  }
  if (updatePollInterval) {
    clearInterval(updatePollInterval);
    updatePollInterval = null;
  }
  for (const watcher of watchers) {
    try { watcher.close(); } catch {}
  }
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
