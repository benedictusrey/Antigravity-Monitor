import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { callRpc, BackendTarget } from '../src/core/rpc';
import { createVscodeMock, installVscodeMock } from './vscode-mock';

function request(url: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ ok: boolean; status: number; json(): unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ ok: response.statusCode === 200, status: response.statusCode!, json: () => JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

test('RPC rejects non-loopback destinations for both transports before sending credentials', async () => {
  for (const scheme of ['http', 'https'] as const) {
    const target: BackendTarget = { id: 'test', kind: 'legacy', scheme, host: 'example.com', port: 80, token: 'not-a-real-token', pid: null, appDataDir: null, owner: 'unknown' };
    await assert.rejects(callRpc(target, 'GetUserStatus'), /non-loopback/);
  }
});

test('native usage writes preserve the prior JSON when atomic replacement fails', async () => {
  installVscodeMock(createVscodeMock());
  const { Store } = require('../src/app/store') as typeof import('../src/app/store');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-atomic-'));
  const file = path.join(folder, 'usage.json');
  const previous = JSON.stringify({ version: 1, buckets: {} });
  fs.writeFileSync(file, previous);
  const store = new Store({ globalStorageUri: { fsPath: folder } } as never);
  store.recordUsage({ day: '2026-11-06', modelId: 'unknown', input: 10, cacheRead: 0, cacheCreate: 0, output: 2 });
  const nativeFs = require('node:fs') as typeof fs;
  const rename = nativeFs.renameSync;
  try {
    nativeFs.renameSync = () => { throw new Error('replacement denied'); };
    await store.flush();
    assert.equal(fs.readFileSync(file, 'utf8'), previous);
    nativeFs.renameSync = rename;
    await store.flush();
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).buckets['2026-11-06|unknown'].input, 10);
  } finally {
    nativeFs.renameSync = rename;
    store.dispose();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  child.kill();
  await exited;
}

test('companion HTTP boundaries survive bad requests and custom settings survive process restart', { timeout: 25_000 }, async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-e2e-'));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const root = path.resolve(__dirname, '..', '..');
  let child: ChildProcess | null = null;
  async function start(): Promise<void> {
    child = spawn(process.execPath, [path.join(root, 'tools', 'monitor-server.mjs'), '--no-open', '--no-badge', '--port', String(port)], { cwd: root, env: { ...process.env, LOCALAPPDATA: folder, HOME: folder, XDG_STATE_HOME: folder }, windowsHide: true, stdio: 'ignore' });
    for (let attempt = 0; attempt < 80; attempt++) {
      try { if ((await request(`${origin}/api/health`)).ok) return; } catch { /* Wait for the listener. */ }
      if (child.exitCode !== null) throw new Error('Companion exited before ready');
      await delay(100);
    }
    throw new Error('Companion did not start');
  }
  try {
    await start();
    const forbiddenHost = await new Promise<number>(resolve => {
      http.get(`${origin}/api/snapshot`, { headers: { Host: `attacker.invalid:${port}` } }, response => { response.resume(); resolve(response.statusCode!); });
    });
    assert.equal(forbiddenHost, 403);
    const malformedUrl = await new Promise<number>(resolve => {
      const req = http.request({ host: '127.0.0.1', port, path: 'http://[', headers: { Host: `127.0.0.1:${port}` } }, response => { response.resume(); resolve(response.statusCode!); });
      req.end();
    });
    assert.equal(malformedUrl, 400);
    assert.equal((await request(`${origin}/media/`)).status, 404);
    assert.equal((await request(`${origin}/media/missing.js`)).status, 404);
    assert.equal((await request(`${origin}/api/health`)).status, 200, 'invalid asset requests cannot crash the service');
    assert.equal((await request(`${origin}/api/command`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://attacker.invalid' }, body: '{}' })).status, 403);
    assert.equal((await request(`${origin}/api/command`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);
    for (const [key, value] of [['displayMode', 'custom'], ['snippetFiveHour', true], ['snippetWeekly', true], ['snippetResets', true]] as const) {
      assert.equal((await request(`${origin}/api/command`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ type: 'updateSetting', key, value }) })).status, 204);
    }
    const file = process.platform === 'win32' ? path.join(folder, 'Antigravity Monitor', 'state.json')
      : process.platform === 'darwin' ? path.join(folder, 'Library', 'Application Support', 'Antigravity Monitor', 'state.json')
      : path.join(folder, 'antigravity-monitor', 'state.json');
    for (let attempt = 0; attempt < 60 && !fs.existsSync(file); attempt++) await delay(100);
    const config = JSON.parse(fs.readFileSync(file, 'utf8')).config;
    assert.equal(config.displayMode, 'custom');
    assert.equal(config.snippetWeekly, true);
    assert.equal(config.snippetFiveHour, true);
    await stop(child!);
    await start();
    const data = await request(`${origin}/api/snapshot`).then(response => response.json()) as { snapshot: { prefs: Record<string, unknown> } };
    assert.equal(data.snapshot.prefs.displayMode, 'custom');
    assert.equal(data.snapshot.prefs.snippetWeekly, true);
    assert.equal(data.snapshot.prefs.snippetResets, true);
  } finally {
    if (child) await stop(child);
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
