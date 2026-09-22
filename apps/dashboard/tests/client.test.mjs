import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'dashboard-client-'));
try {
 await build({entryPoints:['apps/dashboard/src/client.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'client.mjs')});
 const {makeCommand,safeEditorUrl,Api,ApiError,failureMessage}=await import(join(dir,'client.mjs'));
 test('mode commands preserve the edited revision and original server ticket',()=>{
  const snapshot={identity:{controllerId:'c',deviceId:'d'},configurationRevision:2,generation:{epoch:'g',sequence:7},nextRequestId:{epoch:'e',sequence:3}};
  const command=makeCommand(snapshot,{kind:'mode.set',mode:'Quiet'});
  assert.deepEqual(command,{apiVersion:'1.0',controllerId:'c',deviceId:'d',expectedConfigurationRevision:2,expectedGeneration:{epoch:'g',sequence:7},requestId:{epoch:'e',sequence:3},command:{kind:'mode.set',mode:'Quiet'}});
 });
 test('a delayed read cannot replace observations after a submitted write',async()=>{
  const original=globalThis.fetch;let release;
  globalThis.fetch=async(_url,options)=>options.method==='POST'?Response.json({ok:true}):new Promise(resolve=>{release=resolve;});
  try {const api=new Api('a'.repeat(43));const read=api.request('/snapshot');await api.request('/commands',{action:'explicit'});release(Response.json({revision:1}));await assert.rejects(read,error=>error.code==='snapshot-superseded');}finally{globalThis.fetch=original;}
 });
 test('partial receipts retain prior effects instead of claiming no application',()=>{
  const result=failureMessage(new ApiError('transport-failure',503,{outcome:'partially-applied',priorEffects:'confirmed-transmission',completedOperations:['mode'],uncertainOperations:['refresh']}));assert.match(result.message,/partially-applied/);assert.match(result.message,/confirmed-transmission/);assert.equal(result.locked,true);assert.doesNotMatch(result.message,/Not applied/);
  assert.equal(failureMessage(new ApiError('capacity',429)).locked,false);
 });
 test('controller reads and commands serialize per device without blocking another device',async()=>{
  const original=globalThis.fetch;const order=[];let release;
  globalThis.fetch=async(url,options)=>{order.push(url);if(url.endsWith('/slow'))return new Promise(resolve=>{release=resolve;});return Response.json({ok:true});};
  try {const api=new Api('a'.repeat(43));const slow=api.request('/api/controllers/v1/one/slow');const write=api.request('/api/controllers/v1/one/commands',{});await api.request('/api/controllers/v1/two/snapshot');assert.deepEqual(order,['/api/controllers/v1/one/slow','/api/controllers/v1/two/snapshot']);release(Response.json({revision:1}));await slow;await write;assert.equal(order.at(-1),'/api/controllers/v1/one/commands');}finally{globalThis.fetch=original;}
 });
 test('editor links reject credentials, javascript, nonloopback and secret query strings',()=>{
  assert.equal(safeEditorUrl('http://127.0.0.1:8765/wall'),'http://127.0.0.1:8765/wall');
  for(const url of ['javascript:alert(1)','http://user:pass@127.0.0.1/','http://example.com/','http://127.0.0.1/?token=x'])assert.equal(safeEditorUrl(url),undefined);
 });
}finally{await rm(dir,{recursive:true,force:true});}
