#!/usr/bin/env node
// One mirror of Core's active catalog, including runtime resources. Historical
// migration bodies are Core installer fixtures, not installable skill content.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const DEST=path.join(ROOT,'skills');
const SOURCE='crates/tui/assets/skills';
const MATRIX='crates/tui/assets/skills-catalog-matrix.json';
const hash=data=>createHash('sha256').update(data).digest('hex');
const args=process.argv.slice(2);
const coreIndex=args.indexOf('--core');
const core=coreIndex<0?null:path.resolve(args[coreIndex+1]||'');
const write=args.includes('--write');
const groups={
  'Build and maintain software':'plan implement debug test review security-review simplify verify batch dependency-update release github handoff best-of-n interview',
  'Research and make things':'research frontend-design webapp-testing document dataviz docx pdf pptx xlsx documents presentations spreadsheets image-search',
  'Everyday tasks':'gmail google-calendar flights shopping money photos spotify tts podcast goals forget',
  'Extend your agent':'help skill-creator skill-installer plugin-creator mcp-builder mcp-discovery delegate fleet-manager',
};
function files(dir,prefix='',skipHistorical=false) {
  const result={};
  for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const rel=prefix+entry.name, abs=path.join(dir,entry.name);
    if(entry.isSymbolicLink())throw new Error(`Skill symlink refused: ${rel}`);
    if(skipHistorical && /^SKILL\.generation-\d+\.md$/.test(entry.name))continue;
    if(entry.isDirectory())Object.assign(result,files(abs,rel+'/',skipHistorical));
    else if(entry.isFile())result[rel]=fs.readFileSync(abs);
    else throw new Error(`Skill entry is not a file: ${rel}`);
  }
  return result;
}
function metadata(name){
  const body=fs.readFileSync(path.join(DEST,name,'SKILL.md'),'utf8');
  const fm=body.split(/^---\s*$/m)[1]||'';
  let description=/^description:[ \t]*(.*)$/m.exec(fm)?.[1]||'';
  if(/^[>|][-+]?$/.test(description))description=(/^description:[^\n]*\n((?:[ \t]+[^\n]*\n?)*)/m.exec(fm)?.[1]||'').split('\n').map(s=>s.trim()).join(' ').trim();
  description=description.replace(/^(["'])(.*)\1$/,'$2');
  return {name,description,invocation:/^invocation:[ \t]*(.*)$/m.exec(fm)?.[1]||'model+user'};
}
function directory(pin){
  let md='# Codewhale skills\n\n'+pin.skills.length+' active skills from Core generation '+pin.generation+'. Each installs as\n`codewhale-skills:<name>`. Skills provide instructions; they do not connect\naccounts, install dependencies, grant permissions, or prove live service access.\n\nTry “summarize my unread email”, “compare flights for this date”, “make an audio\nbriefing”, or “review this pull request”. Use `npm run skills -- <words>` to\nsearch this directory, or `npm run skills -- --json` for the full inventory.\n\n## What needs setup?\n\n| Workflow | Requirement |\n| --- | --- |\n| Gmail / Calendar | Connected account, or user-owned Google OAuth client with task-specific scopes |\n| GitHub | Authenticated `gh` or a host-provided GitHub connection |\n| Flights / shopping / image search | Web access; FlightAware is an optional keyed route |\n| Bank balances | User-authorized Plaid connection; read-only workflow, no payments |\n| Photos | macOS, local Photos library and `osxphotos` |\n| Spotify | Running Mac app for local playback; authorized API access for search |\n| Speech / podcast | Local speech engine; podcast assembly also needs `ffmpeg` |\n| Forget | Codewhale Context Lens; unavailable on hosts without that control |\n| Documents / browser testing | The tools and dependencies stated by each skill |\n\n';
  for(const [group,names] of Object.entries(groups)){
    md+='## '+group+'\n\n| Skill | When it helps |\n| --- | --- |\n';
    for(const name of names.split(' ').filter(n=>pin.skills.includes(n))){const m=metadata(name);md+=`| [${name}](${name}/SKILL.md)${m.invocation==='explicit-only'?' (explicit only)':''} | ${m.description.replaceAll('|','\\|')} |\n`;}
    md+='\n';
  }
  const classified=Object.values(groups).flatMap(s=>s.split(' '));
  const extras=pin.skills.filter(n=>!classified.includes(n));
  if(extras.length)md+='## Additional skills\n\n'+extras.map(n=>`- [${n}](${n}/SKILL.md): ${metadata(n).description}`).join('\n')+'\n\n';
  return md+'## Source and maintenance\n\nGenerated from [Core](https://github.com/Hmbown/Codewhale/tree/'+pin.commit+'/'+SOURCE+') by `scripts/skills.mjs`. `upstream.json` pins the exact revision and hashes\nof every mirrored file. `npm run check` validates the inventory and this directory;\n`npm run check -- --core ../codewhale` also compares the active Core catalog.\n\n`feedback` and `contributor-onboarding` are repository-local; `feishu` is optional\nand `v4-best-practices` is retired. Retained migration bodies are deliberately\nexcluded, so installing this pack does not resurrect retired workflows.\n';
}
try {
  let pin;
  if(core){
    const matrix=JSON.parse(fs.readFileSync(path.join(core,MATRIX)));
    const names=matrix.skills.map(s=>s.name).sort();
    if(new Set(names).size!==names.length||names.some(n=>! /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(n)))throw new Error('Invalid Core skill identities');
    const sourceFiles={};
    for(const name of names)Object.assign(sourceFiles,Object.fromEntries(Object.entries(files(path.join(core,SOURCE,name),'',true)).map(([p,b])=>[name+'/'+p,b])));
    if(write){
      // Refuse to certify uncommitted source. Check all source assets, including
      // new/untracked files, rather than silently attaching HEAD to dirty bytes.
      const dirty=execFileSync('git',['status','--porcelain','--',SOURCE,MATRIX],{cwd:core,encoding:'utf8'}).trim();
      if(dirty)throw new Error('Commit the reviewed Core skill changes before synchronizing');
      const localDirty=execFileSync('git',['status','--porcelain','--','skills'],{cwd:ROOT,encoding:'utf8'}).split('\n').filter(line => line && !['skills/plugin.json','skills/LICENSE'].includes(line.slice(3))).join('\n');
      if(localDirty)throw new Error('Marketplace skills have local edits; reconcile them before synchronizing');
      for(const [rel,body] of Object.entries(sourceFiles)){
        const committed=execFileSync('git',['show',`HEAD:${SOURCE}/${rel}`],{cwd:core,maxBuffer:6*1024*1024,stdio:['ignore','pipe','pipe']});
        if(!committed.equals(body))throw new Error(`Uncommitted source bytes: ${rel}`);
      }
      const currentDirs=fs.readdirSync(DEST,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name);
      // Retire only known, byte-identical Core copies; never delete an unknown fork.
      for(const name of currentDirs.filter(n=>!names.includes(n))){
        const old=files(path.join(DEST,name));
        const upstream=files(path.join(core,SOURCE,name),'',true);
        if(Object.keys(old).some(p=>!upstream[p]?.equals(old[p])))throw new Error(`Preserve modified non-bundled skill: ${name}`);
      }
      pin={repository:'https://github.com/Hmbown/Codewhale',commit:execFileSync('git',['rev-parse','HEAD'],{cwd:core,encoding:'utf8'}).trim(),generation:matrix.generation,skills:names,files:Object.fromEntries(Object.entries(sourceFiles).map(([p,b])=>[p,hash(b)]))};
      for(const name of currentDirs)fs.rmSync(path.join(DEST,name),{recursive:true});
      for(const [rel,body] of Object.entries(sourceFiles)){const target=path.join(DEST,rel);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,body);}
      fs.writeFileSync(path.join(DEST,'upstream.json'),JSON.stringify(pin,null,2)+'\n');
      fs.writeFileSync(path.join(DEST,'README.md'),directory(pin));
    }else{
      pin=JSON.parse(fs.readFileSync(path.join(DEST,'upstream.json')));
      if(JSON.stringify(names)!==JSON.stringify(pin.skills)||matrix.generation!==pin.generation)throw new Error('Core active skill inventory changed; review and run npm run sync:skills');
      for(const [rel,body] of Object.entries(sourceFiles))if(pin.files[rel]!==hash(body))throw new Error(`Core skill resource drift: ${rel}`);
      if(Object.keys(sourceFiles).length!==Object.keys(pin.files).length)throw new Error('Core skill resource inventory changed');
    }
  }
  if(write&&!core)throw new Error('--write requires --core <checkout>');
  pin??=JSON.parse(fs.readFileSync(path.join(DEST,'upstream.json')));
  if(!/^[a-f0-9]{40}$/.test(pin.commit)||!Array.isArray(pin.skills)||new Set(pin.skills).size!==pin.skills.length||pin.skills.some(n=>! /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(n)))throw new Error('Invalid skill provenance');
  const entries=fs.readdirSync(DEST,{withFileTypes:true});
  if(entries.some(e=>e.isSymbolicLink()))throw new Error('Skill root symlinks are not permitted');
  const dirs=entries.filter(e=>e.isDirectory()).map(e=>e.name).sort();
  if(JSON.stringify(dirs)!==JSON.stringify(pin.skills))throw new Error('Marketplace skill inventory differs from its source pin');
  const actual={};for(const name of dirs)Object.assign(actual,Object.fromEntries(Object.entries(files(path.join(DEST,name))).map(([p,b])=>[name+'/'+p,hash(b)])));
  if(Object.keys(actual).length!==Object.keys(pin.files).length||Object.entries(actual).some(([p,h])=>pin.files[p]!==h))throw new Error('Marketplace skill resources differ from their source hashes');
  if(fs.readFileSync(path.join(DEST,'README.md'),'utf8')!==directory(pin))throw new Error('Skill directory is stale; regenerate with npm run sync:skills');
  if(args.includes('--check')||write){console.log(`${dirs.length} active skills, ${Object.keys(actual).length} source files, Core generation ${pin.generation}: OK`);}
  else{
    const terms=args.filter(a=>a!=='--json').join(' ').toLowerCase().split(/\s+/).filter(Boolean);
    const rows=dirs.map(metadata).filter(m=>terms.every(t=>(m.name+' '+m.description).toLowerCase().includes(t)));
    console.log(args.includes('--json')?JSON.stringify(rows,null,2):rows.map(m=>`${m.name} — ${m.description}`).join('\n')||'No matching skill. Try a task such as email, audio, review or photos.');
  }
}catch(error){console.error(`skills: ${error.message}`);process.exitCode=1;}
