import assert from 'node:assert/strict';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const importModule = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
const load = (file: string) => importModule(pathToFileURL(path.resolve(__dirname, '..', '..', 'tools', file)).href);

test('platform paths follow Windows, macOS, and XDG user data conventions', async () => {
  const { installPaths, configRoot } = await load('platform.mjs');
  const mac = installPaths({}, 'darwin', '/Users/Test User');
  assert.equal(mac.state, '/Users/Test User/Library/Application Support/Antigravity Monitor/state.json');
  assert.equal(mac.runtime, '/Users/Test User/Library/Application Support/Antigravity Monitor/app');
  assert.match(mac.autostart, /Library\/LaunchAgents\/.*\.plist$/);
  const linux = installPaths({ XDG_CONFIG_HOME: '/custom/config', XDG_STATE_HOME: '/custom/state', XDG_DATA_HOME: '/custom/data' }, 'linux', '/home/test');
  assert.equal(linux.autostart, '/custom/config/autostart/antigravity-monitor.desktop');
  assert.equal(linux.state, '/custom/state/antigravity-monitor/state.json');
  assert.equal(linux.runtime, '/custom/data/antigravity-monitor/app');
  assert.equal(installPaths({}, 'linux', '/home/test').state, '/home/test/.local/state/antigravity-monitor/state.json');
  assert.equal(installPaths({ LOCALAPPDATA: 'C:\\Local' }, 'win32', 'C:\\Users\\test').state, 'C:\\Local\\Antigravity Monitor\\state.json');
  assert.equal(configRoot({}, 'win32', 'C:\\Users\\test'), null);
});

test('DevTools port discovery uses the host platform, including custom Linux config roots', async () => {
  const { devtoolsEndpoints } = await load('cdp-badge.mjs');
  const mac = devtoolsEndpoints({}, 'darwin', '/Users/test');
  assert.equal(mac[0].file, '/Users/test/Library/Application Support/Antigravity/DevToolsActivePort');
  assert.deepEqual(mac.map((entry: { app: string }) => entry.app), ['app', 'ide', 'vscode']);
  const linux = devtoolsEndpoints({ XDG_CONFIG_HOME: '/config' }, 'linux', '/home/test');
  assert.equal(linux[0].file, '/config/Antigravity/DevToolsActivePort');
});

test('autostart documents preserve spaces and escape XML or desktop field codes', async () => {
  const { startupDocument, openCommand } = await load('platform.mjs');
  const mac = startupDocument('darwin', '/opt/Node & Tools/node', '/Users/Test User/app', '/Users/Test User/state');
  assert.match(mac, /Node &amp; Tools/);
  assert.match(mac, /<string>\/Users\/Test User\/app\/tools\/monitor-server.mjs<\/string>/);
  assert.match(mac, /<key>RunAtLoad<\/key><true\/>/);
  const linux = startupDocument('linux', '/opt/node bin/node', '/home/100% Test/app', '/state');
  assert.match(linux, /Exec="\/opt\/node bin\/node" "\/home\/100%% Test\/app\/tools\/monitor-server.mjs" --no-open/);
  assert.match(linux, /Terminal=false/);
  assert.match(linux, /Icon=\/home\/100% Test\/app\/media\/icon.png/);
  assert.deepEqual(openCommand('darwin', 'http://127.0.0.1:4599'), { file: '/usr/bin/open', args: ['http://127.0.0.1:4599'] });
  assert.deepEqual(openCommand('linux', 'http://127.0.0.1:4599'), { file: 'xdg-open', args: ['http://127.0.0.1:4599'] });
});
