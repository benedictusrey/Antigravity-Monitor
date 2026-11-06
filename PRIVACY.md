# Privacy

Antigravity Monitor v1.0.0 observes local Antigravity state. It does not run a proxy, send analytics, or call a remote account service.

## What it reads

The monitor discovers local backend processes and listening sockets. It reads the process arguments needed to connect, including the backend's request token. It queries local conversation summaries, trajectory usage, model metadata, and grouped quota summaries. The inline bridge reads the visible route, selected model label, and composer controls through a local DevTools connection.

Conversation trajectories may contain user or assistant content. They are read in memory to derive usage; raw trajectories are not written into usage files or sent to the dashboard. Backend request tokens remain in memory and are not included in dashboard snapshots.

## What it stores

The companion stores display preferences and daily aggregate token totals in `state.json`. It also writes operational logs and installer backups. Native extensions keep preferences and usage in their editor's extension storage. See [USER_GUIDE.md](USER_GUIDE.md#storage-and-startup) for platform paths.

Snapshots contain conversation titles, model identity, usage figures, quota metadata, and connection information. Account name and email are masked in the default UI. Diagnostic logs can include conversation titles, ports, process IDs, and error details. Review them before sharing. The live-check development script can print titles.

## Local access

The companion binds to `127.0.0.1`. Its HTTP endpoints check the Host header; command requests also validate Origin, JSON content type, message shape, and value ranges. These controls do not protect against other software already running with your user account's permissions.

DevTools is a control interface. Keep it on loopback and close it when no longer needed. Do not expose it through a proxy, tunnel, or public network address.

## External connections

Monitoring traffic stays local. Opening documentation, GitHub links, or Node.js downloads uses your browser. Installing development dependencies with npm contacts package services. The monitored apps and editor installers retain their own behavior and privacy policies.

## Remove local data

Disable startup integration and stop the identified companion before removing its data folder. Back up `state.json` first if you want to preserve usage and preferences. Remove each native editor extension separately. Deleting the data folder removes retained local history and backups; the monitor cannot reconstruct older usage afterward.
