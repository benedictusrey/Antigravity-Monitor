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
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(path.posix.join(data, 'companion.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.posix.join(data, 'companion-error.log'))}</string>
</dict></plist>\n`;
  }
  // Desktop Entry Exec quoting also needs to protect field codes and shell metacharacters.
  const quote = value => '"' + String(value).replace(/[%]/g, '%%').replace(/[\\"`$]/g, '\\$&') + '"';
  return `[Desktop Entry]\nType=Application\nName=Antigravity Monitor\nComment=Local context and quota monitor\nIcon=${path.posix.join(runtime, 'media', 'icon.png')}\nExec=${quote(node)} ${quote(path.posix.join(runtime, 'tools', 'monitor-server.mjs'))} --no-open --port 4599\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`;
}
