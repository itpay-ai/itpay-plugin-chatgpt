// V3 render plan: the contract between `buy` / `checkout` and the
// per-host renderers. The CLI builds a `RenderPlan` from the canonical
// V3 checkout response, then `selectPlatform` picks the host-specific
// `RenderPlatform` payload. Each renderer is pure: it takes a plan and
// a sink and writes to stdout/stderr. No HTTP, no state mutation.
//
// Mirrors V1's `lib/render-human.js` shape: `kind` is the high-level
// action the buyer needs to take (`auth_qr` or `payment_qr`); `host`
// is the consumer; `links` and `presentation` carry the brand assets.
// Pick the platform key for a given host. Discord / WhatsApp and
// unrecognised hosts fall back to plain-chat, matching V1.
export function platformKeyForHost(host) {
    switch (host) {
        case "terminal":
            return "terminal";
        case "codex":
        case "claude-code":
            return "markdown";
        case "telegram":
            return "telegram";
        case "feishu":
            return "feishu";
        case "lark":
            return "lark";
        case "discord":
        case "whatsapp":
        case "plain-chat":
        default:
            return "plain_chat";
    }
}
