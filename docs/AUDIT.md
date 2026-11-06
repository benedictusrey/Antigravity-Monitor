# v1.0.0 release audit

Date: 6 November 2026. Scope: local monitoring for one user running desktop Antigravity, Antigravity IDE, and VS Code. Reviewed discovery, RPC, parsing, context selection and analysis, independent quota polling, snapshot presentation, preferences, persistence, HTTP routes, startup, installers, packaging, and release documentation.

## Findings fixed

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

- TypeScript compilation and **204 automated tests passed**, with no skips or failures.
- The isolated companion process test covers hostile Host, cross-origin and non-JSON commands, malformed URLs, invalid assets, and custom preferences retained after a real process restart. It uses temporary platform-specific data paths.
- Atomic-write failure preserves the prior JSON. Loopback RPC rejection is verified for HTTP and HTTPS before credentials are sent.
- Browser checks cover all four dashboard tabs, keyboard navigation, six snippet choices, immediate preview, saved acknowledgements, empty-choice fallback, model and route switches, and expiry without new snapshots.
- Actual installed companion pages were checked at 1440, 1024, 768, and 390 pixels. All four tabs fit without horizontal overflow. The live white-app card and customization controls were captured directly from its DevTools connection; no fixture snapshots were substituted in release images.
- The generated POSIX script passed shell syntax and controlled execution checks under Git Bash, including macOS ancestry, spaced paths, empty-`lsof` fallback, exact PID matching, and backend target parsing.
- All included platform tools passed JavaScript syntax checks. Startup document tests cover platform paths, XML escaping, spaces, and Linux field codes.
- Focused independent source reviews covered monitor cancellation, warning state, payload-limit retry, installer safety, and final HTTP/layout changes. No remaining blocker was identified in that reviewed scope.
- The Windows companion and both native editor packages were installed as **v1.0.0**. Startup shortcut reuse and automatic quota refresh were checked locally. Actual images and the new SVG/PNG logo are included.
- The dependency audit reported **zero known vulnerabilities** after the patched build-tool dependency was installed. This is a registry observation, not proof that all code is free of vulnerabilities.

## Release boundaries

No audit can establish the absence of all bugs. This result is evidence for the stated cases and environment.

Native macOS/Linux installation, login startup, app attachment, update, and uninstall have not run on those operating systems. Their implementations, fixture tests, shell execution, and source reviews are included; native acceptance remains pending. The prepared CI workflow also has not run remotely before upload.

Native editor activation and inline injection after an editor restart were not repeated in this pass; installed version checks and activation/status tests cover their wiring. The white desktop app and standalone companion were exercised live. Screen readers, high-contrast themes, multiple windows behind one shared backend, and prolonged soak/load testing remain open.

Quotas are polled rather than pushed. Backend support, latency, and retries affect freshness. Installers preserve persisted state and backups, but forced process replacement can lose a few seconds of unflushed telemetry. Same-user hostile software is outside the companion's isolation boundary.

## Verdict

The confirmed release blockers found in this pass are fixed and covered by focused checks. Windows upload files are prepared; native macOS/Linux acceptance must remain explicit in release documentation.
