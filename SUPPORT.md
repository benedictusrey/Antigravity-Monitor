# Support

Start with the [user guide](USER_GUIDE.md) and [known limits](README.md#known-limits). Antigravity Monitor v1.0.0 depends on local interfaces that can change when the monitored apps update.

## Report a reproducible issue

Include:

- Operating system and version; say whether the host is white Antigravity desktop, Antigravity IDE, or VS Code.
- Monitor version, installation route, Node.js version, and whether the companion is running.
- Expected behavior, actual behavior, and the shortest steps that reproduce it.
- Whether the problem concerns context, quotas, visible-thread recognition, startup, or display preferences.
- A cropped screenshot or sanitized diagnostic excerpt when useful.

Check the local dashboard at `http://127.0.0.1:4599` and health at `/api/health`. The Settings tab exposes local connection diagnostics. A running backend can still lack quota support or a usable DevTools endpoint.

Do not include request tokens, raw trajectories, process command lines, private titles, account details, or complete state files. Read [PRIVACY.md](PRIVACY.md). Use [SECURITY.md](SECURITY.md) for vulnerabilities.

Native macOS/Linux acceptance remains pending. Reports from those systems should include whether `ps`, `lsof` or `ss`, and startup integration work in the current desktop session.
