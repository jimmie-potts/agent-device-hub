import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareNanoleaf,verifyNanoleaf,rollbackNanoleaf,inspectNanoleaf} from '../dist/setup-consumer.js';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('consumer capability binds configuration, status and revision; explicit rollback remains owning CLI work',async t=>{
 const root=await mkdtemp(join(tmpdir(),'hub-consumer-fixture-'));t.after(()=>rm(root,{recursive:true,force:true}));const config=join(root,'config.json'),state=join(root,'state.json'),script=join(root,'cli.mjs');
 await writeFile(config,JSON.stringify({ownerId:'owner',consumerId:'nanoleaf',clearOnNewTurn:true,endpoint:'http://127.0.0.1:34567/api/monitor/v1'}),{mode:0o600});
 await writeFile(state,JSON.stringify({source:'legacy',ownerId:'owner',consumerId:'nanoleaf',clearOnNewTurn:true,configured:true,connection:'current',revision:7,sessions:[]}));
 await writeFile(script,`import {readFileSync,writeFileSync} from 'node:fs'; const [path,command,arg]=process.argv.slice(2);const state=JSON.parse(readFileSync(path));if(command==='shared-select'){state.source=arg;writeFileSync(path,JSON.stringify(state));}console.log(JSON.stringify(command==='shared-preflight'?{feed:'verified',ownerId:state.ownerId,revision:state.revision}:state));`);
 const command={executable:process.execPath,args:[script,state],environment:{}};const route=await prepareNanoleaf(command,config,'http://127.0.0.1:34567/api/monitor/v1','owner');const snapshot={revision:7,sessions:[]};
 await verifyNanoleaf(route,'http://127.0.0.1:34567','owner',snapshot);await assert.rejects(verifyNanoleaf({...route},'http://127.0.0.1:34567','owner',snapshot),/not-ready/);await assert.rejects(verifyNanoleaf(route,'http://127.0.0.1:34567','owner',{...snapshot,revision:8}),/not-ready/);
 await rollbackNanoleaf(command);assert.equal((await inspectNanoleaf(command)).source,'legacy');await assert.rejects(verifyNanoleaf(route,'http://127.0.0.1:34567','owner',snapshot),/not-ready/);
 await writeFile(config,(await readFile(config,'utf8'))+' ');await assert.rejects(verifyNanoleaf(route,'http://127.0.0.1:34567','owner',snapshot),/not-ready/);
});
