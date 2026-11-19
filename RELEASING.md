# Preparing the v1.2.0 release

All current project packages and release documents use **v1.2.0**. Dependency versions retain upstream values. Banner artwork is deliberately version-free; refresh actual UI captures when product behavior changes.

## Validate

```sh
npm ci
npm run compile
npm test
npm audit
npm run package
```

Run the Windows installer from a complete extracted runtime. Confirm companion health, installed editor versions, actual badge attachment, quota freshness, saved settings, and single-instance startup. Check both existing conversations and new threads. Treat the [audit](docs/AUDIT.md) as a record of tested conditions, not a guarantee of zero bugs.

Native macOS and Linux acceptance remains pending. On each platform, verify process ownership, backend discovery, DevTools attachment, quota changes, update, login startup, uninstall, and state retention. Do not remove the pending status based only on generated startup documents or Windows-hosted fixture tests.

On Windows, run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-windows-launchers.ps1` before installing from source or building a complete companion release. Building needs the Windows .NET Framework C# compiler. Downloaded packages already contain the launchers and need no compiler. Run `scripts/check-windows-launchers.ps1` to verify embedded icons and launch targets.

## Upload-ready files

The prepared release folder (`release/v1.2.0/`) contains:

- `Antigravity-Monitor-1.2.0-windows.zip`, `Antigravity-Monitor-1.2.0-macos.zip`, `Antigravity-Monitor-1.2.0-linux.zip`: OS-specific universal installer bundles with POSIX executable permissions preserved on macOS/Linux archives.
- `Antigravity-Monitor-1.2.0-companion.zip`: complete compiled companion, installers, launcher files, native VSIX, and user documentation. It requires Node.js 22 or newer.
- `antigravity-monitor-1.2.0.vsix`: native editor extension.
- `Antigravity-Monitor-1.2.0-source.zip`: public source snapshot.
- `SHA256SUMS.txt`: hashes of all downloadable packages.
- `RELEASE_NOTES.md`: text prepared for the GitHub release body.
- `staging/`: unpacked `repository/` snapshot and compiled `Antigravity-Monitor-1.2.0/` runtime directory used to assemble the archives.

Do not upload `node_modules`, local state, logs, raw process records, trajectories, downloaded app bundles, private audit workspaces, or backup folders. Runtime and source ZIPs have different purposes; source needs `npm ci` and compilation, while the runtime ZIP includes compiled files.

## Publish

Create or use `benedictusrey/Antigravity-Monitor`, upload the contents of `staging/repository`, and review the Markdown and image links on GitHub. Create tag **v1.2.0** at the intended source commit, paste the release notes, and attach the package files plus checksums. Enable private vulnerability reporting if available.

Preparing these files does not create a repository, tag, or public release. Publication is a separate maintainer action. Preserve backups and the exact checksum file that belongs to the uploaded assets.
