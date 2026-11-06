#!/usr/bin/env node
/**
 * Renders the dashboard in headless Chrome and screenshots every tab.
 *
 * The webview normally gets its data and its `acquireVsCodeApi` shim from VS
 * Code. This harness supplies both so the real `dashboard.html`, `dashboard.css`,
 * and `dashboard.js` can be exercised — catching syntax errors, CSP violations,
 * and layout breakage without reloading the IDE.
 *
 *   node scripts/preview-dashboard.mjs
 *
 * Output: preview/overview.png, sessions.png, models.png, settings.png
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'preview');
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const NONCE = 'preview-nonce';

const now = Date.now();
const iso = (offsetMs) => new Date(now - offsetMs).toISOString();

export function sampleSnapshot() {
  return {
    quota: {
      status: 'live', error: null, observedAt: Date.now(),
      groups: [
        { id: 'gemini', label: 'Gemini Models', buckets: [
          { id: 'gemini-5h', window: '5h', percent: 94.6, resetsAt: iso(-62 * 60000), enabled: true },
          { id: 'gemini-weekly', window: 'weekly', percent: 98.4, resetsAt: iso(-(5 * 24 + 10) * 3600000), enabled: true },
        ] },
        { id: 'third-party', label: 'Claude and GPT models', buckets: [
          { id: '3p-5h', window: '5h', percent: 100, resetsAt: null, enabled: true },
          { id: '3p-weekly', window: 'weekly', percent: 100, resetsAt: null, enabled: true },
        ] },
      ],
    },
    schemaVersion: 1,
    generatedAt: now,
    status: 'ok',
    backend: {
      id: 'https:50062',
      kind: 'legacy',
      scheme: 'https',
      port: 50062,
      pid: 38604,
      app: 'app',
      reachable: true,
      conversations: 4,
      running: 1,
      lastActivityMs: now - 40_000,
      active: true,
    },
    backends: [
      { id: 'https:50062', kind: 'legacy', scheme: 'https', port: 50062, pid: 38604, app: 'app', reachable: true, conversations: 4, running: 1, lastActivityMs: now - 40_000, active: true },
      { id: 'hub:http:55908', kind: 'hub', scheme: 'http', port: 55908, pid: 17460, app: 'vscode', reachable: true, conversations: 2, running: 0, lastActivityMs: now - 900_000, active: false },
      { id: 'hub:http:50096', kind: 'hub', scheme: 'http', port: 50096, pid: 39872, app: 'ide', reachable: true, conversations: 1, running: 0, lastActivityMs: now - 3_600_000, active: false },
    ],
    instances: [
      {
        backend: { id: 'https:50062', kind: 'legacy', scheme: 'https', port: 50062, pid: 38604, app: 'app', reachable: true, conversations: 4, running: 1, lastActivityMs: now - 40_000, active: true },
        status: 'ok',
        observedConversationId: 'c1',
        conversation: {
          id: 'c1',
          title: 'Review parser changes',
          status: 'running',
          stepCount: 201,
          modelName: 'Gemini 3.8 Flash (High)',
          modelId: 'MODEL_PLACEHOLDER_M318',
          usage: { percent: 22.33, used: 234_173, capacity: 1_048_576 },
        },
      },
      {
        backend: { id: 'hub:http:55908', kind: 'hub', scheme: 'http', port: 55908, pid: 17460, app: 'vscode', reachable: true, conversations: 2, running: 0, lastActivityMs: now - 900_000, active: false },
        status: 'ok',
        observedConversationId: null,
        conversation: {
          id: 'v1',
          title: 'Parser integration tests',
          status: 'idle',
          stepCount: 130,
          modelName: 'Gemini 3.8 Flash (High)',
          modelId: 'MODEL_PLACEHOLDER_M318',
          usage: { percent: 17.1, used: 179_300, capacity: 1_048_576 },
        },
      },
      {
        backend: { id: 'hub:http:50096', kind: 'hub', scheme: 'http', port: 50096, pid: 39872, app: 'ide', reachable: true, conversations: 1, running: 0, lastActivityMs: now - 3_600_000, active: false },
        status: 'ok',
        observedConversationId: null,
        conversation: {
          id: 'i1',
          title: 'Review project setup',
          status: 'idle',
          stepCount: 88,
          modelName: 'Claude Sonnet 4.6 (Thinking)',
          modelId: 'MODEL_PLACEHOLDER_M35',
          usage: { percent: 11.7, used: 29_250, capacity: 250_000 },
        },
      },
    ],
    conversation: {
      id: 'c1',
      title: 'Review parser changes',
      status: 'running',
      stepCount: 201,
      lastModified: iso(40_000),
      createdAt: iso(7_200_000),
      modelId: 'MODEL_PLACEHOLDER_M318',
      modelName: 'Gemini 3.8 Flash (High)',
      usage: {
        used: 234_173,
        capacity: 1_048_576,
        percent: 22.33,
        remaining: 814_403,
        input: 3_568,
        cacheRead: 226_317,
        cacheCreate: 0,
        output: 4_288,
        source: 'measured',
        measuredAt: iso(45_000),
      },
      compressed: false,
      imageSteps: 2,
      totals: {
        input: 412_000,
        cacheRead: 2_180_000,
        cacheCreate: 0,
        output: 96_400,
        calls: 98,
        costUsd: 1.24,
      },
    },
    sessions: [
      { id: 'c1', title: 'Review parser changes', status: 'running', stepCount: 201, lastModified: iso(40_000), modelName: 'Gemini 3.8 Flash (High)', percent: 22.33, active: true },
      { id: 'c2', title: 'Prepare documentation', status: 'idle', stepCount: 2639, lastModified: iso(3_600_000), modelName: 'Gemini 3.8 Flash (High)', percent: 68.1, active: false },
      { id: 'c3', title: 'AI Coding Skills Installation', status: 'idle', stepCount: 158, lastModified: iso(86_400_000), modelName: 'Claude Sonnet 4.6 (Thinking)', percent: 12.4, active: false },
      { id: 'c4', title: 'Disabling Autoot in OpenCodex', status: 'idle', stepCount: 14, lastModified: iso(260_000_000), modelName: null, percent: null, active: false },
    ],
    models: [
      { modelId: 'MODEL_PLACEHOLDER_M318', label: 'Gemini 3.8 Flash (High)', quotaPercent: 83.65, resetsAt: new Date(now + 16_000_000).toISOString(), contextLimit: 1_048_576, maxOutput: 65_536, active: true },
      { modelId: 'MODEL_PLACEHOLDER_M319', label: 'Gemini 3.8 Flash (Medium)', quotaPercent: 83.65, resetsAt: new Date(now + 16_000_000).toISOString(), contextLimit: 1_048_576, maxOutput: 65_536, active: false },
      { modelId: 'MODEL_PLACEHOLDER_M26', label: 'Claude Opus 4.6 (Thinking)', quotaPercent: 100, resetsAt: new Date(now + 20_000_000).toISOString(), contextLimit: 250_000, maxOutput: 64_000, active: false },
      { modelId: 'MODEL_PLACEHOLDER_M35', label: 'Claude Sonnet 4.6 (Thinking)', quotaPercent: 96.2, resetsAt: new Date(now + 20_000_000).toISOString(), contextLimit: 250_000, maxOutput: 64_000, active: false },
      { modelId: 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM', label: 'GPT-OSS 120B (Medium)', quotaPercent: 100, resetsAt: null, contextLimit: 131_072, maxOutput: 32_768, active: false },
    ],
    account: {
      name: 'Test User',
      email: 'test@example.com',
      planName: 'Pro',
      tierName: 'Google AI Pro',
      monthlyPromptCredits: 50_000,
      monthlyFlowCredits: 150_000,
    },
    usage: {
      days: Array.from({ length: 14 }, (_, index) => {
        const value = Math.round(40_000 + Math.abs(Math.sin(index * 1.7)) * 180_000);
        return {
          day: new Date(now - (13 - index) * 86_400_000).toISOString().slice(0, 10),
          tokens: value,
          costUsd: value > 60_000 ? 0.42 : null,
        };
      }),
      todayTokens: 128_400,
      todayCostUsd: 0.42,
      monthTokens: 2_345_678,
      monthCostUsd: 3.17,
      priced: true,
    },
    prefs: {
      pollIntervalMs: 2000,
      warningThreshold: 80,
      showQuota: true,
      maskPersonalInfo: true,
      maxPayloadMb: 128,
      displayMode: 'full',
    },
    lastError: null,
    discoveryNotes: [],
    stale: false,
  };
}

function buildStub(tab) {
  return `
    window.__harnessMessages = [];
    window.__harnessErrors = [];
    window.addEventListener('error', function (event) {
      window.__harnessErrors.push(String(event.message));
      document.documentElement.setAttribute('data-harness-errors', window.__harnessErrors.join(' | '));
    });
    window.addEventListener('unhandledrejection', function (event) {
      window.__harnessErrors.push('rejection: ' + String(event.reason));
      document.documentElement.setAttribute('data-harness-errors', window.__harnessErrors.join(' | '));
    });
    const __snapshot = ${JSON.stringify(sampleSnapshot())};
    if (new URLSearchParams(location.search).get('quota') === 'cached') {
      __snapshot.quota.status = 'cached';
      __snapshot.quota.error = 'timeout';
    }
    if (new URLSearchParams(location.search).get('quota') === 'unavailable') __snapshot.quota.status = 'unavailable';
    if (new URLSearchParams(location.search).get('state') === 'new-thread') {
      __snapshot.conversation = null;
      __snapshot.status = 'no-conversation';
      __snapshot.instances[0].conversation = null;
      __snapshot.instances[0].viewState = 'new-thread';
    }
    window.acquireVsCodeApi = function () {
      let state = { tab: ${JSON.stringify(tab)} };
      return {
        postMessage: function (message) {
          window.__harnessMessages.push(message);
          if (message && message.type === 'updateSetting') {
            __snapshot.prefs[message.key] = message.value;
            window.postMessage({ type: 'snapshot', snapshot: JSON.parse(JSON.stringify(__snapshot)) }, '*');
          }
          if (!message || message.type !== 'ready') return;
          const ticks = Math.max(1, Math.min(30, Number(new URLSearchParams(location.search).get('ticks') || '1')));
          for (let index = 0; index < ticks; index += 1) {
            const snapshot = JSON.parse(JSON.stringify(__snapshot));
            if (snapshot.conversation) {
              const used = __snapshot.conversation.usage.used - (ticks - 1 - index) * 9_000;
              snapshot.conversation.usage.used = used;
              snapshot.conversation.usage.percent = (used / snapshot.conversation.usage.capacity) * 100;
            }
            snapshot.generatedAt = Date.now() - (ticks - 1 - index) * 2_000;
            window.postMessage({ type: 'snapshot', snapshot: snapshot }, '*');
          }
        },
        getState: function () { return state; },
        setState: function (next) { state = next; },
      };
    };
  `;
}

function renderShell(tab) {
  const template = fs.readFileSync(path.join(root, 'media', 'dashboard.html'), 'utf8');
  const replaced = template
    .replaceAll('{{cspSource}}', "'self'")
    .replaceAll('{{nonce}}', NONCE)
    .replaceAll('{{host}}', 'companion')
    .replaceAll('{{cssUri}}', '/media/dashboard.css')
    .replaceAll('{{jsUri}}', '/media/dashboard.js');

  const scriptTag = `<script nonce="${NONCE}" src="/media/dashboard.js"></script>`;
  const stubTag = `<script nonce="${NONCE}">${buildStub(tab)}</script>`;
  return replaced.replace(scriptTag, `${stubTag}\n  ${scriptTag}`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

export function startServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/') {
      const tab = url.searchParams.get('tab') ?? 'overview';
      response.writeHead(200, { 'content-type': MIME['.html'] });
      response.end(renderShell(tab));
      return;
    }
    const filePath = path.join(root, url.pathname);
    if (!filePath.startsWith(path.join(root, 'media'))) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    try {
      const body = fs.readFileSync(filePath);
      response.writeHead(200, { 'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('not found');
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function runChrome(args) {
  return new Promise((resolve) => {
    const child = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function main() {
  if (!fs.existsSync(CHROME)) {
    console.error(`Chrome not found at ${CHROME}. Set CHROME_PATH to override.`);
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const { server, port } = await startServer();
  const tabs = ['overview', 'sessions', 'models', 'settings'];
  let failures = 0;

  try {
    for (const tab of tabs) {
      const url = `http://127.0.0.1:${port}/?tab=${tab}&ticks=8`;
      const screenshot = path.join(outDir, `${tab}.png`);

      const shot = await runChrome([
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--window-size=1240,1560',
        '--virtual-time-budget=2500',
        `--screenshot=${screenshot}`,
        url,
      ]);

      const dom = await runChrome([
        '--headless=new',
        '--disable-gpu',
        '--virtual-time-budget=2500',
        '--dump-dom',
        url,
      ]);

      const errorMatch = dom.stdout.match(/data-harness-errors="([^"]*)"/);
      const rendered = /class="gauge__percent"|class="list__row"|class="model-card"|class="settings"/.test(dom.stdout);

      const ok = shot.code === 0 && rendered && !errorMatch;
      if (!ok) {
        failures += 1;
      }
      console.log(
        `${ok ? 'PASS' : 'FAIL'}  ${tab.padEnd(9)} screenshot=${fs.existsSync(screenshot) ? 'yes' : 'no'}` +
          `  rendered=${rendered}  errors=${errorMatch ? errorMatch[1] : 'none'}`,
      );
      if (!rendered) {
        console.log(`      chrome stderr: ${shot.stderr.slice(0, 300).replace(/\s+/g, ' ')}`);
      }
    }
  } finally {
    server.close();
  }

  if (failures > 0) {
    console.error(`\n${failures} tab(s) failed to render.`);
    process.exit(1);
  }
  console.log(`\nAll tabs rendered without console errors. Screenshots in ${path.relative(root, outDir)}/`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
