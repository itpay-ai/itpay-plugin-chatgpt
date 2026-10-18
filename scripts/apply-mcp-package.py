"""Apply exactly the four pure-MCP product files; never execute ZIP contents."""
import argparse, hashlib, json, re
from pathlib import Path
import zipfile

ALLOWED={'plugin.json','mcp.json','skills/itpay-services/SKILL.md','LICENSE'}
parser=argparse.ArgumentParser();parser.add_argument('zip');parser.add_argument('sha256');parser.add_argument('--source-commit',required=True);args=parser.parse_args()
if not re.fullmatch(r'[0-9a-f]{40}',args.source_commit):raise SystemExit('Full reviewed source commit required')
raw=Path(args.zip).read_bytes()
if hashlib.sha256(raw).hexdigest()!=args.sha256:raise SystemExit('Package SHA-256 mismatch')
root=Path(__file__).resolve().parents[1]
with zipfile.ZipFile(args.zip) as z:
 if set(z.namelist())!=ALLOWED or len(z.namelist())!=len(ALLOWED):raise SystemExit('Unexpected package paths')
 manifest=json.loads(z.read('plugin.json'))
 if manifest['name']!='itpay-plugin-chatgpt':raise SystemExit('Stable identity changed')
 config=json.loads(z.read('mcp.json'))
 if set(config['mcpServers'])!={'itpay'} or config['mcpServers']['itpay']['type']!='streamable-http':raise SystemExit('Remote MCP required')
 changed=any(not (root/name).exists() or (root/name).read_bytes()!=z.read(name) for name in ALLOWED)
 for name in ALLOWED:
  if z.getinfo(name).external_attr >> 16 & 0o170000 == 0o120000:raise SystemExit('No symlinks')
  p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(z.read(name))

 if changed:
  (root/'SOURCE.json').write_text(json.dumps({'repository':'itpay-ai/compose-v4','source_commit':args.source_commit,'version':manifest['version'],'package_sha256':args.sha256,'skill_sha256':hashlib.sha256(z.read('skills/itpay-services/SKILL.md')).hexdigest(),'scope':'MCP package candidate; connection and activation separately reviewed'},indent=2)+'\n')
 else:print('No product change; existing valid source provenance retained.')
