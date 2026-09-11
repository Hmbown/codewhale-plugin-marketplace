#!/usr/bin/env node
import http from 'node:http';
import path from 'node:path';
import {Inbox,configFromEnv,parseEvent,dispatch} from './lib.mjs';
const command=process.argv[2]||'serve';
const state=process.env.BRIDGE_STATE_DIR;
if(!state||!path.isAbsolute(state))throw new Error('Set BRIDGE_STATE_DIR to a private absolute directory.');
const inbox=new Inbox(state),config=configFromEnv(process.env);
if(command==='dispatch')console.log(JSON.stringify(await dispatch(inbox,process.env),null,2));
else if(command==='status')console.log(JSON.stringify(inbox.records().map(({id,status,thread_id,turn_id})=>({id,status,thread_id,turn_id})),null,2));
else if(command==='serve') {
  const slackReady=config.slackSecret&&config.slackTeams.length&&config.slackChannels.length&&config.slackUsers.length;
  const linearReady=config.linearSecret&&config.linearOrganizations.length&&config.linearTeams.length&&config.linearLabel;
  if(!slackReady&&!linearReady)throw new Error('Configure a signing secret and explicit allowlists for Slack or Linear first.');
  const server=http.createServer(async(req,res)=>{
    const send=(status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
    if(req.url==='/health'&&req.method==='GET')return send(200,{ok:true,mode:'queue',dispatch:'manual'});
    const service=req.url==='/webhooks/slack'?'slack':req.url==='/webhooks/linear'?'linear':null;
    if(!service||req.method!=='POST')return send(404,{error:'not found'});
    if(!(req.headers['content-type']||'').startsWith('application/json'))return send(415,{error:'JSON required'});
    try {
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>256*1024){send(413,{error:'body too large'});return;}chunks.push(chunk);}
      const event=parseEvent(service,req.headers,Buffer.concat(chunks),config);
      if(event?.challenge)return send(200,{challenge:event.challenge});
      if(!event)return send(200,{ignored:true});
      return send(202,{queued:true,...inbox.enqueue(event)});
    } catch(error) {return send(error.message==='unauthorized'?401:error instanceof SyntaxError?400:503,{error:error.message==='unauthorized'?'unauthorized':'request could not be accepted'});}
  });
  server.requestTimeout=10000;server.headersTimeout=10000;
  server.listen(Number(process.env.BRIDGE_PORT||8788),'127.0.0.1',()=>console.log(`Webhook inbox listening on 127.0.0.1:${server.address().port}. Signed, allowlisted events are queued; no model calls until explicit dispatch.`));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close());
} else throw new Error('Usage: index.mjs [serve|status|dispatch]');
