import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EMPTY,
  formatAge,
  formatCountdown,
  formatDate,
  formatDuration,
  formatExact,
  formatPercent,
  formatPercentWhole,
  formatTokens,
  formatUsd,
  recentDayKeys,
  toDayKey,
} from '../src/core/format';

test('formatTokens keeps magnitude legible across the k and M boundaries', () => {
  assert.equal(formatTokens(0), '0');
  assert.equal(formatTokens(842), '842');
  assert.equal(formatTokens(999), '999');
  assert.equal(formatTokens(1000), '1.0k');
  assert.equal(formatTokens(16384), '16.4k');
  assert.equal(formatTokens(174652), '174.7k');
  assert.equal(formatTokens(999999), '1000.0k');
  assert.equal(formatTokens(1_048_576), '1.0M');
  assert.equal(formatTokens(2_500_000), '2.5M');
});

test('formatTokens acknowledges unknown values instead of printing zero', () => {
  assert.equal(formatTokens(null), EMPTY);
  assert.equal(formatTokens(undefined), EMPTY);
  assert.equal(formatTokens(Number.NaN), EMPTY);
});

test('formatExact uses thousands separators', () => {
  assert.equal(formatExact(1048576), '1,048,576');
  assert.equal(formatExact(null), EMPTY);
});

test('formatPercent trims noise but keeps one decimal of signal', () => {
  assert.equal(formatPercent(16.66), '16.7%');
  assert.equal(formatPercent(50), '50%');
  assert.equal(formatPercent(0), '0%');
  assert.equal(formatPercent(100), '100%');
  assert.equal(formatPercent(120), '100%');
  assert.equal(formatPercent(null), EMPTY);
});

test('formatPercentWhole rounds for quota bars', () => {
  assert.equal(formatPercentWhole(83.6511), '84%');
  assert.equal(formatPercentWhole(100), '100%');
  assert.equal(formatPercentWhole(-5), '0%');
  assert.equal(formatPercentWhole(null), EMPTY);
});

test('formatDuration scales from milliseconds to hours', () => {
  assert.equal(formatDuration(820), '820ms');
  assert.equal(formatDuration(1400), '1.4s');
  assert.equal(formatDuration(65_000), '1m 05s');
  assert.equal(formatDuration(3_900_000), '1h 05m');
  assert.equal(formatDuration(null), EMPTY);
});

test('formatCountdown reports the next reset in human units', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  assert.equal(formatCountdown(Date.parse('2026-11-01T12:00:30Z'), now), '<1m');
  assert.equal(formatCountdown(Date.parse('2026-11-01T12:45:00Z'), now), '45m');
  assert.equal(formatCountdown(Date.parse('2026-11-01T16:06:00Z'), now), '4h 06m');
  assert.equal(formatCountdown(Date.parse('2026-11-04T14:00:00Z'), now), '3d 2h');
  assert.equal(formatCountdown(now - 1000, now), 'now');
});

test('day keys are local-time, zero-padded, and ordered oldest first', () => {
  const moment = new Date(2026, 10, 2, 12, 0, 0);
  assert.equal(toDayKey(moment), '2026-11-02');
  const keys = recentDayKeys(3, moment.getTime());
  assert.deepEqual(keys, ['2026-10-31', '2026-11-01', '2026-11-02']);
});

test('formatDate and formatAge are English and locale-pinned', () => {
  assert.equal(formatDate('2026-11-02T00:00:00'), 'Nov 2, 2026');
  const now = Date.parse('2026-11-02T12:00:00Z');
  assert.equal(formatAge('2026-11-02T11:59:40Z', now), 'just now');
  assert.equal(formatAge('2026-11-02T11:30:00Z', now), '30m ago');
  assert.equal(formatAge('2026-11-02T09:00:00Z', now), '3h ago');
  assert.equal(formatAge(null, now), EMPTY);
});

test('formatUsd keeps sub-cent estimates visible', () => {
  assert.equal(formatUsd(0.004), '<$0.01');
  assert.equal(formatUsd(1.5), '$1.50');
  assert.equal(formatUsd(null), EMPTY);
});
