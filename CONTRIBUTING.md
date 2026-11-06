# Contributing

Antigravity Monitor is a small local telemetry utility. Focused bug fixes, platform tests, accessibility improvements, and clear documentation are welcome.

## Before opening a change

Check existing issues, explain the concrete problem, and keep the change within that scope. For a bug report, include reproduction steps, operating system, app host, and monitor version. Do not attach raw process arguments, request tokens, trajectories, or private conversation screenshots.

## Development

Use Node.js 22 or newer:

```sh
npm ci
npm run compile
npm test
npm run package
```

The shared TypeScript core is independent of VS Code. The native extension lives in `src/app`; the companion and platform installers live in `tools`; dashboard assets live in `media`. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing data flow.

Preserve measured-versus-estimated provenance, app and conversation ownership, local-only connections, input validation, and honest unavailable states. Add a regression that fails for the actual bug. Do not infer full quota from missing data or rename old context measurements after a model switch.

On Windows, run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-windows-launchers.ps1` before installing from source or building a complete companion release. Building needs the Windows .NET Framework C# compiler. Downloaded packages already contain the launchers and need no compiler. Run `scripts/check-windows-launchers.ps1` to verify embedded icons and launch targets.

## Pull requests

Explain the trigger, the resulting behavior, and how it was verified. Include screenshots for visible changes and label illustrative data. State native-platform gaps explicitly. Avoid broad refactors mixed into a small fix.

All current project packages and release files remain **v1.0.0**. Do not bump the version without maintainer agreement. Dependency versions keep their own upstream values.

## Community

Be respectful, stay specific, and discuss the work rather than the person. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Security-sensitive reports follow [SECURITY.md](SECURITY.md).
