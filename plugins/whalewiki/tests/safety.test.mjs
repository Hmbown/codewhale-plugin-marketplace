import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scaffold, mdToHtml, exportHtml, scan, safeFile } from '../scripts/whalewiki.mjs';
const engine = fileURLToPath(new URL('../scripts/whalewiki.mjs', import.meta.url));
const server = fileURLToPath(new URL('../mcp/server.mjs', import.meta.url));
function fixture(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-safety-'));
  t.after(() => fs.rmSync(repo, {recursive:true,force:true}));
  const wiki = scaffold(repo);
  fs.writeFileSync(path.join(repo,'source.py'), 'if True:\n    print("a  b")\n');
  fs.writeFileSync(path.join(wiki,'pages','test.md'), '# Test\n\nRepository context.\n');
  const run = (...args) => execFileSync(process.execPath,[engine,...args], {cwd:repo,encoding:'utf8',env:{...process.env,WHALEWIKI_DIR:wiki},stdio:['pipe','pipe','pipe']});
  const seal = () => run('manifest','set','pages/test.md','--sources','source.py');
  const status = () => JSON.parse(run('status','--json'));
  seal(); return {repo,wiki,run,seal,status};
}
for (const [name,change] of [
  ['string whitespace','if True:\n    print("a b")\n'],
  ['Python indentation','if True:\nprint("a  b")\n'],
  ['comment directives','# type: ignore\nif True:\n    print("a  b")\n'],
]) test(`${name} changes cannot be classified as fresh`, t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.repo,'source.py'),change);
  assert.equal(f.status().pages[0].verdict,'stale');
  assert.throws(()=>f.run('status','--exit-stale'),e=>e.status===2);
});
test('page edits and deleted pages invalidate their seals',t=>{
  const f=fixture(t);fs.appendFileSync(path.join(f.wiki,'pages/test.md'),'Invented claim.');
  assert.equal(f.status().pages[0].page_changed,true);
  f.seal();assert.equal(f.status().counts.fresh,1);
  fs.unlinkSync(path.join(f.wiki,'pages/test.md'));assert.equal(f.status().counts.orphaned,1);
});
test('old manifests without page digests require a new seal',t=>{
  const f=fixture(t),p=path.join(f.wiki,'manifest.json'),m=JSON.parse(fs.readFileSync(p));
  m.version=1;delete m.pages['pages/test.md'].page_sha256;fs.writeFileSync(p,JSON.stringify(m));
  assert.equal(f.status().counts.unsealed,1);
});
test('sealing missing pages or empty evidence never creates a fresh receipt',t=>{
  const f=fixture(t);assert.throws(()=>f.run('manifest','set','pages/missing.md','--sources','source.py'));
  assert.throws(()=>f.run('manifest','set','pages/test.md'));
});
test('manifest traversal is rejected before export reads a private file',t=>{
  const f=fixture(t),p=path.join(f.wiki,'manifest.json'),m=JSON.parse(fs.readFileSync(p));
  m.pages['../private.md']={sources:[]};fs.writeFileSync(p,JSON.stringify(m));
  assert.throws(()=>exportHtml(f.wiki),/invalid manifest page/);
});
test('symlinked source parents are rejected, including links introduced after sealing', {skip:process.platform==='win32'},t=>{
  const f=fixture(t);fs.mkdirSync(path.join(f.repo,'actual'));fs.writeFileSync(path.join(f.repo,'actual','x.py'),'secret');
  fs.symlinkSync('actual',path.join(f.repo,'link'));
  assert.throws(()=>f.run('manifest','set','pages/test.md','--sources','link/x.py'));
  fs.unlinkSync(path.join(f.repo,'source.py'));fs.symlinkSync('actual/x.py',path.join(f.repo,'source.py'));
  assert.equal(f.status().counts.orphaned,1);
});
test('wiki read and search refuse symlink pages', {skip:process.platform==='win32'},t=>{
  const f=fixture(t);fs.unlinkSync(path.join(f.wiki,'pages/test.md'));fs.symlinkSync('../../source.py',path.join(f.wiki,'pages/test.md'));
  assert.throws(()=>exportHtml(f.wiki),/symlink/);
  assert.throws(()=>f.run('search','print'));
});
test('file reads reject directories and oversized inputs',t=>{
  const f=fixture(t);assert.throws(()=>safeFile(f.repo,'whalewiki'),/regular file/);
  fs.writeFileSync(path.join(f.repo,'huge.txt'),Buffer.alloc(2*1024*1024+1));
  assert.throws(()=>safeFile(f.repo,'huge.txt'),/exceeds/);
});
test('scaffold copies the engine when imported and preserves the human brief',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.wiki,'INSTRUCTIONS.md'),'Keep this brief.');scaffold(f.repo);
  assert.equal(fs.readFileSync(path.join(f.wiki,'INSTRUCTIONS.md'),'utf8'),'Keep this brief.');
  assert.equal(fs.readFileSync(path.join(f.wiki,'.tool/status.mjs'),'utf8'),fs.readFileSync(engine,'utf8'));
});
test('status and export do not mutate files or create receipts unless requested',t=>{
  const f=fixture(t),before=fs.readFileSync(path.join(f.wiki,'manifest.json'),'utf8');f.status();exportHtml(f.wiki);
  assert.equal(fs.existsSync(path.join(f.wiki,'.last-run.json')),false);
  assert.equal(fs.readFileSync(path.join(f.wiki,'manifest.json'),'utf8'),before);
  f.run('status','--receipt');assert.ok(fs.existsSync(path.join(f.wiki,'.last-run.json')));
});
test('scan honors gitignore and skips private dotfiles',t=>{
  const f=fixture(t);execFileSync('git',['init','-q'],{cwd:f.repo});
  fs.writeFileSync(path.join(f.repo,'.gitignore'),'ignored.py\n');
  fs.writeFileSync(path.join(f.repo,'ignored.py'),'def private_name(): pass');fs.writeFileSync(path.join(f.repo,'.env'),'credential');
  const paths=scan(f.repo).inventory.map(x=>x.path);assert.ok(paths.includes('source.py'));assert.ok(!paths.includes('ignored.py'));assert.ok(!paths.includes('.env'));
});
test('export escapes HTML and unsafe URLs including markup inside link destinations',()=>{
  const html=mdToHtml('<img src=x onerror=alert(1)>\n\n[t](javascript:alert) [t](data:text/html,x) [t](https://x.test/"onclick="x) [t](https://x.test/**q**)');
  assert.ok(!html.includes('<img'));assert.ok(!html.includes('href="javascript:'));assert.ok(!html.includes('href="data:'));
  assert.ok(!html.includes('href="https://x.test/<strong>'));assert.match(html,/&quot;|%22/);
});
test('code spans are literal and relative wiki links resolve from the current page',()=>{
  const html=mdToHtml('`[x](javascript:run)`\n\n[Next](next.md#hello)\n\n# Hello','pages/test.md');
  assert.match(html,/<code>\[x\]\(javascript:run\)<\/code>/);assert.match(html,new RegExp(`href="#p-${Buffer.from('pages/next.md').toString('base64url')}--hello"`));
});
function rpc(f,input,cwd=path.dirname(server)) {
  const result=spawnSync(process.execPath,[server],{cwd,encoding:'utf8',input,env:{...process.env,WHALEWIKI_DIR:''},timeout:10000});
  assert.equal(result.status,0,result.stderr);return result.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
}
const call=(id,name,args)=>JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}})+'\n';
test('MCP uses explicit workspace from an installed directory and remains read-only',t=>{
  const f=fixture(t);let input=JSON.stringify({jsonrpc:'2.0',id:0,method:'tools/list'})+'\n';
  for(const [i,name] of ['wiki_structure','wiki_read','wiki_search','wiki_status','wiki_codemap'].entries())input+=call(i+1,name,{workspace:f.repo,page:'pages/test.md',query:'context'});
  const out=rpc(f,input);assert.equal(out[0].result.tools.length,6);assert.ok(out[0].result.tools.every(x=>x.annotations.readOnlyHint));
  assert.match(out[2].result.content[0].text,/freshness: fresh/);assert.match(out[3].result.content[0].text,/fresh/);
  assert.equal(fs.existsSync(path.join(f.wiki,'.last-run.json')),false);
});
test('MCP rejects non-page reads and malformed arguments',t=>{
  const f=fixture(t);const out=rpc(f,call(1,'wiki_read',{workspace:f.repo,page:'manifest.json'})+call(2,'wiki_search',{workspace:f.repo,query:'x',max_results:-1}));
  assert.ok(out.every(x=>x.result.isError));
});
test('MCP handles parse errors, null, notifications and subsequent valid requests',t=>{
  const f=fixture(t);const out=rpc(f,'garbage\nnull\n'+JSON.stringify({jsonrpc:'2.0',method:'tools/list'})+'\n'+JSON.stringify({jsonrpc:'2.0',id:9,method:'ping'})+'\n');
  assert.equal(out.length,3);assert.equal(out[0].error.code,-32700);assert.equal(out[1].error.code,-32600);assert.equal(out[2].id,9);
});
test('MCP discards oversized frames and recovers at the next newline',t=>{
  const f=fixture(t);const out=rpc(f,'x'.repeat(300*1024)+'\n'+JSON.stringify({jsonrpc:'2.0',id:3,method:'ping'})+'\n');
  assert.equal(out.length,2);assert.match(out[0].error.message,/256 KiB/);assert.equal(out[1].id,3);
});

test('MCP impact returns scoped evidence without creating receipts',t=>{
  const f=fixture(t);
  const out=rpc(f,call(1,'wiki_impact',{workspace:f.repo,paths:['source.py','missing.py']})+call(2,'wiki_impact',{workspace:f.repo,paths:['../private']}));
  const report=JSON.parse(out[0].result.content[0].text);
  assert.equal(report.pages[0].verdict,'fresh');assert.deepEqual(report.uncovered,['missing.py']);
  assert.equal(out[1].result.isError,true);
  assert.equal(fs.existsSync(path.join(f.wiki,'.last-run.json')),false);
});
