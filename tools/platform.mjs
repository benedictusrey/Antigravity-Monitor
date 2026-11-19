import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function configRoot(env = process.env, platform = process.platform, home = os.homedir()) {
  if (platform === 'win32') return env.APPDATA || null;
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support');
  return env.XDG_CONFIG_HOME || path.posix.join(home, '.config');
}

export function installPaths(env = process.env, platform = process.platform, home = os.homedir()) {
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  const data = platform === 'win32' ? join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Antigravity Monitor')
    : platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Antigravity Monitor')
    : join(env.XDG_STATE_HOME || join(home, '.local', 'state'), 'antigravity-monitor');
  const runtime = platform === 'linux' ? join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'antigravity-monitor', 'app') : join(data, 'app');
  const autostart = platform === 'darwin' ? join(home, 'Library', 'LaunchAgents', 'io.github.benedictusrey.antigravity-monitor.plist')
    : platform === 'linux' ? join(configRoot(env, platform, home), 'autostart', 'antigravity-monitor.desktop') : null;
  return { data, runtime, state: join(data, 'state.json'), autostart };
}

export function openCommand(platform, url) {
  if (platform === 'darwin') return { file: '/usr/bin/open', args: [url] };
  if (platform === 'linux') return { file: 'xdg-open', args: [url] };
  return { file: 'cmd', args: ['/c', 'start', '', url] };
}

function xml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

export function startupDocument(platform, node, runtime, data) {
  if (platform === 'darwin') {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>io.github.benedictusrey.antigravity-monitor</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(path.posix.join(runtime, 'tools', 'monitor-server.mjs'))}</string><string>--no-open</string><string>--port</string><string>4599</string></array>
<key>WorkingDirectory</key><string>${xml(runtime)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>5</integer>
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(path.posix.join(data, 'companion.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.posix.join(data, 'companion-error.log'))}</string>
</dict></plist>\n`;
  }
  // Desktop Entry Exec quoting also needs to protect field codes and shell metacharacters.
  const quote = value => '"' + String(value).replace(/[%]/g, '%%').replace(/[\\"`$]/g, '\\$&') + '"';
  return `[Desktop Entry]\nType=Application\nName=Antigravity Monitor\nComment=Local context and quota monitor\nIcon=${path.posix.join(runtime, 'media', 'icon.png')}\nExec=${quote(node)} ${quote(path.posix.join(runtime, 'tools', 'monitor-server.mjs'))} --no-open --port 4599\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`;
}

export function antigravityInstallCandidates(env = process.env, platform = process.platform, home = os.homedir()) {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local');
    const prog = env.ProgramFiles || 'C:\\Program Files';
    return [
      path.win32.join(local, 'Programs', 'antigravity', 'Antigravity.exe'),
      path.win32.join(local, 'Programs', 'Antigravity', 'Antigravity.exe'),
      path.win32.join(prog, 'Antigravity', 'Antigravity.exe'),
    ];
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Antigravity.app',
      path.posix.join(home, 'Applications', 'Antigravity.app'),
    ];
  }
  return [
    '/usr/share/antigravity/antigravity',
    '/opt/antigravity/antigravity',
    path.posix.join(env.XDG_DATA_HOME || path.posix.join(home, '.local', 'share'), 'antigravity', 'antigravity'),
  ];
}

function readShortText(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function readPlistVersion(plistFile) {
  const xmlText = readShortText(plistFile);
  if (!xmlText) return null;
  const match = xmlText.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/i);
  return match ? match[1].trim() || null : null;
}

function readPackageVersion(pkgFile) {
  const raw = readShortText(pkgFile);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.version === 'string' && parsed.version.trim() ? parsed.version.trim() : null;
  } catch {
    return null;
  }
}

export function readAntigravityBuild(candidates = antigravityInstallCandidates(), platform = process.platform) {
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if ((platform === 'darwin' || candidate.endsWith('.app')) && stat.isDirectory()) {
        const plist = path.join(candidate, 'Contents', 'Info.plist');
        const bin = [path.join(candidate, 'Contents', 'MacOS', 'Antigravity'), path.join(candidate, 'Contents', 'MacOS', 'Electron')]
          .find((file) => fs.existsSync(file));
        const version = readPlistVersion(plist) ?? readPackageVersion(path.join(candidate, 'Contents', 'Resources', 'app', 'package.json'));
        const refStat = bin ? fs.statSync(bin) : fs.existsSync(plist) ? fs.statSync(plist) : stat;
        if (!version && !bin) continue;
        return {
          appRoot: candidate,
          exePath: bin || candidate,
          version,
          signature: `${version ?? ''}:${Math.trunc(refStat.mtimeMs)}:${refStat.size}`,
        };
      }
      if (!stat.isFile()) continue;
      const appRoot = path.dirname(candidate);
      const versionLine = readShortText(path.join(appRoot, 'version'))?.split(/\r?\n/, 1)[0]?.trim() || null;
      const version = versionLine ?? readPackageVersion(path.join(appRoot, 'resources', 'app', 'package.json'));
      return {
        appRoot,
        exePath: candidate,
        version,
        signature: `${version ?? ''}:${Math.trunc(stat.mtimeMs)}:${stat.size}`,
      };
    } catch {
      // Candidate not installed or transiently inaccessible during update.
    }
  }
  return null;
}

export function detectAntigravityUpdate(previous, current) {
  if (!current) {
    return { changed: false, next: previous ?? null, previousVersion: null, version: null };
  }
  const next = { version: current.version ?? null, signature: current.signature };
  if (!previous || typeof previous.signature !== 'string' || !previous.signature) {
    return { changed: false, next, previousVersion: null, version: next.version };
  }
  if (previous.signature === current.signature) {
    return { changed: false, next: previous, previousVersion: null, version: next.version };
  }
  return {
    changed: true,
    next,
    previousVersion: previous.version ?? null,
    version: next.version,
  };
}

export function applyAppUpdateCheck(knownBuild, currentNotice, currentBuild, now = Date.now()) {
  const diff = detectAntigravityUpdate(knownBuild, currentBuild);
  if (!diff.changed) {
    return { knownBuild: diff.next, notice: currentNotice, notify: false, settle: false };
  }
  // Multi-file updates can land version and binary separately; keep the original previousVersion and don't double-fire.
  if (currentNotice && diff.version && diff.version === diff.previousVersion) {
    return { knownBuild: diff.next, notice: currentNotice, notify: false, settle: true };
  }
  return {
    knownBuild: diff.next,
    notice: { version: diff.version, previousVersion: diff.previousVersion, detectedAt: now },
    notify: true,
    settle: true,
    previousVersion: diff.previousVersion,
    version: diff.version,
  };
}
