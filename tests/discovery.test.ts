import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  inferOwner,
  parseFlags,
  parsePosixOutput,
  parseWindowsOutput,
  posixDiscoveryScript,
  toBackendTargets,
  tokenizeCommandLine,
} from '../src/core/discovery';

const HUB_COMMAND =
  'C:\\Users\\me\\.gemini\\bin\\agy.exe --hub --hub-port=55908 --app_data_dir=antigravity --csrf_token=11111111-2222-3333-4444-555555555555';

test('tokenizeCommandLine splits a Windows command line', () => {
  const argv = tokenizeCommandLine(HUB_COMMAND);
  assert.equal(argv.length, 5);
  assert.equal(argv[0], 'C:\\Users\\me\\.gemini\\bin\\agy.exe');
  assert.equal(argv[1], '--hub');
  assert.equal(argv[2], '--hub-port=55908');
});

test('tokenizeCommandLine keeps quoted paths with spaces intact', () => {
  const argv = tokenizeCommandLine('tool --app_data_dir "C:\\Program Files\\Some App" --flag');
  assert.deepEqual(argv, ['tool', '--app_data_dir', 'C:\\Program Files\\Some App', '--flag']);
});

test('tokenizeCommandLine preserves backslashes in unquoted Windows paths', () => {
  const argv = tokenizeCommandLine('C:\\a\\b\\c.exe --x=C:\\deep\\path');
  assert.deepEqual(argv, ['C:\\a\\b\\c.exe', '--x=C:\\deep\\path']);
});

test('parseFlags accepts both equals and space separated forms', () => {
  const flags = parseFlags(['--hub-port=55908', '--csrf_token', 'abcDEF', '--verbose']);
  assert.equal(flags.get('hub-port'), '55908');
  assert.equal(flags.get('csrf_token'), 'abcDEF');
  assert.equal(flags.get('verbose'), '');
});

test('parseFlags lower-cases names but preserves token casing', () => {
  const flags = parseFlags(['--CSRF_TOKEN=MixedCaseToken']);
  assert.equal(flags.get('csrf_token'), 'MixedCaseToken');
});

test('a hub process yields exactly one candidate on its declared port', () => {
  const { targets, notes } = toBackendTargets([
    { pid: 17460, name: 'agy.exe', cmd: HUB_COMMAND, ports: [55908] },
  ]);

  assert.equal(notes.length, 0);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].kind, 'hub');
  assert.equal(targets[0].scheme, 'http');
  assert.equal(targets[0].port, 55908);
  assert.equal(targets[0].token, '11111111-2222-3333-4444-555555555555');
  assert.equal(targets[0].appDataDir, 'antigravity');
});

test('a legacy process yields HTTPS and HTTP candidates for each listening port', () => {
  const cmd =
    'C:\\Programs\\antigravity\\resources\\bin\\language_server.exe --standalone --csrf_token 66666666-7777-8888-9999-aaaaaaaaaaaa --https_server_port 0';
  const { targets } = toBackendTargets([{ pid: 38604, name: 'language_server.exe', cmd, ports: [49261, 50062] }]);

  const identifiers = targets.map((target) => target.id).sort();
  assert.deepEqual(identifiers, ['http:49261', 'http:50062', 'https:49261', 'https:50062']);
  assert.ok(targets.every((target) => target.kind === 'legacy'));
});

test('a process without a token is reported and skipped', () => {
  const { targets, notes } = toBackendTargets([
    { pid: 5, name: 'agy.exe', cmd: 'agy.exe --hub --hub-port=50096', ports: [50096] },
  ]);
  assert.equal(targets.length, 0);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /no usable request token/);
});

test('an out-of-range hub port is rejected rather than probed', () => {
  const { targets, notes } = toBackendTargets([
    { pid: 6, name: 'agy.exe', cmd: 'agy --hub --hub-port=0 --csrf_token=abc', ports: [] },
  ]);
  assert.equal(targets.length, 0);
  assert.ok(notes.some((note) => note.includes('without a usable --hub-port')));
});

test('duplicate candidates are collapsed', () => {
  const { targets } = toBackendTargets([
    { pid: 1, name: 'agy.exe', cmd: 'agy --hub --hub-port=55908 --csrf_token=t', ports: [55908] },
    { pid: 2, name: 'agy.exe', cmd: 'agy --hub --hub-port=55908 --csrf_token=t', ports: [55908] },
  ]);
  assert.equal(targets.length, 1);
});

test('hub candidates are ordered ahead of legacy candidates', () => {
  const { targets } = toBackendTargets([
    { pid: 2, name: 'language_server.exe', cmd: 'ls --csrf_token=t', ports: [50062] },
    { pid: 1, name: 'agy.exe', cmd: 'agy --hub --hub-port=55908 --csrf_token=t', ports: [55908] },
  ]);
  assert.equal(targets[0].kind, 'hub');
});

test('parseWindowsOutput accepts a single object as well as an array', () => {
  const single = parseWindowsOutput(
    '{"pid":17460,"name":"agy.exe","cmd":"agy --hub --hub-port=55908 --csrf_token=t","ports":[55908]}',
  );
  assert.equal(single.length, 1);
  assert.equal(single[0].pid, 17460);
  assert.deepEqual(single[0].ports, [55908]);

  const many = parseWindowsOutput(
    '[{"pid":1,"name":"agy.exe","cmd":"a","ports":[50096]},{"pid":2,"name":"agy.exe","cmd":"b","ports":[55908]}]',
  );
  assert.equal(many.length, 2);
});

test('parseWindowsOutput tolerates empty and malformed output', () => {
  assert.deepEqual(parseWindowsOutput(''), []);
  assert.deepEqual(parseWindowsOutput('[]'), []);
  assert.deepEqual(parseWindowsOutput('not json'), []);
});

test('parsePosixOutput reads the tab separated discovery format', () => {
  const output = '123\t55908,50096\t/usr/local/bin/agy --hub --hub-port=55908 --csrf_token=t\n';
  const processes = parsePosixOutput(output);

  assert.equal(processes.length, 1);
  assert.equal(processes[0].pid, 123);
  assert.deepEqual(processes[0].ports, [55908, 50096]);
  assert.equal(processes[0].name, 'agy');
});

test('POSIX discovery preserves macOS executable paths with spaces and ancestor owners', () => {
  const output = [
    '201\t55908,\t/Applications/Antigravity IDE.app/Contents/Resources/bin/agy --hub --hub-port=55908 --csrf_token=ide-token\tide\tagy',
    '202\t50062,50062,\t/Applications/Antigravity.app/Contents/Resources/bin/language_server_macos_arm64 --csrf_token=app-token\tapp\tlanguage_server_macos_arm64',
    '203\t55909,\t/Users/me/Library/Application Support/Code/extensions/agy --hub --hub-port=55909 --csrf_token=code-token\tvscode\tagy',
  ].join('\n');
  const processes = parsePosixOutput(output);
  assert.deepEqual(processes.map((entry) => entry.name), ['agy', 'language_server_macos_arm64', 'agy']);
  assert.deepEqual(processes[1].ports, [50062]);
  const { targets, notes } = toBackendTargets(processes);
  assert.equal(notes.length, 0);
  assert.equal(targets.find((entry) => entry.port === 55908)?.owner, 'ide');
  assert.equal(targets.find((entry) => entry.port === 55909)?.owner, 'vscode');
  assert.ok(targets.filter((entry) => entry.port === 50062).every((entry) => entry.owner === 'app'));
  assert.ok(targets.every((entry) => entry.host === '127.0.0.1'));
});

test('POSIX discovery accepts Linux socket ports and optional owner-only records', () => {
  const processes = parsePosixOutput(
    '400\t40701,40702,0,65536,junk\t/opt/antigravity/bin/language_server_linux_x64 --csrf_token=linux-token\tapp\n' +
    '401\t40703\t/home/me/.vscode/extensions/agy --hub-port=40703 --csrf_token=hub-token\tvscode\n',
  );
  assert.deepEqual(processes[0].ports, [40701, 40702]);
  assert.equal(processes[0].name, 'language_server_linux_x64');
  const { targets } = toBackendTargets(processes);
  assert.deepEqual(targets.filter((entry) => entry.pid === 400).map((entry) => entry.port).sort(), [40701, 40701, 40702, 40702]);
  assert.equal(targets.find((entry) => entry.pid === 401)?.owner, 'vscode');
});

test('legacy POSIX records recover quoted and unquoted executable paths with spaces', () => {
  const processes = parsePosixOutput(
    '501\t50062\t/Applications/Some App.app/bin/language_server_macos_arm64 --csrf_token=t\n' +
    '502\t50063\t"/Applications/Some App.app/bin/language_server_macos_x64" --csrf_token=t\n',
  );
  assert.deepEqual(processes.map((entry) => entry.name), ['language_server_macos_arm64', 'language_server_macos_x64']);
  assert.equal(toBackendTargets(processes).targets.length, 4);
});

test('POSIX script separates process paths from args and falls back after empty lsof output', () => {
  const script = posixDiscoveryScript();
  assert.match(script, /ps -axo pid=,ppid=,comm=/);
  assert.match(script, /ps -p "\$pid" -o args=/);
  assert.match(script, /current=parent\[current\]/);
  assert.match(script, /depth<12/);
  assert.match(script, /antigravity\[ -\]ide/);
  assert.match(script, /visual studio code/);
  assert.match(script, /if \[ -z "\$ports" \] && command -v ss/);
  assert.match(script, /lsof .* -Fn/);
  assert.match(script, /index\(\$0, "pid=" pid ","\)/);
  assert.doesNotMatch(script, /sub\(\/\^\.\*\/\//, 'awk pathname regex must survive JavaScript escaping');
});

test('the owning app resolved by the parent walk is carried onto every candidate', () => {
  const { targets } = toBackendTargets([
    {
      pid: 38604,
      name: 'language_server.exe',
      cmd: 'language_server.exe --csrf_token=t --https_server_port 0',
      ports: [50062],
      owner: 'app',
    },
    { pid: 39872, name: 'agy.exe', cmd: 'agy --hub --hub-port=50096 --csrf_token=t', ports: [50096], owner: 'ide' },
  ]);

  assert.equal(targets.find((target) => target.pid === 38604)?.owner, 'app');
  assert.equal(targets.find((target) => target.pid === 39872)?.owner, 'ide');
});

test('a missing owner falls back to the process name', () => {
  const { targets } = toBackendTargets([
    { pid: 1, name: 'agy.exe', cmd: 'agy --hub --hub-port=50096 --csrf_token=t', ports: [50096] },
    { pid: 2, name: 'language_server.exe', cmd: 'ls --csrf_token=t', ports: [50062] },
    { pid: 3, name: 'mystery.exe', cmd: 'x --hub-port=50097 --csrf_token=t', ports: [50097] },
  ]);

  assert.equal(targets.find((target) => target.pid === 1)?.owner, 'unknown');
  assert.equal(targets.find((target) => target.pid === 2)?.owner, 'app');
  assert.equal(targets.find((target) => target.pid === 3)?.owner, 'unknown');
});

test('inferOwner only commits when the process name is recognisable', () => {
  assert.equal(inferOwner('agy.exe'), 'unknown', 'agy is spawned by both the IDE and VS Code');
  assert.equal(inferOwner('language_server.exe'), 'app');
  assert.equal(inferOwner('Antigravity.exe'), 'unknown');
  assert.equal(inferOwner(''), 'unknown');
});

test('parseWindowsOutput accepts the owner produced by the discovery script', () => {
  const processes = parseWindowsOutput(
    '[{"pid":38604,"name":"language_server.exe","cmd":"ls","ports":[50062],"owner":"app"},' +
      '{"pid":17460,"name":"agy.exe","cmd":"agy","ports":[55908],"owner":"vscode"},' +
      '{"pid":39872,"name":"agy.exe","cmd":"agy","ports":[50096],"owner":"nonsense"}]',
  );

  assert.equal(processes[0].owner, 'app');
  assert.equal(processes[1].owner, 'vscode');
  assert.equal(processes[2].owner, undefined, 'unrecognised owners are dropped, not guessed');
});
