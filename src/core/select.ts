/**
 * Selection policy: which backend to read, and which conversation to display.
 *
 * This machine routinely runs several Antigravity backends at once, each owning a
 * disjoint set of conversations. Choosing well is therefore part of correctness,
 * not a convenience: showing another window's session as "yours" would be worse
 * than showing nothing.
 */

import { asArray, asRecord, asString, dig, firstString, safeInt } from './values';
import type { BackendOwner } from './rpc';

export type ConversationStatus = 'running' | 'idle' | 'other';

export interface TrajectorySummary {
  id: string;
  title: string;
  stepCount: number;
  status: ConversationStatus;
  rawStatus: string;
  lastModified: string | null;
  createdAt: string | null;
  projectId: string | null;
}

export interface BackendStatus {
  id: string;
  kind: 'hub' | 'legacy';
  scheme: 'http' | 'https';
  port: number;
  pid: number | null;
  owner: BackendOwner;
  reachable: boolean;
  latencyMs: number | null;
  conversationCount: number;
  runningCount: number;
  /** Epoch milliseconds of the newest conversation, or 0. */
  lastActivityMs: number;
  failureReason: string | null;
}

export interface ConversationSelection {
  conversation: TrajectorySummary;
  reason: 'running' | 'changed' | 'pinned' | 'recent';
}

function parseStatus(raw: string | null): ConversationStatus {
  const status = (raw ?? '').toUpperCase();
  if (status.endsWith('_RUNNING')) {
    return 'running';
  }
  if (status.endsWith('_IDLE')) {
    return 'idle';
  }
  return 'other';
}

function toEpochMs(value: string | null): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Parse a `GetAllCascadeTrajectories` response into an ordered list. */
export function parseTrajectories(payload: unknown): TrajectorySummary[] {
  const summaries = dig(payload, 'trajectorySummaries');
  const entries: Array<[string, unknown]> = [];

  const record = asRecord(summaries);
  if (record) {
    for (const [id, value] of Object.entries(record)) {
      entries.push([id, value]);
    }
  } else {
    for (const value of asArray(summaries)) {
      const candidate = asRecord(value);
      const id = candidate ? firstString(candidate.conversationId, candidate.id, candidate.trajectoryId) : null;
      if (candidate && id) {
        entries.push([id, candidate]);
      }
    }
  }

  const result: TrajectorySummary[] = [];
  for (const [id, value] of entries) {
    const source = asRecord(value);
    if (!source) {
      continue;
    }
    const rawStatus = asString(source.status) ?? '';
    const title = firstString(dig(source, 'annotations', 'title'), source.summary) ?? 'Untitled conversation';
    result.push({
      id,
      title,
      stepCount: safeInt(source.stepCount) ?? 0,
      status: parseStatus(rawStatus),
      rawStatus,
      lastModified: asString(source.lastModifiedTime),
      createdAt: asString(source.createdTime),
      projectId: asString(dig(source, 'trajectoryMetadata', 'projectId')),
    });
  }

  result.sort((left, right) => toEpochMs(right.lastModified) - toEpochMs(left.lastModified));
  return result;
}

/**
 * Collapse several listening sockets that belong to one process.
 *
 * A legacy language server can expose the same service on more than one port —
 * verified: 50062 over HTTPS and 50063 over HTTP return the same conversations.
 * Listing both would look like two installations and let the user "switch"
 * between two views of the same data, so one canonical entry is kept per pid.
 */
export function dedupeBackends(statuses: readonly BackendStatus[]): BackendStatus[] {
  const groups = new Map<string, BackendStatus[]>();

  for (const status of statuses) {
    // Hub processes always advertise a distinct port, but a null pid still needs
    // a stable key, so the target id is used as the group.
    const key = status.pid === null ? `id:${status.id}` : `pid:${status.pid}`;
    const group = groups.get(key);
    if (group) {
      group.push(status);
    } else {
      groups.set(key, [status]);
    }
  }

  const result: BackendStatus[] = [];
  for (const group of groups.values()) {
    result.push([...group].sort(compareSameProcess)[0]);
  }
  return result;
}

function compareSameProcess(left: BackendStatus, right: BackendStatus): number {
  if (left.reachable !== right.reachable) {
    return left.reachable ? -1 : 1;
  }
  if (left.conversationCount !== right.conversationCount) {
    return right.conversationCount - left.conversationCount;
  }
  // HTTPS is the legacy server's canonical endpoint.
  if (left.scheme !== right.scheme) {
    return left.scheme === 'https' ? -1 : 1;
  }
  if (left.latencyMs !== right.latencyMs) {
    return (left.latencyMs ?? Number.MAX_SAFE_INTEGER) - (right.latencyMs ?? Number.MAX_SAFE_INTEGER);
  }
  return left.port - right.port;
}

/** Ordering used when the user has not pinned a backend. */
export function rankBackends(statuses: readonly BackendStatus[]): BackendStatus[] {
  return [...statuses].sort((left, right) => {
    if (left.reachable !== right.reachable) {
      return left.reachable ? -1 : 1;
    }
    if (left.runningCount !== right.runningCount) {
      return right.runningCount - left.runningCount;
    }
    if (left.lastActivityMs !== right.lastActivityMs) {
      return right.lastActivityMs - left.lastActivityMs;
    }
    if (left.kind !== right.kind) {
      return left.kind === 'hub' ? -1 : 1;
    }
    return left.port - right.port;
  });
}

/**
 * Choose the backend to display.
 *
 * An explicit pin wins while the backend is reachable. That matters now that
 * every app is polled independently: clicking an app to follow it must not be
 * undone by a background conversation in another app. Without a pin, the host
 * app wins when it has a conversation; otherwise the busiest backend does.
 *
 * `preferredOwner` lets an editor start on its own installation: the VS Code
 * extension should not report the IDE's conversation merely because that window
 * was touched more recently.
 */
export function chooseBackend(
  statuses: readonly BackendStatus[],
  pinnedId: string | null,
  preferredOwner?: BackendOwner,
): BackendStatus | null {
  const reachable = statuses.filter((status) => status.reachable);
  if (reachable.length === 0) {
    return null;
  }

  const best = rankBackends(reachable)[0];
  const own =
    preferredOwner && preferredOwner !== 'unknown'
      ? rankBackends(reachable.filter((status) => status.owner === preferredOwner))[0] ?? null
      : null;
  // Follow the host app when it actually has a conversation. An editor that has
  // never opened the agent should not blank the status bar while another app is
  // in use.
  const preferred = own && (own.conversationCount > 0 || own.runningCount > 0) ? own : null;

  if (pinnedId) {
    const pinned = reachable.find((status) => status.id === pinnedId);
    if (pinned) {
      return pinned;
    }
  }

  return preferred ?? best;
}

/**
 * Choose the conversation to display.
 *
 * Running beats changed, changed beats pinned, pinned beats merely recent — so
 * an active agent is followed across models and windows, while an idle user
 * keeps looking at the session they left open.
 */
export function chooseConversation(
  conversations: readonly TrajectorySummary[],
  previousStepCounts: ReadonlyMap<string, number>,
  pinnedId: string | null,
): ConversationSelection | null {
  if (conversations.length === 0) {
    return null;
  }

  const running = conversations.filter((conversation) => conversation.status === 'running');
  if (running.length > 0) {
    const pinnedRunning = pinnedId ? running.find((conversation) => conversation.id === pinnedId) : undefined;
    return {
      conversation: pinnedRunning ?? running[0],
      reason: 'running',
    };
  }

  const changed = conversations.filter((conversation) => {
    const before = previousStepCounts.get(conversation.id);
    return before !== undefined && before !== conversation.stepCount;
  });
  if (changed.length > 0) {
    return { conversation: changed[0], reason: 'changed' };
  }

  if (pinnedId) {
    const pinned = conversations.find((conversation) => conversation.id === pinnedId);
    if (pinned) {
      return { conversation: pinned, reason: 'pinned' };
    }
  }

  return { conversation: conversations[0], reason: 'recent' };
}

/** True when a conversation's identifying signature differs from the cached one. */
export function signatureOf(conversation: TrajectorySummary): string {
  return `${conversation.id}|${conversation.stepCount}|${conversation.lastModified ?? ''}|${conversation.status}`;
}
