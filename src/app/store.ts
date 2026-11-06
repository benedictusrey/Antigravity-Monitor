/**
 * Durable state.
 *
 * Two very different kinds of data live here:
 *
 * - Selections (which backend, which conversation) belong to a window, so they
 *   are kept in `workspaceState`.
 * - Daily token totals are machine-wide facts about API-equivalent consumption,
 *   so they are kept in a small JSON file under `globalStorageUri`. A settings
 *   blob would be the wrong shape for a growing time series.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { recentDayKeys } from '../core/format';
import { UsageBucket, UsageRecord, UsageSummary, addUsage, summariseUsage } from '../core/usage';

import { MonitorConfig } from './monitor';
import { CONFIG_SECTION } from './strings';
import { SNIPPET_DEFAULTS, SnippetPrefs } from '../core/snippet';

interface UsageFile {
  version: 1;
  buckets: Record<string, UsageBucket>;
}

const USAGE_FILENAME = 'usage.json';
const USAGE_VERSION = 1;
const MAX_DAYS_RETAINED = 120;
const FLUSH_DEBOUNCE_MS = 4_000;

export class Store implements vscode.Disposable {
  private readonly context: vscode.ExtensionContext;
  private buckets = new Map<string, UsageBucket>();
  private dirty = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  // ------------------------------------------------------------- preferences

  get config(): MonitorConfig {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    return {
      ...Object.fromEntries(Object.entries(SNIPPET_DEFAULTS).map(([key, fallback]) => {
        const value = config.get<unknown>(key);
        return [key, typeof value === 'boolean' ? value : fallback];
      })) as SnippetPrefs,
      pollIntervalMs: clampNumber(config.get<number>('pollIntervalMs'), 2000, 1000, 60_000),
      warningThreshold: clampNumber(config.get<number>('warningThreshold'), 80, 50, 100),
      showQuota: config.get<boolean>('showQuota') ?? true,
      maskPersonalInfo: config.get<boolean>('maskPersonalInfo') ?? true,
      maxPayloadMb: clampNumber(config.get<number>('maxPayloadMb'), 128, 16, 1024),
      displayMode: config.get<string>('displayMode') === 'custom' ? 'custom'
        : config.get<string>('displayMode') === 'essentials' ? 'essentials' : 'full',
    };
  }

  /** Remaining-quota percentage below which a one-off warning is shown. */
  get quotaWarningThreshold(): number {
    return clampNumber(
      vscode.workspace.getConfiguration(CONFIG_SECTION).get<number>('quotaWarningThreshold'),
      15,
      0,
      100,
    );
  }

  async setMasked(masked: boolean): Promise<void> {
    await vscode.workspace.getConfiguration(CONFIG_SECTION).update('maskPersonalInfo', masked, vscode.ConfigurationTarget.Global);
  }

  // --------------------------------------------------------------- selections

  get pinnedBackendId(): string | null {
    return this.context.workspaceState.get<string | null>('antigravityMonitor.pinnedBackendId', null);
  }

  async setPinnedBackendId(id: string | null): Promise<void> {
    await this.context.workspaceState.update('antigravityMonitor.pinnedBackendId', id);
  }

  get pinnedConversationId(): string | null {
    return this.context.workspaceState.get<string | null>('antigravityMonitor.pinnedConversationId', null);
  }

  async setPinnedConversationId(id: string | null): Promise<void> {
    await this.context.workspaceState.update('antigravityMonitor.pinnedConversationId', id);
  }

  // -------------------------------------------------------------------- usage

  loadUsage(): void {
    const file = this.usageFilePath();
    if (!file) {
      return;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<UsageFile>;
      if (!parsed || parsed.version !== USAGE_VERSION || typeof parsed.buckets !== 'object' || parsed.buckets === null) {
        return;
      }
      for (const [key, value] of Object.entries(parsed.buckets)) {
        const bucket = sanitiseBucket(value);
        if (bucket) {
          this.buckets.set(key, bucket);
        }
      }
      this.pruneOldDays();
    } catch {
      // A missing or corrupt file is expected on first run and after a schema
      // change; starting empty is correct, and the next flush replaces it.
    }
  }

  recordUsage(record: UsageRecord): void {
    addUsage(this.buckets, record);
    this.dirty = true;
    this.scheduleFlush();
  }

  usageSummary(): UsageSummary {
    return summariseUsage(this.buckets);
  }

  // ------------------------------------------------------------------ storage

  private usageFilePath(): string | null {
    try {
      return path.join(this.context.globalStorageUri.fsPath, USAGE_FILENAME);
    } catch {
      return null;
    }
  }

  private scheduleFlush(): void {
    if (this.disposed || this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DEBOUNCE_MS);
    this.flushTimer.unref?.();
  }

  async flush(): Promise<void> {
    if (!this.dirty) {
      return;
    }
    const file = this.usageFilePath();
    if (!file) {
      return;
    }
    const payload: UsageFile = { version: USAGE_VERSION, buckets: Object.fromEntries(this.buckets) };
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporary, file);
      this.dirty = false;
    } catch {
      // Persisting usage is best-effort: a read-only profile should never break
      // monitoring, and the in-memory series stays correct for this session.
    }
  }

  private pruneOldDays(): void {
    const cutoff = recentDayKeys(MAX_DAYS_RETAINED)[0];
    for (const key of [...this.buckets.keys()]) {
      const day = key.slice(0, key.indexOf('|'));
      if (day < cutoff) {
        this.buckets.delete(key);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.dirty) {
      const file = this.usageFilePath();
      if (file) {
        try {
          fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
          const temporary = `${file}.${process.pid}.tmp`;
          fs.writeFileSync(temporary, JSON.stringify({ version: USAGE_VERSION, buckets: Object.fromEntries(this.buckets) }), { encoding: 'utf8', mode: 0o600 });
          fs.renameSync(temporary, file);
          this.dirty = false;
        } catch {
          // Ignore: shutdown must not fail because of a write problem.
        }
      }
    }
  }
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function sanitiseBucket(value: unknown): UsageBucket | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const read = (field: string): number => {
    const raw = record[field];
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : 0;
  };
  return {
    input: read('input'),
    cacheRead: read('cacheRead'),
    cacheCreate: read('cacheCreate'),
    output: read('output'),
  };
}
