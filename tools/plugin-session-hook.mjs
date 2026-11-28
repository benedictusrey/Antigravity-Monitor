#!/usr/bin/env node
/**
 * Antigravity Plugin SessionStart hook.
 *
 * Supplies the active local Antigravity Language Server port and CSRF token
 * directly to both the companion (127.0.0.1:4599) and any active MCP App
 * bridge listener in memory so telemetry connects immediately without
 * `--remote-debugging-port=9222` or relaunching Antigravity.
 * Never writes tokens to disk or stdout.
 */

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { statePath } from './state.mjs';

const address = process.env.ANTIGRAVITY_LS_ADDRESS ?? '';
const token = process.env.ANTIGRAVITY_CSRF_TOKEN ?? '';
const companionPort = Number(process.env.ANTIGRAVITY_MONITOR_PORT || 4599);

const match = /^(?:http:\/\/)?(?:127\.0\.0\.1|localhost):(\d{1,5})$/i.exec(address.trim());
const port = match ? Number(match[1]) : 0;

function readBridgePort() {
  try {
    const portFile = path.join(path.dirname(statePath()), 'mcp-bridge-port.txt');
    const raw = fs.readFileSync(portFile, 'utf8').trim();
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : null;
  } catch {
    return null;
  }
}

function postToken(targetPort, payload) {
  return new Promise((resolve) => {
    try {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: targetPort,
          path: '/api/token',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
          },
          timeout: 800,
        },
        (res) => {
          res.resume();
          resolve();
        },
      );
      req.on('error', () => resolve());
      req.on('timeout', () => {
        req.destroy();
        resolve();
      });
      req.end(payload);
    } catch {
      resolve();
    }
  });
}

if (!Number.isInteger(port) || port < 1 || port > 65535 || !token || token.length > 512 || /\s/.test(token)) {
  process.stdout.write('{}');
} else {
  const convId = process.env.ANTIGRAVITY_CONVERSATION_ID;
  const payloadObj =
    typeof convId === 'string' && convId.length > 0 && convId.length <= 200 && !/\s/.test(convId)
      ? { port, token, scheme: 'http', conversationId: convId }
      : { port, token, scheme: 'http' };
  const payload = JSON.stringify(payloadObj);
  const targets = new Set([companionPort]);
  const bridgePort = readBridgePort();
  if (bridgePort) targets.add(bridgePort);
  Promise.all([...targets].map((p) => postToken(p, payload))).finally(() => {
    process.stdout.write('{}');
  });
}
