// Markdown renderer for Codex / Claude Code hosts.
// Always produces a full output: header, order table, branded QR image,
// clickable links, checkout/payment IDs, and next-step instructions.
// Every section is mandatory — the agent must display all of it.
export function renderMarkdown(plan, options = {}) {
    const out = options.output ?? ((line) => process.stdout.write(line + "\n"));
    const handoff = buildAgentChatHandoff(plan);
    out(`> AGENT ACTION REQUIRED: ${handoff.instruction}\n\n${handoff.markdown}`);
}
export function buildAgentChatHandoff(plan) {
    const lines = ["### ItPay 付款"];
    const attach = plan.ideImageAttach;
    if (attach?.status === "downloaded" && attach.localPath) {
        lines.push("", `![ItPay 付款二维码](<${attach.localPath}>)`);
    }
    else {
        lines.push("", `> 二维码暂不可用：${attach?.error ?? attach?.status ?? "not prepared"}`);
    }
    const paymentLink = plan.platform.links[0]?.url;
    if (paymentLink)
        lines.push("", `[打开 ItPay 付款页面](${paymentLink})`);
    const totalMinor = plan.orderItems?.reduce((sum, item) => sum + item.amountMinor * item.quantity, 0) ?? 0;
    lines.push("", `金额：**${formatPrice(totalMinor, plan.orderCurrency ?? "CNY")}**`);
    if (plan.orderItems?.length) {
        lines.push(`项目：${plan.orderItems.map((item) => `${item.title} x${item.quantity}`).join("、")}`);
    }
    if (plan.afterActionCommand) {
        lines.push("", `付款后查询：\`${plan.afterActionCommand}\``);
    }
    return {
        type: "send_payment_handoff",
        must_send_to_user: true,
        instruction: "把下面的 Markdown 原样发送到当前聊天；二维码和付款链接都对用户可见后，才能等待付款。不要只展示工具调用或文件路径。",
        markdown: lines.join("\n"),
        ...(plan.afterActionCommand ? { after_visible_action: { command: plan.afterActionCommand } } : {}),
    };
}
export function renderInteractionMarkdown(request) {
    if (request.kind === "input") {
        return renderInputMarkdown(request);
    }
    return renderSelectorMarkdown(request);
}
function renderInputMarkdown(req) {
    const lines = [];
    lines.push(`### :envelope: ${req.title}`);
    lines.push("");
    lines.push(`> ${req.prompt}`);
    lines.push("");
    for (const field of req.fields) {
        lines.push(`- **${field.label}** (\`${field.id}\`, ${field.inputType}${field.required ? ", 必填" : ""})`);
        if (field.placeholder)
            lines.push(`  placeholder: ${field.placeholder}`);
        if (field.description)
            lines.push(`  ${field.description}`);
    }
    const template = buildInputTemplate(req.fields);
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(template, null, 2));
    lines.push("```");
    return lines.join("\n");
}
function renderSelectorMarkdown(req) {
    const lines = [];
    const mode = req.selectionMode === "multiple" ? "多选" : "单选";
    lines.push(`### ${req.title}`);
    lines.push("");
    lines.push(`> ${req.prompt} (${mode})`);
    lines.push("");
    for (const opt of req.options) {
        lines.push(`- ${opt.label} -> \`${opt.value}\``);
        if (opt.description)
            lines.push(`  ${opt.description}`);
    }
    return lines.join("\n");
}
function buildInputTemplate(fields) {
    return Object.fromEntries(fields.map((field) => [field.id, `<${field.inputType}>`]));
}
function formatPrice(amountMinor, currency) {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`;
}
