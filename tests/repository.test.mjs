import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {packagePlugin,ROOT} from '../scripts/package-plugin.mjs';
test('vendored integrations match every pinned Core source hash',()=>{
  const pin=JSON.parse(fs.readFileSync(new URL('../integrations/upstream.json',import.meta.url)));
  assert.match(pin.commit,/^[a-f0-9]{40}$/);
  for(const [rel,hash] of Object.entries(pin.files))assert.equal(createHash('sha256').update(fs.readFileSync(path.join(ROOT,rel))).digest('hex'),hash,rel);
});
test('connection recipes remain outside the installable plugin catalog',()=>{
  const catalog=JSON.parse(fs.readFileSync(path.join(ROOT,'marketplace.json'))),connections=JSON.parse(fs.readFileSync(path.join(ROOT,'connections/catalog.json')));
  for(const c of connections.connections){assert.ok(!catalog.plugins.some(p=>p.name===c.id));assert.equal(new URL(c.url).protocol,'https:');assert.ok(c.docs&&c.status);}
});
test('packaged Computer Use fits the host cap and excludes local recordings and receipts',t=>{
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'cw-package-'));t.after(()=>fs.rmSync(out,{recursive:true,force:true}));
  const r=packagePlugin('computer-use',out);assert.ok(r.bytes<5*1024*1024);assert.ok(fs.existsSync(path.join(r.path,'mcp/server.mjs')));assert.ok(!fs.existsSync(path.join(r.path,'receipts')));
  assert.throws(()=>packagePlugin('computer-use',out),/already exists/);
});
test('packaged WhaleWiki serves five real tools from an unrelated working directory',t=>{
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'cw-wiki-package-'));t.after(()=>fs.rmSync(out,{recursive:true,force:true}));
  const r=packagePlugin('whalewiki',out),manifest=JSON.parse(fs.readFileSync(path.join(r.path,'plugin.json')));
  assert.equal(manifest.extensions['net.codewhale'].hooks,undefined);
  const response=execFileSync(process.execPath,[path.join(r.path,'mcp/server.mjs')],{cwd:out,encoding:'utf8',input:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n'});
  assert.equal(JSON.parse(response).result.tools.length,5);
});
function contractFixture(t,source='plugins/test') {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cw-contract-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'scripts'));fs.copyFileSync(path.join(ROOT,'scripts/check-marketplace.mjs'),path.join(root,'scripts/check-marketplace.mjs'));
  fs.mkdirSync(path.join(root,source),{recursive:true});
  execFileSync('git',['init','-q'],{cwd:root});
  const manifest={name:'test',version:'1.0.0',extensions:{'net.codewhale':{capabilities:{network_hosts:['example.com']}}}};
  fs.writeFileSync(path.join(root,source,'plugin.json'),JSON.stringify(manifest));
  fs.writeFileSync(path.join(root,source,'mcp.json'),JSON.stringify({mcpServers:{remote:{url:'https://example.com/mcp'}}}));
  fs.writeFileSync(path.join(root,'marketplace.json'),JSON.stringify({name:'fixture',plugins:[{name:'test',version:'1.0.0',description:'Fixture',source:`path:${source}`}]}));
  return {root,source,manifest,run:()=>spawnSync(process.execPath,['scripts/check-marketplace.mjs'],{cwd:root,encoding:'utf8'})};
}
test('catalog path text cannot execute shell substitutions during size checking',{skip:process.platform==='win32'},t=>{
  const f=contractFixture(t,'plugins/$(touch INJECTED)');assert.equal(f.run().status,0);assert.equal(fs.existsSync(path.join(f.root,'INJECTED')),false);
});
test('MCP contract rejects undeclared and unused hosts',t=>{
  const f=contractFixture(t);f.manifest.extensions['net.codewhale'].capabilities.network_hosts=['unrelated.example'];
  fs.writeFileSync(path.join(f.root,f.source,'plugin.json'),JSON.stringify(f.manifest));
  const r=f.run();assert.equal(r.status,1);assert.match(r.stderr,/does not declare/);assert.match(r.stderr,/no remote endpoint/);
});
test('malformed MCP server maps fail with a useful diagnostic',t=>{
  const f=contractFixture(t);fs.writeFileSync(path.join(f.root,f.source,'mcp.json'),'{"mcpServers":null}');
  const r=f.run();assert.equal(r.status,1);assert.match(r.stderr,/must be an object/);
});
test('packaging reflects working-tree deletions and refuses output inside its source',t=>{
  const f=contractFixture(t);
  fs.copyFileSync(path.join(ROOT,'scripts/package-plugin.mjs'),path.join(f.root,'scripts/package-plugin.mjs'));
  const removed=path.join(f.root,f.source,'removed.txt');fs.writeFileSync(removed,'deleted before packaging');
  execFileSync('git',['add','--',f.source],{cwd:f.root});fs.unlinkSync(removed);
  const r=spawnSync(process.execPath,['scripts/package-plugin.mjs','test'],{cwd:f.root,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);assert.ok(fs.existsSync(path.join(f.root,'dist/test/plugin.json')));
  assert.ok(!fs.existsSync(path.join(f.root,'dist/test/removed.txt')));
  const nested=spawnSync(process.execPath,['scripts/package-plugin.mjs','test','--out',f.source],{cwd:f.root,encoding:'utf8'});
  assert.equal(nested.status,1);assert.match(nested.stderr,/outside the source/);
});
test('packaging rejects a symlinked source directory',{skip:process.platform==='win32'},t=>{
  const f=contractFixture(t);fs.copyFileSync(path.join(ROOT,'scripts/package-plugin.mjs'),path.join(f.root,'scripts/package-plugin.mjs'));
  fs.renameSync(path.join(f.root,f.source),path.join(f.root,'actual'));
  fs.symlinkSync(path.join(f.root,'actual'),path.join(f.root,f.source),'dir');
  const r=spawnSync(process.execPath,['scripts/package-plugin.mjs','test'],{cwd:f.root,encoding:'utf8'});
  assert.equal(r.status,1);assert.match(r.stderr,/symlink/);
});
