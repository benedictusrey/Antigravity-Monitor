# v1.1.0 release audit

Date: 17 November 2026 (updating the initial 6 November 2026 v1.0.0 baseline). Scope: local monitoring for one user running desktop Antigravity, Antigravity IDE, VS Code, and VS Code Insiders. Reviewed discovery, RPC, model catalog & dynamic quota-pool resolution, conversation selection/subagent hierarchy, companion startup & `DevToolsActivePort` watching, CDP badge bridge, dashboard UI, installer health preflight, and release packaging.

## v1.1.0 Findings fixed

| Priority | Concrete failure | Fix and evidence |
|---|---|---|
| High | Early returns in `pollInstance` (e.g. `new-thread`) skipped updating `previousStepCounts`, and running peers omitted daily `recordUsageDelta`. | Wrapped selection in `try ... finally` to always sync `previousStepCounts` after parsing trajectories and recorded running peer deltas; regression test passes. |
| High | Waiting in standby with zero discovered backends surfaced `error` when discovery returned empty with no prior focus. | `deriveStatus` returns `disconnected` (`Standby`) on discovery standby; regression test passes. |
| High | New backend models (including `Gemini 4 Argon` and new model variants) fell back ambiguously or lacked quota-pool isolation across multi-group Gemini responses. | Auto-merged live picker models into catalog, correlated pools via `description` and `resetTime` hints, separated Argon pricing/pool from `Gemini Models`; unit and live backend tests pass. |
| Medium | Switching backends or pinning/unpinning a conversation triggered full `refreshNow()`, wiping `analysisCache` across threads and re-running discovery. | `selectBackend` and `pinConversation` now re-publish immediately and `schedule(0)` while preserving cached analysis; regression test passes. |
| Medium | Polling an instance could read all uncached idle peer trajectories in one burst on discovery. | Bounded peer warmup to running peers plus at most one uncached idle peer per cycle. |
| Medium | Companion dashboard `POST /api/command` waited up to 1.5s for the next polling interval; inline badge lost custom/essentials density when switching threads; extension warnings checked only `modelId`. | Added immediate `pull()` on command resolution, preserved `prior.density` on conversation switch (`VERSION = 21`), and resolved `selectedModelId ?? modelId` in `maybeWarnAboutQuota`. |
| Medium | Running-companion installer preflight hit `/api/snapshot` during startup before `latest` populated, risking false timeout failure, and PowerShell 5.1 failed `$PSScriptRoot` inside `param(...)`. | Updated `tools/install-windows.ps1` preflight check to validate `/api/health` (`service === 'antigravity-monitor'`) and resolved `$PackageRoot` in script body. |
| Medium | Background CDP loop sent extra `__agmTakeRefresh` / `__agmTakeSettings` evaluations and unconditional `push()` calls when only reading state. | Consolidated `__agmDrain()` into one round-trip, gated `checkRefresh` pushes on `contextKey` / `modelName` changes, rejected `CdpConnection.ready` immediately on premature socket close, and added `window.__agmOwner` guards on global listeners. |
| Low | Dead formatting/model/badge helpers (`clamp`, `formatWeekday`, `hasPricedModel`, `QUOTA_ROWS`, `agedLimit`, `parseReset`, `formatReset`, `sessionLimit`, `preference`, `remember`) added dead code across modules. | Removed unused helpers across `src/core/values.ts`, `src/core/format.ts`, `src/core/models.ts`, and `tools/cdp-badge.mjs`. |

## v1.0.0 Findings fixed

| Priority | Concrete failure | Fix and evidence |
|---|---|---|
| High | A slow full-trajectory read blocked subsequent summary cycles for healthy apps. | Detached analysis lifetime; regression executes repeated summary cycles while a trajectory remains pending. |
| High | Canceled, stopped, or replaced-backend work could restore obsolete results. | Abort and identity checks reject late analysis, discovery, and account completion. Cancellation and removal regressions pass. |
| Medium | An inactive model consumed its low-quota warning before becoming active. | Only the active model disarms its warning; recovery rearms it. Activation resets warning state. |
| Medium | Raising the response limit left the same oversized conversation cached as unreadable. | A changed payload limit invalidates analysis and aborts reads using the old limit. |
| Medium | A directory media request or malformed URL could throw in the companion request handler. | Explicit asset allowlist, guarded reads, and guarded URL parsing. A real process remains healthy after invalid requests. |
| Medium | Local HTTP and RPC boundaries were weaker than the documented local-only behavior. | Host, Origin, JSON type, message values, and both RPC transport destinations are checked. CSP nonces use cryptographic random bytes. |
| Medium | Native usage writes could truncate a previous JSON file or clear dirty state across an asynchronous write race. | Synchronous temporary-file replacement. A forced rename failure preserves the previous valid file and remains retryable. |
| Medium | POSIX discovery missed spaced macOS paths, misattributed hosts, or skipped socket fallback after empty `lsof` output. | Parent-chain ownership, explicit executable names, defensive TSV parsing, and `ss` fallback. The generated shell executes successfully against controlled fixtures. |
| Medium | Normal macOS supervised update could fail after `bootout` had already terminated the recorded PID. | Exited PIDs are accepted; loaded jobs are unloaded with checked errors before replacement. Ownership checks include user and expected script path. |
| Medium | An occupied POSIX port with an unreadable health response could pass installation preflight. | TCP occupancy is checked separately; unrecognized listeners block changes before startup or runtime writes. |
| Medium | Following a model switch, the badge's remembered quota status could suppress the local expiry transition of a new cached reading. | Every rendered snippet records its actual quota state. Browser regression seeds the prior unavailable state and confirms a 25-second-old reading expires six seconds later. |
| Medium | The locked development glob matcher had a known denial-of-service advisory. | Pin the patched matcher through an override. The resulting locked tree reports zero known advisories in the recorded npm audit. |

## Validation

- TypeScript compilation and **214 automated tests passed**, with no skips or failures (`npm test`).
- Static UI checks (`design-taste-frontend` `lint.mjs --app`) returned `0 FAIL` on redesigned dashboard assets; live headless Edge captures verified dark and light companion themes across Overview, Threads, Models, and Settings views at desktop (`1280px`) and companion (`640px`) viewports without console errors.
- Live backend verification (`npm run live`) ran against local `Antigravity.exe` with `Gemini Models`, `Claude and GPT models`, and `Gemini 4 Argon` quota pools.
- Windows launcher build and check scripts verified embedded icons, `v1.1.0` product metadata, launch targets, and missing-file guards.
- Local Windows installation and companion restart persisted preferences (`HKCU\...\Run` + Startup shortcut + `antigravity-monitor-1.1.0.vsix` editor install).
- The isolated companion process test covers hostile Host, cross-origin and non-JSON commands, malformed URLs, invalid assets, and custom preferences retained after a real process restart. It uses temporary platform-specific data paths.
- Atomic-write failure preserves the prior JSON. Loopback RPC rejection is verified for HTTP and HTTPS before credentials are sent.
- Browser checks cover all four dashboard tabs, keyboard navigation, six snippet choices, immediate preview, saved acknowledgements, empty-choice fallback, model and route switches, and expiry without new snapshots.
- Actual installed companion pages were checked at 1440, 1024, 768, and 390 pixels. All four tabs fit without horizontal overflow. The live white-app card and customization controls were captured directly from its DevTools connection; no fixture snapshots were substituted in release images.
- The generated POSIX script passed shell syntax and controlled execution checks under Git Bash, including macOS ancestry, spaced paths, empty-`lsof` fallback, exact PID matching, and backend target parsing.
- All included platform tools passed JavaScript syntax checks. Startup document tests cover platform paths, XML escaping, spaces, and Linux field codes.
- Focused independent source reviews covered monitor cancellation, warning state, payload-limit retry, installer safety, and final HTTP/layout changes. No remaining blocker was identified in that reviewed scope.
- The Windows companion and native editor packages were installed as **v1.1.0**. Startup shortcut, `HKCU\...\Run` auto-start, and automatic quota refresh were checked locally.
- The dependency audit reported **zero known vulnerabilities** after the patched build-tool dependency was installed. This is a registry observation, not proof that all code is free of vulnerabilities.

## Release boundaries

No audit can establish the absence of all bugs. This result is evidence for the stated cases and environment.

Native macOS/Linux installation, login startup, app attachment, update, and uninstall have not run on those operating systems. Their implementations, fixture tests, shell execution, and source reviews are included; native acceptance remains pending. The prepared CI workflow also has not run remotely before upload.

Native editor activation and inline injection after an editor restart were not repeated in this pass; installed version checks and activation/status tests cover their wiring. The white desktop app and standalone companion were exercised live. Screen readers, high-contrast themes, multiple windows behind one shared backend, and prolonged soak/load testing remain open.

Quotas are polled rather than pushed. Backend support, latency, and retries affect freshness. Installers preserve persisted state and backups, but forced process replacement can lose a few seconds of unflushed telemetry. Same-user hostile software is outside the companion's isolation boundary.

## Verdict

The confirmed release blockers found in this pass are fixed and covered by focused checks. Windows upload files are prepared; native macOS/Linux acceptance must remain explicit in release documentation.
