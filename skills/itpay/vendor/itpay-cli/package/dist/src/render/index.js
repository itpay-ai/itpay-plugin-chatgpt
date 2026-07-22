// Render plan entry point. `dispatch` runs the right renderer based
// on the host. Desktop Markdown and terminal renderers prepare a local
// image; plain-chat and IM renderers keep the server URL and never create
// an unused local attachment.
import { renderTerminal } from "./terminal.js";
import { renderMarkdown } from "./markdown.js";
import { renderPlainChat } from "./plain_chat.js";
import { renderTelegram } from "./telegram.js";
import { renderFeishu } from "./feishu.js";
import { platformKeyForHost } from "./plan.js";
import { ensureIdeImageAttach } from "./ide.js";
export async function dispatchRender(plan, options) {
    const key = platformKeyForHost(plan.host);
    if (key === "markdown" || key === "terminal") {
        await ensureIdeImageAttach(plan, options);
    }
    switch (key) {
        case "terminal": {
            const terminalOptions = {
                format: options.qrFormat ?? "terminal",
                isTTY: options.isTTY ?? Boolean(process.stdout.isTTY),
                ...(options.asciiWidth ? { asciiWidth: options.asciiWidth } : {}),
                ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
                ...(options.qrFilePath ? { qrFilePath: options.qrFilePath } : {}),
                ...(options.output ? { output: options.output } : {}),
                ...(options.baseURL ? { baseURL: options.baseURL } : {}),
            };
            await renderTerminal(plan, terminalOptions);
            return;
        }
        case "markdown":
            renderMarkdown(plan, options.output ? { output: options.output } : {});
            return;
        case "telegram":
            if (!options.target) {
                throw new Error(`--target is required for host ${plan.host}`);
            }
            renderTelegram(plan, {
                target: options.target,
                ...(options.output ? { output: options.output } : {}),
            });
            return;
        case "feishu":
        case "lark":
            if (!options.target) {
                throw new Error(`--target is required for host ${plan.host}`);
            }
            renderFeishu(plan, {
                target: options.target,
                host: key,
                ...(options.output ? { output: options.output } : {}),
            });
            return;
        case "plain_chat":
        default:
            renderPlainChat(plan, options.output ? { output: options.output } : {});
            return;
    }
}
