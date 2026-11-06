#!/usr/bin/env node
/**
 * Companion state.
 *
 * The extension keeps its settings in VS Code and its usage under
 * `globalStorageUri`; the companion has neither, so it owns a small file of its
 * own. Same bucket shape as the extension, so both hosts agree on a day's
 * totals.
 *
 * Everything read from disk is untrusted: a hand-edited or half-written file
 * must never crash the monitor or corrupt a total.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { installPaths } from './platform.mjs';
const { SNIPPET_DEFAULTS } = createRequire(import.meta.url)('../out/src/core/snippet.js');

const VERSION = 1;

export function statePath(env = process.env, platform = process.platform, home = os.homedir()) {
  return installPaths(env, platform, home).state;
}

export function loadState(file) {
  const empty = { version: VERSION, config: {}, buckets: {}, limits: null };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || parsed.version !== VERSION) {
      return empty;
    }
    return {
      version: VERSION,
      config: isRecord(parsed.config) ? parsed.config : {},
      buckets: isRecord(parsed.buckets) ? parsed.buckets : {},
      limits: parsed.limits ?? null,
    };
  } catch {
    return empty;
  }
}

/** Write through a temp file so a crash cannot truncate the real one. */
export function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  const payload = JSON.stringify({
    version: VERSION,
    config: state.config ?? {},
    buckets: state.buckets ?? {},
    limits: state.limits ?? null,
  });
  fs.writeFileSync(temp, payload, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
}

/** Merge stored config over defaults, discarding anything that fails validation. */
export function mergeConfig(defaults, stored) {
  const next = { ...defaults };
  if (!isRecord(stored)) {
    return next;
  }

  const number = (key, min, max) => {
    const value = Number(stored[key]);
    if (Number.isFinite(value)) {
      next[key] = Math.min(max, Math.max(min, Math.round(value)));
    }
  };
  number('pollIntervalMs', 1000, 60_000);
  number('warningThreshold', 50, 100);
  number('maxPayloadMb', 16, 1024);

  if (typeof stored.showQuota === 'boolean') {
    next.showQuota = stored.showQuota;
  }
  if (typeof stored.maskPersonalInfo === 'boolean') {
    next.maskPersonalInfo = stored.maskPersonalInfo;
  }
  if (stored.displayMode === 'essentials' || stored.displayMode === 'full' || stored.displayMode === 'custom') {
    next.displayMode = stored.displayMode;
  }
  for (const key of Object.keys(SNIPPET_DEFAULTS)) {
    if (typeof stored[key] === 'boolean') next[key] = stored[key];
  }

  return next;
}

/** Drop buckets whose numbers are not finite non-negative values. */
export function sanitiseBuckets(raw) {
  const buckets = new Map();
  if (!isRecord(raw)) {
    return buckets;
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) {
      continue;
    }
    const read = (field) => {
      const number = Number(value[field]);
      return Number.isFinite(number) && number >= 0 ? number : 0;
    };
    buckets.set(key, {
      input: read('input'),
      cacheRead: read('cacheRead'),
      cacheCreate: read('cacheCreate'),
      output: read('output'),
    });
  }
  return buckets;
}

export function serialiseBuckets(buckets) {
  return Object.fromEntries(buckets);
}

/** A cached weekly reading, or nothing if the file was tampered with. */
export function sanitiseLimits(raw) {
  if (!isRecord(raw) || !isRecord(raw.weekly)) {
    return null;
  }
  const percent = Number(raw.weekly.percent);
  const readAt = Number(raw.readAt);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return null;
  }
  if (!Number.isFinite(readAt) || readAt <= 0) {
    return null;
  }
  return {
    weekly: {
      percent,
      resetText: typeof raw.weekly.resetText === 'string' ? raw.weekly.resetText.slice(0, 40) : null,
    },
    readAt,
  };
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
