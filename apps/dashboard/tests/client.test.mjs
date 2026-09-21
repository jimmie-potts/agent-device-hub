import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'dashboard-client-'));
try {
 await build({entryPoints:['apps/dashboard/src/client.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'client.mjs')});
 const {makeCommand,safeEditorUrl}=await import(join(dir,'client.mjs'));
 test('mode commands preserve the edited revision and original server ticket',()=>{
  const snapshot={identity:{controllerId:'c',deviceId:'d'},configurationRevision:2,generation:{epoch:'g',sequence:7},nextRequestId:{epoch:'e',sequence:3}};
  const command=makeCommand(snapshot,{kind:'mode.set',mode:'Quiet'});
  assert.deepEqual(command,{apiVersion:'1.0',controllerId:'c',deviceId:'d',expectedConfigurationRevision:2,expectedGeneration:{epoch:'g',sequence:7},requestId:{epoch:'e',sequence:3},command:{kind:'mode.set',mode:'Quiet'}});
 });
 test('editor links reject credentials, javascript, nonloopback and secret query strings',()=>{
  assert.equal(safeEditorUrl('http://127.0.0.1:8765/wall'),'http://127.0.0.1:8765/wall');
  for(const url of ['javascript:alert(1)','http://user:pass@127.0.0.1/','http://example.com/','http://127.0.0.1/?token=x'])assert.equal(safeEditorUrl(url),undefined);
 });
}finally{await rm(dir,{recursive:true,force:true});}
