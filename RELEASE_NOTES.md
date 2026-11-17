# Antigravity Monitor v1.1.0

Antigravity Monitor keeps context usage, model quotas, and the active conversation thread on screen within reach. The white desktop app uses a background companion that activates automatically alongside Antigravity; Antigravity IDE and VS Code also have native status-bar and dashboard surfaces.

## Highlights

- **Output generation speed (`tok/s` snippet):** Measures provider output rate accurately from response decode windows (`viewableAt` -> `finishedGeneratingAt`, with full-turn fallback for sub-500ms windows) and exposes it across Custom snippets, status bar tooltip, Overview KPI strip, and Session ledger.
- **Automatic new-model & quota-pool discovery:** New backend models (`Gemini 4 Argon`, `Gemini 4 Hydrogen`, `Gemini 4 Carbon`, `Orchestrator (Argon)`, `Gemini 3.8 Flash`, `Claude Opus 5.5`, `Claude Sonnet 5.5`, `GPT-OSS 120B`, and future releases) and separate quota pools (`Gemini Models`, `Gemini 4 Argon`, `Claude and GPT models`) appear automatically without manual updates.
- **Active thread & subagent awareness:** Separates top-level conversations from child subagents (`Threads` tab), nests subagents under parent threads, supports instant search and pinning/auto-following, and tracks mid-conversation model switches cleanly.
- **Auto-activation & universal installers:** Watches `DevToolsActivePort`, wakes alongside Antigravity IDE / VS Code on extension activation, and ships hardened Windows (`.exe`/`.cmd`), macOS (`.command`), and Linux (`.sh`) installers with automatic POSIX `node` lookup and VS Code Insiders support.
- **`data-terminal` dashboard redesign:** Eliminated redundant card padding and blank voids in favor of a tight hairline-ruled interface supporting light/dark companion themes and `--vscode-*` editor inheritance.

## Reliability & audit fixes

Fixed `pollInstance` `previousStepCounts` tracking during `new-thread` early returns and running peer daily usage recording, updated companion `SHIM` to pull immediately after `POST /api/command`, preserved badge density across conversation switches (`VERSION = 21`), used `selectedModelId` in active quota warnings, fixed standby status misreporting (`disconnected`), preserved cached conversation analysis on focus/pinning, fixed Windows installer `/api/health` preflight and `$PSScriptRoot` binding, and removed unused helpers.

## Install

Platform-specific universal packages (**Antigravity-Monitor-1.1.0-windows.zip**, **Antigravity-Monitor-1.1.0-macos.zip**, **Antigravity-Monitor-1.1.0-linux.zip**) and the combined **Antigravity-Monitor-1.1.0-companion.zip** include the runtime, **antigravity-monitor-1.1.0.vsix**, and native installers (`Install Antigravity Monitor.exe` / `.cmd`, `Install Antigravity Monitor.command`, `Install Antigravity Monitor.sh`) with executable permissions preserved for macOS/Linux. Node.js 22+ is required. Compare hashes against `SHA256SUMS.txt` before installation.

## Verification and limits

Windows verification includes compilation, **214** passing unit/integration tests, `lint.mjs --app` (`0 FAIL`), rebuilt Windows launcher verification, headless dark/light browser screenshots across all 4 tabs, live `Antigravity.exe` backend verification, and local Windows installation. **Native macOS and Linux runtime execution remain unverified** without native hardware runs.
