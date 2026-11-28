#!/usr/bin/env node
/**
 * Antigravity Monitor MCP App server (stdio JSON-RPC 2.0).
 *
 * Exposes an interactive MCP App (`open_monitor`) with Antigravity `aux_pane`
 * and `global` sidebar entrypoints, backed directly by `ANTIGRAVITY_LS_ADDRESS`
 * and `ANTIGRAVITY_CSRF_TOKEN` so Antigravity Desktop users get live telemetry
 * on every fresh launch without requiring `--remote-debugging-port=9222`.
 *
 * Zero runtime dependencies. Never write non-JSON-RPC output to stdout.
 */

import * as fs from 'node:fs';
import * as http from 'node:http';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { fileURLToPath } from 'node:url';

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
const { formatTokens } = load(path.join('core', 'format.js'));

const APP_URI = 'ui://antigravity-monitor/dashboard.html';
const COMPANION_PORT = Number(process.env.ANTIGRAVITY_MONITOR_PORT || 4599);

export function isLiveSnapshot(snapshot) {
  return Boolean(snapshot && (snapshot.status === 'ok' || snapshot.status === 'no-conversation'));
}

export function selectPreferredSnapshot(companionSnap, embeddedSnap) {
  if (isLiveSnapshot(companionSnap)) return companionSnap;
  if (isLiveSnapshot(embeddedSnap)) return embeddedSnap;
  return companionSnap ?? embeddedSnap ?? null;
}

export function shouldReauthCompanion(companionSnap, cachedTarget, nowMs, lastAttemptMs, cooldownMs = 3000) {
  return Boolean(
    cachedTarget &&
      companionSnap?.status === 'unauthorized' &&
      nowMs - lastAttemptMs >= cooldownMs,
  );
}

export function validateTokenPayload(payload) {
  const targetPort = Number(payload?.port);
  const token = typeof payload?.token === 'string' ? payload.token : '';
  const scheme = payload?.scheme === 'https' ? 'https' : payload?.scheme === 'http' || payload?.scheme === undefined ? 'http' : null;
  const rawConv = payload?.conversationId;
  const conversationId =
    typeof rawConv === 'string' && rawConv.length > 0 && rawConv.length <= 200 && !/\s/.test(rawConv)
      ? rawConv
      : undefined;
  if (
    !scheme ||
    !Number.isInteger(targetPort) ||
    targetPort < 1 ||
    targetPort > 65535 ||
    token.length === 0 ||
    token.length > 512 ||
    /\s/.test(token)
  ) {
    return null;
  }
  return conversationId ? { port: targetPort, token, scheme, conversationId } : { port: targetPort, token, scheme };
}

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
let stateDirty = false;

function flushState() {
  if (!stateDirty) return;
  const existing = loadState(stateFile);
  saveState(stateFile, {
    config,
    buckets: serialiseBuckets(buckets),
    limits: existing.limits,
    appBuild: existing.appBuild,
  });
  stateDirty = false;
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushState();
  }, 5000);
  saveTimer.unref?.();
}

export function parseEnvLoopbackTarget(address = process.env.ANTIGRAVITY_LS_ADDRESS, token = process.env.ANTIGRAVITY_CSRF_TOKEN) {
  if (!address || !token || typeof token !== 'string' || token.length === 0 || token.length > 512 || /\s/.test(token)) {
    return null;
  }
  const match = /^(?:http:\/\/)?(?:127\.0\.0\.1|localhost):(\d{1,5})$/i.exec(String(address).trim());
  if (!match) return null;
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { port, token, scheme: 'http' };
}

export function postLoopbackJson(port, pathname, payload, timeoutMs = 800) {
  return new Promise((resolve) => {
    try {
      const body = JSON.stringify(payload);
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: pathname,
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          },
          timeout: timeoutMs,
        },
        (res) => {
          res.resume();
          resolve(res.statusCode >= 200 && res.statusCode < 300);
        },
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end(body);
    } catch {
      resolve(false);
    }
  });
}

async function fetchCompanionSnapshot(port = COMPANION_PORT, timeoutMs = 700) {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/api/snapshot`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.snapshot ?? null;
  } catch {
    return null;
  }
}

export function buildSelfContainedAppHtml(baseRoot = root) {
  const html = fs.readFileSync(path.join(baseRoot, 'media', 'dashboard.html'), 'utf8');
  const css = fs.readFileSync(path.join(baseRoot, 'media', 'dashboard.css'), 'utf8');
  const bridge = fs.readFileSync(path.join(baseRoot, 'media', 'mcp-app-bridge.js'), 'utf8');
  const dashboardJs = fs.readFileSync(path.join(baseRoot, 'media', 'dashboard.js'), 'utf8');

  const safeStyle = `<style>\n${css.replace(/<\/style>/gi, '<\\/style>')}\n</style>`;
  const safeScript = `<script>\n${bridge.replace(/<\/script>/gi, '<\\/script>')}\n${dashboardJs.replace(/<\/script>/gi, '<\\/script>')}\n</script>`;

  return html
    .replace(/<meta[\s\S]*?http-equiv="Content-Security-Policy"[\s\S]*?\/?>/i, '')
    .replace(/<link\s+rel="stylesheet"\s+href="\{\{cssUri\}\}"\s*\/?>/i, () => safeStyle)
    .replace(/<script\s+nonce="\{\{nonce\}\}"\s+src="\{\{jsUri\}\}"><\/script>/i, () => safeScript)
    .replaceAll('{{host}}', 'mcp-app');
}

const monitor = new Monitor({
  logger: (message) => console.error(`[mcp-app] ${message}`),
  getConfig: () => config,
  onSnapshot: (snapshot) => {
    latest = snapshot;
  },
  recordUsage: (record) => {
    addUsage(buckets, record);
    stateDirty = true;
    scheduleSave();
  },
  usageSummary: () => summariseUsage(buckets),
});

let lastProvidedTarget = null;
let lastCompanionReauthAt = 0;

const envTarget = parseEnvLoopbackTarget();
const envConv =
  typeof process.env.ANTIGRAVITY_CONVERSATION_ID === 'string' &&
  process.env.ANTIGRAVITY_CONVERSATION_ID.length > 0 &&
  process.env.ANTIGRAVITY_CONVERSATION_ID.length <= 200 &&
  !/\s/.test(process.env.ANTIGRAVITY_CONVERSATION_ID)
    ? process.env.ANTIGRAVITY_CONVERSATION_ID
    : undefined;
if (envTarget) {
  lastProvidedTarget = envConv ? { ...envTarget, conversationId: envConv } : envTarget;
  monitor.provideTarget(envTarget.port, envTarget.token, envTarget.scheme, 'app');
  if (envConv) {
    monitor.observeConversation(envTarget.port, envConv, 'conversation', null);
  }
  void postLoopbackJson(COMPANION_PORT, '/api/token', lastProvidedTarget);
}

let embeddedStarted = false;
function ensureEmbeddedStarted() {
  if (embeddedStarted) return;
  embeddedStarted = true;
  monitor.start();
}

function applyCommand(message) {
  switch (message.type) {
    case 'ready':
      return;
    case 'refresh':
      if (embeddedStarted) monitor.refreshNow();
      return;
    case 'relaunchApp':
    case 'relaunchIde':
    case 'openInAppPanel':
      // Forwarded to companion once by send_command after applyCommand.
      return;
    case 'selectBackend':
      if (embeddedStarted) monitor.selectBackend(message.id);
      return;
    case 'selectSession':
      if (embeddedStarted) monitor.pinConversation(message.id);
      return;
    case 'updateSetting':
      config[message.key] = message.value;
      stateDirty = true;
      scheduleSave();
      if (embeddedStarted) monitor.updatePreferences();
      return;
    default:
      return;
  }
}

async function currentSnapshot() {
  const companionSnap = await fetchCompanionSnapshot(COMPANION_PORT, 400);
  if (isLiveSnapshot(companionSnap)) {
    return companionSnap;
  }
  const now = Date.now();
  if (shouldReauthCompanion(companionSnap, lastProvidedTarget, now, lastCompanionReauthAt)) {
    lastCompanionReauthAt = now;
    void postLoopbackJson(COMPANION_PORT, '/api/token', lastProvidedTarget);
  }
  ensureEmbeddedStarted();
  return selectPreferredSnapshot(companionSnap, latest);
}

function summariseSnapshotText(snapshot) {
  if (!snapshot) {
    return 'Antigravity Monitor is connecting to the local language server.';
  }
  const conv = snapshot.conversation;
  if (!conv || !conv.usage) {
    return `Antigravity Monitor status: ${snapshot.status}.`;
  }
  const pct = typeof conv.usage.percent === 'number' ? `${conv.usage.percent.toFixed(1)}%` : 'unknown';
  const used = typeof conv.usage.used === 'number' ? formatTokens(conv.usage.used) : '?';
  const cap = typeof conv.usage.capacity === 'number' ? formatTokens(conv.usage.capacity) : '?';
  const model = conv.modelName || snapshot.composerModelName || 'Unknown model';
  return `${conv.title || 'Active session'} (${model}): ${pct} context (${used} / ${cap}).`;
}

export const TOOLS = [
  {
    name: 'open_monitor',
    title: 'Antigravity Monitor',
    description: 'Open the live Antigravity Monitor dashboard showing context window, quota pools, token speed, and active threads.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    _meta: {
      ui: {
        resourceUri: APP_URI,
      },
      'com.google.antigravity/ui': {
        entrypoints: [
          { type: 'aux_pane', title: 'Antigravity Monitor' },
          { type: 'global', title: 'Antigravity Monitor' },
        ],
      },
    },
  },
  {
    name: 'get_snapshot',
    title: 'Get Monitor Snapshot',
    description: 'Fetch the latest live telemetry snapshot for the Antigravity Monitor UI.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    _meta: {
      ui: {
        visibility: ['app'],
      },
    },
  },
  {
    name: 'send_command',
    title: 'Send Monitor Command',
    description: 'Forward a dashboard action or preference update to the Antigravity Monitor controller.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'object' },
      },
      required: ['message'],
      additionalProperties: false,
    },
    _meta: {
      ui: {
        visibility: ['app'],
      },
    },
  },
];

function writeResponse(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function writeError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

async function handleRequest(msg) {
  const { id, method, params } = msg ?? {};
  const isNotification = id === undefined || id === null;

  try {
    switch (method) {
      case 'initialize': {
        if (isNotification) return;
        const requested = typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-03-26';
        writeResponse(id, {
          protocolVersion: requested,
          capabilities: {
            tools: {},
            resources: {},
          },
          serverInfo: {
            name: 'antigravity-monitor',
            version: packageVersion,
          },
        });
        return;
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return;
      case 'ping':
        if (!isNotification) writeResponse(id, {});
        return;
      case 'tools/list':
        if (!isNotification) writeResponse(id, { tools: TOOLS });
        return;
      case 'resources/list':
        if (!isNotification) {
          writeResponse(id, {
            resources: [
              {
                uri: APP_URI,
                name: 'Antigravity Monitor Dashboard',
                description: 'Live local context window, quota pools, threads, and settings dashboard.',
                mimeType: 'text/html;profile=mcp-app',
                _meta: { ui: { prefersBorder: false } },
              },
            ],
          });
        }
        return;
      case 'resources/read': {
        if (isNotification) return;
        const uri = params?.uri;
        if (uri !== APP_URI) {
          writeError(id, -32602, `Unknown resource URI: ${String(uri)}`);
          return;
        }
        const text = buildSelfContainedAppHtml();
        writeResponse(id, {
          contents: [
            {
              uri: APP_URI,
              mimeType: 'text/html;profile=mcp-app',
              text,
              _meta: { ui: { prefersBorder: false } },
            },
          ],
        });
        return;
      }
      case 'tools/call': {
        if (isNotification) return;
        const name = params?.name;
        const args = params?.arguments ?? {};
        if (name === 'open_monitor') {
          const snapshot = await currentSnapshot();
          writeResponse(id, {
            content: [{ type: 'text', text: summariseSnapshotText(snapshot) }],
            structuredContent: { snapshot },
          });
          return;
        }
        if (name === 'get_snapshot') {
          const snapshot = await currentSnapshot();
          writeResponse(id, {
            content: [{ type: 'text', text: summariseSnapshotText(snapshot) }],
            structuredContent: { snapshot },
          });
          return;
        }
        if (name === 'send_command') {
          const parsed = parseMessage(args?.message);
          if (parsed) {
            const delivered = await postLoopbackJson(COMPANION_PORT, '/api/command', parsed);
            if (!delivered || (embeddedStarted && (parsed.type === 'refresh' || parsed.type === 'selectBackend' || parsed.type === 'selectSession'))) {
              applyCommand(parsed);
            }
          }
          const snapshot = await currentSnapshot();
          writeResponse(id, {
            content: [{ type: 'text', text: 'OK' }],
            structuredContent: { snapshot },
          });
          return;
        }
        writeError(id, -32601, `Unknown tool: ${String(name)}`);
        return;
      }
      default:
        if (!isNotification) writeError(id, -32601, `Method not found: ${String(method)}`);
    }
  } catch (error) {
    if (!isNotification) {
      writeError(id, -32603, error instanceof Error ? error.message : String(error));
    }
  }
}

export function startTokenBridgeServer(onValidPayload) {
  const srv = http.createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/api/token') {
      response.writeHead(404);
      response.end();
      return;
    }
    const contentType = request.headers['content-type']?.split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      response.writeHead(415, { 'content-type': 'application/json' });
      response.end('{"error":"JSON required"}');
      return;
    }
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 4096) {
        response.writeHead(413);
        response.end();
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        const valid = validateTokenPayload(parsed);
        if (!valid) {
          response.writeHead(400, { 'content-type': 'application/json' });
          response.end('{"error":"invalid token payload"}');
          return;
        }
        onValidPayload(valid);
        response.writeHead(204);
        response.end();
      } catch {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end('{"error":"bad request"}');
      }
    });
  });
  return srv;
}

export function startServer() {
  const bridgePortFile = path.join(path.dirname(stateFile), 'mcp-bridge-port.txt');
  const tokenBridge = startTokenBridgeServer((valid) => {
    lastProvidedTarget = valid;
    monitor.provideTarget(valid.port, valid.token, valid.scheme, 'app');
    if (valid.conversationId) {
      monitor.observeConversation(valid.port, valid.conversationId, 'conversation', null);
    }
    void postLoopbackJson(COMPANION_PORT, '/api/token', valid);
  });
  tokenBridge.on('error', (err) => {
    console.error(`[mcp-app] token bridge error: ${err.message}`);
  });
  tokenBridge.listen(0, '127.0.0.1', () => {
    const addr = tokenBridge.address();
    if (typeof addr === 'object' && addr?.port) {
      try {
        fs.mkdirSync(path.dirname(bridgePortFile), { recursive: true, mode: 0o700 });
        fs.writeFileSync(bridgePortFile, String(addr.port), { mode: 0o600 });
      } catch (err) {
        console.error(`[mcp-app] failed to write bridge port file: ${err.message}`);
      }
    }
  });

  // Start embedded monitor lazily only if the companion is absent or not live.
  void currentSnapshot();
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return;
    }
    void handleRequest(parsed);
  });

  const shutdown = () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    try { fs.unlinkSync(bridgePortFile); } catch {}
    try { tokenBridge.close(); } catch {}
    flushState();
    monitor.stop();
    process.exit(0);
  };
  rl.on('close', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  startServer();
}
