"""Apply exactly the four pure-MCP product files; never execute ZIP contents."""
import argparse, hashlib, json
from pathlib import Path
import zipfile

ALLOWED={'plugin.json','mcp.json','skills/itpay-services/SKILL.md','LICENSE'}
parser=argparse.ArgumentParser();parser.add_argument('zip');parser.add_argument('sha256');args=parser.parse_args()
raw=Path(args.zip).read_bytes()
if hashlib.sha256(raw).hexdigest()!=args.sha256:raise SystemExit('Package SHA-256 mismatch')
root=Path(__file__).resolve().parents[1]
with zipfile.ZipFile(args.zip) as z:
 if set(z.namelist())!=ALLOWED or len(z.namelist())!=len(ALLOWED):raise SystemExit('Unexpected package paths')
 manifest=json.loads(z.read('plugin.json'))
 if manifest['name']!='itpay-plugin-chatgpt':raise SystemExit('Stable identity changed')
 config=json.loads(z.read('mcp.json'))
 if set(config['mcpServers'])!={'itpay'} or config['mcpServers']['itpay']['type']!='streamable-http':raise SystemExit('Remote MCP required')
 for name in ALLOWED:
  if z.getinfo(name).external_attr >> 16 & 0o170000 == 0o120000:raise SystemExit('No symlinks')
  p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(z.read(name))
