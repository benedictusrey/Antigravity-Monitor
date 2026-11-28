# Antigravity Monitor v1.4.0

Antigravity Monitor now ships as a native **Antigravity Plugin** (`MCP App` + `SessionStart`/`PreInvocation` auth bridge) alongside **zero-relaunch Antigravity IDE monitoring** (`extensionView` inline composer-footer badge + VSIX companion bridge) so both Antigravity Desktop and Antigravity IDE get live telemetry automatically.

## Highlights

- **Native Antigravity Plugin (`~/.gemini/config/plugins/antigravity-monitor/`):** Installed automatically by the Windows, macOS, and Linux installers (and cleanly removed by the uninstaller). Open **Antigravity Monitor** straight from the side panel or left sidebar on any fresh Antigravity Desktop launch.
- **Zero-relaunch Antigravity IDE monitoring & composer-footer pill:** Reads Antigravity IDE's loopback `extensionView` iframe token (`9223`) without relaunching IDE or invoking prompts, places the inline badge neatly inside `.agy-composer-footer` immediately left of the Send (`→`) button, and projects IDE-specific state into the VSIX extension's status bar and dashboard.
- **Boot-safe companion & native Windows 11 tray flyout:** Supplies memory-only auth via `SessionStart`/`PreInvocation` -> `POST /api/token`, maintains Desktop/IDE `--remote-debugging-port` shortcuts automatically, includes a checkable **Start on Boot** tray toggle and dynamic-height GDI+ flyout (~15 MB RAM, Dark/Light `T`, Refresh `R`, Close `Esc`), and never launches Antigravity Desktop on Windows boot.
- **Clean Windows Uninstaller (`Antigravity Monitor_Uninstaller.exe`):** Prompts for confirmation and cleanly removes the scheduled task, registry startup entry, Start Menu & Startup shortcuts, running tray/companion processes, editor VSIX, Antigravity plugin, and `%LOCALAPPDATA%\Antigravity Monitor`.

## Install

Platform-specific universal packages (**Antigravity-Monitor-1.4.0-windows.zip**, **Antigravity-Monitor-1.4.0-macos.zip**, **Antigravity-Monitor-1.4.0-linux.zip**) and the combined **Antigravity-Monitor-1.4.0-companion.zip** include the runtime, bundled Antigravity plugin, **antigravity-monitor-1.4.0.vsix**, and native installers (`Install Antigravity Monitor.exe` / `.cmd`, `Install Antigravity Monitor.command`, `Install Antigravity Monitor.sh`, `Antigravity Monitor_Uninstaller.exe`) with executable permissions preserved for macOS/Linux. Node.js 22+ is required. Compare hashes against `SHA256SUMS.txt` before installation.

To upgrade an existing installation, extract the v1.4.0 package and run the installer from that folder. It preserves `state.json` (pruned cleanly to a 120-day window) and backups, updates the Antigravity plugin bundle and VSIX, refreshes sign-in entries, and restarts the companion cleanly.

## Things to notice

- **Zero-relaunch telemetry across Desktop & IDE:** Context window, quota pools, `tok/s`, cache hit ratios, threads, models, and settings stay live in both apps without manual intervention; the installer also updates Windows Desktop (`9222`) and IDE (`9223`) shortcuts so inline composer pills attach immediately on fresh starts.
- **Windows launchers:** the EXE launchers are build outputs and are not committed. Run `scripts/build-windows-launchers.ps1` before packaging from source. Downloaded packages already contain them.
- **Unsigned packages and checksums:** verify downloaded archives against `SHA256SUMS.txt` before extracting or running them.

## Verification and limits

Windows verification for this release includes TypeScript compilation, `esbuild` bundling of `media/mcp-app-bridge.js`, **254 / 254** automated unit and integration tests (`npm test`), Impeccable live UI detection (`[]`, 0 errors / 0 warnings), rebuilt Windows launcher/uninstaller/flyout checks at `v1.4.0` metadata, VSIX packaging, live plugin & Antigravity Desktop + Antigravity IDE (`9223` `.agy-composer-footer`) badge verification, and release archive + `SHA256SUMS.txt` generation under `release/v1.4.0/`. Native macOS and Linux runtime execution remain unverified on physical hardware.
