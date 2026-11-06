#!/usr/bin/env node
/**
 * Live verification against a running Antigravity installation.
 *
 * Runs the *real* monitor — discovery, backend probing, selection, polling,
 * trajectory analysis, snapshot assembly — with only the persistence and UI
 * layers stubbed. Not shipped in the VSIX; it exists so the protocol work can be
 * re-proven on any machine without opening the IDE.
 *
 *   node scripts/live-check.mjs
 *
 * Exit code 0 means a conversation was measured. Non-zero means the monitor
 * never reached a usable state, and the diagnostic output explains why.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { Monitor } = require(path.join(here, '..', 'out', 'src', 'app', 'monitor.js'));
const format = require(path.join(here, '..', 'out', 'src', 'core', 'format.js'));
const { appLabel } = require(path.join(here, '..', 'out', 'src', 'core', 'presentation.js'));

const TIMEOUT_MS = Number(process.env.LIVE_CHECK_TIMEOUT_MS ?? 25_000);

const logs = [];
const usageRecords = [];
let latest = null;

const monitor = new Monitor({
  logger: (message) => {
    logs.push(message);
    if (process.env.LIVE_CHECK_VERBOSE) {
      console.log(`  · ${message}`);
    }
  },
  getConfig: () => ({
    pollIntervalMs: 2000,
    warningThreshold: 80,
    showQuota: true,
    maskPersonalInfo: true,
    maxPayloadMb: 128,
  }),
  onSnapshot: (snapshot) => {
    latest = snapshot;
  },
  recordUsage: (record) => {
    usageRecords.push(record);
  },
  usageSummary: () => ({
    days: [],
    todayTokens: 0,
    todayCostUsd: null,
    monthTokens: 0,
    monthCostUsd: null,
    priced: false,
  }),
});

function waitFor(predicate, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (predicate() || Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        resolve(predicate());
      }
    }, 120);
  });
}

function bar(percent) {
  const filled = Math.round(Math.max(0, Math.min(100, percent ?? 0)) / 5);
  return `${'█'.repeat(filled)}${'░'.repeat(20 - filled)}`;
}

async function main() {
  console.log('Antigravity Monitor — live check');
  console.log('─'.repeat(64));
  monitor.start();

  const ready = await waitFor(() => latest && latest.status === 'ok' && latest.conversation, TIMEOUT_MS);
  monitor.stop();

  if (!latest) {
    console.error('FAIL: the monitor produced no snapshot at all.');
    for (const line of logs) console.error(`  · ${line}`);
    process.exit(1);
  }

  console.log(`status            ${latest.status}`);
  console.log(`backends found    ${latest.backends.length}`);
  for (const backend of latest.backends) {
    const marker = backend.active ? '*' : ' ';
    console.log(
      `  ${marker} ${appLabel(backend.app).padEnd(16)} ${backend.id.padEnd(16)}` +
        ` ${backend.reachable ? 'reachable  ' : 'unreachable'}` +
        `  conversations=${backend.conversations}  running=${backend.running}`,
    );
  }
  if (latest.discoveryNotes.length > 0) {
    console.log(`discovery notes   ${latest.discoveryNotes.join('; ')}`);
  }
  if (latest.instances.length > 0) {
    console.log('apps:');
    for (const instance of latest.instances) {
      const conversation = instance.conversation;
      const usage = conversation?.usage;
      console.log(
        `  ${instance.backend.active ? '*' : ' '} ${appLabel(instance.backend.app).padEnd(16)}` +
          ` ${instance.backend.id.padEnd(16)}` +
          ` ${conversation ? conversation.title.slice(0, 42).padEnd(42) : 'no conversation'.padEnd(42)}` +
          ` ${usage ? format.formatPercent(usage.percent) : 'no reading'}`,
      );
    }
  }

  if (latest.conversation) {
    const conversation = latest.conversation;
    const usage = conversation.usage;
    console.log('─'.repeat(64));
    console.log(`conversation      ${conversation.title.slice(0, 60)}`);
    console.log(`status / steps    ${conversation.status} / ${conversation.stepCount}`);
    console.log(`model             ${conversation.modelName ?? conversation.modelId ?? 'unknown'}`);
    if (usage) {
      const percent = usage.percent ?? 0;
      console.log(
        `context           ${bar(percent)}  ${format.formatPercent(percent)}` +
          `  ${format.formatExact(usage.used)} / ${format.formatExact(usage.capacity)} tokens`,
      );
      console.log(
        `breakdown         fresh=${format.formatExact(usage.input)}` +
          `  cache-read=${format.formatExact(usage.cacheRead)}` +
          `  output=${format.formatExact(usage.output)}`,
      );
      console.log(`source            ${usage.source}`);
      console.log(`remaining         ${format.formatTokens(usage.remaining)} tokens`);
    } else {
      console.log('context           not measured');
    }
    console.log(`image steps       ${conversation.imageSteps}`);
  }

  console.log(`models in picker  ${latest.models.length}`);
  console.log(`usage records     ${usageRecords.length}`);
  if (latest.lastError) {
    console.log(`last error        ${latest.lastError}`);
  }
  console.log('─'.repeat(64));

  const measured = Boolean(latest.conversation?.usage) && (latest.conversation.usage.used ?? 0) > 0;
  if (ready && measured) {
    console.log('PASS: live context usage was measured from the running backend.');
    process.exit(0);
  }

  console.log('Diagnostics:');
  for (const line of logs) console.log(`  · ${line}`);
  console.error(`FAIL: expected a measured conversation within ${TIMEOUT_MS} ms.`);
  process.exit(1);
}

main().catch((error) => {
  monitor.stop();
  console.error(error);
  process.exit(1);
});
