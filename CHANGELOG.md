# Changelog

## v1.1.0

Accuracy, automatic model/quota-pool recognition, Antigravity startup activation, audit fixes, and substantial UI polish. Source, native extension, companion, and current packages are bumped to **v1.1.0**.

### Monitoring and accuracy

- Automatic discovery and classification of new models (including `Gemini 4 Argon`, `Gemini 4 Hydrogen`, `Gemini 4 Carbon`, `Orchestrator (Argon)`, `Gemini 3.8 Flash`, `Claude Opus 5.5`, `Claude Sonnet 5.5`, `GPT-OSS 120B`), provider tags (`New`, `Notice`, `Unavailable`), and live picker selections without requiring monitor updates.
- Measured **Output `tok/s`** generation speed computed from Antigravity step timestamps (`viewableAt` to `finishedGeneratingAt`, falling back to turn elapsed time when decode windows are `< 500ms`), exposed as `snippetTokPerSec` toggle, tooltip field, and KPI cell.
- Multi-pool Gemini quota resolution (`Gemini Models`, `Gemini 4 Argon`, `Claude and GPT models`) using group descriptions and `resetTime` hint matching.
- Accurate model-switch attribution via `selectedModelId` / `generatorModel` separation, object-shaped `codeAction.actionSpec` parsing, and `invokeSubagent` token estimation.
- Thread hierarchy separation (`isSubagent`, `rootConversationId`, `lastUserViewTime`) so top-level conversations take precedence over background subagents while surfacing running work.
- Recognizes `Code - Insiders.exe` on Windows alongside Antigravity desktop, Antigravity IDE, and VS Code.

### Companion startup, universal installers, and reliability

- Automatic activation alongside Antigravity via extension startup spawn (`ensureCompanionRunning`), `DevToolsActivePort` directory watch (`nudgeDiscovery`), Windows Startup shortcut + `HKCU\...\Run` auto-start, and tighter 4s standby discovery backoff.
- Universal installer upgrades across Windows (`Install Antigravity Monitor.exe`/`.cmd`), macOS (`Install Antigravity Monitor.command`), and Linux (`Install Antigravity Monitor.sh`): automatic POSIX `node` discovery (`PATH`, Homebrew, `/usr/local`, `/snap/bin`, Volta, fnm, nvm), expanded editor CLI detection including VS Code Insiders, Linux desktop application shortcut, `--vsix` flag support, and LF validation in `scripts/build-release.ps1`.
- Fixed `pollInstance` so `previousStepCounts` still updates during `new-thread` early returns and running peer trajectories record daily usage deltas cleanly.
- Fixed `/api/health` preflight and `$PSScriptRoot` default handling in `tools/install-windows.ps1`.
- Fixed standby `deriveStatus`, preserved `analysisCache` across backend switches/pinning, preserved inline badge `density` across conversation switches (`VERSION = 21`), triggered immediate snapshot pull on companion `POST /api/command`, and added active-model `selectedModelId` checks in quota warnings.
- Reduced CDP polling overhead (`__agmDrain()`, gated `checkRefresh` pushes, immediate `CdpConnection` close rejection, owner-guarded listeners) and removed dead helpers (`clamp`, `formatWeekday`, `hasPricedModel`, `QUOTA_ROWS`, `agedLimit`, `parseReset`, `formatReset`, `sessionLimit`, `preference`, `remember`).
- Updated Windows launcher binaries and installer checks for **v1.1.0** metadata.

### Interface

- Redesigned dashboard around a dense **`data-terminal`** architectural layout with adaptive dark (`#111216`) and light (`#f3f5f8`) companion themes plus full `--vscode-*` variable inheritance, zero nested SaaS boxes, and `2px` accent selection indicators.
- Paired Overview top band: bold `36px` context percentage + full-width warning/critical threshold ruler + token composition (`Cache hit %` & shares) alongside side-by-side `5-hour` / `Weekly` quota pools.
- Added divided 4-cell KPI strip (`Output speed tok/s`, `Cache hit ratio`, `Session API equiv.`, `Observed today`), full-width active apps strip, and balanced `Session & Account ledger` + Y/X scaled `Daily usage` panel.
- Renamed **Sessions** tab to **Threads** with nested subagent hierarchy, search bar, Follow/Pinned indicators, grouped **Models** grids, two-column **Settings**, keyboard shortcuts (`1`–`4`, `r`), and refreshed repo banners & screenshots.

## v1.0.0

Initial release preparation. Source, native extension, companion, and current downloadable packages retain v1.0.0.

### Monitoring

- Context used, remaining, and capacity tokens, with measured or estimated provenance.
- Visible-thread recognition and explicit new-thread, waiting, unavailable, and disconnected states.
- Independent 5-hour and weekly quota refresh using the local grouped quota service, with reset countdowns, cached status, expiry, and retry backoff.
- Separate readings for desktop Antigravity, Antigravity IDE, and VS Code.
- Session summaries, model capacities, token breakdown, context growth, and locally observed usage history.

### Interface

- Composer snippet, expandable detail card, native editor status bar, and four-tab dashboard.
- Six configurable snippet fields with immediate preview and persistent preferences.
- Essentials, Full, and Custom modes; copy and refresh actions; keyboard tab navigation.
- Compact responsive layouts with paired overview sections, denser facts, and wide-window settings columns.
- New scalable lift-and-telemetry logo. Three version-free release banners composed from actual running UI captures.

### Installation

- Branded Windows EXE launchers with embedded logo and v1.0.0 product metadata. Start Menu and Startup shortcuts use a multi-size ICO; PNG and ICNS icon formats are included.

- Windows stable companion runtime, checked native editor installation, hidden launch, and per-user Startup shortcut.
- macOS companion installer, Application Support storage, LaunchAgent startup, and browser integration.
- Linux companion installer, XDG state/data paths, desktop autostart, and browser integration.
- POSIX process ownership, spaced executable paths, listening-port discovery, and local DevTools port-file lookup.
- Native macOS/Linux acceptance remains pending.

### Reliability and security

- Slow trajectory reads run independently of summary cycles. Canceled and replaced backend results are discarded.
- Quota warnings remain armed until the relevant model is active. Payload-limit changes retry oversized conversations.
- Cached badge quotas expire correctly after a model switch.
- Atomic usage replacement; validated local HTTP commands, explicit media allowlist, guarded URLs, and loopback-only RPC destinations.
- Patched locked build-tool glob dependency and a fresh dependency audit.
- Automated tests, isolated process restart checks, controlled POSIX shell fixtures, browser interaction checks, and a documented release audit.
