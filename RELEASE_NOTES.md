# Antigravity Monitor v1.0.0

Antigravity Monitor keeps context usage, model quotas, and the conversation on screen within reach. The white desktop app uses a background companion; Antigravity IDE and VS Code also have native status-bar and dashboard surfaces.

## Highlights

- Visible-thread recognition with explicit new-thread and waiting states.
- Automatically refreshed 5-hour and weekly quotas, separated by model group.
- Custom snippets for context, remaining tokens, both limits, model identity, and reset countdowns.
- A compact detail card, four dashboard sections, and a scalable lift-and-telemetry logo.
- Local usage history, measured-versus-estimated context, and clear unavailable states.
- Windows installation and startup integration, plus macOS/Linux companion installers and startup implementations.

## Reliability work

Slow trajectory reads no longer stall healthy backend summary cycles. Canceled and replaced backend results cannot restore stale readings. Quota alerts stay armed until their model is active. Raising the response limit retries a previously oversized conversation. Native usage files use atomic replacement. The companion rejects unrelated Host values, cross-origin or non-JSON commands, unsafe RPC destinations, and unknown media paths.

The locked build dependency tree was audited after updating its affected glob matcher. The companion itself has no third-party runtime dependencies.

## Install

Windows packages include **Install Antigravity Monitor.exe** and **Antigravity Monitor.exe** with the project logo. These launch the readable commands beside them. Keep the complete extracted folder together. Installed Start Menu and Startup shortcuts use the same branded ICO.

Download and extract **Antigravity-Monitor-1.0.0-companion.zip**, install Node.js 22 or newer, and run the platform installer. Keep the folder together. Native editor users can install **antigravity-monitor-1.0.0.vsix** directly; the white desktop app still needs the companion.

Read [the user guide](https://github.com/benedictusrey/Antigravity-Monitor/blob/main/USER_GUIDE.md) and compare package hashes against `SHA256SUMS.txt` before installation. The current packages are unsigned.

## Verification and limits

Windows has local execution evidence, including a real companion process restart and settings persistence. Shared discovery and platform paths have automated tests. **Native macOS/Linux startup and app attachment remain unverified** and need platform acceptance. Quotas use five-second polling when healthy; latency and failure backoff can delay updates.

The repository banners use actual running UI captures and omit release version text. Values shown are observations at capture time. See the repository audit for the exact tested scope and remaining limits.
