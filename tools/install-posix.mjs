#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import * as net from 'node:net';
import { installPaths, startupDocument } from './platform.mjs';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const label = 'io.github.benedictusrey.antigravity-monitor';
const healthUrl = 'http://127.0.0.1:4599/api/health';

async function health() {
  try { return await fetch(healthUrl, { signal: AbortSignal.timeout(1500) }).then(response => response.json()); }
  catch { return null; }
}

function ownProcess(info) {
  if (info?.service !== 'antigravity-monitor' || !Number.isInteger(info.pid) || info.pid <= 1) return false;
  try {
    const command = execFileSync('/bin/ps', ['-p', String(info.pid), '-o', 'uid=,command='], { encoding: 'utf8' }).trim();
    const match = /^(\d+)\s+([\s\S]+)$/.exec(command);
    return match && Number(match[1]) === process.getuid() && [source, installPaths().runtime].some(folder => match[2].includes(path.join(folder, 'tools', 'monitor-server.mjs')));
  } catch { return false; }
}

async function stopOwnProcess(info) {
  if (!info) return;
  try { process.kill(info.pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
  if (!ownProcess(info)) throw new Error('Port 4599 was not recognized as the monitor. No process was stopped.');
  try { process.kill(info.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  for (let attempt = 0; attempt < 60; attempt++) {
    try { process.kill(info.pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
    await delay(100);
  }
  throw new Error('The monitor did not stop. No runtime files were replaced.');
}

async function portOccupied() {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port: 4599 });
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('Port 4599 did not answer safely. No changes were made.')); });
    socket.once('error', error => { socket.destroy(); error.code === 'ECONNREFUSED' ? resolve(false) : reject(error); });
  });
}

function editorCli(name, candidates) {
  for (const candidate of [...candidates, ...(process.env.PATH || '').split(':').filter(Boolean).map(folder => path.join(folder, name))]) {
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch { /* Try the next location. */ }
  }
  return null;
}

export async function install(options = {}) {
  if (!['darwin', 'linux'].includes(process.platform)) throw new Error('Use Install Antigravity Monitor.cmd on Windows.');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required.');
  const locations = installPaths();
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  const packageFile = path.join(source, `antigravity-monitor-${manifest.version}.vsix`);
  const required = ['package.json', 'LICENSE', 'out/src', 'tools', 'media'];
  if (!options.uninstall) for (const name of required) if (!fs.existsSync(path.join(source, name))) throw new Error(`Missing ${name}. Extract the complete companion ZIP or build from source.`);
  const occupied = await portOccupied();
  const existing = occupied ? await health() : null;
  if (occupied && !ownProcess(existing)) throw new Error('Port 4599 belongs to another service. No changes were made.');
  const uid = process.getuid();
  // Unload supervision before stopping an old process so KeepAlive cannot race the upgrade.
  if (process.platform === 'darwin' && fs.existsSync(locations.autostart)) {
    let loaded = false;
    try { execFileSync('/bin/launchctl', ['print', `gui/${uid}/${label}`], { stdio: 'ignore' }); loaded = true; } catch { /* Not loaded. */ }
    if (loaded) execFileSync('/bin/launchctl', ['bootout', `gui/${uid}`, locations.autostart], { stdio: 'inherit' });
  }
  await stopOwnProcess(existing);
  if (options.uninstall) {
    if (fs.existsSync(locations.autostart)) fs.unlinkSync(locations.autostart);
    console.log(`Startup disabled. Usage, settings, and runtime retained at ${locations.data} and ${locations.runtime}.`);
    return;
  }
  const backup = path.join(locations.data, 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
  if (fs.existsSync(locations.runtime)) {
    fs.mkdirSync(backup, { recursive: true });
    fs.cpSync(locations.runtime, path.join(backup, 'app'), { recursive: true });
    if (fs.existsSync(locations.state)) fs.copyFileSync(locations.state, path.join(backup, 'state.json'));
  }
  fs.mkdirSync(locations.runtime, { recursive: true });
  fs.mkdirSync(locations.data, { recursive: true, mode: 0o700 });
  for (const name of required) fs.cpSync(path.join(source, name), path.join(locations.runtime, name), { recursive: true, force: true });
  const shellQuote = value => "'" + value.replace(/'/g, "'\\''") + "'";
  const launcher = path.join(locations.data, process.platform === 'darwin' ? 'Open Antigravity Monitor.command' : 'open-monitor.sh');
  fs.writeFileSync(launcher, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(path.join(locations.runtime, 'tools', 'monitor-server.mjs'))} "$@"\n`, { mode: 0o700 });
  if (!options.noAutostart) {
    fs.mkdirSync(path.dirname(locations.autostart), { recursive: true });
    if (fs.existsSync(locations.autostart)) {
      fs.mkdirSync(backup, { recursive: true });
      fs.copyFileSync(locations.autostart, path.join(backup, path.basename(locations.autostart)));
    }
    fs.writeFileSync(locations.autostart, startupDocument(process.platform, process.execPath, locations.runtime, locations.data), { mode: 0o600 });
  } else if (fs.existsSync(locations.autostart)) fs.unlinkSync(locations.autostart);
  const failures = [];
  if (!options.noExtensions && fs.existsSync(packageFile)) {
    const editors = [
      ['VS Code', editorCli('code', ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'])],
      ['Antigravity IDE', editorCli('antigravity-ide', ['/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide'])],
    ];
    for (const [name, cli] of editors) {
      if (!cli) { console.log(`${name}: CLI not found; native extension skipped.`); continue; }
      try { execFileSync(cli, ['--install-extension', packageFile, '--force'], { stdio: 'inherit' }); }
      catch { failures.push(name); }
    }
  }
  if (!options.noStart) {
    if (process.platform === 'darwin' && !options.noAutostart) {
      execFileSync('/bin/launchctl', ['enable', `gui/${uid}/${label}`]);
      execFileSync('/bin/launchctl', ['bootstrap', `gui/${uid}`, locations.autostart]);
    } else {
      const stdout = fs.openSync(path.join(locations.data, 'companion.log'), 'a', 0o600);
      const stderr = fs.openSync(path.join(locations.data, 'companion-error.log'), 'a', 0o600);
      try {
        const child = spawn(process.execPath, [path.join(locations.runtime, 'tools', 'monitor-server.mjs'), '--no-open', '--port', '4599'], { cwd: locations.runtime, detached: true, stdio: ['ignore', stdout, stderr] });
        child.unref();
        child.on('error', error => console.error(`Could not start companion: ${error.message}`));
      } finally { fs.closeSync(stdout); fs.closeSync(stderr); }
    }
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const info = await health();
      if (ownProcess(info) && info.version === manifest.version && info.build === manifest.monitorBuild) { ready = true; break; }
      await delay(100);
    }
    if (!ready) throw new Error(`Companion did not become ready. Inspect logs in ${locations.data}.`);
  }
  console.log(`Antigravity Monitor ${manifest.version} installed: ${locations.runtime}`);
  console.log(options.noAutostart ? 'Automatic startup disabled.' : `Startup: ${locations.autostart}`);
  console.log(`Dashboard: http://127.0.0.1:4599\nLauncher: ${launcher}\nReload editor windows after native extension installation.`);
  if (failures.length) throw new Error(`Companion installed; extension installation failed: ${failures.join(', ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const allowed = ['--no-autostart', '--no-extensions', '--no-start', '--uninstall'];
  if (args.some(argument => !allowed.includes(argument))) { console.error(`Options: ${allowed.join(' ')}`); process.exitCode = 1; }
  else await install({ noAutostart: args.includes('--no-autostart'), noExtensions: args.includes('--no-extensions'), noStart: args.includes('--no-start'), uninstall: args.includes('--uninstall') }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
