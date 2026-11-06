# Preparing the v1.0.0 release

All current project packages and release documents use **v1.0.0**. Dependency versions retain upstream values. Banner artwork is deliberately version-free; refresh actual UI captures when product behavior changes.

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

The prepared release folder contains:

- `repository`: public source, documentation, tests, workflow, actual screenshots, and version-free banners.
- `Antigravity-Monitor-1.0.0-companion.zip`: complete compiled companion, installers, launcher files, native VSIX, and user documentation. It requires Node.js 22 or newer.
- `antigravity-monitor-1.0.0.vsix`: native editor extension.
- `Antigravity-Monitor-1.0.0-source.zip`: public source snapshot.
- `SHA256SUMS.txt`: hashes of the three downloadable packages.
- `RELEASE_NOTES.md`: text prepared for the GitHub release body.

Do not upload `node_modules`, local state, logs, raw process records, trajectories, downloaded app bundles, private audit workspaces, or backup folders. Runtime and source ZIPs have different purposes; source needs `npm ci` and compilation, while the runtime ZIP includes compiled files.

## Publish

Create or use `benedictusrey/Antigravity-Monitor`, upload the contents of `repository`, and review the Markdown and image links on GitHub. Create tag **v1.0.0** at the intended source commit, paste the release notes, and attach the package files plus checksums. Enable private vulnerability reporting if available.

Preparing these files does not create a repository, tag, or public release. Publication is a separate maintainer action. Preserve backups and the exact checksum file that belongs to the uploaded assets.
