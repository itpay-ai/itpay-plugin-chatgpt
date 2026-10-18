# ItPay for ChatGPT & Codex — review candidate

Stable plugin identity: `itpay-plugin-chatgpt`. This replaces the bundled CLI
product with the same remote MCP entry in ChatGPT and Codex. MIT license and Git
history retained. No Node, CLI, vendor or Seller runtime is bundled.

**Not activated:** checked-in configuration may be loopback engineering-only.
A publicly reachable approved MCP deployment, OAuth client/resource/profile and
private host connection must be verified before use. Creating this PR/package
does not deploy, register, submit or approve purchasing on a platform.

Core source and builder: `itpay-ai/compose-v4`,
`apps/mcp/skills/itpay-services/SKILL.md` and
`apps/mcp/scripts/build-chat-packages.py`. `delivery.json` records exact source,
configuration, file hashes and ZIP hash outside the product package.

Sync only via `Sync fixed ItPay MCP candidate`: fixed V4 commit, public client,
verified endpoint and expected ZIP hash; it creates a PR. No schedule, npm/latest,
CLI publish listener or automatic merge. Missing scoped GitHub App permissions
is an explicit workflow failure, not permission to fall back to old CLI sync.

Run repository checks with `node --test tests/*.test.mjs`.
For upgrades, replace the old plugin through the host's normal installer; do not
uninstall the independent CLI or copy Device identity into MCP. Explicit CLI
requests keep their original entry. Existing tasks restore their original owner.

Natural ChatGPT/Codex co-install and commerce review remain pending. No real
payment, deployment or market submission occurs in this repository candidate.
