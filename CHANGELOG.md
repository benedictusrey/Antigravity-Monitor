# Changelog

## v1.3.0

Adaptive multi-version Antigravity support (2.34+ and future releases), native lightweight Windows 11 system tray flyout, accurate output speed and session cache hit ratio metrics, Dark & Light dashboard themes, clickable account email masking on the inline card, and silent console-free sign-in startup. Packages are organized under `release/v1.3.0/`.

### Adaptive Antigravity 2.34+ & future-version compatibility

- **4-tier adaptive auth & RPC chain** (`src/app/monitor.ts`, `src/core/rpc.ts`, `tools/cdp-badge.mjs`, `tools/monitor-server.mjs`):
  1. CLI `--csrf_token` / `--csrf-token` / `--csrftoken` (Antigravity ≤ 2.33, IDE, VS Code).
  2. Memory-only runtime token handoff (`window.__APP_CONFIG__.csrfToken` → `Monitor.provideToken()`), never logged or persisted (Antigravity 2.34+).
  3. Passive CDP `Network.requestWillBeSent` header capture (`extractCsrfHeader()`, `maxTotalBufferSize: 0`, auto-disabled after capture) when a future build moves tokens into a JS closure.
  4. Same-origin in-page RPC fallback (`BadgeInjector.callRpc()` with `credentials: 'include'`) via `MonitorDeps.rpcFallback`.
- **Future-proof discovery & CDP attachment** (`src/core/discovery.ts`, `tools/cdp-badge.mjs`): keeps app-owned renamed server binaries using ephemeral `--https_server_port 0` or `--standalone` on both Windows and POSIX; `devtoolsEndpoints()` auto-discovers additional `Antigravity*` profile channels; `isAttachableTarget()` attaches only to `page` targets; `PROBE` recognizes `window.__APP_CONFIG__.productName`; 5-tier adaptive inline pill anchoring (`VERSION = 27`) with non-intrusive bottom-right fallback; live `appVersion` change detection with staged post-update re-attach.
- **Unauthorized visibility** (`src/app/monitor.ts`, `src/app/snapshot.ts`, `src/app/statusbar.ts`, `src/app/strings.ts`, `media/dashboard.js`): running backends that refuse requests without a DevTools session report `unauthorized` ("Authorization needed") instead of Standby.

### Native Windows 11 tray flyout & silent startup

- `tools/windows-flyout.cs`, `tools/windows-launcher.cs`, `scripts/build-windows-launchers.ps1`: replaced the Edge popup with a **100% native GDI+ / WinForms Windows 11 flyout** (`FormBorderStyle.None`, `ShowInTaskbar = false`, `TopMost = true`, native `DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND`, `CS_DROPSHADOW`, ~15 MB RAM, zero Edge/WebView2 processes, zero idle polling when hidden) docked at the bottom-right corner above the taskbar with Dark/Light theme toggle (`T`), Refresh (`R`), Close (`Esc`), and clickable account email masking.
- **Single-instance Windows system tray (`--tray`)**: left-click / **Open Antigravity (Active Thread)** focuses or launches Antigravity with `--remote-debugging-port=9222` and opens/focuses the Antigravity Monitor right-side browser panel (`openInAppPanel` via `[data-testid="new-tab-card-new-preview"]` and `[data-testid="browser-url-input"]`); **Open Monitor Dashboard** toggles the native flyout.
- `tools/start-companion.ps1`, `tools/install-windows.ps1`: silent `CreateNoWindow` sign-in startup via `Antigravity Monitor.exe --companion [--supervise]`, failure logging to `companion-error.log`, port-race adoption, 20 s readiness timeout, and automatic tray cleanup on upgrade.

### Metrics accuracy & dashboard polish

- **Output speed (`tok/s`)** (`src/core/analysis.ts`): fixed ~2× undercounting on thinking turns by dividing full `output` tokens across the `viewableAt` → `finishedGeneratingAt` decode window, and retained the last valid measured `tok/s` across tiny sub-250ms tool-call steps.
- **Cache hit ratio & token shares** (`media/dashboard.js`): denominator now includes `cacheCreate` (`input + cacheRead + cacheCreate`) with 1-decimal precision (capped at `99.9%` when fresh/cache-write tokens exist); top breakdown shows last-turn cache hit and `<1%` for small non-zero segments; KPI strip shows session-wide cache hit ratio.
- **Dark & Light theme + inline account email** (`media/dashboard.html`, `media/dashboard.css`, `media/dashboard.js`, `tools/cdp-badge.mjs`, `tools/monitor-server.mjs`): crafted Obsidian Dark and Alabaster Light palettes with sun/moon toggle (`T`, persisted in `localStorage`), `cache-control: no-store` on `/media/*`, and clickable censored/uncensored active account email on the inline card.

### Release preparation

- Version 1.3.0 (`monitorBuild` `2026-11-23-v1.3.0`) across package metadata, launcher metadata, documentation, live v1.3.0 screenshots, and release tooling; **233/233** automated tests passing and live check verified against Antigravity 2.34.0.

## v1.2.0

Forward-compatibility hardening for newer Antigravity backends and model catalogs, dashboard UI/motion upgrades, and cleanly organized universal installer packages under `release/v1.2.0/`. Source, native extension, companion, Windows EXE metadata, and release packages are bumped to **v1.2.0**.

### Compatibility and model/quota resilience

- Generalized `resolveQuotaGroup` (`src/core/quota.ts`) with pool description membership parsing (`Models within this group: ...`), distinctive dedicated-pool token matching, family-aware tie-breaking when two pools share `100%` weekly reset values (such as `Claude and GPT models` vs `Gemini 4 Argon`), generic family fallback, and window aliases (`7d`/`week`, `five_hour`/`5_hour`/`5-hour`/`session`), surfaced via `activeQuotaGroupId` in `Snapshot`.
- Expanded dynamic model recognition (`src/core/models.ts`) with fallback metadata for `M532`..`M535` (`Gemini 4 Neon`), `M537` (`Orchestrator (Neon)`), and `M578` (`Gemini 4 Hydrogen Sonar`), `humanizeSlug` formatting when backends omit `displayName`, broader `parseUserStatus` field aliases (`modelOrAlias.alias`, `record.modelId`, `maxContextTokens`), name-based pricing fallback in `priceFor`/`estimateCost`, raised model row cap (`24` -> `64`), and `Promise.allSettled` retry backoff (`10s`) on partial account refreshes.
- Hardened trajectory analysis, selection, and discovery (`src/core/analysis.ts`, `src/core/select.ts`, `src/core/discovery.ts`) to read `metadata.requestedModel.model`, future non-planner response step types carrying `metadata.modelUsage`, alternate token field names (`promptTokens`, `completionTokens`, `cachedInputTokens`, `cacheWriteTokens`), bare `RUNNING`/`IDLE` statuses, and renamed backend binaries (`cortex_server*`, `antigravity_server*`, `--csrf_token` + `--https_server_port`, `Antigravity*`, `Code*`).
- Updated `tools/cdp-badge.mjs` (`VERSION = 24`) with widened DOM placement fallbacks (`model-selector-trigger` parent bar plus semantic `Turbo`/model-button & `Ask` input fallbacks), `127.0.0.1:9222` CDP fallback probing, `badge` status + 1-click **"Relaunch Antigravity with badge"** button in the companion dashboard (`relaunchApp`), clean `MutationObserver` disconnect + `AbortController` listener cleanup on upgrades, route/query parsing (`/c|/chat|/conversation|/t|/thread/`, `?conversationId|cascadeId=`), and `Code - Insiders` support.
- Hardened Windows/POSIX installers (`tools/install-windows.ps1`, `tools/install-posix.mjs`) to clean replaced runtime directories on upgrade, create an `"Antigravity (with Monitor)"` Start Menu shortcut launching with `--remote-debugging-port=9222 --remote-debugging-address=127.0.0.1`, check DevTools availability after install, normalize `\` to `/` in POSIX/Windows ZIP headers (`scripts/set-zip-permissions.mjs`), and remove ~90 lines of dead legacy quota-row helpers (`parseQuotaRows`, `sanitiseLimits`, `devtoolsPortFiles`).

### Interface and motion upgrades

- Updated `data-terminal` palette tokens (`#0e1014` dark ground, `#0b5ed7` light accent), added a sliding `#tab-indicator`, user-triggered `.pane--entering` transitions, `scaleX`-composited context/quota gauges with ruler ticks, tactile `.switch` toggles in Settings, interactive `Daily usage` hover/focus hint readout, topbar `Copy` summary button with refresh icon spin, and `prefers-reduced-motion` support (`media/dashboard.html`, `media/dashboard.css`, `media/dashboard.js`, `docs/DESIGN.md`).
- Updated inline composer pill/card feedback in `tools/cdp-badge.mjs` with press/hover transitions, `scaleX` progress bars, card entrance transitions, and `Copied` feedback.

### Release packaging and validation

- Rebuilt `antigravity-monitor-1.2.0.vsix`, branded Windows EXE launchers (`v1.2.0` metadata), ICO/ICNS assets, and OS-specific universal installer archives organized cleanly with unpacked copies placed under `release/v1.2.0/staging/`.
- Verified compilation, `214/214` automated tests, `0` `npm audit` advisories, live `Antigravity.exe 2.33.0` backend telemetry (`24` picker models) and live CDP badge attachment (`attached: 1`), Windows launcher verification, `16` WCAG AA contrast checks, and headless Chrome click-through across desktop/companion/mobile dark & light viewports.

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
