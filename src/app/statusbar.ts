/**
 * The status bar item and its hover.
 *
 * One item, one job: answer "how much context is left?" at a glance. Anything
 * that needs more than a glance belongs in the dashboard.
 */

import * as vscode from 'vscode';

import { formatCountdown, formatExact, formatPercent, formatPercentWhole, formatTokens, formatUsd } from '../core/format';
import { appLabel, buildStatusText, escapeMarkdown, usageBand, visibleQuota } from '../core/presentation';

import { Snapshot } from './snapshot';
import { STRINGS } from './strings';
import { quotaAt, quotaBucket, resolveQuotaGroup } from '../core/quota';
import { snippetPreferences } from '../core/snippet';

export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor(command: string) {
    this.item = vscode.window.createStatusBarItem('antigravityMonitor.status', vscode.StatusBarAlignment.Right, 100);
    this.item.name = 'Antigravity Monitor';
    this.item.command = command;
    this.item.text = `$(sync~spin) ${STRINGS.statusBar.starting}`;
    this.item.tooltip = STRINGS.statusBar.starting;
    this.item.show();
  }

  update(snapshot: Snapshot): void {
    this.item.text = statusText(snapshot);
    this.item.tooltip = tooltipFor(snapshot);
    this.item.backgroundColor = backgroundFor(snapshot);
  }

  dispose(): void {
    this.item.dispose();
  }
}

/** Status bar text for a snapshot. Thin wrapper over the pure builder. */
export function statusText(snapshot: Snapshot): string {
  switch (snapshot.status) {
    case 'starting':
      return `$(sync~spin) ${STRINGS.statusBar.starting}`;
    case 'connecting':
      return `$(sync~spin) ${STRINGS.statusBar.connecting}`;
    case 'disconnected':
      return `$(debug-disconnect) ${STRINGS.statusBar.noBackend}`;
    case 'error':
      return `$(warning) ${STRINGS.statusBar.error}`;
    case 'no-conversation':
      return `$(pulse) ${STRINGS.statusBar.noConversation}`;
    default:
      break;
  }

  const conversation = snapshot.conversation;
  const usage = conversation?.usage ?? null;
  if (!conversation || !usage) {
    return `$(pulse) ${STRINGS.statusBar.unavailable}`;
  }

  if (snapshot.prefs.displayMode === 'custom') {
    const prefs = snippetPreferences(snapshot.prefs);
    const parts: string[] = [];
    if (prefs.snippetContext) parts.push((usage.source === 'estimated' ? '~' : '') + (usage.percent === null ? formatTokens(usage.used) : formatPercent(usage.percent)));
    if (prefs.snippetRemaining && usage.remaining !== null) parts.push(`${formatTokens(usage.remaining)} left`);
    for (const [key, window, label] of [['snippetFiveHour', '5h', '5h'], ['snippetWeekly', 'weekly', 'Week']] as const) {
      if (!prefs[key]) continue;
      const bucket = quotaBucket(snapshot.quota, conversation.modelName, window);
      const cached = snapshot.quota && quotaAt(snapshot.quota).status === 'cached' ? '~' : '';
      parts.push(bucket ? `${cached}${label} ${formatPercent(bucket.percent!)}${prefs.snippetResets && bucket.resetsAt ? ` (${formatCountdown(Date.parse(bucket.resetsAt))})` : ''}` : `${label} —`);
    }
    if (prefs.snippetModel && conversation.modelName) parts.push(conversation.modelName);
    return `$(pulse) ${parts.length ? parts.join(' · ') : 'Monitor'}`;
  }

  return buildStatusText({
    used: usage.used,
    capacity: usage.capacity,
    percent: usage.percent === null ? null : formatPercent(usage.percent),
    estimated: usage.source === 'estimated',
    compressed: conversation.compressed,
    quotaPercent: snapshot.prefs.showQuota ? activeQuotaPercent(snapshot) : null,
    mode: snapshot.prefs.displayMode,
  });
}

function backgroundFor(snapshot: Snapshot): vscode.ThemeColor | undefined {
  if (snapshot.status === 'error') {
    return new vscode.ThemeColor('statusBarItem.errorBackground');
  }
  const percent = snapshot.conversation?.usage?.percent ?? null;
  switch (usageBand(percent, snapshot.prefs.warningThreshold)) {
    case 'critical':
      return new vscode.ThemeColor('statusBarItem.errorBackground');
    case 'warning':
      return new vscode.ThemeColor('statusBarItem.warningBackground');
    default:
      return undefined;
  }
}

/** Build the hover. Markdown so the numbers align and stay selectable. */
export function tooltipFor(snapshot: Snapshot): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString(undefined, true);
  tooltip.supportThemeIcons = true;

  if (snapshot.status === 'starting') {
    tooltip.appendMarkdown(STRINGS.statusBar.starting);
    return tooltip;
  }

  if (snapshot.status === 'disconnected') {
    tooltip.appendMarkdown(`**${STRINGS.tooltip.noBackend}**`);
    appendBackendList(tooltip, snapshot);
    appendFooter(tooltip, snapshot);
    return tooltip;
  }

  if (snapshot.status === 'error') {
    tooltip.appendMarkdown(`**${STRINGS.statusBar.error}**`);
    if (snapshot.lastError) {
      tooltip.appendMarkdown(`\n\n${escapeMarkdown(snapshot.lastError)}`);
    }
    appendBackendList(tooltip, snapshot);
    appendFooter(tooltip, snapshot);
    return tooltip;
  }

  const conversation = snapshot.conversation;
  if (!conversation) {
    tooltip.appendMarkdown(STRINGS.tooltip.noConversation);
    appendBackendList(tooltip, snapshot);
    appendFooter(tooltip, snapshot);
    return tooltip;
  }

  tooltip.appendMarkdown(
    `**${STRINGS.tooltip.title}**\n$(comment-discussion) ${escapeMarkdown(conversation.title)}\n\n`,
  );

  const usage = conversation.usage;
  if (!usage) {
    tooltip.appendMarkdown(`_${STRINGS.statusBar.unavailable}_`);
    if (snapshot.lastError) {
      tooltip.appendMarkdown(`\n\n${escapeMarkdown(snapshot.lastError)}`);
    }
    appendFooter(tooltip, snapshot);
    return tooltip;
  }

  const percent = usage.percent === null ? null : formatPercent(usage.percent);
  const used = `\`${formatTokens(usage.used)}${usage.capacity === null ? '' : ` / ${formatTokens(usage.capacity)}`}\``;
  tooltip.appendMarkdown(
    `${percent === null ? `${used} tokens` : `**${percent}** used \u00b7 ${used} tokens`}\n`,
  );
  if (usage.remaining !== null) {
    tooltip.appendMarkdown(`\`${formatTokens(usage.remaining)}\` left\n`);
  }

  tooltip.appendMarkdown('\n| | |\n|:--|:--|\n');
  row(tooltip, STRINGS.tooltip.model, escapeMarkdown(conversation.modelName ?? conversation.modelId ?? 'Unknown'));
  if (usage.capacity !== null) {
    row(tooltip, STRINGS.tooltip.capacity, `\`${formatExact(usage.capacity)}\` tokens`);
  }

  const quota = activeQuota(snapshot);
  if (quota && snapshot.prefs.showQuota && quota.quotaPercent !== null) {
    const reset = quota.resetsAt ? Date.parse(quota.resetsAt) : NaN;
    const suffix = Number.isFinite(reset) ? `, ${STRINGS.tooltip.resetsIn} ${formatCountdown(reset)}` : '';
    row(
      tooltip,
      STRINGS.tooltip.quota,
      `**${formatPercentWhole(quota.quotaPercent)}** left${suffix}`,
    );
  }

  if (snapshot.quota) {
    const weekly = quotaBucket(snapshot.quota, conversation.modelName, 'weekly');
    row(tooltip, 'Weekly quota', weekly ? `${formatPercent(weekly.percent!)} left${weekly.resetsAt ? `, resets in ${formatCountdown(Date.parse(weekly.resetsAt))}` : ''}` : 'Unavailable');
    row(tooltip, 'Quota group', escapeMarkdown(resolveQuotaGroup(snapshot.quota.groups, conversation.modelName)?.label ?? 'Not identified'));
    row(tooltip, 'Quota source', `${quotaAt(snapshot.quota).status} · automatic 5-second refresh`);
  }

  row(
    tooltip,
    STRINGS.tooltip.source,
    usage.source === 'estimated' ? STRINGS.tooltip.estimated : STRINGS.tooltip.measured,
  );

  tooltip.appendMarkdown(`\n**${STRINGS.tooltip.breakdown}**\n\n`);
  const pieces = [
    `${STRINGS.tooltip.freshInput} \`${formatExact(usage.input)}\``,
    `${STRINGS.tooltip.cacheRead} \`${formatExact(usage.cacheRead)}\``,
  ];
  if (usage.cacheCreate > 0) {
    pieces.push(`${STRINGS.tooltip.cacheWrite} \`${formatExact(usage.cacheCreate)}\``);
  }
  pieces.push(`${STRINGS.tooltip.output} \`${formatExact(usage.output)}\``);
  tooltip.appendMarkdown(pieces.join(' \u00b7 '));

  if (conversation.totals.costUsd !== null) {
    tooltip.appendMarkdown(
      `\n\n${formatUsd(conversation.totals.costUsd)} API-equivalent across ${formatExact(conversation.totals.calls)} calls`,
    );
  }

  const others: string[] = [];
  for (const instance of snapshot.instances ?? []) {
    if (snapshot.backend && instance.backend.id === snapshot.backend.id) {
      continue;
    }
    const otherPercent = instance.conversation?.usage?.percent;
    if (otherPercent === null || otherPercent === undefined) {
      continue;
    }
    others.push(`${appLabel(instance.backend.app)} ${formatPercent(otherPercent)}`);
  }
  if (others.length > 0) {
    tooltip.appendMarkdown(`\n\n$(list-unordered) ${STRINGS.tooltip.alsoRunning}: ${others.join('; ')}`);
  }

  if (conversation.compressed) {
    tooltip.appendMarkdown(`\n\n$(fold) ${STRINGS.tooltip.compressed}`);
  }
  if (conversation.imageSteps > 0) {
    tooltip.appendMarkdown(`\n\n$(file-media) ${STRINGS.tooltip.imageSteps}: ${conversation.imageSteps}`);
  }
  if (snapshot.stale) {
    tooltip.appendMarkdown(`\n\n$(history) ${STRINGS.tooltip.stale}`);
  }
  if (snapshot.lastError) {
    tooltip.appendMarkdown(`\n\n$(warning) ${escapeMarkdown(snapshot.lastError)}`);
  }

  appendFooter(tooltip, snapshot);
  return tooltip;
}

function row(tooltip: vscode.MarkdownString, label: string, value: string): void {
  tooltip.appendMarkdown(`| ${label} | ${value} |\n`);
}

function activeQuota(snapshot: Snapshot): Snapshot['models'][number] | null {
  const modelId = snapshot.conversation?.modelId ?? null;
  if (!modelId) {
    return null;
  }
  return snapshot.models.find((model) => model.modelId === modelId) ?? null;
}

function activeQuotaPercent(snapshot: Snapshot): number | null {
  if (snapshot.quota) return visibleQuota(quotaBucket(snapshot.quota, snapshot.conversation?.modelName, '5h')?.percent ?? null);
  return visibleQuota(activeQuota(snapshot)?.quotaPercent ?? null);
}

function appendBackendList(tooltip: vscode.MarkdownString, snapshot: Snapshot): void {
  const instances = snapshot.instances;
  if (instances.length > 0) {
    tooltip.appendMarkdown('\n\n**Apps**\n\n');
    for (const instance of instances) {
      const conversation = instance.conversation;
      const used = conversation?.usage?.percent ?? null;
      const reading = used === null ? 'No reading' : `${formatPercent(used)} used`;
      const title = conversation ? escapeMarkdown(conversation.title) : 'No conversation';
      tooltip.appendMarkdown(
        `- ${instance.backend.active ? '$(check) ' : ''}**${appLabel(instance.backend.app)}** \u00b7 ${title} \u00b7 ${reading}\n`,
      );
    }
    return;
  }

  const reachable = snapshot.backends.filter((backend) => backend.reachable);
  if (reachable.length === 0) {
    return;
  }
  tooltip.appendMarkdown('\n\n**Apps**\n\n');
  for (const backend of reachable) {
    tooltip.appendMarkdown(
      `- ${appLabel(backend.app)} \u00b7 port ${backend.port} \u00b7 ${backend.conversations} conversation${backend.conversations === 1 ? '' : 's'}\n`,
    );
  }
}

function appendFooter(tooltip: vscode.MarkdownString, snapshot: Snapshot): void {
  const pieces: string[] = [];
  if (snapshot.backend) {
    pieces.push(appLabel(snapshot.backend.app));
  }
  if (snapshot.conversation) {
    pieces.push(`${formatExact(snapshot.conversation.stepCount)} steps`);
  }
  tooltip.appendMarkdown('\n\n');
  if (pieces.length > 0) {
    tooltip.appendMarkdown(`${pieces.join(' \u00b7 ')}\n\n`);
  }
  tooltip.appendMarkdown(`$(dashboard) ${STRINGS.tooltip.openDashboard}`);
}
