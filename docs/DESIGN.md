# v1.1.0 interface and visual design

The main question is: does this reading belong to the conversation on screen?

Objects: a renderer, its backend port, visible conversation identity, parent/subagent hierarchy, context used/remaining, output speed (`tok/s`), token composition (fresh input, cache read, cache write, output), measurement source, model quota pool, weekly account quota, and reading time. New thread, switching, unknown selection, disconnected (`Standby`), and measured conversation are separate states. Missing readings never mean zero usage or full quota.

Chosen direction: `data-terminal` architectural layout with crisp `1px` hairline divisions (`--border`, `--rule`) and a single `2px` `--accent` selection line, eliminating padded card voids while keeping host `--vscode-*` overrides intact for light, dark, and high-contrast themes. Wide viewports pair the `36px` context figure, threshold ruler, and composition bar flush against side-by-side `5-hour` / `Weekly` quota pools, followed by a 4-cell KPI strip (`Output speed`, `Cache hit ratio`, `Session API equiv.`, `Observed today`) and a balanced `Session ledger` / `Daily usage` split.

Tokens: dark ground `#111216`, surface `#16181e`, alt `#1b1e26`, border `#252833`, text `#f2f4f8`, muted `#8b91a0`, signal blue `#4a8ad6`; light ground `#f3f5f8`, surface `#ffffff`, alt `#f0f2f6`, border `#d8dde6`, text `#111318`, muted `#505766`, signal blue `#0957c3`. Tabular figures everywhere; no remote fonts, no resting shadows, no gradients.

The visible conversation state becomes the card's primary reading. This differs from the old percentage-first design: a new thread is named explicitly rather than represented by an old percentage or invented zero.

Compact layout, left aligned:

    App                         source
    Conversation title / New thread
    Context percentage OR readiness state
    Used / capacity             Remaining
    Model                       value
    5-hour quota                remaining/reset
    Weekly quota                remaining/reset
    Weekly source / last checked
    Display controls
    Copy                        Refresh

Both quota windows use the local RetrieveUserQuotaSummary request verified in the installed app's Usage menu implementation. Keep Gemini and Claude/GPT groups separate. Poll independently every five seconds, retain source timestamps on failures, and age readings locally. Cached values expire after 30 seconds or at reset. No account Settings interaction or remote API is required. The selected composer model determines quota identity; measured context retains its response model.

Six native checkbox controls customize the small snippet inside a collapsed details section. Essentials and Full remain presets. Dashboard controls share the same setting keys; native editor preferences remain scoped to their own installation. Preserve a clickable Monitor fallback when all fields are hidden.

The logo combines an upward folded mark with three measured telemetry bars. The SVG is the scalable source; the PNG is rendered from it. Release banners use actual app screenshots and no version text. The captured new-thread state is retained rather than inventing a populated conversation for marketing.

Review against brief: remove nested fact boxes and tiny uppercase labels; keep the host's neutral appearance. The distinguishing element is the visible-conversation state, with account quota independent from conversation context. Color marks data or risk, not navigation. User-triggered transitions only; reduced motion disables travel.
