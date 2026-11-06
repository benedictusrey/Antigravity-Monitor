# Security

This document covers Antigravity Monitor v1.0.0. The project is unsigned and provided without warranty. Open source allows inspection; it does not establish that every build or environment is safe.

## Report a vulnerability

Use the repository's **Security > Report a vulnerability** feature if private reporting is enabled. Do not post backend request tokens, raw trajectories, process command lines, account details, or private conversation screenshots in a public issue. If private reporting is unavailable, open a minimal issue asking for a private reporting route without including exploit details or sensitive data.

Include the affected version, operating system, relevant host, reproduction steps, and the expected security boundary. Remove personal information from logs before sharing.

## Security boundaries

- Monitoring RPCs accept loopback destinations only. The self-signed TLS exception is limited to those local endpoints.
- Backend request tokens stay in memory and are not delivered to dashboard webviews.
- The companion binds to loopback, checks Host, validates command origins and JSON input, and serves an explicit asset allowlist.
- Dashboard dynamic text is inserted as text under a Content Security Policy. The webview loads local resources.
- Installers identify a monitor process before replacing it and retain backups of existing files.

These controls are not a sandbox against malicious software running as the same user. DevTools grants control of the monitored app's pages. Enable it only on a loopback interface and use trusted software.

## Verify a download

Compare the release asset's SHA-256 with `SHA256SUMS.txt` from the same release:

```powershell
Get-FileHash -LiteralPath .\Antigravity-Monitor-1.0.0-companion.zip -Algorithm SHA256
```

On macOS use `shasum -a 256`; on Linux use `sha256sum`. A checksum detects a mismatch; it is not a signature or a guarantee of harmless code. Keep antivirus and operating-system protections enabled. Follow your organization's script and application policies.

## Support scope

The active release line is v1.0.0. Windows has local execution evidence. macOS/Linux implementations are included but native acceptance is pending. Security reports about any included platform are welcome. No response-time or support-lifetime guarantee is made.
