/**
 * Dashboard host.
 *
 * The webview never receives the CSRF token, the process command line, or raw
 * trajectory data — only the snapshot defined in `snapshot.ts`. Messages coming
 * back are validated in `core/messages.ts` before they reach the extension.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { SettingKey, parseMessage } from '../core/messages';

import { Snapshot } from './snapshot';
import { APP_NAME, VIEW_TYPE } from './strings';

export interface PanelCallbacks {
  onRefresh: () => void;
  onSelectBackend: (id: string) => void;
  onSelectSession: (id: string) => void;
  onShowDiagnostics: () => void;
  onUpdateSetting: (key: SettingKey, value: string | number | boolean) => void;
}

export class DashboardPanel implements vscode.Disposable {
  private static current: DashboardPanel | null = null;

  private readonly panel: vscode.WebviewPanel;
  private readonly callbacks: PanelCallbacks;
  private readonly disposables: vscode.Disposable[] = [];
  private latest: Snapshot | null = null;
  private webviewReady = false;
  private disposed = false;

  static show(context: vscode.ExtensionContext, callbacks: PanelCallbacks): DashboardPanel {
    if (DashboardPanel.current && !DashboardPanel.current.disposed) {
      DashboardPanel.current.reveal();
      return DashboardPanel.current;
    }
    DashboardPanel.current = new DashboardPanel(context, callbacks);
    return DashboardPanel.current;
  }

  private constructor(context: vscode.ExtensionContext, callbacks: PanelCallbacks) {
    this.callbacks = callbacks;

    this.panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      APP_NAME,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        // The dashboard is a reading surface; retaining it keeps the user's tab
        // and scroll position across focus changes.
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');
    this.panel.webview.html = this.html(context);

    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message: unknown) => this.handleMessage(message)),
      this.panel.onDidDispose(() => this.dispose()),
    );
  }

  update(snapshot: Snapshot): void {
    this.latest = snapshot;
    if (this.disposed || !this.webviewReady) {
      return;
    }
    void this.panel.webview.postMessage({ type: 'snapshot', snapshot });
  }

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Beside, true);
  }

  private handleMessage(message: unknown): void {
    const parsed = parseMessage(message);
    if (!parsed) {
      return;
    }

    switch (parsed.type) {
      case 'ready':
        this.webviewReady = true;
        if (this.latest) {
          void this.panel.webview.postMessage({ type: 'snapshot', snapshot: this.latest });
        }
        break;
      case 'refresh':
        this.callbacks.onRefresh();
        break;
      case 'diagnostics':
        this.callbacks.onShowDiagnostics();
        break;
      case 'selectBackend':
        this.callbacks.onSelectBackend(parsed.id);
        break;
      case 'selectSession':
        this.callbacks.onSelectSession(parsed.id);
        break;
      case 'updateSetting':
        this.callbacks.onUpdateSetting(parsed.key, parsed.value);
        break;
      default:
        break;
    }
  }

  private html(context: vscode.ExtensionContext): string {
    const media = vscode.Uri.joinPath(context.extensionUri, 'media');
    const webview = this.panel.webview;
    const nonce = crypto.randomBytes(16).toString('base64');
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(media, 'dashboard.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(media, 'dashboard.js'));

    let template: string;
    try {
      template = fs.readFileSync(path.join(context.extensionUri.fsPath, 'media', 'dashboard.html'), 'utf8');
    } catch {
      return fallbackHtml();
    }

    return template
      .replaceAll('{{cspSource}}', webview.cspSource)
      .replaceAll('{{nonce}}', nonce)
      .replaceAll('{{host}}', 'editor')
      .replaceAll('{{cssUri}}', cssUri.toString())
      .replaceAll('{{jsUri}}', jsUri.toString());
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (DashboardPanel.current === this) {
      DashboardPanel.current = null;
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    try {
      this.panel.dispose();
    } catch {
      // Already disposed because the user closed the tab.
    }
  }
}

/** Shown only if the packaged media folder is missing or unreadable. */
function fallbackHtml(): string {
  const nonce = crypto.randomBytes(16).toString('base64');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';">
<title>${APP_NAME}</title></head>
<body style="font-family: var(--vscode-font-family); padding: 24px;">
<h1 style="font-size: 16px;">${APP_NAME}</h1>
<p>The dashboard resources could not be loaded. Run <strong>${APP_NAME}: Show Diagnostics</strong> for details.</p>
</body></html>`;
}
