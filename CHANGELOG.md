# Changelog

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
