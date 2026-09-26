import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {startupFailureCode} from '../dist/startup-failure.js';

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
