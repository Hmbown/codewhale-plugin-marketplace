import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const engine=fileURLToPath(new URL('../scripts/whalewiki.mjs',import.meta.url));
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ww-write-security-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const repo=path.join(dir,'repo');fs.mkdirSync(repo);
  assert.equal(spawnSync('git',['init','-q'],{cwd:repo}).status,0);
  fs.writeFileSync(path.join(repo,'source.js'),'export const x=1;\n');
  const run=(args,env={})=>spawnSync(process.execPath,[engine,...args],{cwd:repo,encoding:'utf8',env:{...process.env,WHALEWIKI_DIR:path.join(repo,'whalewiki'),...env}});
  const made=run(['scaffold']);assert.equal(made.status,0,made.stderr);
  return {dir,repo,wiki:path.join(repo,'whalewiki'),run};
}
const writers=[
  ['codemap.md',['map']],['INDEX.md',['status','--mark']],['.last-run.json',['status','--receipt']],
  ['.tool/status.mjs',['scaffold']],['INSTRUCTIONS.md',['scaffold']],['whalewiki.toml',['scaffold']],
  ['manifest.json',['scaffold']],['whalewiki.html',['export']],
];
for(const dangling of [false,true]) test(`wiki writers reject ${dangling?'dangling':'existing'} symlink leaves`,{skip:process.platform==='win32'},t=>{
  for(const [rel,args] of writers) {
    const f=fixture(t),dest=path.join(f.wiki,rel),outside=path.join(f.dir,'outside');
    fs.rmSync(dest,{force:true});
    if(!dangling) fs.writeFileSync(outside,'unchanged');
    fs.symlinkSync(outside,dest);
    const result=f.run(args);
    assert.notEqual(result.status,0,`${rel}: ${result.stdout}`);
    assert.match(result.stderr,/symlink/);
    assert.equal(fs.existsSync(outside),!dangling);
    if(!dangling) assert.equal(fs.readFileSync(outside,'utf8'),'unchanged');
  }
});

test('wiki scaffold and map reject linked directories, including a missing destination below one', {skip:process.platform==='win32'},t=>{
  for(const rel of ['whalewiki','whalewiki/.tool','whalewiki/pages','redirect']) {
    const f=fixture(t),outside=path.join(f.dir,'outside');fs.mkdirSync(outside);
    const dest=path.join(f.repo,rel);fs.rmSync(dest,{recursive:true,force:true});fs.symlinkSync(outside,dest,'dir');
    const env=rel==='redirect'?{WHALEWIKI_DIR:path.join(dest,'new-wiki')}:{};
    for(const cmd of rel==='whalewiki'||rel==='redirect'?['scaffold','map']:['scaffold']) {
      const result=f.run([cmd],env);assert.notEqual(result.status,0);assert.match(result.stderr,/symlink/);
    }
    assert.deepEqual(fs.readdirSync(outside),[]);
  }
});

test('wiki export rejects a linked output parent and supports an explicit external file', {skip:process.platform==='win32'},t=>{
  const f=fixture(t),outside=path.join(f.dir,'outside');fs.mkdirSync(outside);
  fs.symlinkSync(outside,path.join(f.repo,'export-link'),'dir');
  const rejected=f.run(['export','--out','export-link/wiki.html']);
  assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/symlink/);assert.deepEqual(fs.readdirSync(outside),[]);
  const accepted=f.run(['export','--out',path.join(outside,'wiki.html')]);
  assert.equal(accepted.status,0,accepted.stderr);assert.match(fs.readFileSync(path.join(outside,'wiki.html'),'utf8'),/<!doctype html>/i);
});

test('atomic wiki writes replace a hardlink without modifying its other name', t=>{
  const f=fixture(t),outside=path.join(f.dir,'outside');fs.writeFileSync(outside,'unchanged');
  fs.linkSync(outside,path.join(f.wiki,'codemap.md'));
  const result=f.run(['map']);assert.equal(result.status,0,result.stderr);
  assert.equal(fs.readFileSync(outside,'utf8'),'unchanged');
  assert.match(fs.readFileSync(path.join(f.wiki,'codemap.md'),'utf8'),/source.js/);
});
