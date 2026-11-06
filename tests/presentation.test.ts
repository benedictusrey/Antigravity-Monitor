import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  appLabel,
  buildStatusText,
  escapeMarkdown,
  quotaLabel,
  usageBand,
  usageSummaryLabel,
  visibleQuota,
} from '../src/core/presentation';

const BASE = {
  used: 174_652,
  capacity: 1_048_576,
  percent: '16.7%',
  estimated: false,
  compressed: false,
  quotaPercent: null as number | null,
};

test('the status bar leads with the pulse icon and a compact ratio', () => {
  assert.equal(buildStatusText(BASE), '$(pulse) 174.7k / 1.0M · 16.7%');
});

test('an estimate is marked with a leading tilde', () => {
  assert.equal(buildStatusText({ ...BASE, estimated: true }), '$(pulse) ~174.7k / 1.0M · 16.7%');
});

test('without a known capacity only the used figure is shown', () => {
  assert.equal(buildStatusText({ ...BASE, capacity: null }), '$(pulse) 174.7k · 16.7%');
});

test('near the limit the icon escalates', () => {
  assert.equal(buildStatusText({ ...BASE, percent: '95%' }), '$(zap) 174.7k / 1.0M · 95%');
  assert.equal(buildStatusText({ ...BASE, percent: '94.9%' }), '$(pulse) 174.7k / 1.0M · 94.9%');
});

test('quota and compression markers are appended, not prepended', () => {
  const text = buildStatusText({ ...BASE, quotaPercent: 84, compressed: true });
  assert.equal(text, '$(pulse) 174.7k / 1.0M · 16.7% · $(circle-filled) 84% · $(fold)');
});

test('usage bands follow the configured threshold', () => {
  assert.equal(usageBand(10, 80), 'normal');
  assert.equal(usageBand(79.9, 80), 'normal');
  assert.equal(usageBand(80, 80), 'warning');
  assert.equal(usageBand(94.9, 80), 'warning');
  assert.equal(usageBand(95, 80), 'critical');
  assert.equal(usageBand(null, 80), 'normal');
});

test('markdown escaping neutralises emphasis and code spans', () => {
  assert.equal(escapeMarkdown('my_file_name'), 'my\\_file\\_name');
  assert.equal(escapeMarkdown('a `code` span'), 'a \\`code\\` span');
  assert.equal(escapeMarkdown('a|b'), 'a\\|b');
  assert.equal(escapeMarkdown('*bold*'), '\\*bold\\*');
});

test('ordinary punctuation is not escaped into the hover', () => {
  assert.equal(escapeMarkdown('Gemini 3.8 Flash (High)'), 'Gemini 3.8 Flash (High)');
  assert.equal(escapeMarkdown('build 681.666'), 'build 681.666');
});

test('quotaLabel renders whole percentages', () => {
  assert.equal(quotaLabel(83.6), '84%');
  assert.equal(quotaLabel(null), '');
});

test('a full quota is not shown, because it carries no information', () => {
  assert.equal(visibleQuota(100), null);
  assert.equal(visibleQuota(99.6), null, 'rounds to 100%, so it reads as full');
  assert.equal(visibleQuota(99.4), 99.4);
  assert.equal(visibleQuota(83.6), 83.6);
  assert.equal(visibleQuota(null), null);
});

test('essentials drops to the percentage alone without losing the estimate mark', () => {
  assert.equal(buildStatusText({ ...BASE, mode: 'essentials' }), '$(pulse) 16.7%');
  assert.equal(
    buildStatusText({ ...BASE, estimated: true, mode: 'essentials' }),
    '$(pulse) ~16.7%',
  );
  assert.equal(
    buildStatusText({ ...BASE, percent: '95%', mode: 'essentials' }),
    '$(zap) 95%',
  );
});

test('essentials still says something when the percentage is unknown', () => {
  assert.equal(buildStatusText({ ...BASE, percent: null, mode: 'essentials' }), '$(pulse) 174.7k');
});

test('full remains the default and the richer reading', () => {
  assert.equal(buildStatusText(BASE), '$(pulse) 174.7k / 1.0M · 16.7%');
  assert.equal(buildStatusText({ ...BASE, mode: 'full', quotaPercent: 84 }), '$(pulse) 174.7k / 1.0M · 16.7% · $(circle-filled) 84%');
});

test('usageSummaryLabel reads as a sentence fragment', () => {
  assert.equal(usageSummaryLabel(174_652, 1_048_576, 16.66), '174.7k of 1.0M tokens (16.7%)');
  assert.equal(usageSummaryLabel(174_652, null, null), '174.7k of unknown capacity tokens');
});

test('appLabel distinguishes the three installations', () => {
  assert.equal(appLabel('app'), 'Antigravity');
  assert.equal(appLabel('ide'), 'Antigravity IDE');
  assert.equal(appLabel('vscode'), 'VS Code');
  assert.equal(appLabel('unknown'), 'Unknown app');
});
