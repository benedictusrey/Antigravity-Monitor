import assert from 'node:assert/strict';
import * as http from 'node:http';
import { test } from 'node:test';

import { BackendTarget, callRpc, RpcError } from '../src/core/rpc';

function serve(handler: http.RequestListener): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port }));
  });
}

function target(port: number, token: string | null): BackendTarget {
  return { id: `http:${port}`, kind: 'legacy', scheme: 'http', host: '127.0.0.1', port, token, pid: null, appDataDir: null, owner: 'app' };
}

test('a target without a token sends no CSRF header, and a 401 becomes an unauthorized error', async () => {
  const headers: Array<string | undefined> = [];
  const { server, port } = await serve((request, response) => {
    headers.push(request.headers['x-codeium-csrf-token'] as string | undefined);
    response.writeHead(401).end();
  });
  try {
    await assert.rejects(callRpc(target(port, null), 'GetUnleashData', {}), (error: unknown) => error instanceof RpcError && error.code === 'unauthorized');
    assert.deepEqual(headers, [undefined]);
  } finally {
    server.close();
  }
});

test('a target with a token still sends it', async () => {
  let header: string | undefined;
  const { server, port } = await serve((request, response) => {
    header = request.headers['x-codeium-csrf-token'] as string | undefined;
    response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
  try {
    await callRpc(target(port, 'token-for-test'), 'GetUnleashData', {});
    assert.equal(header, 'token-for-test');
  } finally {
    server.close();
  }
});
