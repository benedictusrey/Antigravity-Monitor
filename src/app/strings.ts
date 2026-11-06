/**
 * User-facing copy.
 *
 * Centralised so the extension speaks with one voice: the status bar, the
 * tooltip, notifications, and the dashboard all draw from here. Keeping the text
 * in a module (rather than inline) is also what would make localisation a
 * translation exercise instead of a refactor.
 */

export const APP_NAME = 'Antigravity Monitor';
export const OUTPUT_CHANNEL_NAME = 'Antigravity Monitor';
export const VIEW_TYPE = 'antigravityMonitor.dashboard';

export const COMMANDS = {
  openDashboard: 'antigravityMonitor.openDashboard',
  refresh: 'antigravityMonitor.refresh',
  selectBackend: 'antigravityMonitor.selectBackend',
  showDiagnostics: 'antigravityMonitor.showDiagnostics',
} as const;

export const CONFIG_SECTION = 'antigravityMonitor';

export const STRINGS = {
  statusBar: {
    starting: 'Starting\u2026',
    connecting: 'Connecting\u2026',
    noBackend: 'No Antigravity backend',
    noConversation: 'No active conversation',
    error: 'Monitoring unavailable',
    unavailable: 'Conversation too large',
  },
  tooltip: {
    title: 'Context window',
    conversation: 'Conversation',
    model: 'Model',
    used: 'Used',
    remaining: 'Remaining',
    capacity: 'Capacity',
    breakdown: 'Breakdown',
    freshInput: 'Fresh input',
    cacheRead: 'Cache read',
    cacheWrite: 'Cache write',
    output: 'Output',
    quota: '5-hour quota',
    alsoRunning: 'Also running',
    resetsIn: 'resets in',
    backend: 'Backend',
    updated: 'Updated',
    source: 'Source',
    measured: 'Measured',
    estimated: 'Estimated',
    compressed: 'Context was compressed',
    imageSteps: 'Image generations',
    openDashboard: 'Open dashboard',
    noConversation: 'No conversation is active in Antigravity.',
    noBackend: 'No Antigravity language server was found.',
    stale: 'Last reading is out of date',
  },
  actions: {
    refresh: 'Refresh',
    selectBackend: 'Backend',
    diagnostics: 'Diagnostics',
  },
  notices: {
    noBackends: 'Antigravity Monitor could not find a running Antigravity language server.',
    quotaWarning: (model: string, remaining: string) =>
      `${model} has ${remaining} of its quota remaining.`,
  },
} as const;
