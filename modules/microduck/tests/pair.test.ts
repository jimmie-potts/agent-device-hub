import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {test} from 'node:test';
import {VendorPair} from '../src/pair.js';
for(const failed of [0,1])void test(`loss of member ${failed} invalidates and reaps the pair before replacement`,{timeout:10000},async t=>{
  let invalidated=false;
  const pair=new VendorPair(()=>{invalidated=true;}),children=[0,1].map(()=>spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}));
  t.after(async()=>{await pair.stop().catch(()=>{});for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
  for(const child of children)pair.add(child);await Promise.all(children.map(child=>once(child,'spawn')));
  const child=children[failed];assert.ok(child);child.kill('SIGTERM');await once(child,'exit');await pair.stop();
  assert.equal(invalidated,true);assert.equal(pair.ended,true);
  for(const c of children){assert.ok(c.exitCode!==null||c.signalCode!==null);assert.ok(c.pid!==undefined);assert.throws(()=>process.kill(c.pid??0,0));}
  const replacement=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});await once(replacement,'spawn');
  const next=new VendorPair(()=>{});next.add(replacement);await next.stop();assert.ok(replacement.signalCode!==null);
});
void test('invalidation failure still reaps both members',{timeout:10000},async t=>{
  const pair=new VendorPair(()=>{throw new Error('synthetic witness failure');});const children=[0,1].map(()=>spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}));
  t.after(async()=>{await pair.stop().catch(()=>{});for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
  for(const child of children)pair.add(child);await Promise.all(children.map(child=>once(child,'spawn')));
  await assert.rejects(pair.stop());for(const child of children)assert.ok(child.exitCode!==null||child.signalCode!==null);
});
