#!/usr/bin/env node
// Opt-in live verification. Operates only a new, initially empty TextEdit
// document through the plugin's MCP surface. Never part of npm test.
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
if(process.platform!=='darwin') throw new Error('verify-macos requires macOS');
const showPreview=process.argv.includes('--preview');
const recordVideo=process.argv.includes('--recording');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const server=spawn(process.execPath,[path.join(root,'mcp/server.mjs')],{stdio:['pipe','pipe','inherit']});
let seq=0, buffer=''; const pending=new Map(); const evidence=[];
server.stdout.setEncoding('utf8');
server.stdout.on('data', chunk=>{buffer+=chunk; let i; while((i=buffer.indexOf('\n'))>=0){const msg=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);pending.get(msg.id)?.(msg);pending.delete(msg.id);}});
async function tool(name,args={}){
  const id=++seq, start=Date.now();
  const response=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`${name} timed out`)),65000);pending.set(id,m=>{clearTimeout(timer);resolve(m);});server.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}})+'\n');});
  assert.ok(response.result,JSON.stringify(response.error));
  const data=JSON.parse(response.result.content[0].text);
  evidence.push({tool:name,ms:Date.now()-start,ok:data.ok,error:data.error,path:data.file??data.path});
  assert.equal(data.ok,true,JSON.stringify(data));
  return {data,content:response.result.content};
}
const app_ref={bundle_id:'com.apple.TextEdit'};
async function state(){return (await tool('get_app_state',{app_ref})).data;}
function fixtureWindow(s){
  const w=s.elements.find(e=>e.role==='AXWindow'&&e.label?.includes(path.basename(fixture)));
  assert.ok(w,'The unique fixture window is present');return w;
}
function editor(s){const w=fixtureWindow(s);return s.elements.find(e=>e.role==='AXTextArea'&&e.windowIndex===w.windowIndex);}
function target(s){const e=editor(s);assert.ok(e,'The fixture editor is present');return {type:'element',state_id:s.state_id,index:e.index};}
function value(s){return editor(s)?.value;}
const dir=path.join(root,'receipts',`macos-${Date.now()}`);fs.mkdirSync(dir,{recursive:true});
const fixture=path.join(dir,`cu-verification-${Date.now()}.txt`);
let result;
const cleanup=[];
fs.writeFileSync(fixture,'');
try {
  const probe=(await tool('request_access')).data;
  assert.equal(probe.via,'app');assert.equal(probe.permissions.accessibility,'granted');assert.equal(probe.permissions.screen_capture,'ok');
  // Take the baseline only once the desktop is settled: a previous run closing
  // its fixture hands the foreground back a moment later, and a baseline caught
  // mid-handover makes the check below flap for reasons this run did not cause.
  const settledForeground=async()=>{
    let last=null;
    for(let i=0;i<8;i++){
      const now=(await tool('get_app_state')).data.bundle_id;
      if(now===last) return now;
      last=now;
      await new Promise(r=>setTimeout(r,400));
    }
    return last;
  };
  const foreground=await settledForeground();
  await tool('open_application',{name:'TextEdit',url:pathToFileURL(fixture).href,activate:false});
  let s=await state();
  assert.ok(s.elements.some(e=>e.role==='AXWindow' && e.label?.includes(path.basename(fixture))),'The unique fixture window is present');
  assert.equal(value(s),'','Refuse to overwrite an existing document');
  const expected='Codewhale computer use works.\nUnicode: Hello 世界 🐋';
  await tool('type',{text:expected});s=await state();assert.equal(value(s),expected);
  await tool('select_text',{target:target(s),text_range:[0,9]});await tool('type',{text:'CODEWHALE'});s=await state();assert.equal(value(s),'CODEWHALE'+expected.slice(9));
  await tool('set_value',{target:target(s),value:expected});s=await state();assert.equal(value(s),expected);
  const w=fixtureWindow(s);
  const region=[w.position.x,w.position.y,w.size.w,w.size.h];
  const shot=await tool('screenshot',{app_ref,path:path.join(dir,'textedit.png')});assert.ok(shot.content.some(c=>c.type==='image'),'MCP embeds screenshot bytes');
  assert.equal(shot.data.points.x,region[0]);assert.equal(shot.data.pixels.w,region[2]*shot.data.scale);
  const zoom=await tool('zoom',{region:[0,0,600,240],path:path.join(dir,'zoom.png')});assert.ok(zoom.content.some(c=>c.type==='image'));
  if(showPreview) await tool('preview',{enabled:true});
  // Everything so far is background-safe: observation, accessibility writes,
  // keyboard, window capture and the preview. None of it may take the
  // foreground.
  assert.equal((await tool('get_app_state')).data.bundle_id,foreground,'Background tools and preview preserve foreground app');

  // Pointer actions are the exception, and the receipt has to say so. macOS
  // drops pointer events posted to a process, so a coordinate with no
  // pressable accessibility element under it falls back to a real pointer
  // gesture: the cursor moves (and is put back) and the target application
  // comes forward. What is verified here is that the receipt admits it.
  const pointerBefore=(await tool('cursor_position')).data;
  const click=(await tool('left_click',{target:{type:'coordinate',x:40,y:100}})).data;
  s=await state();assert.equal(value(s),expected,'Pointer click preserves document contents');
  assert.ok(['a11y','event'].includes(click.strategy),'the click names its strategy');
  const frontAfterClick=(await tool('get_app_state')).data.bundle_id;
  if(click.strategy==='event'){
    assert.equal(click.pointer_moved,true,'a global gesture admits it moved the cursor');
    assert.equal(click.foreground_taken,frontAfterClick!==foreground,'foreground_taken matches what actually happened');
  } else {
    assert.equal(click.pointer_moved,false,'an accessibility press leaves the cursor alone');
    assert.equal(frontAfterClick,foreground,'an accessibility press leaves the foreground alone');
  }
  await tool('mouse_move',{target:{type:'coordinate',x:40,y:100}});
  const cursor=(await tool('cursor_position')).data;
  assert.ok(Number.isFinite(cursor.x)&&Number.isFinite(cursor.y));
  evidence.push({check:'pointer_cost',strategy:click.strategy,pointer_moved:click.pointer_moved,
    pointer_restored:click.pointer_restored,foreground_taken:click.foreground_taken,
    foreground_before:foreground,foreground_after:frontAfterClick,
    physical_pointer:{before:{x:pointerBefore.x,y:pointerBefore.y},after:{x:cursor.x,y:cursor.y}}});
  await tool('scroll',{target:target(s),direction:'down',amount:2});
  let stopped;
  if(recordVideo){
    const recording=(await tool('recording_start',{region,durationSec:2})).data;
    await tool('wait',{seconds:3});stopped=(await tool('recording_stop',{id:recording.id})).data;assert.ok(stopped.bytes>0,'Recorded nonempty video');
  }
  result={passed:true,probe,recording:stopped,evidence};
} catch(e){result={passed:false,error:e.message,evidence};console.error(e);process.exitCode=1;}
finally{
  if(showPreview) try { await tool('preview',{enabled:false}); } catch(e) { cleanup.push(e.message);process.exitCode=1; }
  // Address only this run's unique file. Never close the front document or
  // quit TextEdit: either could belong to the user by the time cleanup runs.
  try {
    execFileSync('osascript',['-e',`on run argv
      tell application "TextEdit"
        repeat with d in documents
          if path of d is item 1 of argv then
            close d saving no
            exit repeat
          end if
        end repeat
      end tell
    end run`,fixture],{timeout:10000,stdio:'pipe'});
  } catch(e) { cleanup.push('Fixture cleanup failed; left document open: '+e.message);process.exitCode=1; }
  server.stdin.end();await once(server,'exit');
  result={...result,passed:result.passed && cleanup.length===0,cleanup,evidence};
  fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({passed:result.passed,dir,calls:evidence.filter(e=>e.tool).length,cleanup},null,2));
}
