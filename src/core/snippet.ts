export const SNIPPET_DEFAULTS = {
  snippetContext: true,
  snippetRemaining: true,
  snippetFiveHour: false,
  snippetWeekly: false,
  snippetModel: false,
  snippetResets: false,
} as const;

export type SnippetKey = keyof typeof SNIPPET_DEFAULTS;
export type SnippetPrefs = Partial<Record<SnippetKey, boolean>>;

export function snippetPreferences(config: SnippetPrefs & { displayMode?: string }): Record<SnippetKey, boolean> {
  if (config.displayMode !== 'custom') {
    return { ...SNIPPET_DEFAULTS, snippetRemaining: config.displayMode !== 'essentials' };
  }
  return Object.fromEntries(Object.entries(SNIPPET_DEFAULTS).map(([key, fallback]) => [
    key, typeof config[key as SnippetKey] === 'boolean' ? config[key as SnippetKey] : fallback,
  ])) as Record<SnippetKey, boolean>;
}
