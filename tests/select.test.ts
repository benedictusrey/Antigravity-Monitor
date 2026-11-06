import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BackendStatus,
  chooseBackend,
  chooseConversation,
  dedupeBackends,
  parseTrajectories,
  rankBackends,
  signatureOf,
} from '../src/core/select';
import { trajectoriesPayload } from './fixtures';

function backend(overrides: Partial<BackendStatus> & { id: string }): BackendStatus {
  return {
    kind: 'hub',
    scheme: 'http',
    port: 5000,
    pid: null,
    owner: 'unknown',
    reachable: true,
    latencyMs: 5,
    conversationCount: 1,
    runningCount: 0,
    lastActivityMs: 0,
    failureReason: null,
    ...overrides,
  };
}

test('parseTrajectories orders conversations by most recent activity', () => {
  const list = parseTrajectories(
    trajectoriesPayload([
      { id: 'a', title: 'Older', stepCount: 10, lastModified: '2026-11-01T10:00:00Z' },
      { id: 'b', title: 'Newest', stepCount: 20, lastModified: '2026-11-01T15:00:00Z' },
    ]),
  );

  assert.deepEqual(list.map((entry) => entry.id), ['b', 'a']);
  assert.equal(list[0].title, 'Newest');
  assert.equal(list[0].stepCount, 20);
});

test('parseTrajectories normalises the status enum', () => {
  const list = parseTrajectories(
    trajectoriesPayload([
      { id: 'a', title: 'Running', stepCount: 1, status: 'CASCADE_RUN_STATUS_RUNNING' },
      { id: 'b', title: 'Idle', stepCount: 1, status: 'CASCADE_RUN_STATUS_IDLE' },
      { id: 'c', title: 'Other', stepCount: 1, status: 'CASCADE_RUN_STATUS_UNSPECIFIED' },
    ]),
  );

  assert.equal(list.find((entry) => entry.id === 'a')?.status, 'running');
  assert.equal(list.find((entry) => entry.id === 'b')?.status, 'idle');
  assert.equal(list.find((entry) => entry.id === 'c')?.status, 'other');
});

test('parseTrajectories survives an empty or malformed payload', () => {
  assert.deepEqual(parseTrajectories({}), []);
  assert.deepEqual(parseTrajectories(null), []);
  assert.deepEqual(parseTrajectories({ trajectorySummaries: [] }), []);
});

test('rankBackends puts live activity first', () => {
  const ranked = rankBackends([
    backend({ id: 'idle', runningCount: 0, lastActivityMs: 9_000 }),
    backend({ id: 'running', runningCount: 1, lastActivityMs: 1_000 }),
    backend({ id: 'unreachable', reachable: false, runningCount: 5, lastActivityMs: 9_999 }),
  ]);

  assert.deepEqual(ranked.map((entry) => entry.id), ['running', 'idle', 'unreachable']);
});

test('rankBackends prefers the most recent activity when nothing is running', () => {
  const ranked = rankBackends([
    backend({ id: 'stale', lastActivityMs: 1_000 }),
    backend({ id: 'fresh', lastActivityMs: 5_000 }),
  ]);
  assert.equal(ranked[0].id, 'fresh');
});

test('chooseBackend returns the best reachable backend when nothing is pinned', () => {
  const chosen = chooseBackend(
    [
      backend({ id: 'idle', lastActivityMs: 5_000 }),
      backend({ id: 'busy', runningCount: 1, lastActivityMs: 1_000 }),
    ],
    null,
  );
  assert.equal(chosen?.id, 'busy');
});

test('chooseBackend honours a pin while it is reachable', () => {
  const chosen = chooseBackend(
    [
      backend({ id: 'pinned', lastActivityMs: 1_000 }),
      backend({ id: 'other', lastActivityMs: 9_000 }),
    ],
    'pinned',
  );
  assert.equal(chosen?.id, 'pinned');
});

test('chooseBackend keeps an explicit pin even when another backend is running', () => {
  const chosen = chooseBackend(
    [
      backend({ id: 'pinned', runningCount: 0 }),
      backend({ id: 'other', runningCount: 1 }),
    ],
    'pinned',
  );
  assert.equal(chosen?.id, 'pinned', 'clicking an app must not be undone by background work');
});

test('chooseBackend keeps a pinned backend that is itself running', () => {
  const chosen = chooseBackend(
    [
      backend({ id: 'pinned', runningCount: 1, lastActivityMs: 1_000 }),
      backend({ id: 'other', runningCount: 1, lastActivityMs: 9_000 }),
    ],
    'pinned',
  );
  assert.equal(chosen?.id, 'pinned');
});

test('chooseBackend returns null when nothing is reachable', () => {
  assert.equal(chooseBackend([backend({ id: 'dead', reachable: false })], null), null);
  assert.equal(chooseBackend([], null), null);
});

test('chooseBackend starts on the extension host when it has a backend', () => {
  const chosen = chooseBackend(
    [
      backend({ id: 'desktop', owner: 'app', lastActivityMs: 9_000, runningCount: 1 }),
      backend({ id: 'vscode', owner: 'vscode', lastActivityMs: 1_000 }),
    ],
    null,
    'vscode',
  );
  assert.equal(chosen?.id, 'vscode', 'the busier app does not steal the status bar');
});

test('chooseBackend prefers the host app even when it is not the busiest', () => {
  const chosen = chooseBackend(
    [
      backend({ id: 'ide', owner: 'ide', lastActivityMs: 9_000 }),
      backend({ id: 'code', owner: 'vscode', lastActivityMs: 1_000 }),
    ],
    null,
    'vscode',
  );
  assert.equal(chosen?.id, 'code');
});

test('chooseBackend honours a pin across owners', () => {
  const chosen = chooseBackend(
    [
      backend({ id: 'code', owner: 'vscode', lastActivityMs: 1_000 }),
      backend({ id: 'ide', owner: 'ide', lastActivityMs: 9_000 }),
    ],
    'ide',
    'vscode',
  );
  assert.equal(chosen?.id, 'ide');
});

test('chooseBackend falls back to the best app when the host has none', () => {
  const chosen = chooseBackend(
    [backend({ id: 'ide', owner: 'ide', lastActivityMs: 9_000 }), backend({ id: 'app', owner: 'app' })],
    null,
    'vscode',
  );
  assert.equal(chosen?.id, 'ide');
});

test('chooseBackend falls back when the host app has no conversation', () => {
  const chosen = chooseBackend(
    [
      backend({ id: 'vscode', owner: 'vscode', conversationCount: 0 }),
      backend({ id: 'desktop', owner: 'app', conversationCount: 3, lastActivityMs: 9_000 }),
    ],
    null,
    'vscode',
  );
  assert.equal(chosen?.id, 'desktop', 'an unused editor does not hide active work elsewhere');
});

test('a running conversation outranks a changed one', () => {
  const list = parseTrajectories(
    trajectoriesPayload([
      { id: 'changed', title: 'Changed', stepCount: 50, lastModified: '2026-11-01T15:00:00Z' },
      { id: 'running', title: 'Running', stepCount: 40, status: 'CASCADE_RUN_STATUS_RUNNING', lastModified: '2026-11-01T14:00:00Z' },
    ]),
  );

  const selection = chooseConversation(list, new Map([['changed', 42]]), null);
  assert.equal(selection?.conversation.id, 'running');
  assert.equal(selection?.reason, 'running');
});

test('a pinned running conversation wins over another running conversation', () => {
  const list = parseTrajectories(
    trajectoriesPayload([
      { id: 'other', title: 'Other', stepCount: 10, status: 'CASCADE_RUN_STATUS_RUNNING', lastModified: '2026-11-01T15:00:00Z' },
      { id: 'mine', title: 'Mine', stepCount: 10, status: 'CASCADE_RUN_STATUS_RUNNING', lastModified: '2026-11-01T14:00:00Z' },
    ]),
  );

  assert.equal(chooseConversation(list, new Map(), 'mine')?.conversation.id, 'mine');
});

test('a changed conversation is preferred over the pinned one', () => {
  const list = parseTrajectories(
    trajectoriesPayload([
      { id: 'pinned', title: 'Pinned', stepCount: 10, lastModified: '2026-11-01T15:00:00Z' },
      { id: 'changed', title: 'Changed', stepCount: 30, lastModified: '2026-11-01T14:00:00Z' },
    ]),
  );

  const selection = chooseConversation(list, new Map([['changed', 29]]), 'pinned');
  assert.equal(selection?.conversation.id, 'changed');
  assert.equal(selection?.reason, 'changed');
});

test('the pinned conversation is kept when nothing else changed', () => {
  const list = parseTrajectories(
    trajectoriesPayload([
      { id: 'newer', title: 'Newer', stepCount: 10, lastModified: '2026-11-01T15:00:00Z' },
      { id: 'pinned', title: 'Pinned', stepCount: 10, lastModified: '2026-11-01T14:00:00Z' },
    ]),
  );

  assert.equal(chooseConversation(list, new Map(), 'pinned')?.conversation.id, 'pinned');
});

test('the most recent conversation is the fallback', () => {
  const list = parseTrajectories(
    trajectoriesPayload([
      { id: 'newer', title: 'Newer', stepCount: 10, lastModified: '2026-11-01T15:00:00Z' },
      { id: 'older', title: 'Older', stepCount: 10, lastModified: '2026-11-01T14:00:00Z' },
    ]),
  );

  const selection = chooseConversation(list, new Map(), null);
  assert.equal(selection?.conversation.id, 'newer');
  assert.equal(selection?.reason, 'recent');
});

test('an empty conversation list selects nothing rather than a guess', () => {
  assert.equal(chooseConversation([], new Map(), null), null);
});

test('one process exposing two sockets is listed once, over HTTPS', () => {
  const deduped = dedupeBackends([
    backend({ id: 'http:50063', pid: 38604, scheme: 'http', port: 50063, conversationCount: 4, owner: 'app' }),
    backend({ id: 'https:50062', pid: 38604, scheme: 'https', port: 50062, conversationCount: 4, owner: 'app' }),
  ]);

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].id, 'https:50062');
  assert.equal(deduped[0].owner, 'app', 'the owning app survives deduplication');
});

test('dedupe keeps the reachable socket of a process', () => {
  const deduped = dedupeBackends([
    backend({ id: 'https:49262', pid: 38604, scheme: 'https', port: 49262, reachable: false }),
    backend({ id: 'http:50063', pid: 38604, scheme: 'http', port: 50063, conversationCount: 4 }),
  ]);

  assert.deepEqual(deduped.map((entry) => entry.id), ['http:50063']);
});

test('dedupe keeps distinct processes apart', () => {
  const deduped = dedupeBackends([
    backend({ id: 'hub:http:50096', pid: 39872, port: 50096 }),
    backend({ id: 'hub:http:55908', pid: 17460, port: 55908 }),
    backend({ id: 'https:50062', pid: 38604, kind: 'legacy', scheme: 'https', port: 50062 }),
  ]);

  assert.equal(deduped.length, 3);
});

test('dedupe does not merge entries that have no pid', () => {
  const deduped = dedupeBackends([
    backend({ id: 'a', pid: null, port: 1 }),
    backend({ id: 'b', pid: null, port: 2 }),
  ]);
  assert.equal(deduped.length, 2);
});

test('the signature changes with every field that implies new content', () => {
  const [conversation] = parseTrajectories(
    trajectoriesPayload([{ id: 'a', title: 'A', stepCount: 5, lastModified: '2026-11-01T15:00:00Z' }]),
  );

  assert.equal(
    signatureOf(conversation),
    'a|5|2026-11-01T15:00:00Z|idle',
  );
  assert.notEqual(signatureOf({ ...conversation, stepCount: 6 }), signatureOf(conversation));
});
