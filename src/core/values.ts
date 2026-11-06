/**
 * Defensive accessors for untrusted JSON.
 *
 * The backend is a Go service that speaks protobuf-JSON: 64-bit integers arrive
 * as strings, optional fields are omitted entirely, and unknown fields are
 * silently discarded. Every value that reaches business logic therefore passes
 * through one of these helpers, which fail closed instead of coercing.
 */

export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Parse a protobuf 64-bit integer.
 *
 * Accepts a JSON number or a decimal string. Rejects negatives, non-integers,
 * non-finite values, and anything beyond `Number.MAX_SAFE_INTEGER`, because a
 * silently rounded token count is worse than an acknowledged gap.
 */
export function safeInt(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

/** Parse an optional finite number (used for quota fractions). */
export function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Read a nested value by path, returning `null` as soon as a link is missing. */
export function dig(value: unknown, ...path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    const record = asRecord(current);
    if (!record || !(key in record)) {
      return null;
    }
    current = record[key];
  }
  return current;
}

/** First non-empty string among the given candidates. */
export function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const text = asString(value);
    if (text) {
      return text;
    }
  }
  return null;
}

/** Clamp a number into an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
