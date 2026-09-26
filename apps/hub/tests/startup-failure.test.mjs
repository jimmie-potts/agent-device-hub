import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {startupFailureCode} from '../dist/startup-failure.js';
import {createDeviceRegistry,bindServiceTools,createMcpHandler} from '@jimmie-potts/device-mcp';

// Hub #357: a failed start names its cause without exposing paths or private values.
test('startup failures name stable causes only',()=>{
 assert.equal(startupFailureCode(new Error('Tool catalog exceeds response limit')),'mcp-tool-catalog-too-large');
 for(const code of ['invalid-configuration','invalid-controller','owner-quiesced','storage-unavailable'])assert.equal(startupFailureCode(new Error(code)),code);
 for(const error of [new Error('ENOENT: no such file or directory, open /home/owner/private.json'),new Error('Invalid Configuration'),'invalid-configuration',undefined,new Error('a'.repeat(80))])
  assert.equal(startupFailureCode(error),undefined);
});

test('the CLI prints the named cause of a failed start',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-cli-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const controller={id:'same',kind:'nanoleaf',controllerId:'c',deviceId:'d',endpoint:'http://127.0.0.1:9/controller/v1',token:'n'.repeat(43)};
 const file=join(directory,'host.json');
 await writeFile(file,JSON.stringify({directory,ownerId:'owner',consumers:[],credentials:[{id:'operator',digest:'a'.repeat(64),scopes:['read'],devices:[]}],controllers:[controller,{...controller,deviceId:'e'}],port:0}),{mode:0o600});
 const failure=await promisify(execFile)(process.execPath,[new URL('../dist/cli.js',import.meta.url).pathname,'serve',file]).then(()=>assert.fail('start must fail'),error=>error);
 assert.equal(failure.stderr,'hub-start-failed: invalid-configuration\n');
 assert.equal(failure.code,1);
});

test('the gateway error for an oversized catalog maps to its named cause',()=>{
 const registry=createDeviceRegistry([{controllerId:'controller',deviceId:'light',extensions:{read:{inputSchema:{type:'object',additionalProperties:false,properties:{}},
  outputSchema:{type:'object',additionalProperties:false,properties:{}},scope:'read',description:'x'.repeat(1000),
  annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true},invoke:async()=>({data:{}})}}}]);
 const tools=bindServiceTools(registry,{deviceId:'light',bindings:[{extension:'read',name:'read'}]});
 let failure;
 try{createMcpHandler({enabled:true,registry,tools,authenticate:async()=>null,allowedHosts:['127.0.0.1:1'],allowedOrigins:['http://127.0.0.1:1'],limits:{maxResponseBytes:1024}});}
 catch(error){failure=error;}
 assert.ok(failure,'an oversized catalog must stop the handler');
 assert.equal(startupFailureCode(failure),'mcp-tool-catalog-too-large');
});
