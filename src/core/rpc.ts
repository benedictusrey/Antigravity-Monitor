/**
 * Minimal Connect-RPC client for the Antigravity language server.
 *
 * The protocol is protobuf-over-JSON on loopback: a POST per method, one
 * protocol header, and a CSRF token that identifies the backend instance. The
 * official clients (and the reference extension) use generated protobuf stubs;
 * this implementation deliberately uses the plain JSON mapping instead, which is
 * what the server actually accepts and which cannot drift out of sync with a
 * generated descriptor.
 *
 * `node:http` / `node:https` are used directly rather than `fetch` so that
 * per-request timeouts, byte ceilings, and the loopback-only self-signed
 * certificate exception are all explicit rather than implicit.
 */

import * as http from 'node:http';
import * as https from 'node:https';

export const SERVICE_PATH = '/exa.language_server_pb.LanguageServerService';

/** Which Antigravity installation a backend belongs to. */
export type BackendOwner = 'app' | 'ide' | 'vscode' | 'unknown';

export interface BackendTarget {
  /** Stable identity: `kind:port`. */
  id: string;
  kind: 'hub' | 'legacy';
  scheme: 'http' | 'https';
  host: string;
  port: number;
  /** Per-backend CSRF token. Never logged. */
  token: string;
  pid: number | null;
  appDataDir: string | null;
  /** The desktop app or the VS Code-based IDE, resolved from the process tree. */
  owner: BackendOwner;
}

export type RpcErrorCode =
  | 'unauthorized'
  | 'not_found'
  | 'invalid_argument'
  | 'timeout'
  | 'aborted'
  | 'network'
  | 'payload_too_large'
  | 'protocol'
  | 'unavailable';

export class RpcError extends Error {
  readonly code: RpcErrorCode;
  readonly httpStatus: number | null;

  constructor(code: RpcErrorCode, message: string, httpStatus: number | null = null) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.httpStatus = httpStatus;
  }

  /** Whether retrying the same request could plausibly succeed. */
  get retryable(): boolean {
    return this.code === 'timeout' || this.code === 'network' || this.code === 'unavailable';
  }
}

export interface RpcOptions {
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;

export function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

/** Invoke one unary method and return the decoded JSON body. */
export async function callRpc<T = unknown>(
  target: BackendTarget,
  method: string,
  body: unknown = {},
  options: RpcOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  if (!isLoopback(target.host)) {
    throw new RpcError('protocol', 'Refusing RPC to a non-loopback host');
  }

  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  const requestFn = target.scheme === 'https' ? https.request : http.request;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const finish = (error: RpcError | null, value?: T): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
      if (error) {
        reject(error);
      } else {
        resolve(value as T);
      }
    };

    const onAbort = (): void => {
      request.destroy();
      finish(new RpcError('aborted', 'Request aborted'));
    };

    const request = requestFn(
      {
        host: target.host,
        port: target.port,
        path: `${SERVICE_PATH}/${method}`,
        method: 'POST',
        // Loopback only: the language server presents a self-signed certificate.
        ...(target.scheme === 'https' ? { rejectUnauthorized: false } : {}),
        headers: {
          'content-type': 'application/json',
          'connect-protocol-version': '1',
          'x-codeium-csrf-token': target.token,
          accept: 'application/json',
          'content-length': payload.byteLength,
        },
      },
      (response: http.IncomingMessage) => {
        const chunks: Buffer[] = [];
        let received = 0;
        let overflowed = false;

        response.on('data', (chunk: Buffer) => {
          if (overflowed) {
            return;
          }
          received += chunk.length;
          if (received > maxBytes) {
            overflowed = true;
            response.destroy();
            finish(
              new RpcError(
                'payload_too_large',
                `Response exceeded the ${Math.round(maxBytes / (1024 * 1024))} MB limit`,
                response.statusCode ?? null,
              ),
            );
            return;
          }
          chunks.push(chunk);
        });

        response.on('end', () => {
          if (overflowed) {
            return;
          }
          const status = response.statusCode ?? 0;
          const text = Buffer.concat(chunks).toString('utf8');

          if (status >= 200 && status < 300) {
            if (text.trim().length === 0) {
              finish(null, {} as T);
              return;
            }
            try {
              finish(null, JSON.parse(text) as T);
            } catch {
              finish(new RpcError('protocol', `Malformed JSON response (${text.length} bytes)`, status));
            }
            return;
          }

          finish(new RpcError(mapStatus(status, text), describeEnvelope(status, text), status));
        });

        response.on('error', (error: Error) => {
          finish(new RpcError('network', error.message, response.statusCode ?? null));
        });
      },
    );

    request.on('error', (error: Error) => {
      if (settled) {
        return;
      }
      const code = (error as NodeJS.ErrnoException).code;
      finish(new RpcError(code === 'ECONNREFUSED' || code === 'ECONNRESET' ? 'unavailable' : 'network', error.message));
    });

    timer = setTimeout(() => {
      request.destroy();
      finish(new RpcError('timeout', `Request timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    if (options.signal) {
      if (options.signal.aborted) {
        request.destroy();
        finish(new RpcError('aborted', 'Request aborted'));
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    request.end(payload);
  });
}

function mapStatus(status: number, body: string): RpcErrorCode {
  if (status === 401 || status === 403) {
    return 'unauthorized';
  }
  if (status === 404) {
    return 'not_found';
  }
  if (status === 400 || status === 422) {
    return 'invalid_argument';
  }
  if (status >= 500) {
    return 'unavailable';
  }
  // A Connect endpoint with no matching method answers 501 or a plain 404.
  if (body.includes('"error"') && status === 200) {
    return 'unauthorized';
  }
  return 'network';
}

function describeEnvelope(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      const message = record.message ?? record.error;
      if (typeof message === 'string' && message.length > 0) {
        return truncate(message, 300);
      }
    }
  } catch {
    // Fall through to the raw body.
  }
  const trimmed = body.trim();
  return trimmed.length > 0 ? truncate(trimmed, 300) : `HTTP ${status}`;
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\u2026`;
}

export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  error: RpcError | null;
}

/**
 * Cheap liveness check.
 *
 * `GetUnleashData` is the smallest method the service exposes. A hub answers it
 * with `{}`; the IDE's host bridge answers 401. Any 2xx JSON object is accepted,
 * because requiring a particular body shape would break on the next build.
 */
export async function probeBackend(target: BackendTarget, timeoutMs = 3_000, signal?: AbortSignal): Promise<ProbeResult> {
  const startedAt = Date.now();
  try {
    await callRpc(target, 'GetUnleashData', {}, { timeoutMs, signal });
    return { ok: true, latencyMs: Date.now() - startedAt, error: null };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof RpcError ? error : new RpcError('network', String(error)),
    };
  }
}
