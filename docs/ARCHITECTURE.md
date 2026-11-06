# Architecture

Antigravity Monitor v1.0.0 has a shared observer core and two presentation hosts: a native VS Code extension and a standalone companion. The white Antigravity desktop app uses the companion because it has no VS Code extension host.

## Data flow

1. Platform discovery reads the process table and listening sockets. Parent-process ownership separates desktop Antigravity, Antigravity IDE, and VS Code.
2. The local RPC client validates the loopback destination, sets request time and byte limits, and sends the token belonging to that backend.
3. Summary polling identifies changed conversations. Full trajectories are read only when their identity or step signature changes and the adaptive floor allows it.
4. Trajectory reads have a separate cancellation lifetime. Slow reads do not block the next summary cycle. Results from stopped, removed, replaced, or canceled backends are discarded.
5. An independent quota loop requests `RetrieveUserQuotaSummary` with `forceRefresh: true`. It preserves model groups, bucket windows, absolute reset times, observation time, and freshness.
6. Typed snapshots feed the native status bar, dashboard, and companion's per-renderer badge bridge. Request tokens and raw trajectories are excluded.

## Context and selection

Context counts fresh input, cache reads, cache writes, and output. Cached input still occupies the context window. Output already includes thinking and is not counted twice. Capacity comes from the model catalogue; an unknown capacity stays unknown.

Provider readings are labelled Measured. A local estimate during an unfinished response is labelled Estimated. Compression needs two measured readings; a shrinking step count is treated as a rewind rather than compression.

The inline bridge observes the visible route and selected model. Explicit conversation identity wins over background activity; new threads clear the old context. Model selection chooses quota identity separately from the response model attached to measured token counts.

## Quotas

Quota responses retain Gemini and Claude/GPT groups. A known model must resolve to exactly one group. Unknown, disabled, malformed, expired, or absent values are not inferred.

Healthy cadence is five seconds, with a four-second request timeout and 1 MB quota payload ceiling. Failure retry delays are 10, 20, then 30 seconds. A failed observation retains its source time and becomes cached. Values expire after 30 seconds or at reset. Dashboard and badge consumers also age readings locally without incoming snapshots.

## Hosts and storage

`src/core` contains parsing, analysis, formatting, quota, selection, and usage helpers without an editor dependency. `src/app` contains monitoring and the native extension glue. `tools` contains the companion, renderer bridge, persistence, and platform installers. `media` contains the shared plain-JavaScript dashboard.

The companion serves only loopback HTTP. It checks Host and command Origin, requires JSON commands, validates message values, and serves a fixed media allowlist. The native webview has a nonce-based Content Security Policy and local resource roots.

Companion state uses a temporary file and atomic rename. Native usage writes use the same replacement pattern. This prevents a failed replacement from truncating the last valid JSON. Each installation still owns its own preferences and usage; cross-process aggregation is not a synchronization protocol.

## Platform implementation

Windows uses CIM and TCP connection queries. macOS/Linux use a POSIX process-table walk with `lsof` or `ss`. Platform helpers resolve Windows app-data paths, macOS Application Support and LaunchAgents, and Linux XDG locations. Installers use the current user's account and retain backups.

The implementation is included for all three operating systems. Windows has local end-to-end evidence. Native macOS/Linux app discovery, login startup, and DevTools attachment remain acceptance requirements; fixture tests and shell syntax checks do not establish those behaviors.
