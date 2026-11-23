<p align="center">
  <a href="https://github.com/benedictusrey/Antigravity-Monitor">
    <img src="assets/branding/antigravity-monitor-logo.png" width="128" height="128" alt="Antigravity Monitor icon">
  </a>
</p>

<h1 align="center">Antigravity Monitor</h1>

<p align="center">
  <strong>Know your context. Keep an eye on your model limits.</strong><br>
  Local monitoring for Antigravity desktop, Antigravity IDE, and Visual Studio Code.<br>
  Built with <code>TypeScript</code> and <code>Node.js</code>.
</p>

<p align="center">
  <a href="https://github.com/benedictusrey/Antigravity-Monitor/releases"><img src="https://img.shields.io/badge/release-v1.3.0-4daafc?style=flat-square" alt="v1.3.0 release"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-22%2B-43853d?style=flat-square" alt="Requires Node.js 22 or newer"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-4daafc?style=flat-square" alt="MIT license"></a>
</p>

<p align="center">
  <a href="https://github.com/benedictusrey/Antigravity-Monitor/releases/tag/v1.3.0">Download v1.3.0</a> ·
  <a href="USER_GUIDE.md">User guide</a> ·
  <a href="PRIVACY.md">Privacy</a> ·
  <a href="https://github.com/benedictusrey/Antigravity-Monitor/actions/workflows/ci.yml">Build checks</a> ·
  <a href="https://github.com/benedictusrey/Antigravity-Monitor/issues">Report an issue</a>
</p>

![Antigravity Monitor showing actual context and quota readings](assets/banners/antigravity-monitor-hero.jpg)

Antigravity Monitor adds a small composer readout, a detail card, and a dashboard to Antigravity. It follows the visible conversation, distinguishes new threads and child subagents, automatically discovers new models and quota pools from the local backend, and refreshes 5-hour and weekly quotas continuously. Native extensions add a status bar and dashboard inside Antigravity IDE and Visual Studio Code.

## Get started

Download the archive for your OS (**Antigravity-Monitor-1.3.0-windows.zip**, **Antigravity-Monitor-1.3.0-macos.zip**, or **Antigravity-Monitor-1.3.0-linux.zip**), or **Antigravity-Monitor-1.3.0-companion.zip** for all platforms together, extract the entire folder, and keep its files together. Install [Node.js 22 or newer](https://nodejs.org/) first. No administrator or sudo access is needed.

| Platform | Install from the extracted folder | Startup |
|---|---|---|
| **Windows** | Open **Install Antigravity Monitor.exe** (or `.cmd`). | Silent sign-in startup via `Antigravity Monitor.exe --companion`, native Windows 11 system tray + lightweight GDI+ flyout (no Edge/WebView2), `AntigravityMonitor` crash-restarting Scheduled Task, **Antigravity (with Monitor)** Start Menu shortcut, and VS Code / Antigravity IDE / Insiders VSIX. |
| **macOS** | Double-click **Install Antigravity Monitor.command** or run `sh "Install Antigravity Monitor.command"`. | Auto-locates `node` (Homebrew, nvm, fnm, volta), sets LaunchAgent, installs editor VSIX. |
| **Linux** | Run `./"Install Antigravity Monitor.sh"` (or `sh "Install Antigravity Monitor.sh"`). | Auto-locates `node`, adds XDG autostart + desktop app entry, installs editor VSIX. |

Open Antigravity normally. The companion starts automatically when you sign in, stays separate from the app, watches for Antigravity updates and DevTools endpoints so it refreshes telemetry, model catalogs, and shortcuts simultaneously, and reconnects whenever the local backend restarts. The dashboard is at **http://127.0.0.1:4599**. Installers also install the included VSIX into supported editor CLIs they find; reload editor windows afterward.

**Windows has been tested locally. macOS and Linux implementations include discovery, storage, installers, and startup integration; native platform acceptance remains pending.** Linux needs `ps` and either `lsof` or `ss` for socket discovery, plus `xdg-open` to launch the dashboard. macOS uses `ps`, `lsof`, `open`, and `launchctl`.

The white Antigravity desktop app has no VS Code extension host. It needs the companion, not only the VSIX. Its inline composer snippet appears to the left of `Turbo` once Antigravity runs with `--remote-debugging-port=9222`: use **Relaunch Antigravity with badge** in the dashboard (**http://127.0.0.1:4599**), launch **Antigravity (with Monitor)** from the Windows Start Menu, or see [DevTools setup](USER_GUIDE.md#enable-the-inline-badge) (an in-app **Reload** or plain shortcut keeps DevTools off). The monitor does not patch Antigravity's installed files.

> [!IMPORTANT]
> On Windows, do not double-click the VSIX. Microsoft's Visual Studio installer cannot install VS Code extensions. Use the project installer or an editor's **Install from VSIX** command.

The Windows EXE launchers embed the project logo and call the commands beside them. Keep the extracted package together. Installed Start Menu and Startup shortcuts use a multi-size ICO. Linux autostart carries the PNG icon; an ICNS asset is included for macOS packaging.

## What you can see

![Actual Antigravity Monitor dashboard and live quota details](assets/banners/antigravity-monitor-features.jpg)

| Feature | What it tells you |
|---|---|
| **Context & speed** | Used, remaining, capacity tokens, 1-decimal last-turn & session cache hit ratio, and measured output `tok/s` rate (inclusive of thinking decode). |
| **Conversation awareness** | The visible thread, a new thread, or an unidentified selection. Delayed data from another thread is rejected. |
| **Live quotas** | Separate 5-hour and weekly limits for Gemini, Gemini Argon, and Claude/GPT quota pools, with reset countdowns and freshness. |
| **Multiple apps & accounts** | Each discovered app keeps its own conversation; inline cards show the active Antigravity account email (click to mask/unmask). |
| **Threads and models** | Parent/subagent hierarchy with instant search, plus automatic model catalogue and quota-pool discovery. |
| **Usage history** | Locally observed token totals and an API-equivalent cost estimate where pricing is available. |
| **Themes & native flyout** | Obsidian Dark and Alabaster Light themes (`T` shortcut) in the dashboard, plus a zero-browser native Windows 11 tray flyout and one-click in-app side-panel opener. |

Healthy quota requests run every five seconds, independently of transcript reads. A slow conversation read does not hold up other apps' summary polling. Failures back off; cached quotas expire after 30 seconds or at their reported reset. Missing information stays unavailable rather than becoming an invented zero or full allowance.

## Standalone Windows 11 flyout

![Actual Antigravity Monitor native Windows 11 tray flyout](assets/banners/antigravity-monitor-flyout.jpg)

On Windows, **Open Monitor Dashboard** in the system tray toggles a native Win32 / GDI+ flyout pinned above the bottom-right corner of the taskbar — no Edge process, no WebView2 overhead, no taskbar icon, and zero idle polling when hidden. Press `T` to switch between Obsidian Dark and Alabaster Light, `R` to refresh, `Esc` to hide, click your account email to mask or reveal it, or click **Open in Antigravity Panel** to jump straight into your foreground Antigravity session.

## Choose your snippet

![Actual customization controls and composer snippet](assets/banners/antigravity-monitor-customization.jpg)

Click the composer readout, then expand **Customize snippet**. Choose context used, context remaining, 5-hour quota, weekly quota, model name, reset countdowns, and output `tok/s`. Changes preview immediately and save automatically. **Essentials** and **Full** remain quick presets.

The companion's preferences apply to its inline snippets across connected apps. Each native editor extension keeps its own status-bar preferences. Long snippets truncate within the composer; detailed readings remain available in the tooltip and card.

Banner UI captures come from the running application. Quotas and times are observations from capture time, not promises of a particular allowance. Banner artwork contains no release version so it can be reused.

## Privacy and security

Monitoring requests stay on loopback. The app does not proxy model traffic or send analytics. Backend request tokens remain in memory and are not included in dashboard snapshots. Account details are masked by default.

The monitor reads conversation state to calculate context usage. It stores aggregate usage and preferences locally; diagnostics can contain conversation titles and connection metadata. Review logs and screenshots before sharing them. DevTools access can control local app pages, so keep debugging endpoints local and use only trusted software. Read [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## Build and verify

```sh
npm ci
npm run compile
npm test
npm run package
```

The companion has no third-party runtime dependencies. Development tools are pinned in the lockfile. Run `npm run live` against a running Antigravity backend for local integration checks; its diagnostic output may include conversation titles.

See [Architecture](docs/ARCHITECTURE.md), [Audit and validation](docs/AUDIT.md), and [Release preparation](RELEASING.md) for implementation details and verification limits. The source, extension package, companion, and current release files use **v1.3.0**.

On Windows, run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-windows-launchers.ps1` before installing from source or building a complete companion release. Building needs the Windows .NET Framework C# compiler. Downloaded packages already contain the launchers and need no compiler. Run `scripts/check-windows-launchers.ps1` to verify embedded icons and launch targets.

## Known limits

- Quotas use polling, not server push. Backend latency, unsupported RPCs, and retry backoff can delay updates.
- Inline badges need a reachable DevTools endpoint. Native editor status bars do not.
- Native status bars use the measured conversation model. The white-app badge can also observe the model selected for the next response.
- Usage starts when monitoring begins. Cost figures are estimates, not subscription billing.
- Multiple windows sharing one backend can remain ambiguous. The monitor avoids choosing an unrelated conversation when selection is explicit.
- The current release is unsigned. Native macOS/Linux startup, screen readers, and high-contrast themes need further acceptance testing.

## Contribute & feedback

Antigravity Monitor is independently developed and maintained by [Benedictus RH (@benedictusrey)](https://github.com/benedictusrey). Reproducible bug reports, platform test results, clearer documentation, and focused pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [SUPPORT.md](SUPPORT.md) before sharing diagnostics.

## License

Created and maintained by [Benedictus RH (@benedictusrey)](https://github.com/benedictusrey). Released under the [MIT License](LICENSE), without warranty.

Antigravity Monitor is an independent community project. It is not affiliated with Google, Microsoft, or their products.
