/**
 * Minimal `vscode` module mock.
 *
 * The extension host is not available outside the IDE, so activation is
 * exercised against this stub. It records what the extension registers and fails
 * loudly on any API surface the extension uses but the mock omits — exactly the
 * class of wiring bug that TypeScript cannot catch.
 */

class MarkdownString {
  value = '';
  supportThemeIcons = false;
  isTrusted: boolean | Record<string, boolean> = false;

  constructor(value?: string, _supportThemeIcons?: boolean) {
    this.value = value ?? '';
  }

  appendMarkdown(text: string): MarkdownString {
    this.value += text;
    return this;
  }

  appendText(text: string): MarkdownString {
    this.value += text;
    return this;
  }
}

class ThemeColor {
  constructor(readonly id: string) {}
}

function makeDisposable(dispose: () => void = () => undefined) {
  return { dispose };
}

export interface VscodeMock {
  module: Record<string, unknown>;
  registrations: Array<{ id: string; handler: (...args: unknown[]) => unknown }>;
  statusBarItems: Array<Record<string, unknown>>;
  warnings: string[];
  outputLines: string[];
}

export function createVscodeMock(): VscodeMock {
  const registrations: Array<{ id: string; handler: (...args: unknown[]) => unknown }> = [];
  const statusBarItems: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];
  const outputLines: string[] = [];

  const configStore: Record<string, unknown> = {
    pollIntervalMs: 2000,
    warningThreshold: 80,
    showQuota: true,
    maskPersonalInfo: true,
    quotaWarningThreshold: 15,
    maxPayloadMb: 128,
  };

  const uri = (fsPath: string) => ({
    fsPath,
    path: fsPath,
    scheme: 'file',
    toString: () => `file://${fsPath.replace(/\\/g, '/')}`,
  });

  const module = {
    version: '1.107.0',
    env: { appName: 'Visual Studio Code' },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ViewColumn: { Active: -1, Beside: -2, One: 1 },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    ThemeColor,
    MarkdownString,
    Uri: {
      joinPath: (base: { fsPath: string }, ...parts: string[]) => uri(`${base.fsPath}\\${parts.join('\\')}`),
      file: (value: string) => uri(value),
      parse: (value: string) => uri(value),
    },
    window: {
      createStatusBarItem: () => {
        const item: Record<string, unknown> = {
          name: '',
          text: '',
          tooltip: undefined,
          command: undefined,
          backgroundColor: undefined,
          show: () => undefined,
          hide: () => undefined,
          dispose: () => undefined,
        };
        statusBarItems.push(item);
        return item;
      },
      createOutputChannel: () => ({
        appendLine: (line: string) => outputLines.push(line),
        show: () => undefined,
        dispose: () => undefined,
      }),
      showWarningMessage: (message: string) => {
        warnings.push(message);
        return Promise.resolve(undefined);
      },
      showErrorMessage: (message: string) => {
        warnings.push(message);
        return Promise.resolve(undefined);
      },
      showInformationMessage: (message: string) => {
        warnings.push(message);
        return Promise.resolve(undefined);
      },
      showQuickPick: () => Promise.resolve(undefined),
      setStatusBarMessage: () => makeDisposable(),
      createWebviewPanel: () => ({
        webview: {
          html: '',
          cspSource: 'vscode-resource:',
          asWebviewUri: (value: unknown) => value,
          onDidReceiveMessage: () => makeDisposable(),
          postMessage: () => Promise.resolve(true),
        },
        reveal: () => undefined,
        onDidDispose: () => makeDisposable(),
        dispose: () => undefined,
      }),
    },
    commands: {
      registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
        registrations.push({ id, handler });
        return makeDisposable();
      },
      executeCommand: () => Promise.resolve(undefined),
    },
    workspace: {
      getConfiguration: () => ({
        get: (key: string) => configStore[key],
        update: (key: string, value: unknown) => {
          configStore[key] = value;
          return Promise.resolve();
        },
        has: (key: string) => key in configStore,
      }),
      onDidChangeConfiguration: () => makeDisposable(),
      workspaceFolders: undefined,
    },
  };

  return { module, registrations, statusBarItems, warnings, outputLines };
}

/**
 * Install the mock so `require('vscode')` resolves to it.
 *
 * Must run before the extension module is required; the test runner gives each
 * file its own process, so this does not leak into other tests.
 */
export function installVscodeMock(mock: VscodeMock): void {
  const Module = require('node:module') as {
    _resolveFilename: (request: string, ...rest: unknown[]) => string;
    _cache: Record<string, { id: string; filename: string; loaded: boolean; exports: unknown }>;
  };

  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function patched(request: string, ...rest: unknown[]): string {
    if (request === 'vscode') {
      return 'vscode';
    }
    return originalResolve.call(this, request, ...rest);
  };

  Module._cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: mock.module };
}
