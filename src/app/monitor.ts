/**
 * The monitor: discovery, selection, polling, and snapshot assembly.
 *
 * This module deliberately has no `vscode` import. Everything it needs is
 * injected, which keeps the polling logic runnable from a plain Node process —
 * that is how it is verified against a live Antigravity installation.
 *
 * Polling is two-tier, and the reason is measured rather than theoretical:
 * `GetCascadeTrajectorySteps` returns the *entire* trajectory on current builds
 * (9.6 MB for a 1,264-step conversation, no compression, ~140 ms) and ignores
 * `startIndex`/`endIndex` entirely. Fetching it every tick would move megabytes
 * per second across loopback. So the cheap summary call runs every tick, and the
 * expensive call runs only when a conversation actually changed.
 */

import { execFile } from 'node:child_process';
import * as path from 'node:path';

import { CompressionDetector, ConversationAnalysis, ConversationTotals, analyzeSteps } from '../core/analysis';
import {
  RawProcess,
  parsePosixOutput,
  parseWindowsOutput,
  posixDiscoveryScript,
  toBackendTargets,
  windowsDiscoveryScript,
} from '../core/discovery';
import { toDayKey } from '../core/format';
import {
  AccountInfo,
  ModelSpec,
  PickerModel,
  buildCatalog,
  estimateCost,
  parseUserStatus,
  quotaFor,
  resolveModel,
} from '../core/models';
import { BackendOwner, BackendTarget, RpcError, callRpc } from '../core/rpc';
import {
  BackendStatus,
  TrajectorySummary,
  chooseBackend,
  chooseConversation,
  dedupeBackends,
  parseTrajectories,
  signatureOf,
} from '../core/select';
import { asArray, dig } from '../core/values';
import { UsageRecord } from '../core/usage';
import { QuotaState, QUOTA_POLL_MS, emptyQuota, parseQuotaSummary, quotaAt, quotaBucket } from '../core/quota';
import { SnippetPrefs, snippetPreferences } from '../core/snippet';
import type { DisplayMode } from '../core/presentation';

import {
  BackendView,
  ConversationView,
  InstanceView,
  ModelRow,
  MonitorStatus,
  SESSION_LIMIT,
  SessionRow,
  Snapshot,
  SnapshotPrefs,
  UsageSummary,
  UsageView,
  emptySnapshot,
} from './snapshot';

export interface MonitorConfig extends SnippetPrefs {
  pollIntervalMs: number;
  warningThreshold: number;
  showQuota: boolean;
  maskPersonalInfo: boolean;
  maxPayloadMb: number;
  displayMode: DisplayMode;
}

export interface MonitorDeps {
  logger: (message: string) => void;
  getConfig: () => MonitorConfig;
  onSnapshot: (snapshot: Snapshot) => void;
  recordUsage: (record: UsageRecord) => void;
  usageSummary: () => UsageSummary;
  /** The installation hosting this monitor, used to start on its own backend. */
  hostApp?: BackendOwner;
}

interface CachedAnalysis {
  signature: string;
  analysis: ConversationAnalysis | null;
  error: string | null;
  fetchedAt: number;
  durationMs: number;
}

interface InstanceState {
  target: BackendTarget;
  status: BackendStatus;
  conversations: TrajectorySummary[];
  activeConversationId: string | null;
  /** Conversation the host's own window has open, reported by the badge bridge. */
  observedConversationId: string | null;
  observationState?: 'conversation' | 'new-thread' | 'unknown';
  observedAt?: number;
  previousStepCounts: Map<string, number>;
  retryAt: number;
}

const STATUS_REFRESH_MS = 60_000;
const SUMMARY_TIMEOUT_MS = 8_000;
const STEPS_TIMEOUT_MS = 45_000;
const DISCOVERY_TIMEOUT_MS = 12_000;
const MAX_BACKOFF_DISCOVERY_MS = 15_000;
const MAX_BACKOFF_RPC_MS = 60_000;

export class Monitor {
  private readonly deps: MonitorDeps;

  private disposed = false;
  private generation = 0;
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private discovering = false;
  private aborter: AbortController | null = null;
  private analysisAborter = new AbortController();
  private quotaTimer: NodeJS.Timeout | null = null;
  private quotaAborter: AbortController | null = null;
  private quotaRefreshing = false;
  private quotaRequested = false;
  private readonly quotas = new Map<string, QuotaState>();
  private readonly quotaRetries = new Map<string, { failures: number; at: number }>();

  private statuses = new Map<string, BackendStatus>();
  private readonly instances = new Map<string, InstanceState>();
  private focusTargetId: string | null = null;
  private needDiscovery = true;
  private pollsSinceDiscovery = 0;
  private readonly hostApp: BackendOwner | null;

  private readonly analysisCache = new Map<string, CachedAnalysis>();
  private readonly lastTotals = new Map<string, ConversationTotals>();
  private readonly inFlightSteps = new Set<string>();
  private readonly compression = new CompressionDetector();
  private readonly compressedUntil = new Map<string, number>();

  private catalog = new Map<string, ModelSpec>();
  private account: AccountInfo | null = null;
  private picker: PickerModel[] = [];
  private lastStatusRefresh = 0;

  private failureCount = 0;
  private lastFailureKind: 'discovery' | 'rpc' = 'rpc';
  private lastError: string | null = null;
  private discoveryNotes: string[] = [];
  private lastSuccessAt = 0;

  private snapshot: Snapshot;
  private snapshotSignature = '';

  private pinnedBackendId: string | null = null;
  private pinnedConversationId: string | null = null;

  constructor(deps: MonitorDeps) {
    this.deps = deps;
    this.hostApp = deps.hostApp && deps.hostApp !== 'unknown' ? deps.hostApp : null;
    this.snapshot = emptySnapshot(this.prefs());
  }

  // ---------------------------------------------------------------- lifecycle

  start(): void {
    if (this.disposed) {
      return;
    }
    this.deps.logger('Monitor starting');
    this.schedule(0);
    this.scheduleQuota(0);
  }

  stop(): void {
    this.disposed = true;
    this.generation += 1;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.aborter?.abort();
    this.aborter = null;
    this.analysisAborter.abort();
    if (this.quotaTimer) clearTimeout(this.quotaTimer);
    this.quotaTimer = null;
    this.quotaAborter?.abort();
    this.quotaAborter = null;
  }

  /** Force an immediate refresh, discarding any in-flight request. */
  refreshNow(): void {
    if (this.disposed) {
      return;
    }
    this.refreshQuotaNow();
    this.aborter?.abort();
    this.analysisAborter.abort();
    this.analysisAborter = new AbortController();
    this.generation += 1;
    this.failureCount = 0;
    this.analysisCache.clear();
    this.compression.clear();
    this.compressedUntil.clear();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Re-discovery is intentional: the user pressed refresh because something
    // looked wrong, and a stale backend handle is the most common cause.
    this.needDiscovery = true;
    this.schedule(0);
  }

  getSnapshot(): Snapshot {
    return this.snapshot;
  }

  updatePreferences(): void {
    if (this.disposed) return;
    if (this.prefs().maxPayloadMb !== this.snapshot.prefs.maxPayloadMb) this.refreshNow();
    this.publish();
  }

  refreshQuotaNow(): void {
    if (this.disposed) return;
    this.quotaRetries.clear();
    if (this.quotaRefreshing) { this.quotaRequested = true; return; }
    this.scheduleQuota(0);
  }

  private scheduleQuota(delayMs: number): void {
    if (this.disposed) return;
    if (this.quotaTimer) clearTimeout(this.quotaTimer);
    this.quotaTimer = setTimeout(() => { void this.quotaCycle(); }, delayMs);
    this.quotaTimer.unref?.();
  }

  /** Quotas publish independently so a large trajectory cannot freeze account limits. */
  private async quotaCycle(): Promise<void> {
    if (this.disposed || this.quotaRefreshing) return;
    this.quotaRefreshing = true;
    this.quotaRequested = false;
    const started = Date.now();
    const aborter = new AbortController();
    this.quotaAborter = aborter;
    const reachable = [...this.instances.values()].filter((instance) => instance.status.reachable);
    const instances = reachable.filter((instance) => (this.quotaRetries.get(instance.target.id)?.at ?? 0) <= started);
    try {
      await Promise.allSettled(instances.map(async (instance) => {
        const target = instance.target;
        try {
          const payload = await callRpc(target, 'RetrieveUserQuotaSummary', { forceRefresh: true }, {
            signal: aborter.signal, timeoutMs: 4000, maxBytes: 1024 * 1024,
          });
          if (this.disposed || aborter.signal.aborted || this.instances.get(target.id) !== instance || instance.target !== target) return;
          this.quotas.set(instance.target.id, {
            groups: parseQuotaSummary(payload), observedAt: Date.now(), status: 'live', error: null,
          });
          this.quotaRetries.delete(target.id);
        } catch (error) {
          if (this.disposed || aborter.signal.aborted || instance.target !== target || this.instances.get(target.id) !== instance) return;
          const previous = this.quotas.get(instance.target.id) ?? emptyQuota();
          this.quotas.set(instance.target.id, quotaAt({ ...previous, error: error instanceof RpcError ? error.code : 'network' }));
          const failures = (this.quotaRetries.get(target.id)?.failures ?? 0) + 1;
          this.quotaRetries.set(target.id, { failures, at: Date.now() + Math.min(30000, 5000 * 2 ** Math.min(failures, 3)) });
        }
        if (!this.disposed) this.publish();
      }));
    } finally {
      this.quotaRefreshing = false;
      if (!this.disposed) this.publish();
      if (this.quotaAborter === aborter) this.quotaAborter = null;
      this.scheduleQuota(this.quotaRequested ? 0 : reachable.length ? Math.max(1000, QUOTA_POLL_MS - (Date.now() - started)) : 1000);
    }
  }

  private quotaForBackend(id: string | null): QuotaState {
    return quotaAt(id ? this.quotas.get(id) ?? emptyQuota() : emptyQuota());
  }

  getBackends(): BackendView[] {
    return this.buildBackendViews();
  }

  selectBackend(id: string): void {
    this.pinnedBackendId = id;
    this.pinnedConversationId = null;
    this.focusTargetId = id;
    this.refreshNow();
  }

  pinConversation(id: string | null): void {
    this.pinnedConversationId = id;
    if (id) {
      const owner = this.instanceContaining(id);
      if (owner) {
        this.pinnedBackendId = owner.target.id;
        this.focusTargetId = owner.target.id;
        owner.activeConversationId = id;
      }
      const cached = this.analysisCache.get(id);
      if (cached) {
        cached.signature = '';
      }
    }
    this.refreshNow();
  }

  /**
   * Record the conversation a host window itself has open.
   *
   * The badge bridge reads this from the renderer's URL, which is more accurate
   * than any activity heuristic: a background conversation that just finished a
   * step must not replace the one the user is looking at.
   */
  observeConversation(
    backendPort: number,
    conversationId: string | null,
    viewState: 'conversation' | 'new-thread' | 'unknown' = conversationId ? 'conversation' : 'new-thread',
  ): void {
    if (!Number.isInteger(backendPort)) {
      return;
    }
    if (conversationId !== null && (typeof conversationId !== 'string' || conversationId.length === 0)) {
      return;
    }
    const instance = [...this.instances.values()].find((candidate) => candidate.target.port === backendPort);
    if (!instance) {
      return;
    }
    instance.observedAt = Date.now();
    if (instance.observedConversationId === conversationId && instance.observationState === viewState) return;
    instance.observedConversationId = conversationId;
    instance.observationState = viewState;
    if (conversationId === null) {
      // An observed empty page must clear the previous selection immediately.
      instance.activeConversationId = null;
    } else {
      instance.activeConversationId = conversationId;
    }
    this.publish();
    this.schedule(0);
  }

  /** Enumerate backends for the picker, refreshing the scan first. */
  async listBackends(): Promise<BackendView[]> {
    if (!this.discovering) {
      await this.discover().catch(() => undefined);
    }
    return this.buildBackendViews();
  }

  restorePinnedBackend(id: string | null): void {
    this.pinnedBackendId = id;
  }

  restorePinnedConversation(id: string | null): void {
    this.pinnedConversationId = id;
  }

  // ------------------------------------------------------------------ polling

  private schedule(delayMs: number): void {
    if (this.disposed) {
      return;
    }
    const generation = this.generation;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      void this.cycle(generation);
    }, Math.max(0, delayMs));
    this.timer.unref?.();
  }

  private async cycle(generation: number): Promise<void> {
    if (this.disposed || generation !== this.generation) {
      return;
    }
    if (this.polling) {
      // A previous cycle is still finishing; try again shortly rather than
      // stacking requests.
      this.schedule(250);
      return;
    }

    this.polling = true;
    const aborter = new AbortController();
    this.aborter = aborter;
    let delay = this.prefs().pollIntervalMs;

    try {
      await this.pollOnce(generation, aborter.signal);
      if (this.disposed || aborter.signal.aborted || generation !== this.generation) return;
      this.failureCount = 0;
      this.lastError = null;
      this.lastSuccessAt = Date.now();
    } catch (error) {
      if (!aborter.signal.aborted) {
        this.handleFailure(error);
        delay = this.backoffDelay();
      }
    } finally {
      this.polling = false;
      if (this.aborter === aborter) {
        this.aborter = null;
      }
    }

    if (this.disposed || generation !== this.generation) {
      return;
    }
    this.publish();
    this.schedule(delay);
  }

  private async pollOnce(generation: number, signal: AbortSignal): Promise<void> {
    this.pollsSinceDiscovery += 1;
    if (this.instances.size === 0 || this.needDiscovery || this.pollsSinceDiscovery > 10) {
      this.needDiscovery = false;
      this.pollsSinceDiscovery = 0;
      await this.discover();
      if (generation !== this.generation) {
        return;
      }
    }

    if (this.instances.size === 0) {
      this.lastFailureKind = 'discovery';
      throw new RpcError('unavailable', 'No Antigravity backend answered');
    }

    // Poll every installation independently. One sleeping or restarting app must
    // not turn the others into an error state.
    const now = Date.now();
    const ready = [...this.instances.values()].filter((state) => state.retryAt <= now);
    const results = await Promise.allSettled(ready.map((state) => this.pollInstance(state, signal)));
    if (this.disposed || signal.aborted || generation !== this.generation) return;

    let succeeded = 0;
    let firstFailure: unknown = null;
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        succeeded += 1;
        return;
      }
      firstFailure = firstFailure ?? result.reason;
      this.markInstanceFailure(ready[index], result.reason);
    });

    if (succeeded === 0) {
      this.lastFailureKind = ready.length === 0 ? 'discovery' : 'rpc';
      throw firstFailure ?? new RpcError('unavailable', 'No Antigravity backend answered');
    }

    this.chooseFocus();
    const focus = this.focusInstance();
    if (focus && focus.status.reachable) {
      await this.refreshAccountIfDue(focus.target, signal);
    }

    this.pruneCaches();
  }

  private async pollInstance(state: InstanceState, signal: AbortSignal): Promise<void> {
    const target = state.target;
    const payload = await this.call(target, 'GetAllCascadeTrajectories', {}, SUMMARY_TIMEOUT_MS, signal);
    if (this.disposed || signal.aborted || this.instances.get(target.id) !== state || state.target !== target) return;
    const conversations = parseTrajectories(payload);
    state.conversations = conversations;
    state.retryAt = 0;

    const lastActivityMs = conversations.reduce((newest, conversation) => {
      const parsed = conversation.lastModified ? Date.parse(conversation.lastModified) : 0;
      return Number.isFinite(parsed) && parsed > newest ? parsed : newest;
    }, 0);

    state.status = {
      ...state.status,
      reachable: true,
      conversationCount: conversations.length,
      runningCount: conversations.filter((conversation) => conversation.status === 'running').length,
      lastActivityMs,
      failureReason: null,
    };
    this.statuses.set(state.target.id, state.status);

    if (conversations.length === 0) {
      state.activeConversationId = null;
      return;
    }

    const observationFresh = Date.now() - (state.observedAt ?? 0) < 5_000;
    const pinned =
      state.target.id === this.focusTargetId &&
      this.pinnedConversationId &&
      conversations.some((conversation) => conversation.id === this.pinnedConversationId)
        ? this.pinnedConversationId
        : null;
    if (observationFresh && state.observationState !== 'conversation' && !pinned) {
      state.activeConversationId = null;
      return;
    }
    const observed = observationFresh && state.observedConversationId
      ? conversations.find((conversation) => conversation.id === state.observedConversationId) ?? null
      : null;
    const selection = chooseConversation(conversations, state.previousStepCounts, pinned ?? state.activeConversationId);
    const conversation =
      (pinned ? conversations.find((entry) => entry.id === pinned) ?? null : null) ??
      observed ??
      (observationFresh && state.observationState === 'conversation' ? null : selection?.conversation) ??
      null;
    if (!conversation) {
      state.activeConversationId = null;
      return;
    }

    state.activeConversationId = conversation.id;
    // Whole trajectories have their own lifetime so slow reads cannot stall summary polling.
    const analysisSignal = this.analysisAborter.signal;
    void this.refreshAnalysis(target, conversation, analysisSignal).then(() => {
      if (this.disposed || analysisSignal.aborted || this.instances.get(target.id) !== state || state.target !== target) return;
      this.recordUsageDelta(conversation.id);
      this.publish();
    });

    // Remember what "unchanged" means for the next tick, for every conversation
    // so switching between them cannot fabricate a change.
    state.previousStepCounts.clear();
    for (const entry of conversations) {
      state.previousStepCounts.set(entry.id, entry.stepCount);
    }
  }

  private markInstanceFailure(state: InstanceState, error: unknown): void {
    const code = error instanceof RpcError ? error.code : 'network';
    if (code === 'aborted') {
      return;
    }
    state.retryAt = Date.now() + (code === 'timeout' ? 5_000 : 20_000);
    state.status = { ...state.status, reachable: false, failureReason: code };
    this.statuses.set(state.target.id, state.status);
    this.deps.logger(
      `Backend ${state.target.id} failed (${code}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  private chooseFocus(): void {
    const chosen = chooseBackend(
      [...this.instances.values()].map((state) => state.status),
      this.pinnedBackendId,
      this.hostApp ?? undefined,
    );
    const next = chosen?.id ?? null;
    if (next !== this.focusTargetId) {
      this.focusTargetId = next;
      if (next) {
        this.deps.logger(`Focused backend ${next}`);
      }
    }
  }

  private focusInstance(): InstanceState | null {
    return this.focusTargetId ? this.instances.get(this.focusTargetId) ?? null : null;
  }

  private instanceContaining(conversationId: string): InstanceState | null {
    for (const state of this.instances.values()) {
      if (state.conversations.some((conversation) => conversation.id === conversationId)) {
        return state;
      }
    }
    return null;
  }

  private async refreshAnalysis(
    target: BackendTarget,
    conversation: TrajectorySummary,
    signal: AbortSignal,
  ): Promise<void> {
    const signature = signatureOf(conversation);
    const cached = this.analysisCache.get(conversation.id);

    const shouldRead = shouldFetchSteps({
      hasCached: cached !== undefined,
      cachedSignature: cached?.signature ?? null,
      signature,
      inFlight: this.inFlightSteps.has(conversation.id),
      lastFetchAt: cached?.fetchedAt ?? 0,
      now: Date.now(),
      floorMs: this.stepsFloorMs(cached?.durationMs ?? 0),
    });
    if (!shouldRead) {
      return;
    }

    this.inFlightSteps.add(conversation.id);
    const startedAt = Date.now();
    try {
      const payload = await this.call(
        target,
        'GetCascadeTrajectorySteps',
        { cascadeId: conversation.id },
        STEPS_TIMEOUT_MS,
        signal,
      );
      if (this.disposed || signal.aborted || this.instances.get(target.id)?.target !== target) return;
      const steps = asArray(dig(payload, 'steps'));
      const analysis = analyzeSteps(steps);
      const durationMs = Date.now() - startedAt;
      this.analysisCache.set(conversation.id, {
        signature,
        analysis,
        error: null,
        fetchedAt: Date.now(),
        durationMs,
      });

      const now = Date.now();
      if (this.compression.observe(conversation.id, analysis)) {
        this.compressedUntil.set(conversation.id, now + this.prefs().pollIntervalMs * 3);
        this.deps.logger(`Context compression detected in "${conversation.title}"`);
      }
    } catch (error) {
      if (this.disposed || signal.aborted || this.instances.get(target.id)?.target !== target) return;
      const message = error instanceof RpcError ? error.message : String(error);
      // Cache the failure against this signature so a permanently oversized
      // conversation is not re-requested on every tick.
      const fatal = error instanceof RpcError && (error.code === 'payload_too_large' || error.code === 'not_found');
      this.analysisCache.set(conversation.id, {
        signature: fatal ? signature : '',
        analysis: null,
        error: message,
        fetchedAt: Date.now(),
        durationMs: Date.now() - startedAt,
      });
      if (!(error instanceof RpcError && error.code === 'aborted')) {
        this.deps.logger(`Failed to read "${conversation.title}": ${message}`);
      }
    } finally {
      this.inFlightSteps.delete(conversation.id);
    }
  }

  private stepsFloorMs(durationMs: number): number {
    const base = this.prefs().pollIntervalMs;
    return Math.min(15_000, Math.max(base, durationMs * 3));
  }

  // ---------------------------------------------------------------- discovery

  private async discover(): Promise<void> {
    if (this.discovering) {
      return;
    }
    this.discovering = true;
    const generation = this.generation;
    try {
      const processes = await runDiscovery(this.deps.logger);
      if (this.disposed || generation !== this.generation) return;
      const { targets, notes } = toBackendTargets(processes);
      this.discoveryNotes = notes;

      if (targets.length === 0) {
        this.statuses.clear();
        this.instances.clear();
        this.quotas.clear();
        this.quotaRetries.clear();
        this.focusTargetId = null;
        this.deps.logger('Discovery found no Antigravity backends');
        return;
      }

      const scanned = await this.scanTargets(targets);
      if (this.disposed || generation !== this.generation) return;
      const statuses = dedupeBackends(scanned);
      this.statuses = new Map(statuses.map((status) => [status.id, status]));

      const present = new Set(targets.map((target) => target.id));
      for (const id of [...this.instances.keys()]) {
        if (!present.has(id)) {
          this.instances.delete(id);
          this.quotas.delete(id);
          this.quotaRetries.delete(id);
        }
      }

      for (const status of statuses) {
        const target = targets.find((candidate) => candidate.id === status.id);
        if (!target) {
          continue;
        }
        const existing = this.instances.get(status.id);
        if (existing) {
          existing.target = target;
          existing.status = status;
          if (!status.reachable) {
            existing.retryAt = Date.now() + 15_000;
          }
        } else {
          this.instances.set(status.id, {
            target,
            status,
            conversations: [],
            activeConversationId: null,
            observedConversationId: null,
            previousStepCounts: new Map(),
            retryAt: status.reachable ? 0 : Date.now() + 15_000,
          });
        }
      }

      this.chooseFocus();
      if (this.focusTargetId) {
        const status = this.statuses.get(this.focusTargetId);
        this.deps.logger(
          `Focused backend ${this.focusTargetId} of ${statuses.filter((entry) => entry.reachable).length} reachable ` +
            `(${status?.conversationCount ?? 0} conversations, ${status?.runningCount ?? 0} running)`,
        );
      } else {
        this.deps.logger('Every discovered backend failed to answer');
      }
    } finally {
      this.discovering = false;
    }
  }

  /**
   * Scan every candidate, stopping at the first working port for each process.
   * A legacy server exposes several sockets; only one speaks this API, and the
   * rest answer 401 or reset immediately, so the extra probes are cheap.
   */
  private async scanTargets(targets: readonly BackendTarget[]): Promise<BackendStatus[]> {
    const statuses: BackendStatus[] = [];
    const resolvedPids = new Set<number>();
    const queue = [...targets];
    const concurrency = 4;

    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (;;) {
        const target = queue.shift();
        if (!target) {
          return;
        }
        if (target.pid !== null && resolvedPids.has(target.pid)) {
          continue;
        }
        const status = await this.scanTarget(target);
        statuses.push(status);
        if (status.reachable && target.pid !== null) {
          resolvedPids.add(target.pid);
        }
      }
    });

    await Promise.all(workers);
    return statuses;
  }

  private async scanTarget(target: BackendTarget): Promise<BackendStatus> {
    const startedAt = Date.now();
    const base: BackendStatus = {
      id: target.id,
      kind: target.kind,
      scheme: target.scheme,
      port: target.port,
      pid: target.pid,
      owner: target.owner,
      reachable: false,
      latencyMs: null,
      conversationCount: 0,
      runningCount: 0,
      lastActivityMs: 0,
      failureReason: null,
    };

    try {
      const payload = await callRpc(target, 'GetAllCascadeTrajectories', {}, { timeoutMs: 6_000 });
      const conversations = parseTrajectories(payload);
      const lastActivityMs = conversations.reduce((newest, conversation) => {
        const parsed = conversation.lastModified ? Date.parse(conversation.lastModified) : 0;
        return Number.isFinite(parsed) && parsed > newest ? parsed : newest;
      }, 0);
      return {
        ...base,
        reachable: true,
        latencyMs: Date.now() - startedAt,
        conversationCount: conversations.length,
        runningCount: conversations.filter((conversation) => conversation.status === 'running').length,
        lastActivityMs,
      };
    } catch (error) {
      const reason = error instanceof RpcError ? error.code : 'network';
      return { ...base, latencyMs: Date.now() - startedAt, failureReason: reason };
    }
  }

  // ------------------------------------------------------------- account data

  private async refreshAccountIfDue(target: BackendTarget, signal: AbortSignal): Promise<void> {
    if (Date.now() - this.lastStatusRefresh < STATUS_REFRESH_MS) {
      return;
    }
    this.lastStatusRefresh = Date.now();

    try {
      const [models, status] = await Promise.all([
        this.call(target, 'GetAvailableModels', {}, SUMMARY_TIMEOUT_MS, signal),
        this.call(target, 'GetUserStatus', {}, SUMMARY_TIMEOUT_MS, signal),
      ]);
      if (this.disposed || signal.aborted || this.instances.get(target.id)?.target !== target) return;
      this.catalog = buildCatalog(models);
      const summary = parseUserStatus(status, this.catalog);
      this.account = summary.account;
      this.picker = summary.picker;
      this.deps.logger(`Model catalogue loaded: ${this.catalog.size} entries, ${this.picker.length} picker entries`);
    } catch (error) {
      if (!(error instanceof RpcError && error.code === 'aborted')) {
        this.deps.logger(`Account refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // ------------------------------------------------------------------ failures

  private handleFailure(error: unknown): void {
    this.failureCount += 1;
    const message = error instanceof Error ? error.message : String(error);
    this.lastError = message;
    if (this.failureCount === 1 || this.failureCount % 10 === 0) {
      this.deps.logger(`Poll failed (${this.lastFailureKind}, attempt ${this.failureCount}): ${message}`);
    }
  }

  private backoffDelay(): number {
    const base = this.prefs().pollIntervalMs;
    const cap = this.lastFailureKind === 'discovery' ? MAX_BACKOFF_DISCOVERY_MS : MAX_BACKOFF_RPC_MS;
    const exponent = Math.max(0, this.failureCount - 1);
    return Math.max(base, Math.min(base * 2 ** exponent, cap));
  }

  // ---------------------------------------------------------------- snapshot

  private publish(): void {
    const snapshot = this.buildSnapshot();
    const signature = snapshotSignature(snapshot);
    if (signature === this.snapshotSignature) {
      return;
    }
    this.snapshotSignature = signature;
    this.snapshot = snapshot;
    this.deps.onSnapshot(snapshot);
  }

  private prefs(): SnapshotPrefs {
    const config = this.deps.getConfig();
    return {
      pollIntervalMs: config.pollIntervalMs,
      warningThreshold: config.warningThreshold,
      showQuota: config.showQuota,
      maskPersonalInfo: config.maskPersonalInfo,
      maxPayloadMb: config.maxPayloadMb,
      displayMode: config.displayMode,
      ...snippetPreferences(config),
    };
  }

  private buildSnapshot(): Snapshot {
    const prefs = this.prefs();
    const focus = this.focusInstance();
    const active =
      focus?.conversations.find((conversation) => conversation.id === focus.activeConversationId) ?? null;
    const conversationView = active ? this.buildConversationView(active) : null;

    return {
      schemaVersion: 1,
      quota: this.quotaForBackend(focus?.target.id ?? null),
      generatedAt: Date.now(),
      status: this.deriveStatus(focus, active),
      backend: focus ? this.toBackendView(focus.status, true) : null,
      backends: this.buildBackendViews(),
      instances: this.buildInstanceViews(),
      conversation: conversationView,
      sessions: focus
        ? focus.conversations
            .slice(0, SESSION_LIMIT)
            .map((conversation) => this.buildSessionRow(conversation, focus.activeConversationId))
        : [],
      models: this.buildModelRows(conversationView?.modelId ?? null),
      account: this.account,
      usage: this.deps.usageSummary(),
      prefs,
      lastError: this.lastError,
      discoveryNotes: this.discoveryNotes,
      stale: this.lastSuccessAt > 0 && Date.now() - this.lastSuccessAt > prefs.pollIntervalMs * 3,
    };
  }

  private deriveStatus(focus: InstanceState | null, active: TrajectorySummary | null): MonitorStatus {
    if (this.lastError) {
      return 'error';
    }
    if (!focus) {
      return this.statuses.size === 0 ? 'disconnected' : 'connecting';
    }
    if (!focus.status.reachable) {
      return 'connecting';
    }
    if (active) {
      return 'ok';
    }
    return (focus.observationState === 'new-thread' && Date.now() - (focus.observedAt ?? 0) < 5_000) ||
      focus.conversations.length === 0 ? 'no-conversation' : 'connecting';
  }

  private buildInstanceViews(): InstanceView[] {
    const views: InstanceView[] = [];
    for (const state of this.instances.values()) {
      if (!state.status.reachable) {
        continue;
      }
      const conversation =
        state.conversations.find((entry) => entry.id === state.activeConversationId) ?? null;
      views.push({
        quota: this.quotaForBackend(state.target.id),
        backend: this.toBackendView(state.status, state.target.id === this.focusTargetId),
        status: conversation ? 'ok' : 'no-conversation',
        conversation: conversation ? this.buildConversationView(conversation) : null,
        observedConversationId: state.observedConversationId,
        viewState: Date.now() - (state.observedAt ?? 0) < 5_000 ? state.observationState : 'unknown',
      });
    }
    return views.sort((left, right) => {
      if (left.backend.active !== right.backend.active) {
        return left.backend.active ? -1 : 1;
      }
      return right.backend.lastActivityMs - left.backend.lastActivityMs;
    });
  }

  private buildConversationView(conversation: TrajectorySummary): ConversationView {
    const cached = this.analysisCache.get(conversation.id);
    const analysis = cached?.analysis ?? null;
    const modelId = analysis?.modelId ?? null;
    const spec = resolveModel(modelId, this.catalog);
    const capacity = spec?.contextLimit ?? null;
    const used = analysis?.used ?? null;
    const costTokens = analysis?.totals;

    let usage: UsageView | null = null;
    if (analysis && used !== null) {
      usage = {
        used,
        capacity,
        percent: capacity && capacity > 0 ? (used / capacity) * 100 : null,
        remaining: capacity !== null ? Math.max(0, capacity - used) : null,
        input: analysis.measured?.input ?? 0,
        cacheRead: analysis.measured?.cacheRead ?? 0,
        cacheCreate: analysis.measured?.cacheCreate ?? 0,
        output: analysis.measured?.output ?? 0,
        source: analysis.source === 'estimated' ? 'estimated' : 'measured',
        measuredAt: analysis.measured?.measuredAt ?? null,
      };
    }

    return {
      id: conversation.id,
      title: conversation.title,
      status: conversation.status,
      stepCount: conversation.stepCount,
      lastModified: conversation.lastModified,
      createdAt: conversation.createdAt,
      modelId,
      modelName: spec?.name ?? null,
      usage,
      compressed: (this.compressedUntil.get(conversation.id) ?? 0) > Date.now(),
      imageSteps: analysis?.imageSteps ?? 0,
      totals: {
        input: costTokens?.input ?? 0,
        cacheRead: costTokens?.cacheRead ?? 0,
        cacheCreate: costTokens?.cacheCreate ?? 0,
        output: costTokens?.output ?? 0,
        calls: costTokens?.calls ?? 0,
        costUsd: costTokens ? estimateCost(costTokens, modelId) : null,
      },
    };
  }

  private buildSessionRow(conversation: TrajectorySummary, activeId: string | null): SessionRow {
    const cached = this.analysisCache.get(conversation.id);
    const analysis = cached?.analysis ?? null;
    const spec = resolveModel(analysis?.modelId ?? null, this.catalog);
    const capacity = spec?.contextLimit ?? null;
    const used = analysis?.source === 'measured' ? analysis.measured?.total ?? null : null;

    return {
      id: conversation.id,
      title: conversation.title,
      status: conversation.status,
      stepCount: conversation.stepCount,
      lastModified: conversation.lastModified,
      modelName: spec?.name ?? null,
      percent: capacity && used !== null ? (used / capacity) * 100 : null,
      active: conversation.id === activeId,
    };
  }

  private buildModelRows(activeModelId: string | null): ModelRow[] {
    const rows: ModelRow[] = [];

    for (const entry of this.picker) {
      const spec = resolveModel(entry.modelId, this.catalog);
      rows.push({
        modelId: entry.modelId,
        label: entry.label,
        quotaPercent: entry.quotaPercent,
        resetsAt: entry.resetsAt,
        contextLimit: entry.contextLimit ?? spec?.contextLimit ?? null,
        maxOutput: entry.maxOutput ?? spec?.maxOutput ?? null,
        active: entry.modelId !== null && entry.modelId === activeModelId,
      });
    }

    if (rows.length === 0) {
      // No picker yet (for example before the first account refresh). Show what
      // the catalogue knows so the tab is never blank.
      for (const spec of this.catalog.values()) {
        if (spec.contextLimit === null) {
          continue;
        }
        const quota = quotaFor(spec.id, this.picker);
        rows.push({
          modelId: spec.id,
          label: spec.name,
          quotaPercent: quota?.quotaPercent ?? null,
          resetsAt: quota?.resetsAt ?? null,
          contextLimit: spec.contextLimit,
          maxOutput: spec.maxOutput,
          active: spec.id === activeModelId,
        });
        if (rows.length >= 12) {
          break;
        }
      }
    }

    const liveQuota = this.quotaForBackend(this.focusTargetId);
    return rows.map((row) => {
      const bucket = quotaBucket(liveQuota, row.label, '5h');
      return { ...row, quotaPercent: bucket?.percent ?? null, resetsAt: bucket?.resetsAt ?? null };
    });
  }

  private buildBackendViews(): BackendView[] {
    return [...this.statuses.values()]
      .map((status) => this.toBackendView(status, status.id === this.focusTargetId))
      .sort((left, right) => {
        if (left.active !== right.active) {
          return left.active ? -1 : 1;
        }
        if (left.reachable !== right.reachable) {
          return left.reachable ? -1 : 1;
        }
        return right.lastActivityMs - left.lastActivityMs;
      });
  }

  private toBackendView(status: BackendStatus, active: boolean): BackendView {
    return {
      id: status.id,
      kind: status.kind,
      scheme: status.scheme,
      port: status.port,
      pid: status.pid,
      app: status.owner,
      reachable: status.reachable,
      conversations: status.conversationCount,
      running: status.runningCount,
      lastActivityMs: status.lastActivityMs,
      active,
    };
  }

  // -------------------------------------------------------------------- usage

  private recordUsageDelta(conversationId: string): void {
    const cached = this.analysisCache.get(conversationId);
    const analysis = cached?.analysis;
    if (!analysis || analysis.totals.calls === 0) {
      return;
    }

    const current = analysis.totals;
    const previous = this.lastTotals.get(conversationId);
    if (!previous) {
      // First observation: establish a baseline instead of attributing an
      // arbitrarily old conversation's history to today.
      this.lastTotals.set(conversationId, { ...current });
      return;
    }

    const delta: ConversationTotals = {
      input: current.input - previous.input,
      cacheRead: current.cacheRead - previous.cacheRead,
      cacheCreate: current.cacheCreate - previous.cacheCreate,
      output: current.output - previous.output,
      calls: current.calls - previous.calls,
    };

    const rewind = delta.input < 0 || delta.cacheRead < 0 || delta.cacheCreate < 0 || delta.output < 0 || delta.calls < 0;
    this.lastTotals.set(conversationId, { ...current });
    if (rewind) {
      // An undo rewrote history; rebase rather than record negative usage.
      return;
    }
    if (delta.input + delta.cacheRead + delta.cacheCreate + delta.output === 0) {
      return;
    }

    this.deps.recordUsage({
      day: toDayKey(),
      modelId: analysis.modelId,
      input: delta.input,
      cacheRead: delta.cacheRead,
      cacheCreate: delta.cacheCreate,
      output: delta.output,
    });
  }

  private pruneCaches(): void {
    const alive = new Set<string>();
    for (const state of this.instances.values()) {
      for (const conversation of state.conversations) {
        alive.add(conversation.id);
      }
    }
    for (const id of this.analysisCache.keys()) {
      if (!alive.has(id)) {
        this.analysisCache.delete(id);
      }
    }
    for (const id of this.lastTotals.keys()) {
      if (!alive.has(id)) {
        this.lastTotals.delete(id);
      }
    }
    for (const id of this.compressedUntil.keys()) {
      if (!alive.has(id)) {
        this.compressedUntil.delete(id);
      }
    }
  }

  private async call<T>(
    target: BackendTarget,
    method: string,
    body: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<T> {
    return callRpc<T>(target, method, body, {
      timeoutMs,
      maxBytes: this.prefs().maxPayloadMb * 1024 * 1024,
      signal,
    });
  }
}

export interface FetchDecisionInput {
  hasCached: boolean;
  cachedSignature: string | null;
  signature: string;
  inFlight: boolean;
  lastFetchAt: number;
  now: number;
  floorMs: number;
}

/**
 * Decide whether the whole-trajectory read is warranted this tick.
 *
 * This is the rule that keeps the extension from moving megabytes per second:
 * an untouched conversation is never re-read, and a conversation that is being
 * re-read quickly enough is held back by a floor derived from how long the
 * previous read took.
 */
export function shouldFetchSteps(input: FetchDecisionInput): boolean {
  if (input.inFlight) {
    return false;
  }
  if (input.hasCached && input.cachedSignature === input.signature) {
    return false;
  }
  if (input.hasCached && input.now - input.lastFetchAt < input.floorMs) {
    return false;
  }
  return true;
}

/** Compact identity used to suppress redundant snapshot emissions. */
function snapshotSignature(snapshot: Snapshot): string {
  const conversation = snapshot.conversation;
  return JSON.stringify([
    snapshot.status,
    snapshot.backend?.id ?? null,
    conversation?.id ?? null,
    conversation?.usage?.used ?? null,
    conversation?.usage?.capacity ?? null,
    conversation?.usage?.source ?? null,
    conversation?.modelId ?? null,
    conversation?.compressed ?? false,
    snapshot.lastError,
    snapshot.prefs,
    snapshot.quota,
    snapshot.backends.map((backend) => [backend.id, backend.reachable, backend.active, backend.conversations]),
    snapshot.instances.map((instance) => [
      instance.backend.id,
      instance.status,
      instance.conversation?.id ?? null,
      instance.conversation?.title ?? null,
      instance.conversation?.usage?.used ?? null,
      instance.observedConversationId,
      instance.viewState,
      instance.quota,
    ]),
    snapshot.sessions.map((session) => [session.id, session.stepCount, session.percent, session.active]),
    snapshot.models.map((model) => [model.modelId, model.quotaPercent, model.active]),
    [snapshot.usage.todayTokens, snapshot.usage.todayCostUsd],
  ]);
}

/** Spawn the platform discovery command and return raw process records. */
async function runDiscovery(logger: (message: string) => void): Promise<RawProcess[]> {
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const stdout = await execCapture(
      powershell,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', windowsDiscoveryScript()],
      logger,
    );
    return parseWindowsOutput(stdout);
  }

  const stdout = await execCapture('/bin/sh', ['-c', posixDiscoveryScript()], logger);
  return parsePosixOutput(stdout);
}

function execCapture(file: string, args: string[], logger: (message: string) => void): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: DISCOVERY_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) {
          logger(`Discovery command failed: ${error.message}`);
          resolve('');
          return;
        }
        resolve(stdout);
      },
    );
  });
}
