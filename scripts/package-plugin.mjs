#!/usr/bin/env node
// Package the actual reviewed source set, excluding ignored local artifacts.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const ROOT=fileURLToPath(new URL('../',import.meta.url));
export function packagePlugin(name, output=path.join(ROOT,'dist')) {
  const catalog=JSON.parse(fs.readFileSync(path.join(ROOT,'marketplace.json')));
  const entry=catalog.plugins.find(p=>p.name===name);
  if(!/^[a-z0-9][a-z0-9-]*$/.test(name)||!entry?.source.startsWith('path:'))throw new Error('Choose a local catalog plugin.');
  const rel=entry.source.slice(5), source=path.resolve(ROOT,rel);
  const relativeSource=path.relative(ROOT,source);
  if(!relativeSource||relativeSource==='..'||relativeSource.startsWith('..'+path.sep)||path.isAbsolute(relativeSource))throw new Error('Bundle source must be inside the repository');
  let component=ROOT;
  for(const part of relativeSource.split(path.sep)){
    component=path.join(component,part);
    if(fs.lstatSync(component).isSymbolicLink())throw new Error('Bundle source contains a symlink');
  }
  const dest=path.resolve(output,name);
  if(dest===source||dest.startsWith(source+path.sep))throw new Error('Output must be outside the source bundle');
  if(!dest.startsWith(path.resolve(output)+path.sep)||fs.existsSync(dest))throw new Error('Output already exists or is invalid; choose a new --out directory.');
  const files=[...new Set(execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard','--',rel],{cwd:ROOT,encoding:'utf8'}).split('\0').filter(Boolean))];
  let bytes=0;
  const copies=files.flatMap(file=>{
    const suffix=path.relative(source,path.join(ROOT,file));
    if(suffix.startsWith('..')||path.isAbsolute(suffix))throw new Error('Bundle path escapes root');
    let current=source;
    for(const part of suffix.split(path.sep)){
      current=path.join(current,part);
      let stat;
      try {stat=fs.lstatSync(current);} catch(error){if(error.code==='ENOENT')return [];throw error;}
      if(stat.isSymbolicLink())throw new Error('Bundle contains a symlink');
    }
    const stat=fs.statSync(current);if(!stat.isFile())throw new Error('Bundle contains a non-file');bytes+=stat.size;
    return [{from:current,to:path.join(dest,suffix)}];
  });
  if(!copies.some(copy=>['plugin.json','kimi.plugin.json','plugin.toml'].includes(path.relative(dest,copy.to))))throw new Error('Bundle manifest is missing');
  if(bytes>5*1024*1024)throw new Error('Bundle exceeds the host 5 MiB cap');
  fs.mkdirSync(dest,{recursive:true});
  for(const {from,to} of copies){fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);}
  return {name,path:dest,files:copies.length,bytes};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const i=process.argv.indexOf('--out');console.log(JSON.stringify(packagePlugin(process.argv[2],i<0?undefined:process.argv[i+1]),null,2));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
