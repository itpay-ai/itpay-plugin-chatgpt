# ItPay remote MCP candidate

This branch is the independent Dot remote product. It contains no CLI, bundled
runtime, npm installer or fallback command. Existing CLI tasks remain at their
original entry and identity.

## Candidate status

Version `3.1.0-pa.1`, query scope: two fixed railway searches and original saved
result/page reads. Queries create persistent runs and may consume declared
entitlements; they are not labelled read-only. No purchase, aftercare write,
credits, subscription or digital-service upsell is in this package.

The exact new HTTPS `/agent/mcp` endpoint and OAuth registration are **pending**.
`mcp.template.json` is deliberately disabled and is not an installable MCP
configuration. Do not install this unpaired source as a working native product.
A reviewed exact endpoint/client/resource pairing is required before Testing;
the old `/hub/mcp` registration or a loopback fixture is not that evidence.

`SOURCE.json` records the V4 source, generated catalogue and Skill hashes. The
fixed builder is `apps/mcp/scripts/build-chat-packages.py --personal-agent` in
Compose V4. Run it with the reviewed public endpoint and client ID only after
pairing review; the builder itself never registers, deploys, uploads or approves.

Local checks: `npm test` checks the payload hashes, remote-only boundary and
pending connection status. Native Dot experience and platform approval remain
separate, unobserved gates. Actions are manual and need explicit per-run approval.
