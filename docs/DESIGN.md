# v1.0.0 interface and visual design

The main question is: does this reading belong to the conversation on screen?

Objects: a renderer, its backend port, visible conversation identity, context used/remaining, measurement source, model quota, weekly account quota, and reading time. New thread, switching, unknown selection, disconnected, and measured conversation are separate states. Missing readings never mean zero usage or full quota. The UI is glanced at beside the composer, then opened for detail.

Chosen direction: true-black flat with the host palette and type. The compact card follows the existing composer; the dashboard groups peer readings in rows. Four tabs keep navigation usable in a narrow editor panel. Wide windows use paired overview sections, dense facts, and two-column settings; narrow windows return to one column.

Tokens: ground #101010, surface #202020, raised #2a2a2a, text #f5f5f5, secondary #b4b4b4, data blue #4daafc. Host CSS variables override these values for light and high-contrast themes. Use the host sans face, 14px data, 12px metadata, 24-30px primary readings, and tabular figures. No remote fonts or decorative animation.

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
