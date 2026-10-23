import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const source=JSON.parse(readFileSync(new URL('SOURCE.json',root),'utf8'));
test('Remote candidate payload exactly matches fixed source hashes and version',()=>{
 for(const [path,digest]of Object.entries(source.files))assert.equal(createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex'),digest,path);
 const plugin=JSON.parse(readFileSync(new URL('plugin.json',root),'utf8'));
 const pkg=JSON.parse(readFileSync(new URL('package.json',root),'utf8'));
 assert.equal(plugin.version,source.version);assert.equal(pkg.version,source.version);assert.equal(source.protocol,'itpay.agent.v1');assert.equal(source.scope,'query');
});
test('Missing real OAuth pairing remains disabled, with no legacy grant or credential substitute',()=>{
 assert.equal(source.pairing_status,'pending');assert.equal(source.mcp_url,null);assert.equal(source.oauth_client_id,null);assert.equal(existsSync(new URL('mcp.json',root)),false);
 const template=JSON.parse(readFileSync(new URL('mcp.template.json',root),'utf8'));assert.equal(template.activation,'disabled');assert.equal(template.resource_path,'/agent/mcp');assert.equal(template.endpoint,null);
 const skill=readFileSync(new URL('skills/itpay-services/SKILL.md',root),'utf8');assert.match(skill,/do not install or invoke CLI/i);assert.match(skill,/2–4 line route brief/);assert.match(skill,/no buying tools/);assert.match(skill,/untrusted data/);
 assert.equal(existsSync(new URL('.github/workflows/sync-itpay-cli.yml',root)),false);
});
test('The remote source contains no CLI runtime or launcher',()=>{
 function walk(url){if(!existsSync(url))return [];return readdirSync(url,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(new URL(e.name+'/',url)):[e.name]);}
 assert.deepEqual(walk(new URL('skills/itpay/',root)),[]);
 assert.equal(existsSync(new URL('skills/itpay/scripts/itpay.mjs',root)),false);
});
