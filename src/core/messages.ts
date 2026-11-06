/**
 * The webview message protocol.
 *
 * A webview is untrusted input as far as the extension is concerned: it runs
 * script, and its messages arrive as `unknown`. Everything is validated here
 * against a closed set, and unknown shapes are dropped rather than coerced.
 */

import { SNIPPET_DEFAULTS } from './snippet';

export const SETTING_KEYS = [
  'pollIntervalMs',
  'warningThreshold',
  'showQuota',
  'maskPersonalInfo',
  'maxPayloadMb',
  'displayMode',
  ...Object.keys(SNIPPET_DEFAULTS) as Array<keyof typeof SNIPPET_DEFAULTS>,
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

/** The only string-valued setting, and the only values it may take. */
export const DISPLAY_MODES = ['essentials', 'full', 'custom'] as const;

export type InboundMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'diagnostics' }
  | { type: 'selectBackend'; id: string }
  | { type: 'selectSession'; id: string }
  | { type: 'updateSetting'; key: SettingKey; value: string | number | boolean };

const MAX_ID_LENGTH = 200;

function isDisplayMode(value: string): boolean {
  return (DISPLAY_MODES as readonly string[]).includes(value);
}

/** Validate one inbound message; returns `null` for anything unrecognised. */
export function parseMessage(value: unknown): InboundMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;

  switch (record.type) {
    case 'ready':
    case 'refresh':
    case 'diagnostics':
      return { type: record.type };

    case 'selectBackend':
    case 'selectSession': {
      const id = record.id;
      if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH) {
        return null;
      }
      return { type: record.type, id };
    }

    case 'updateSetting': {
      const key = record.key;
      if (typeof key !== 'string' || !(SETTING_KEYS as readonly string[]).includes(key)) {
        return null;
      }
      const settingValue = record.value;
      const booleanKey = key === 'showQuota' || key === 'maskPersonalInfo' || key in SNIPPET_DEFAULTS;
      if (booleanKey && typeof settingValue === 'boolean') {
        return { type: 'updateSetting', key: key as SettingKey, value: settingValue };
      }
      const bounds: Record<string, [number, number]> = {
        pollIntervalMs: [1000, 60000], warningThreshold: [50, 100], maxPayloadMb: [16, 1024],
      };
      const range = bounds[key];
      if (range && typeof settingValue === 'number' && Number.isInteger(settingValue) && settingValue >= range[0] && settingValue <= range[1]) {
        return { type: 'updateSetting', key: key as SettingKey, value: settingValue };
      }
      // Strings are only meaningful for the enum, and only the two legal values.
      if (typeof settingValue === 'string' && key === 'displayMode' && isDisplayMode(settingValue)) {
        return { type: 'updateSetting', key: key as SettingKey, value: settingValue };
      }
      return null;
    }

    default:
      return null;
  }
}
