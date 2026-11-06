/**
 * Extension entry point.
 *
 * Wiring only: construct the monitor, connect it to the status bar and the
 * dashboard, expose commands, and make sure everything is torn down. The
 * behaviour lives in `monitor.ts` and the pure `core/` modules.
 */

import * as vscode from 'vscode';

import { SettingKey } from '../core/messages';
import { appLabel } from '../core/presentation';
import { BackendOwner } from '../core/rpc';

import { Monitor } from './monitor';
import { DashboardPanel } from './panel';
import { Snapshot } from './snapshot';
import { StatusBar } from './statusbar';
import { Store } from './store';
import { APP_NAME, COMMANDS, CONFIG_SECTION, OUTPUT_CHANNEL_NAME, STRINGS } from './strings';

let output: vscode.OutputChannel | undefined;
let store: Store | undefined;
let monitor: Monitor | undefined;
let statusBar: StatusBar | undefined;
let panel: DashboardPanel | undefined;

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
    onRefresh: () => monitor?.refreshNow(),
    onSelectBackend: (id: string) => {
      void store?.setPinnedBackendId(id);
      monitor?.selectBackend(id);
    },
    onSelectSession: (id: string) => {
      void store?.setPinnedConversationId(id);
      monitor?.pinConversation(id);
    },
    onShowDiagnostics: () => output?.show(true),
    onUpdateSetting: (key: SettingKey, value: string | number | boolean) => {
      void updateSetting(key, value);
    },
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.openDashboard, () => {
      panel = DashboardPanel.show(context, callbacks);
      panel.update(monitor!.getSnapshot());
    }),

    vscode.commands.registerCommand(COMMANDS.refresh, () => {
      monitor?.refreshNow();
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
        panel.update(monitor!.getSnapshot());
      }
    }),

    { dispose: () => disposeAll() },
  );

  monitor.start();
}

function onSnapshot(snapshot: Snapshot): void {
  statusBar?.update(snapshot);
  panel?.update(snapshot);
  maybeWarnAboutQuota(snapshot);
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
  const activeId = snapshot.conversation.modelId;

  for (const model of snapshot.models) {
    if (model.modelId === null || model.quotaPercent === null) {
      continue;
    }
    const low = model.quotaPercent <= threshold;
    const armed = quotaState.get(model.modelId) ?? true;

    if (low && armed && model.modelId === activeId) {
      quotaState.set(model.modelId, false);
      if (model.modelId === activeId) {
        void vscode.window.showWarningMessage(
          STRINGS.notices.quotaWarning(model.label, `${Math.round(model.quotaPercent)}%`),
        );
      }
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
