import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const json = p => JSON.parse(readFileSync(new URL('../'+p, import.meta.url), 'utf8'));
test('stable remote-only product with host-neutral shared Skill',()=>{
 const p=json('plugin.json'),m=json('mcp.json');
 assert.equal(p.name,'itpay-plugin-chatgpt');
 assert.equal(m.mcpServers.itpay.type,'streamable-http');
 assert.equal(new URL(m.mcpServers.itpay.url).pathname,'/hub/mcp');
 assert.deepEqual(Object.keys(m.mcpServers),['itpay']);
 const skill=readFileSync(new URL('../skills/itpay-services/SKILL.md',import.meta.url),'utf8');
 assert.match(skill,/connected ItPay MCP in the current host/);assert.doesNotMatch(skill,/both ChatGPT and Codex/);assert.match(skill,/Do not install or invoke a/);
 assert.deepEqual(readdirSync(new URL('../skills/',import.meta.url)),['itpay-services']);
 assert.ok(!JSON.stringify(m).includes('command'));
 const workflow=readFileSync(new URL('../.github/workflows/sync-itpay-mcp.yml',import.meta.url),'utf8');
 assert.ok(!workflow.includes('itpay-cli-published'));assert.ok(!workflow.includes('npm-channel'));
});
