/**
 * The contract between the monitor and every consumer (status bar, tooltip,
 * dashboard). Versioned so a stale webview can be detected rather than
 * mis-rendered.
 */

import type { AccountInfo } from '../core/models';
import type { DisplayMode } from '../core/presentation';
import type { ConversationStatus } from '../core/select';
import type { UsageDay, UsageSummary } from '../core/usage';
import type { QuotaState } from '../core/quota';
import type { SnippetPrefs } from '../core/snippet';

export type { UsageDay, UsageSummary };

export const SNAPSHOT_SCHEMA_VERSION = 1;

/** Upper bound on session rows so a long history cannot bloat the webview. */
export const SESSION_LIMIT = 50;

export type MonitorStatus =
  | 'starting'
  | 'connecting'
  | 'ok'
  | 'no-conversation'
  | 'disconnected'
  | 'error';

export interface BackendView {
  id: string;
  kind: 'hub' | 'legacy';
  scheme: 'http' | 'https';
  port: number;
  pid: number | null;
  /** Which installation owns this backend: desktop app, IDE, VS Code, or unknown. */
  app: 'app' | 'ide' | 'vscode' | 'unknown';
  reachable: boolean;
  conversations: number;
  running: number;
  lastActivityMs: number;
  active: boolean;
}

export interface UsageView {
  used: number;
  capacity: number | null;
  percent: number | null;
  remaining: number | null;
  input: number;
  cacheRead: number;
  cacheCreate: number;
  output: number;
  source: 'measured' | 'estimated';
  measuredAt: string | null;
}

export interface ConversationView {
  id: string;
  title: string;
  status: ConversationStatus;
  stepCount: number;
  lastModified: string | null;
  createdAt: string | null;
  modelId: string | null;
  modelName: string | null;
  usage: UsageView | null;
  compressed: boolean;
  imageSteps: number;
  totals: {
    input: number;
    cacheRead: number;
    cacheCreate: number;
    output: number;
    calls: number;
    costUsd: number | null;
  };
}

export interface SessionRow {
  id: string;
  title: string;
  status: ConversationStatus;
  stepCount: number;
  lastModified: string | null;
  modelName: string | null;
  percent: number | null;
  active: boolean;
}

export interface ModelRow {
  modelId: string | null;
  label: string;
  quotaPercent: number | null;
  resetsAt: string | null;
  contextLimit: number | null;
  maxOutput: number | null;
  active: boolean;
}

export interface SnapshotPrefs extends SnippetPrefs {
  pollIntervalMs: number;
  warningThreshold: number;
  showQuota: boolean;
  maskPersonalInfo: boolean;
  maxPayloadMb: number;
  displayMode: DisplayMode;
}

/**
 * One installation's share of the picture.
 *
 * Several Antigravity hosts can run at once against the same account. Each owns
 * a separate language server and therefore a separate conversation set, so a
 * single "current conversation" would silently describe only one window.
 */
export interface InstanceView {
  quota?: QuotaState;
  backend: BackendView;
  status: MonitorStatus;
  conversation: ConversationView | null;
  /** Conversation the host itself has open, when a renderer reported it. */
  observedConversationId: string | null;
  viewState?: 'conversation' | 'new-thread' | 'unknown';
}

export interface Snapshot {
  quota?: QuotaState;
  weeklyQuota?: { percent: number; resetText: string | null; observedAt: number } | null;
  schemaVersion: number;
  generatedAt: number;
  status: MonitorStatus;
  backend: BackendView | null;
  backends: BackendView[];
  /** Every reachable installation, focused one first. */
  instances: InstanceView[];
  conversation: ConversationView | null;
  sessions: SessionRow[];
  models: ModelRow[];
  account: AccountInfo | null;
  usage: UsageSummary;
  prefs: SnapshotPrefs;
  /** Human-readable reason for the current state; never contains a token. */
  lastError: string | null;
  discoveryNotes: string[];
  /** True when the last successful reading is older than the poll interval. */
  stale: boolean;
}

export function emptySnapshot(prefs: SnapshotPrefs): Snapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: Date.now(),
    status: 'starting',
    backend: null,
    backends: [],
    instances: [],
    conversation: null,
    sessions: [],
    models: [],
    account: null,
    usage: {
      days: [],
      todayTokens: 0,
      todayCostUsd: null,
      monthTokens: 0,
      monthCostUsd: null,
      priced: false,
    },
    prefs,
    lastError: null,
    discoveryNotes: [],
    stale: false,
  };
}
