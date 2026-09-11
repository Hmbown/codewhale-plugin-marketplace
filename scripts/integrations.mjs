#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../integrations/',import.meta.url));
const choices={telegram:'telegram-bridge',wechat:'weixin-bridge',wecom:'wecom-bridge',feishu:'feishu-bridge',webhooks:'webhook-bridge'};
const [cmd='list',name,...args]=process.argv.slice(2);
if(cmd==='list')for(const [id,dir] of Object.entries(choices))console.log(`${id.padEnd(12)} ${path.join(root,dir,'README.md')}`);
else if(!choices[name]||!['check','start'].includes(cmd)) {console.error('Usage: integrations list | check <name> | start <name> --env-file <absolute-path>');process.exitCode=1;}
else {
  const dir=path.join(root,choices[name]);
  const envIndex=args.indexOf('--env-file'),envFile=envIndex<0?null:args[envIndex+1];
  if(cmd==='start'&&(!envFile||!path.isAbsolute(envFile)||!fs.existsSync(envFile)))throw new Error('start requires an existing absolute --env-file path; copy and edit the integration .env.example first');
  const script=cmd==='check'?(fs.existsSync(path.join(dir,'scripts/validate-config.mjs'))?'scripts/validate-config.mjs':null):'src/index.mjs';
  if(!script) {console.log(`Read ${dir}/README.md and ${dir}/.env.example. No live credentials or service calls checked.`);}
  else {
    const nodeArgs=[...(envFile?[`--env-file=${envFile}`]:[]),script];
    const r=spawnSync(process.execPath,nodeArgs,{cwd:dir,stdio:'inherit'});process.exitCode=r.status??1;
  }
}
