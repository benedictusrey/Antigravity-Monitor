/**
 * Pure presentation rules shared by the status bar, tooltip, and dashboard.
 *
 * Kept free of `vscode` imports so the wording, thresholds, and escaping can be
 * tested directly — a status bar is a poor place to discover a formatting bug.
 */

import { formatPercent, formatPercentWhole, formatTokens } from './format';

export type UsageBand = 'normal' | 'warning' | 'critical';

/** How much detail an always-visible surface shows. */
export type DisplayMode = 'essentials' | 'full' | 'custom';

export interface StatusTextInput {
  used: number;
  capacity: number | null;
  percent: string | null;
  estimated: boolean;
  compressed: boolean;
  quotaPercent: number | null;
  mode?: DisplayMode;
}

/**
 * Build the status bar string, e.g. `$(pulse) 174.7k / 1.0M · 16.7%`.
 *
 * A leading `~` marks an estimate so the number is never read as a measurement.
 * Essentials drops to the percentage alone; the tooltip stays detailed either way.
 */
export function buildStatusText(input: StatusTextInput): string {
  const percentValue = input.percent === null ? 0 : Number.parseFloat(input.percent);
  const icon = percentValue >= 95 ? '$(zap)' : '$(pulse)';
  const prefix = input.estimated ? '~' : '';

  if (input.mode === 'essentials') {
    const reading = input.percent ? `${prefix}${input.percent}` : `${prefix}${formatTokens(input.used)}`;
    return `${icon} ${reading}`;
  }

  const figure =
    input.capacity === null
      ? `${prefix}${formatTokens(input.used)}`
      : `${prefix}${formatTokens(input.used)} / ${formatTokens(input.capacity)}`;

  const parts = [figure];
  if (input.percent) {
    parts.push(input.percent);
  }
  if (input.quotaPercent !== null) {
    parts.push(`$(circle-filled) ${formatPercentWhole(input.quotaPercent)}`);
  }
  if (input.compressed) {
    parts.push('$(fold)');
  }

  return `${icon} ${parts.join(' \u00b7 ')}`;
}

/**
 * Classify usage into a visual band.
 *
 * The user's threshold is the point at which the status bar starts asking for
 * attention; critical is a fixed high-water mark just short of the limit.
 */
export function usageBand(percent: number | null, warningThreshold: number): UsageBand {
  if (percent === null) {
    return 'normal';
  }
  if (percent >= 95) {
    return 'critical';
  }
  if (percent >= warningThreshold) {
    return 'warning';
  }
  return 'normal';
}

/** Compact quota label used where space is tight. */
export function quotaLabel(percent: number | null): string {
  return percent === null ? '' : formatPercentWhole(percent);
}

/**
 * Quota worth showing next to context.
 *
 * A quota at 100% is not information — it is the default state — and a calm
 * "100%" beside a warning-coloured context figure reads as a second signal.
 * Rounding decides: 99.6% displays as 100% and is hidden for the same reason.
 */
export function visibleQuota(percent: number | null): number | null {
  if (percent === null || percent >= 99.5) {
    return null;
  }
  return percent;
}

/**
 * Escape text that is interpolated into Markdown.
 *
 * Only characters that change meaning are escaped. Dots, parentheses, and
 * hyphens are ordinary text in a table cell; escaping them showed literal
 * backslashes in the hover (for example `Gemini 3.\8 Flash \(High\)`).
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]|])/g, '\\$1');
}

/** One-line summary used as accessible text for the dashboard gauge. */
export function usageSummaryLabel(used: number, capacity: number | null, percent: number | null): string {
  const capacityText = capacity === null ? 'unknown capacity' : formatTokens(capacity);
  const percentText = percent === null ? '' : ` (${formatPercent(percent)})`;
  return `${formatTokens(used)} of ${capacityText} tokens${percentText}`;
}

/**
 * Name the installation a backend belongs to.
 *
 * Three hosts can run the agent at once and each owns its own language server,
 * so "which app am I looking at" has to be answerable in one word.
 */
export function appLabel(app: 'app' | 'ide' | 'vscode' | 'unknown'): string {
  switch (app) {
    case 'app':
      return 'Antigravity';
    case 'ide':
      return 'Antigravity IDE';
    case 'vscode':
      return 'VS Code';
    default:
      return 'Unknown app';
  }
}
