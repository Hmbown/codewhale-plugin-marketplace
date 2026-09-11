import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHmac} from 'node:crypto';
import {Inbox,parseEvent,dispatch} from '../src/lib.mjs';
const now=1789110000000;
const config={slackSecret:'fixture-signing-secret',slackTeams:['T1'],slackChannels:['C1'],slackUsers:['U1'],linearSecret:'fixture-linear-secret',linearOrganizations:['O1'],linearTeams:['LT1'],linearLabel:'L1'};
function slack(event={type:'app_mention',user:'U1',channel:'C1',text:'Please inspect this',ts:'1'}) {
  const body=Buffer.from(JSON.stringify({type:'event_callback',team_id:'T1',event_id:'E1',event}));const stamp=String(now/1000);
  return {body,headers:{'x-slack-request-timestamp':stamp,'x-slack-signature':'v0='+createHmac('sha256',config.slackSecret).update(`v0:${stamp}:`).update(body).digest('hex')}};
}
function linear(extra={}) {
  const body=Buffer.from(JSON.stringify({webhookTimestamp:now,organizationId:'O1',action:'create',type:'Issue',data:{id:'I1',identifier:'SHA-1',title:'Issue',teamId:'LT1',labels:[{id:'L1'}]},...extra}));
  return {body,headers:{'linear-signature':createHmac('sha256',config.linearSecret).update(body).digest('hex')}};
}
function inbox(t) {const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cw-webhook-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return new Inbox(dir);}
const env={CODEWHALE_WORKSPACE:'/fixture',CODEWHALE_MODEL:'fixture-model',CODEWHALE_RUNTIME_TOKEN:'fixture-runtime'};
test('signed Slack event requires team, channel and user admission',()=>{
  const s=slack();assert.equal(parseEvent('slack',s.headers,s.body,config,now).service,'slack');
  for(const key of ['slackTeams','slackChannels','slackUsers'])assert.equal(parseEvent('slack',s.headers,s.body,{...config,[key]:[]},now),null);
});
test('Slack rejects invalid signatures, expired events, bots and message edits',()=>{
  const s=slack();assert.throws(()=>parseEvent('slack',{...s.headers,'x-slack-signature':'bad'},s.body,config,now),/unauthorized/);
  assert.throws(()=>parseEvent('slack',s.headers,s.body,config,now+301000),/unauthorized/);
  assert.throws(()=>parseEvent('slack',{...s.headers,'x-slack-signature':s.headers['x-slack-signature'].slice(3)},s.body,config,now),/unauthorized/);
  for(const extra of [{bot_id:'B1'},{subtype:'message_changed'}]){const x=slack({type:'app_mention',user:'U1',channel:'C1',text:'x',...extra});assert.equal(parseEvent('slack',x.headers,x.body,config,now),null);}
});
test('signed challenge succeeds; arbitrary unsigned challenge fails',()=>{
  const body=Buffer.from(JSON.stringify({type:'url_verification',challenge:'fixture'})),stamp=String(now/1000);
  const headers={'x-slack-request-timestamp':stamp,'x-slack-signature':'v0='+createHmac('sha256',config.slackSecret).update(`v0:${stamp}:`).update(body).digest('hex')};
  assert.equal(parseEvent('slack',headers,body,config,now).challenge,'fixture');assert.throws(()=>parseEvent('slack',{},body,config,now));
});
test('Linear requires signature, freshness, organization, team and trigger label',()=>{
  const s=linear();assert.equal(parseEvent('linear',s.headers,s.body,config,now).service,'linear');
  for(const key of ['linearOrganizations','linearTeams'])assert.equal(parseEvent('linear',s.headers,s.body,{...config,[key]:[]},now),null);
  assert.equal(parseEvent('linear',s.headers,s.body,{...config,linearLabel:'wrong'},now),null);
  assert.throws(()=>parseEvent('linear',s.headers,s.body,config,now+61000),/unauthorized/);
  assert.throws(()=>parseEvent('linear',s.headers,Buffer.concat([s.body,Buffer.from(' ')]),config,now),/unauthorized/);
});
test('queue survives reopening and deduplicates retries including changed delivery headers',t=>{
  const i=inbox(t),s=linear(),first=parseEvent('linear',s.headers,s.body,config,now);
  assert.equal(i.enqueue(first).duplicate,false);
  const second=parseEvent('linear',{...s.headers,'linear-delivery':'different'},s.body,config,now);
  assert.equal(new Inbox(i.dir).enqueue(second).duplicate,true);assert.equal(i.records().length,1);
});
test('failed file sync cannot turn a partial receipt into an accepted duplicate',t=>{
  const i=inbox(t),s=slack(),event=parseEvent('slack',s.headers,s.body,config,now),sync=fs.fsyncSync;
  try {
    fs.fsyncSync=()=>{throw new Error('fixture disk failure');};
    assert.throws(()=>i.enqueue(event),/fixture disk failure/);
  } finally {fs.fsyncSync=sync;}
  assert.equal(fs.existsSync(i.file(event.id)),false);
  assert.equal(i.enqueue(event).duplicate,false);assert.equal(i.enqueue(event).duplicate,true);
  assert.equal(fs.readdirSync(i.dir).length,1);
});
test('corrupt existing receipts fail intake instead of acknowledging a lost request',t=>{
  const i=inbox(t),s=slack(),event=parseEvent('slack',s.headers,s.body,config,now);
  fs.writeFileSync(i.file(event.id),'{');assert.throws(()=>i.enqueue(event));
});
test('dispatch uses the existing runtime API with explicit model and approvals intact',async t=>{
  const i=inbox(t),s=slack();i.enqueue(parseEvent('slack',s.headers,s.body,config,now));const calls=[];
  const result=await dispatch(i,env,async(route,options)=>{calls.push({route,...options});return calls.length===1?{id:'thread-1'}:{turn:{id:'turn-1'}};});
  assert.equal(result[0].status,'dispatched');assert.deepEqual(calls.map(c=>c.route),['/v1/threads','/v1/threads/thread-1/turns']);
  for(const c of calls){assert.equal(c.body.auto_approve,false);assert.equal(c.body.trust_mode,false);assert.equal(c.body.allow_shell,false);assert.equal(c.body.model,'fixture-model');}
  assert.deepEqual(await dispatch(i,env,()=>assert.fail('must not redispatch')),[]);
});
test('uncertain runtime delivery is retained for review and never automatically retried',async t=>{
  const i=inbox(t),s=slack();i.enqueue(parseEvent('slack',s.headers,s.body,config,now));let calls=0;
  await dispatch(i,env,async()=>{calls++;throw new Error('private details must not reach receipt');});
  assert.equal(i.records()[0].status,'needs_review');assert.ok(!JSON.stringify(i.records()).includes('private details'));
  await dispatch(i,env,()=>calls++);assert.equal(calls,1);
});
test('interrupted dispatch stages and competing processes do not duplicate work',async t=>{
  const i=inbox(t),s=slack();i.enqueue(parseEvent('slack',s.headers,s.body,config,now));const r=i.records()[0];r.status='starting_turn';i.save(r);
  assert.deepEqual(await dispatch(i,env,()=>assert.fail('must not repeat uncertain dispatch')),[]);
  const unlock=i.lock();await assert.rejects(()=>dispatch(i,env,()=>{}),/EEXIST/);unlock();
});
test('dispatch refuses missing configuration and non-loopback runtime addresses',async t=>{
  const i=inbox(t);await assert.rejects(()=>dispatch(i,{},()=>{}),/requires/);
  await assert.rejects(()=>dispatch(i,{...env,CODEWHALE_RUNTIME_URL:'http://127.0.0.1.attacker.test'},()=>{}),/loopback/);
});
test('overlarge requests never reach parsing or a queue',()=>{assert.throws(()=>parseEvent('slack',{},Buffer.alloc(256*1024+1),config,now),/large/);});

test('real HTTP server queues signed events, acknowledges retries and rejects unsigned bodies',async t=>{
  const {spawn}=await import('node:child_process');
  const i=inbox(t);const child=spawn(process.execPath,[fileURLToPath(new URL('../src/index.mjs',import.meta.url))],{env:{...process.env,BRIDGE_STATE_DIR:i.dir,BRIDGE_PORT:'0',SLACK_SIGNING_SECRET:config.slackSecret,SLACK_TEAM_IDS:'T1',SLACK_CHANNEL_IDS:'C1',SLACK_USER_IDS:'U1',LINEAR_WEBHOOK_SECRET:''},stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill('SIGTERM'));
  const port=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('server startup timed out')),10000);
    child.on('exit',code=>{clearTimeout(timeout);reject(new Error(`server exited ${code}`));});
    child.stdout.on('data',chunk=>{const m=/127\.0\.0\.1:(\d+)/.exec(String(chunk));if(m){clearTimeout(timeout);resolve(m[1]);}});
  });
  const stamp=String(Math.floor(Date.now()/1000)),body=slack().body;
  const signature='v0='+createHmac('sha256',config.slackSecret).update(`v0:${stamp}:`).update(body).digest('hex');
  const url=`http://127.0.0.1:${port}`;
  const headers={'content-type':'application/json','x-slack-request-timestamp':stamp,'x-slack-signature':signature};
  assert.deepEqual(await(await fetch(url+'/health')).json(),{ok:true,mode:'queue',dispatch:'manual'});
  let response=await fetch(url+'/webhooks/slack',{method:'POST',headers,body});assert.equal(response.status,202);assert.equal((await response.json()).duplicate,false);
  response=await fetch(url+'/webhooks/slack',{method:'POST',headers,body});assert.equal((await response.json()).duplicate,true);
  response=await fetch(url+'/webhooks/slack',{method:'POST',headers:{'content-type':'application/json'},body});assert.equal(response.status,401);
  assert.equal(i.records().length,1);assert.equal(i.records()[0].status,'pending');
});
