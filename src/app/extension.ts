/**
 * Extension entry point.
 *
 * Wiring only: construct the monitor, connect it to the status bar and the
 * dashboard, expose commands, and make sure everything is torn down. The
 * behaviour lives in `monitor.ts` and the pure `core/` modules.
 */

import { execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { SettingKey } from '../core/messages';
import { appLabel } from '../core/presentation';
import { BackendOwner } from '../core/rpc';

import { Monitor } from './monitor';
import { DashboardPanel } from './panel';
import { Snapshot, projectCompanionSnapshot } from './snapshot';
import { StatusBar } from './statusbar';
import { Store } from './store';
import { APP_NAME, COMMANDS, CONFIG_SECTION, OUTPUT_CHANNEL_NAME, STRINGS } from './strings';

let output: vscode.OutputChannel | undefined;
let store: Store | undefined;
let monitor: Monitor | undefined;
let statusBar: StatusBar | undefined;
let panel: DashboardPanel | undefined;
let latestSnapshot: Snapshot | undefined;
let companionTimer: NodeJS.Timeout | undefined;
let companionActive = false;

const quotaState = new Map<string, boolean>();

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  output.appendLine(`${APP_NAME} activating`);
  quotaState.clear();

  store = new Store(context);
  store.loadUsage();

  statusBar = new StatusBar(COMMANDS.openDashboard);

  monitor = new Monitor({
    logger: (message) => output?.appendLine(`[${new Date().toISOString()}] ${message}`),
    getConfig: () => store!.config,
    onSnapshot: (snapshot) => onSnapshot(snapshot),
    recordUsage: (record) => store?.recordUsage(record),
    usageSummary: () => store?.usageSummary() ?? emptyUsage(),
    hostApp: hostOwner(),
  });

  monitor.restorePinnedBackend(store.pinnedBackendId);
  monitor.restorePinnedConversation(store.pinnedConversationId);

  const callbacks = {
    onRefresh: () => {
      monitor?.refreshNow();
      if (companionActive) postCompanionCommand({ type: 'refresh' });
    },
    onSelectBackend: (id: string) => {
      void store?.setPinnedBackendId(id);
      monitor?.selectBackend(id);
      if (companionActive) postCompanionCommand({ type: 'selectBackend', id });
    },
    onSelectSession: (id: string | null) => {
      void store?.setPinnedConversationId(id);
      monitor?.pinConversation(id);
      if (companionActive) postCompanionCommand({ type: 'selectSession', id });
    },
    onShowDiagnostics: () => output?.show(true),
    onUpdateSetting: (key: SettingKey, value: string | number | boolean) => {
      void updateSetting(key, value);
      if (companionActive) postCompanionCommand({ type: 'updateSetting', key, value });
    },
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.openDashboard, () => {
      panel = DashboardPanel.show(context, callbacks);
      panel.update(latestSnapshot ?? monitor!.getSnapshot());
    }),

    vscode.commands.registerCommand(COMMANDS.refresh, () => {
      monitor?.refreshNow();
      if (companionActive) postCompanionCommand({ type: 'refresh' });
      void vscode.window.setStatusBarMessage('Antigravity Monitor: refreshed', 2000);
    }),

    vscode.commands.registerCommand(COMMANDS.selectBackend, () => selectBackend()),

    vscode.commands.registerCommand(COMMANDS.showDiagnostics, () => output?.show(true)),

    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(CONFIG_SECTION)) {
        return;
      }
      monitor?.updatePreferences();
      if (panel) {
        panel.update(latestSnapshot ?? monitor!.getSnapshot());
      }
    }),

    { dispose: () => disposeAll() },
  );

  monitor.start();
  ensureCompanionRunning();
}

/**
 * If the standalone companion was installed on this machine, start it silently
 * whenever an editor host activates and port 4599 is not yet answering.
 */
function ensureCompanionRunning(): void {
  if (process.env.NODE_TEST_CONTEXT) return;
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const script =
    process.platform === 'win32'
      ? path.join(localAppData, 'Antigravity Monitor', 'app', 'tools', 'start-companion.ps1')
      : path.join(
          process.platform === 'darwin'
            ? path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity Monitor')
            : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'antigravity-monitor'),
          'app',
          'tools',
          'monitor-server.mjs',
        );
  if (!fs.existsSync(script)) return;

  const req = http.get('http://127.0.0.1:4599/api/health', { timeout: 1000 }, (res) => {
    res.resume();
  });
  req.on('error', () => {
    try {
      if (process.platform === 'win32') {
        const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        execFile(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script], {
          windowsHide: true,
        });
      } else {
        const child = spawn(process.execPath, [script, '--no-open', '--port', '4599'], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
      }
    } catch {
      // Best-effort companion wakeup.
    }
  });
  req.on('timeout', () => req.destroy());
}

function onSnapshot(snapshot: Snapshot): void {
  if (snapshot.status === 'ok' || snapshot.status === 'no-conversation') {
    stopCompanionBridge();
    latestSnapshot = snapshot;
    statusBar?.update(snapshot);
    panel?.update(snapshot);
    maybeWarnAboutQuota(snapshot);
    return;
  }
  if (snapshot.status === 'unauthorized' || snapshot.status === 'disconnected') {
    startCompanionBridge();
  }
  if (companionActive && latestSnapshot) {
    return;
  }
  latestSnapshot = snapshot;
  statusBar?.update(snapshot);
  panel?.update(snapshot);
  maybeWarnAboutQuota(snapshot);
}

function startCompanionBridge(): void {
  if (process.env.NODE_TEST_CONTEXT || companionTimer) return;
  const interval = Math.max(1000, store?.config.pollIntervalMs ?? 2000);
  void pollCompanion();
  companionTimer = setInterval(() => void pollCompanion(), interval);
  companionTimer.unref?.();
}

function stopCompanionBridge(): void {
  companionActive = false;
  if (!companionTimer) return;
  clearInterval(companionTimer);
  companionTimer = undefined;
}

function pollCompanion(): Promise<void> {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:4599/api/snapshot', { timeout: 1500 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try {
          if (res.statusCode !== 200 || !store) return;
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { snapshot?: Snapshot };
          const projected = projectCompanionSnapshot(payload.snapshot, hostOwner(), store.config);
          if (!projected) return;
          companionActive = true;
          latestSnapshot = projected;
          statusBar?.update(projected);
          panel?.update(projected);
          maybeWarnAboutQuota(projected);
        } catch {
          // Companion may still be initializing.
        } finally {
          resolve();
        }
      });
    });
    req.on('error', () => resolve());
    req.on('timeout', () => {
      req.destroy();
      resolve();
    });
  });
}

function postCompanionCommand(message: Record<string, unknown>): void {
  if (process.env.NODE_TEST_CONTEXT) return;
  try {
    const body = JSON.stringify(message);
    const req = http.request(
      'http://127.0.0.1:4599/api/command',
      {
        method: 'POST',
        timeout: 1500,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (res) => res.resume(),
    );
    req.on('error', () => {});
    req.on('timeout', () => req.destroy());
    req.write(body);
    req.end();
  } catch {
    // Best-effort forwarding.
  }
}

/**
 * Which installation hosts this extension host.
 *
 * Three apps share the account, so without this the status bar can report a
 * busier window in another app. The name is the only stable runtime signal.
 */
function hostOwner(): BackendOwner {
  const name = vscode.env?.appName ?? '';
  if (/antigravity ide/i.test(name)) {
    return 'ide';
  }
  if (/visual studio code/i.test(name)) {
    return 'vscode';
  }
  return 'unknown';
}

/**
 * Warn once each time a model's remaining quota crosses below the configured
 * threshold. Notifications are limited to the model actually in use, because a
 * warning about a model the user is not calling is noise.
 */
function maybeWarnAboutQuota(snapshot: Snapshot): void {
  const threshold = store?.quotaWarningThreshold ?? 0;
  if (threshold <= 0 || !snapshot.conversation) {
    return;
  }
  const activeId = snapshot.conversation.selectedModelId ?? snapshot.conversation.modelId;

  for (const model of snapshot.models) {
    if (model.modelId === null || model.quotaPercent === null) {
      continue;
    }
    const low = model.quotaPercent <= threshold;
    const armed = quotaState.get(model.modelId) ?? true;

    if (low && armed && model.modelId === activeId) {
      quotaState.set(model.modelId, false);
      void vscode.window.showWarningMessage(
        STRINGS.notices.quotaWarning(model.label, `${Math.round(model.quotaPercent)}%`),
      );
    } else if (!low && !armed) {
      quotaState.set(model.modelId, true);
    }
  }
}

async function selectBackend(): Promise<void> {
  if (!monitor || !store) {
    return;
  }

  const backends = await monitor.listBackends();
  if (backends.length === 0) {
    void vscode.window.showInformationMessage(STRINGS.notices.noBackends);
    return;
  }

  const items = backends.map((backend) => ({
    label: `${appLabel(backend.app)} ${backend.scheme}://127.0.0.1:${backend.port}`,
    description: backend.active ? 'Selected' : '',
    detail: `${backend.conversations} conversation${backend.conversations === 1 ? '' : 's'}${
      backend.running > 0 ? ` · ${backend.running} running` : ''
    }${backend.reachable ? '' : ' · unreachable'}`,
    id: backend.id,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select the Antigravity backend to monitor',
    matchOnDescription: false,
  });
  if (!picked) {
    return;
  }

  await store.setPinnedBackendId(picked.id);
  monitor.selectBackend(picked.id);
  void vscode.window.setStatusBarMessage(`Antigravity Monitor: switched to ${picked.label}`, 2500);
}

async function updateSetting(key: SettingKey, value: string | number | boolean): Promise<void> {
  const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await configuration.update(key, value, vscode.ConfigurationTarget.Global);
  // onDidChangeConfiguration restarts the monitor, so nothing else is required.
}

function emptyUsage() {
  return {
    days: [],
    todayTokens: 0,
    todayCostUsd: null,
    monthTokens: 0,
    monthCostUsd: null,
    priced: false,
  };
}

function disposeAll(): void {
  stopCompanionBridge();
  latestSnapshot = undefined;
  monitor?.stop();
  statusBar?.dispose();
  store?.dispose();
  panel?.dispose();
  output?.dispose();
}

export function deactivate(): void {
  disposeAll();
  output = undefined;
  store = undefined;
  monitor = undefined;
  statusBar = undefined;
  panel = undefined;
}
