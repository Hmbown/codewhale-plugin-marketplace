import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
const root=fileURLToPath(new URL('../integrations/',import.meta.url));
for(const entry of fs.readdirSync(root,{withFileTypes:true}).filter(e=>e.isDirectory())) {
  const dir=`${root}${entry.name}`;
  if(!fs.existsSync(`${dir}/test`))continue;
  const files=fs.readdirSync(`${dir}/test`).filter(f=>f.endsWith('.test.mjs')).map(f=>`test/${f}`);
  const r=spawnSync(process.execPath,['--test',...files],{cwd:dir,stdio:'inherit'});
  if(r.status!==0)process.exit(r.status||1);
}
