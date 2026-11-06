# Antigravity Monitor user guide

This guide covers v1.0.0. The white desktop app uses a separate companion. Antigravity IDE and VS Code can also run the native extension.

## Install and update

Extract the complete companion ZIP. Install Node.js 22 or newer, then run the installer for your platform from that folder. Windows uses `Install Antigravity Monitor.cmd`; macOS uses `sh "Install Antigravity Monitor.command"`; Linux uses `sh "Install Antigravity Monitor.sh"`.

The installer copies a stable runtime, preserves settings, creates startup integration, and starts the companion. Re-run it to update an existing installation. It identifies the monitor before stopping a process on port 4599 and saves the previous runtime as a backup. Do not run it with administrator or sudo privileges.

Native editor extension installation depends on finding the editor CLI. If skipped, use **Extensions: Install from VSIX** inside the editor and select `antigravity-monitor-1.0.0.vsix`. Reload editor windows after installation.

macOS and Linux installation code is included, with native platform acceptance still pending. macOS installation requires a logged-in graphical session for the user LaunchAgent. Linux startup requires a desktop session that supports XDG autostart; it is not a system service.

Windows users can open **Install Antigravity Monitor.exe** for installation and **Antigravity Monitor.exe** for the dashboard. These branded launchers call the readable commands beside them; keep the package together. Installation adds a branded Start Menu shortcut. For a custom VSIX path, use the existing .cmd argument support; the EXE uses the package beside it.

## Enable the inline badge

The companion looks for `DevToolsActivePort` beneath the app's normal user configuration directory. If the white app already exposes this endpoint, the badge attaches automatically. Closing and reopening the app is supported while the companion stays running.

If no endpoint is available, quit the app normally and relaunch it with a loopback remote-debugging port. On macOS, for an app named Antigravity:

```sh
open -a Antigravity --args --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1
```

On Linux, launch the actual white desktop executable with those same arguments. The executable name and installation path depend on its distribution. IDE and VS Code badges each need their own port, such as 9223 and 9224. An already-running Electron app may ignore new launch arguments.

For endpoints outside the standard port-file paths, start the companion manually:

```sh
node tools/monitor-server.mjs --no-open --cdp-port 9222,9223,9224
```

Do not run a second companion alongside the installed instance. Stop the installed instance before using alternate command-line settings. Never expose DevTools to a network interface; it grants control over local app pages.

## Read the monitor

The small composer snippet opens the detail card. The card shows the visible conversation, measured or estimated context, the model, both quota windows, reset countdowns, and freshness. **New thread** means there is no response context to measure yet. **Waiting** means the current selection has not been measured; it does not mean zero usage.

The model that produced a measured response stays attached to its token count. If you select another model for the next response, the badge chooses that model's quota group separately.

Quotas normally refresh every five seconds. A failed request or an observation older than 12 seconds is marked cached. Values older than 30 seconds or past reset become unavailable. Retry delays increase to 10, 20, and 30 seconds after failures. Opening Antigravity's Usage menu is not required.

## Customize the snippet

Expand **Customize snippet** in the card, or open **Settings** in the companion dashboard. Choose any of these fields:

| Field | Display |
|---|---|
| Context used | Current context percentage or token count. |
| Context remaining | Tokens left in the measured context window. |
| 5-hour quota | Remaining allowance for the selected model group. |
| Weekly quota | Remaining weekly allowance for that group. |
| Model name | Model identity. |
| Reset countdowns | Reset times beside selected quota fields. |

Changing a field enables Custom mode. Essentials shows the core context reading; Full adds remaining context. Hiding all fields leaves a **Monitor** button. Changes preview immediately; allow a few seconds for the companion's debounced disk save before terminating it forcibly.

Native editor settings apply to that editor's status bar. They are separate from companion preferences.

## Dashboard

- **Overview:** context, quota windows, connected apps, token breakdown, growth, and locally observed usage.
- **Sessions:** conversation summaries. Selecting a session measures it in the dashboard.
- **Models:** model capacities and available quotas.
- **Settings:** display preferences, thresholds, response limits, backend selection, and local diagnostics.

Use arrow keys to move between tabs. The inline card closes with Escape or an outside click. Refresh requests fresh readings; context changes only when the conversation changes.

## Storage and startup

| Platform | Data | Runtime | Startup |
|---|---|---|---|
| Windows | `%LOCALAPPDATA%\Antigravity Monitor` | `app` beneath data | Windows Startup shortcut. |
| macOS | `~/Library/Application Support/Antigravity Monitor` | `app` beneath data | `~/Library/LaunchAgents/io.github.benedictusrey.antigravity-monitor.plist`. |
| Linux | `$XDG_STATE_HOME/antigravity-monitor` or `~/.local/state/antigravity-monitor` | `$XDG_DATA_HOME/antigravity-monitor/app` or `~/.local/share/antigravity-monitor/app` | `$XDG_CONFIG_HOME/autostart/antigravity-monitor.desktop` or `~/.config/autostart/antigravity-monitor.desktop`. |

Data includes `state.json`, logs, and upgrade backups. Native editors keep their own settings and usage in their extension storage. Moving or removing Node.js can break an installed startup entry; re-run the installer afterward.

On macOS/Linux, use `node tools/install-posix.mjs --no-autostart` to install without startup integration. Other options are `--no-extensions`, `--no-start`, and `--uninstall`. Uninstall stops the identified companion and removes its startup entry while retaining data and runtime for manual recovery. Remove native editor extensions through their Extensions view separately.

On Windows, remove the **Antigravity Monitor** Startup shortcut to disable future automatic launches. Stop the identified companion process before removing its runtime. Keep `state.json` and backups if you want to retain usage and preferences.

## Troubleshooting

| Problem | Check |
|---|---|
| No badge | Companion health, the app's DevTools endpoint, and the selected debug port. Native status bars do not need DevTools. |
| No backend | Start the app and open its agent UI. On Linux check `lsof` or `ss` availability and process permissions. |
| Quota unavailable | Backend connectivity, supported quota RPC, and whether the selected model maps to a known group. Refresh retries immediately. |
| Port 4599 occupied | Identify the existing service. Installers refuse unrelated owners; do not kill an unknown process. |
| New settings do not survive | Allow the save debounce to finish, check write permissions and logs, then retry. |
| Native extension still looks old | Reload that editor's window after installation. |
| macOS/Linux startup missing | Confirm a graphical user session, the startup file, the absolute Node path, and logs. Native acceptance is still pending. |

See [SUPPORT.md](SUPPORT.md) for a useful bug report and [PRIVACY.md](PRIVACY.md) before sharing diagnostics.
