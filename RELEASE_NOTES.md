# Antigravity Monitor v1.2.0

Antigravity Monitor keeps context usage, model quotas, and the active conversation thread on screen within reach. The white desktop app uses a background companion that activates automatically alongside Antigravity; Antigravity IDE and VS Code also have native status-bar and dashboard surfaces.

## Highlights

- **Forward-compatible quota pools & tie-breaking:** Resolves multi-pool quota identities dynamically from pool descriptions (`Models within this group: ...`), dedicated-pool tokens, family matching, and window aliases (`7d`/`week`, `five_hour`/`5_hour`/`5-hour`/`session`), disambiguating pools that share `100%` weekly resets (such as `Claude and GPT models` vs `Gemini 4 Argon`).
- **Dynamic model catalog & slug humanization:** Adds fallback metadata for `M532`..`M535` (`Gemini 4 Neon`), `M537` (`Orchestrator (Neon)`), and `M578` (`Gemini 4 Hydrogen Sonar`), automatically humanizes raw slugs (e.g. `gemini-4-hydrogen-sonar` -> `Gemini 4 Hydrogen Sonar`), supports expanded field aliases and name-based pricing fallback, raises the model row cap to `64`, and retries partial account refreshes with `10s` backoff.
- **Schema, binary & DevTools bridge resilience:** Reads `metadata.requestedModel.model`, future step types with `metadata.modelUsage`, alternate token field names, bare `RUNNING`/`IDLE` statuses, renamed backend binaries (`cortex_server*`, `antigravity_server*`), and updated CDP badge attachment (`VERSION = 24`: `127.0.0.1:9222` fallback probe, semantic `Turbo`/model-button & `Ask` fallbacks, dashboard badge status + 1-click **Relaunch Antigravity with badge** control, `"Antigravity (with Monitor)"` Start Menu shortcut, clean upgrade replacement, and normalized ZIP forward-slash headers) including VS Code Insiders.
- **Dashboard & inline motion upgrades:** Refines dark/light `data-terminal` contrast (`#0e1014` ground, `#0b5ed7` light accent), adds a sliding `#tab-indicator`, `scaleX` gauges with ruler ticks, Settings tactile `.switch` toggles, interactive `Daily usage` hover/focus readout, topbar `Copy` button, inline card/pill transitions, and `prefers-reduced-motion` support.

## Install

Platform-specific universal packages (**Antigravity-Monitor-1.2.0-windows.zip**, **Antigravity-Monitor-1.2.0-macos.zip**, **Antigravity-Monitor-1.2.0-linux.zip**) and the combined **Antigravity-Monitor-1.2.0-companion.zip** include the runtime, **antigravity-monitor-1.2.0.vsix**, and native installers (`Install Antigravity Monitor.exe` / `.cmd`, `Install Antigravity Monitor.command`, `Install Antigravity Monitor.sh`) with executable permissions preserved for macOS/Linux. Node.js 22+ is required. Compare hashes against `SHA256SUMS.txt` before installation.

## Things to notice

- **Inline composer snippet requires a DevTools launch:** Desktop Antigravity displays the snippet pill to the left of `Turbo` only when launched with `--remote-debugging-port=9222`. In-app **Reload** (`Ctrl+R`), plain Antigravity shortcuts, and Antigravity auto-updates (`--updated`) keep DevTools disabled. Click **Relaunch Antigravity with badge** in the Overview notice on **http://127.0.0.1:4599**, or open **Antigravity (with Monitor)** from the Windows Start Menu.
- **Clean upgrades, PC boot & Antigravity update pipeline:** Running the Windows or POSIX installer preserves `state.json`, backs up prior runtime and config files, cleans replaced `out/src`, `tools`, and `media` folders before copying `v1.2.0`, registers a per-user logon Scheduled Task (`AntigravityMonitor` with automatic restart on failure and fallback `node.exe` resolution) alongside Startup/Run entries on Windows (`ThrottleInterval` + `KeepAlive` on macOS), watches the installed Antigravity binary and backend PID transitions to refresh telemetry, quotas, model catalogs, CDP badge attachment, and Start Menu shortcuts simultaneously whenever Antigravity updates, and installs `antigravity-monitor-1.2.0.vsix` (reload open Antigravity IDE / VS Code windows afterward).
- **Unsigned packages & checksums:** Verify downloaded archives against `SHA256SUMS.txt` before extracting or running.

## Verification and limits

Windows verification includes compilation, **217** passing unit/integration tests, `npm audit` (`0` vulnerabilities), rebuilt Windows launcher verification (`v1.2.0` metadata), live `Antigravity.exe 2.33.0` backend telemetry (`24` picker models) and live Electron CDP inline snippet attachment (`attached: 1`, `probedPages: 5`), `16` WCAG AA contrast checks (`>= 4.96:1`), and headless Chrome interactive verification across desktop/companion/mobile dark and light views. **Native macOS and Linux runtime execution remain unverified** on physical hardware.
