import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from '@modelcontextprotocol/ext-apps';

declare global {
  interface Window {
    acquireVsCodeApi?: () => {
      postMessage: (msg: unknown) => void;
      getState: () => unknown;
      setState: (state: unknown) => void;
    };
  }
}

const queuedMessages: unknown[] = [];
let connected = false;
let lastSnapshotSignature = '';
let pollingInFlight = false;

const app = new App({ name: 'Antigravity Monitor', version: '1.4.0' }, {});

function syncHostContext(ctx: ReturnType<App['getHostContext']>): void {
  if (!ctx) return;
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
    const currentTheme = document.documentElement.getAttribute('data-theme');
    if (currentTheme !== 'light' && currentTheme !== 'dark') {
      document.documentElement.setAttribute('data-theme', ctx.theme);
    }
  }
  if (ctx.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
}

function forwardSnapshot(structuredContent: unknown): void {
  const sc = structuredContent as { snapshot?: unknown } | undefined;
  if (!sc || !sc.snapshot) return;
  const serialized = JSON.stringify(sc.snapshot);
  if (serialized === lastSnapshotSignature) return;
  lastSnapshotSignature = serialized;
  window.postMessage({ type: 'snapshot', snapshot: sc.snapshot }, '*');
}

let commandChain: Promise<void> = Promise.resolve();

function sendCommand(msg: unknown): Promise<void> {
  commandChain = commandChain
    .catch(() => {})
    .then(async () => {
      try {
        const result = await app.callServerTool({
          name: 'send_command',
          arguments: { message: msg },
        });
        forwardSnapshot(result?.structuredContent);
      } catch {
        // Best-effort bridge; next poll refreshes state.
      }
    });
  return commandChain;
}

window.acquireVsCodeApi = () => ({
  postMessage(msg: unknown) {
    if (!connected) {
      queuedMessages.push(msg);
      return;
    }
    void sendCommand(msg);
  },
  getState: () => ({}),
  setState: () => {},
});

app.ontoolresult = (result) => {
  forwardSnapshot(result?.structuredContent);
};

app.onhostcontextchanged = (ctx) => {
  syncHostContext(ctx);
};

async function pollSnapshot(): Promise<void> {
  if (!connected || pollingInFlight) return;
  pollingInFlight = true;
  try {
    const result = await app.callServerTool({
      name: 'get_snapshot',
      arguments: {},
    });
    forwardSnapshot(result?.structuredContent);
  } catch {
    // Ignored; transient errors resolve on next tick.
  } finally {
    pollingInFlight = false;
  }
}

void (async () => {
  try {
    await app.connect();
    connected = true;
    syncHostContext(app.getHostContext());
    while (queuedMessages.length > 0) {
      const next = queuedMessages.shift();
      await sendCommand(next);
    }
    await pollSnapshot();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        void pollSnapshot();
      }
    }, 750);
    const onWake = () => {
      if (document.visibilityState !== 'hidden') {
        void pollSnapshot();
      }
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('beforeunload', () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    });
  } catch {
    // Host bridge failed to initialize; view stays blank or displays last snapshot.
  }
})();
