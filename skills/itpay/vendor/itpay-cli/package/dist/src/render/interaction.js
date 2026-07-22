import { platformKeyForHost } from "./plan.js";
import { renderTerminalInteraction } from "./terminal.js";
import { renderInteractionMarkdown } from "./markdown.js";
import { renderPlainChatInteraction } from "./plain_chat.js";
import { renderTelegramInteraction } from "./telegram.js";
import { renderFeishuInteraction } from "./feishu.js";
export async function dispatchInteractionRequest(host, request, options = {}) {
    const key = platformKeyForHost(host);
    switch (key) {
        case "terminal":
            await renderTerminalInteraction(request, {
                isTTY: options.isTTY ?? Boolean(process.stdout.isTTY),
                ...(options.asciiWidth ? { asciiWidth: options.asciiWidth } : {}),
                ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
                ...(options.output ? { output: options.output } : {}),
            });
            return;
        case "markdown": {
            const md = renderInteractionMarkdown(request);
            const out = options.output ?? ((line) => process.stdout.write(line + "\n"));
            out(md);
            return;
        }
        case "telegram":
            if (!options.target) {
                throw new Error(`--target is required for host ${host}`);
            }
            renderTelegramInteraction(request, {
                target: options.target,
                ...(options.output ? { output: options.output } : {}),
            });
            return;
        case "feishu":
        case "lark":
            if (!options.target) {
                throw new Error(`--target is required for host ${host}`);
            }
            renderFeishuInteraction(request, {
                target: options.target,
                host: key,
                ...(options.output ? { output: options.output } : {}),
            });
            return;
        case "plain_chat":
        default:
            renderPlainChatInteraction(request, options.output ? { output: options.output } : {});
            return;
    }
}
