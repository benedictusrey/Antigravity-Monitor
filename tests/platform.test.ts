import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
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
  assert.deepEqual(mac.map((entry: { app: string }) => entry.app), ['app', 'ide', 'vscode', 'vscode']);
  const linux = devtoolsEndpoints({ XDG_CONFIG_HOME: '/config' }, 'linux', '/home/test');
  assert.equal(linux[0].file, '/config/Antigravity/DevToolsActivePort');
  assert.equal(linux[3].file, '/config/Code - Insiders/DevToolsActivePort');
});

test('autostart documents preserve spaces and escape XML or desktop field codes', async () => {
  const { startupDocument, openCommand } = await load('platform.mjs');
  const mac = startupDocument('darwin', '/opt/Node & Tools/node', '/Users/Test User/app', '/Users/Test User/state');
  assert.match(mac, /Node &amp; Tools/);
  assert.match(mac, /<string>\/Users\/Test User\/app\/tools\/monitor-server.mjs<\/string>/);
  assert.match(mac, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(mac, /<key>ThrottleInterval<\/key><integer>5<\/integer>/);
  const linux = startupDocument('linux', '/opt/node bin/node', '/home/100% Test/app', '/state');
  assert.match(linux, /Exec="\/opt\/node bin\/node" "\/home\/100%% Test\/app\/tools\/monitor-server.mjs" --no-open/);
  assert.match(linux, /Terminal=false/);
  assert.match(linux, /Icon=\/home\/100% Test\/app\/media\/icon.png/);
  assert.deepEqual(openCommand('darwin', 'http://127.0.0.1:4599'), { file: '/usr/bin/open', args: ['http://127.0.0.1:4599'] });
  assert.deepEqual(openCommand('linux', 'http://127.0.0.1:4599'), { file: 'xdg-open', args: ['http://127.0.0.1:4599'] });
});

test('POSIX shell scripts use LF line endings and share nvm fallback discovery', () => {
  const root = path.resolve(__dirname, '..', '..');
  for (const file of ['Antigravity Monitor.sh', 'Install Antigravity Monitor.sh', 'Install Antigravity Monitor.command']) {
    const raw = fs.readFileSync(path.join(root, file), 'utf8');
    assert.equal(raw.includes('\r\n'), false, `${file} must use LF line endings`);
  }
  for (const file of ['Antigravity Monitor.sh', 'Install Antigravity Monitor.sh']) {
    const raw = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(raw, /\.nvm\/versions\/node\/\*\/bin\/node/, `${file} must search nvm installations`);
  }
  const commandLauncher = fs.readFileSync(path.join(root, 'Install Antigravity Monitor.command'), 'utf8');
  assert.match(commandLauncher, /Install Antigravity Monitor\.sh/, 'macOS launcher must delegate to Install Antigravity Monitor.sh');
});

test('POSIX installer rejects missing explicit --vsix and cleans Linux desktop entries on uninstall', async () => {
  const { resolveVsixFile, removeStartupEntries } = await load('install-posix.mjs');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-posix-test-'));
  try {
    assert.throws(
      () => resolveVsixFile(tempRoot, '1.2.0', path.join(tempRoot, 'missing.vsix')),
      /VSIX package not found/,
    );
    const autostart = path.join(tempRoot, 'autostart.desktop');
    const appDir = path.join(tempRoot, 'xdg-data', 'applications');
    fs.mkdirSync(appDir, { recursive: true });
    const desktopApp = path.join(appDir, 'antigravity-monitor.desktop');
    fs.writeFileSync(autostart, '[Desktop Entry]\n');
    fs.writeFileSync(desktopApp, '[Desktop Entry]\n');
    removeStartupEntries(
      { autostart },
      'linux',
      { XDG_DATA_HOME: path.join(tempRoot, 'xdg-data') },
      tempRoot,
    );
    assert.equal(fs.existsSync(autostart), false);
    assert.equal(fs.existsSync(desktopApp), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('setZipUnixPermissions writes UNIX creator, 0755 modes, and forward slashes in LFH and CD headers', async () => {
  const { setZipUnixPermissions } = await importModule(
    pathToFileURL(path.resolve(__dirname, '..', '..', 'scripts', 'set-zip-permissions.mjs')).href,
  );
  const nameA = Buffer.from('dir\\Install Antigravity Monitor.command', 'utf8');
  const nameB = Buffer.from('dir\\README.md', 'utf8');
  const localHeader = (name: Buffer): Buffer => {
    const rec = Buffer.alloc(30 + name.length);
    rec.writeUInt32LE(0x04034b50, 0);
    rec.writeUInt16LE(name.length, 26);
    name.copy(rec, 30);
    return rec;
  };
  const header = (name: Buffer, offset: number): Buffer => {
    const rec = Buffer.alloc(46 + name.length);
    rec.writeUInt32LE(0x02014b50, 0);
    rec.writeUInt16LE(20, 4);
    rec.writeUInt16LE(name.length, 28);
    rec.writeUInt32LE(offset, 42);
    name.copy(rec, 46);
    return rec;
  };
  const lfhA = localHeader(nameA);
  const lfhB = localHeader(nameB);
  const cdOffset = lfhA.length + lfhB.length;
  const cd = Buffer.concat([header(nameA, 0), header(nameB, lfhA.length)]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(2, 8);
  eocd.writeUInt16LE(2, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-zip-test-'));
  const zipPath = path.join(tempRoot, 'sample.zip');
  try {
    fs.writeFileSync(zipPath, Buffer.concat([lfhA, lfhB, cd, eocd]));
    setZipUnixPermissions(zipPath);
    const patched = fs.readFileSync(zipPath);
    assert.equal(patched.subarray(30, 30 + nameA.length).toString('utf8'), 'dir/Install Antigravity Monitor.command');
    assert.equal(patched.readUInt16LE(cdOffset + 4) >> 8, 3);
    assert.equal(patched.readUInt32LE(cdOffset + 38) >>> 16, 0o100755);
    assert.equal(patched.subarray(cdOffset + 46, cdOffset + 46 + nameA.length).toString('utf8'), 'dir/Install Antigravity Monitor.command');
    const secondOffset = cdOffset + 46 + nameA.length;
    assert.equal(patched.readUInt16LE(secondOffset + 4) >> 8, 3);
    assert.equal(patched.readUInt32LE(secondOffset + 38) >>> 16, 0o100644);
    assert.equal(patched.subarray(secondOffset + 46, secondOffset + 46 + nameB.length).toString('utf8'), 'dir/README.md');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Antigravity build detector reads install binaries and handles multi-file updates', async () => {
  const { antigravityInstallCandidates, applyAppUpdateCheck, detectAntigravityUpdate, readAntigravityBuild } = await load('platform.mjs');
  const winCandidates = antigravityInstallCandidates({ LOCALAPPDATA: 'C:\\Local', ProgramFiles: 'C:\\Program Files' }, 'win32', 'C:\\Users\\test');
  assert.equal(winCandidates[0], 'C:\\Local\\Programs\\antigravity\\Antigravity.exe');
  const macCandidates = antigravityInstallCandidates({}, 'darwin', '/Users/test');
  assert.equal(macCandidates[0], '/Applications/Antigravity.app');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-app-update-'));
  try {
    const exe = path.join(tempRoot, 'Antigravity.exe');
    const ver = path.join(tempRoot, 'version');
    fs.writeFileSync(exe, 'v1-binary');
    fs.writeFileSync(ver, '44.9.1\n');
    const firstBuild = readAntigravityBuild([exe]);
    assert.equal(firstBuild?.version, '44.9.1');

    const initialCheck = detectAntigravityUpdate(null, firstBuild);
    assert.equal(initialCheck.changed, false);
    assert.equal(initialCheck.next?.version, '44.9.1');

    const sameCheck = detectAntigravityUpdate(initialCheck.next, readAntigravityBuild([exe]));
    assert.equal(sameCheck.changed, false);

    // Step 1 of multi-file update: version file changes before binary finishes swapping.
    fs.writeFileSync(ver, '45.0.0\n');
    const partialBuild = readAntigravityBuild([exe]);
    const step1 = applyAppUpdateCheck(initialCheck.next, null, partialBuild, 1000);
    assert.equal(step1.notify, true);
    assert.equal(step1.notice?.previousVersion, '44.9.1');
    assert.equal(step1.notice?.version, '45.0.0');

    // Step 2: binary replacement lands right after; must keep original previousVersion and avoid duplicate notification.
    fs.writeFileSync(exe, 'v2-updated-binary-longer');
    const step2 = applyAppUpdateCheck(step1.knownBuild, step1.notice, readAntigravityBuild([exe]), 2000);
    assert.equal(step2.notify, false);
    assert.equal(step2.settle, true);
    assert.equal(step2.notice?.previousVersion, '44.9.1');
    assert.equal(step2.notice?.version, '45.0.0');

    // Once previous notice cleared (badge attached), a hotfix with the same version still notifies once.
    fs.writeFileSync(exe, 'v2-hotfix-binary-even-longer');
    const step3 = applyAppUpdateCheck(step2.knownBuild, null, readAntigravityBuild([exe]), 3000);
    assert.equal(step3.notify, true);

    const appBundle = path.join(tempRoot, 'Antigravity.app');
    fs.mkdirSync(path.join(appBundle, 'Contents', 'MacOS'), { recursive: true });
    fs.writeFileSync(path.join(appBundle, 'Contents', 'MacOS', 'Antigravity'), 'macho');
    fs.writeFileSync(path.join(appBundle, 'Contents', 'Info.plist'), '<dict><key>CFBundleShortVersionString</key><string>46.1.0</string></dict>');
    assert.equal(readAntigravityBuild([appBundle], 'darwin')?.version, '46.1.0');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Windows startup helper and installer configure fallback Node resolution, Scheduled Task, shortcuts, and valid PowerShell syntax', () => {
  const root = path.resolve(__dirname, '..', '..');
  const starterFile = path.join(root, 'tools', 'start-companion.ps1');
  const installerFile = path.join(root, 'tools', 'install-windows.ps1');
  const starter = fs.readFileSync(starterFile, 'utf8');
  const installer = fs.readFileSync(installerFile, 'utf8');
  assert.match(starter, /Get-Command node\.exe/);
  assert.match(starter, /\[switch\]\$Supervise/);
  assert.match(installer, /\[switch\]\$Uninstall/);
  assert.match(installer, /\[switch\]\$RefreshShortcuts/);
  assert.match(installer, /Save-MonitorLaunchShortcuts/);
  assert.match(installer, /Register-ScheduledTask/);
  assert.match(installer, /-Supervise/);
  assert.match(installer, /-RestartCount 3/);
  if (process.platform === 'win32') {
    const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    for (const file of [starterFile, installerFile]) {
      const escaped = file.replace(/'/g, "''");
      const output = execFileSync(
        ps,
        [
          '-NoProfile',
          '-Command',
          `$errors = $null; $null = [System.Management.Automation.Language.Parser]::ParseFile('${escaped}', [ref]$null, [ref]$errors); if ($errors.Count) { throw ($errors | Out-String) }`,
        ],
        { encoding: 'utf8' },
      );
      assert.equal(output.trim(), '');
    }
  }
});
