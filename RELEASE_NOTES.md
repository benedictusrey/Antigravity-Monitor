# Antigravity Monitor v1.3.0

Antigravity Monitor keeps context usage, model quotas, and the active conversation thread on screen within reach. The white desktop app uses a background companion that starts at sign-in without a console window and recognizes Antigravity when it opens. Antigravity IDE and VS Code keep their native status-bar and dashboard surfaces.

## Highlights

- **Silent sign-in start & native Windows 11 tray flyout:** the Windows Startup shortcut, `HKCU\...\Run` entry, and `AntigravityMonitor` logon task start the companion through `Antigravity Monitor.exe --companion` with no console window and enable a single-instance Windows system tray icon. Left-clicking the tray (**Open Antigravity (Active Thread)**) focuses or launches Antigravity and opens the Monitor right-side browser panel directly in the foreground session; **Open Monitor Dashboard** toggles a native, always-on-top GDI+ Windows 11 flyout docked above the bottom-right taskbar (no taskbar icon, zero Edge/WebView2 processes, ~15 MB RAM).
- **Companion survives closing windows:** the companion no longer shares a visible console, so closing a window cannot stop it. If it stops anyway, the logon task restarts it (up to three times, one minute apart).
- **Dashboard starts the companion first:** `Antigravity Monitor.exe` from the Start Menu starts the hidden companion and opens the native lightweight flyout directly without spawning a console window.
- **Failures are recorded:** startup errors are appended to `companion-error.log` in the Antigravity Monitor data folder. Nothing is shown on screen, so this log is the place to look.
- **Startup races and slow starts handled:** when two launchers race for the port, the one that loses adopts the running companion. Readiness waits up to 20 seconds.
- **Adaptive multi-version Antigravity support (2.34+ and future releases):** newer Antigravity builds (2.34 verified) omit `--csrf_token` from the language server command line. The monitor now uses a 4-tier adaptive auth/RPC chain (CLI token → runtime config token → passive CDP network header capture → same-origin in-page RPC fallback), future-proof backend discovery (`--https_server_port 0` / `--standalone`), 5-tier adaptive inline badge anchoring, and live runtime version-change recovery. When no DevTools session is attached yet, it reports **Authorization needed** instead of Standby.
- **Accurate output speed, session cache hit ratio & Dark/Light themes:** fixed ~2× `tok/s` undercounting on thinking turns, included `cacheCreate` in 1-decimal cache hit ratios (last-turn breakdown + session-wide KPI), added crafted Obsidian Dark and Alabaster Light themes with a top-bar toggle (`T`), and replaced the inline card's top-left label with a clickable masked/unmasked active Antigravity account email.
- **Safer DevTools badge:** the inline badge attaches only to page targets, never to workers or other debuggees on the same port, and auto-discovers additional `Antigravity*` profile channels.
- **Accurate diagnostics:** discovery notes reach the snapshot when they change, and a poll that is refused by the backend names the token problem rather than a missing backend.

## Install

Platform-specific universal packages (**Antigravity-Monitor-1.3.0-windows.zip**, **Antigravity-Monitor-1.3.0-macos.zip**, **Antigravity-Monitor-1.3.0-linux.zip**) and the combined **Antigravity-Monitor-1.3.0-companion.zip** include the runtime, **antigravity-monitor-1.3.0.vsix**, and native installers (`Install Antigravity Monitor.exe` / `.cmd`, `Install Antigravity Monitor.command`, `Install Antigravity Monitor.sh`) with executable permissions preserved for macOS/Linux. Node.js 22+ is required. Compare hashes against `SHA256SUMS.txt` before installation.

To upgrade a Windows installation, extract the v1.3.0 package and run the installer from that folder. It replaces the sign-in entries that pointed at PowerShell, stops the previous companion, keeps `state.json`, and backs up the prior runtime.

## Things to notice

- **Antigravity 2.34+ telemetry & inline badge need DevTools:** desktop Antigravity 2.34+ omits the CLI token, so both live telemetry and the inline composer snippet require launching Antigravity with `--remote-debugging-port=9222`. Use the system tray (**Open Antigravity (Active Thread)**), **Relaunch Antigravity with badge** in the dashboard, or **Antigravity (with Monitor)** from the Windows Start Menu. Plain shortcuts and in-app Reload keep DevTools off.
- **Windows launchers:** the EXE launchers are build outputs and are not committed. Run `scripts/build-windows-launchers.ps1` before packaging from source. Downloaded packages already contain them.
- **Unsigned packages and checksums:** verify downloaded archives against `SHA256SUMS.txt` before extracting or running them.

## Verification and limits

Windows verification for this release includes compilation, **233** passing unit and integration tests, a passing live check (`npm run live`) against Antigravity 2.34.0 (`status ok`, `source measured`, 24 picker models), rebuilt Windows launcher and tray checks at `v1.3.0` metadata, VSIX packaging, and release archive + `SHA256SUMS.txt` generation. **Interactive desktop sign-in and tray click behavior should be confirmed after installing.** Native macOS and Linux runtime execution remain unverified on physical hardware.
