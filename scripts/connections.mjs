#!/usr/bin/env node
import fs from 'node:fs';
const {connections}=JSON.parse(fs.readFileSync(new URL('../connections/catalog.json',import.meta.url)));
const [command='list',id]=process.argv.slice(2);
if(command==='list') {
  for(const c of connections)console.log(`${c.id.padEnd(12)} ${c.auth.padEnd(7)} ${c.status}`);
  console.log('\nShow setup: npm run connections -- show linear');
} else {
  const c=connections.find(c=>c.id===id);
  if(!c||!['show','doctor'].includes(command)){console.error('Usage: connections list | show <id> | doctor <id>');process.exitCode=1;}
  else if(command==='doctor') {
    console.log(JSON.stringify({id:c.id,status:c.status,credential:c.env?(process.env[c.env]?'present (not validated)':'missing'):'interactive OAuth required',authenticated:false,tools_verified:false,next:`npm run connections -- show ${id}`},null,2));
  } else {
    console.log(`${c.name}: ${c.note}\nOfficial setup: ${c.docs}\n`);
    if(c.status==='client-qualification-needed') {
      console.log('Setup is not qualified for Codewhale. No install command is offered.');
    } else if(c.auth==='oauth') {
      console.log(`codewhale mcp add ${c.id} --url ${c.url}\ncodewhale mcp login ${c.id}\ncodewhale doctor\n\nRun these in your terminal. Verify a real read-only tool before calling the connection ready.`);
    } else {
      const config={servers:{[c.id]:{url:c.url,bearer_token_env_var:c.env}}};
      console.log(`Set ${c.env} in the host environment, then merge this server entry into your existing MCP config (do not replace other entries):\n${JSON.stringify(config,null,2)}\ncodewhale doctor`);
    }
  }
}
