import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {planSetup,applySetup,removeSetup,planRemoval,inspectSetup} from '../dist/setup.js';
const remove=async(directory,authority)=>removeSetup(directory,(await planRemoval(directory)).digest,authority);
const source={provider:'codex',client:'cli',hostId:'host',sourceId:'cli',hook:'SessionStart'};
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const write=(p,v)=>writeFile(p,JSON.stringify(v),{mode:0o600});
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'hub-setup-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'receipt'),{mode:0o700});const target=join(root,'hooks.json');await write(target,{hooks:{Stop:[{hooks:[{type:'command',command:'unrelated'}]}]},trust:'unchanged'});return {directory:join(root,'receipt'),target,source,endpoint:'http://127.0.0.1:34567/api/monitor/v1/events',node:process.execPath,hook:new URL('../bin/monitor-hook.mjs',import.meta.url).pathname,owner:'installation-owner',qualified:false};}
function authority(){const active=new Map();return {active,grant:async(id,token)=>{active.set(id,token);},revoke:async(id,token)=>{assert.equal(active.get(id),token);active.delete(id);}};}
test('plan is read-only; idempotent setup and surgical removal preserve latest unrelated settings',async t=>{
 const input=await fixture(t),access=authority();const before=await readFile(input.target,'utf8');
 const plan=await planSetup(input);assert.equal(await readFile(input.target,'utf8'),before);assert.ok(plan.additions.length>=7);
 await applySetup(input,plan.digest,access);await applySetup(input,(await planSetup(input)).digest,access);assert.equal(access.active.size,1);
 const current=await read(input.target);assert.equal(current.trust,'unchanged');current.hooks.Stop=current.hooks.Stop.filter(g=>g.hooks[0].command!=='unrelated');current.newPreference='KEEP';current.hooks.Stop.push({hooks:[{type:'command',command:'new-user-hook'}]});await write(input.target,current);
 const status=await inspectSetup(input.directory);assert.equal(status.state,'installed');assert.equal(status.qualified,false);assert.ok(!JSON.stringify(status).includes(input.directory));
 await remove(input.directory,access);assert.equal(access.active.size,0);const final=await read(input.target);assert.equal(final.newPreference,'KEEP');assert.deepEqual(final.hooks.Stop,[{hooks:[{type:'command',command:'new-user-hook'}]}]);assert.equal(final.trust,'unchanged');
});
test('stale plans, changed owned entries and interrupted credential operations fail safely',async t=>{
 const input=await fixture(t),access=authority(),stale=await planSetup(input);await write(input.target,{hooks:{},added:true});await assert.rejects(applySetup(input,stale.digest,access),/changed/);assert.equal(access.active.size,0);
 let failed=true;const interrupted={...access,grant:async(...args)=>{await access.grant(...args);if(failed)throw new Error('interrupted');}};
 await assert.rejects(applySetup(input,(await planSetup(input)).digest,interrupted),/interrupted/);assert.equal((await inspectSetup(input.directory)).enabled,false);
 failed=false;await applySetup(input,(await planSetup(input)).digest,interrupted);assert.equal(access.active.size,1);
 const saved=await readFile(input.target,'utf8'),edited=JSON.parse(saved);edited.hooks.Stop[0].hooks[0].timeout=10;await write(input.target,edited);await assert.rejects(remove(input.directory,access),/owned-entry/);assert.equal(access.active.size,1);
 await writeFile(input.target,saved,{mode:0o600});await assert.rejects(remove(input.directory,{...access,revoke:async()=>{throw new Error('offline');}}),/offline/);assert.equal((await inspectSetup(input.directory)).state,'removing');await remove(input.directory,access);await remove(input.directory,access);assert.equal(access.active.size,0);
});
test('host authority persists owned access and revokes the live credential without affecting unrelated access',async t=>{
 const {startHub}=await import('../dist/server.js');const {hubSetupAuthority}=await import('../dist/setup-authority.js');const {createHash}=await import('node:crypto');
 const input=await fixture(t),root=join(input.directory,'host');await mkdir(root,{mode:0o700});const token='a'.repeat(43),configPath=join(input.directory,'host.json');
 const config={directory:root,ownerId:'owner',consumers:[],controllers:[],port:0,credentials:[{id:'admin',digest:createHash('sha256').update(token).digest('hex'),scopes:['read','ingest','admin','control'],devices:[]}]};await write(configPath,config);
 const hub=await startHub(config);t.after(()=>hub.close());input.endpoint=hub.url+'/api/monitor/v1/events';const access=hubSetupAuthority(hub,configPath);
 await applySetup(input,(await planSetup(input)).digest,access);const producer=await read(join(input.directory,'producer.json'));const url=hub.url+'/api/hub/v1/authority?scope=ingest';
 assert.equal((await fetch(url,{headers:{authorization:'Bearer '+producer.token}})).status,200);await remove(input.directory,access);assert.equal((await fetch(url,{headers:{authorization:'Bearer '+producer.token}})).status,401);assert.equal((await fetch(url,{headers:{authorization:'Bearer '+token}})).status,200);assert.equal((await read(configPath)).credentials.length,1);
});
test('large supported configuration remains recoverable through removal',async t=>{
 const input=await fixture(t),access=authority();await write(input.target,{hooks:{},large:'x'.repeat(140000)});
 await applySetup(input,(await planSetup(input)).digest,access);assert.equal((await inspectSetup(input.directory)).state,'installed');await remove(input.directory,access);assert.equal((await read(input.target)).large.length,140000);
});
test('edited, missing and duplicated owned commands are conflicts; plans contain actual changes',async t=>{
 const input=await fixture(t),access=authority();await applySetup(input,(await planSetup(input)).digest,access);const saved=await readFile(input.target,'utf8');
 assert.deepEqual((await planSetup(input)).additions,[]);const removal=await planRemoval(input.directory);assert.equal(removal.removals.length,8);assert.deepEqual(removal.additions,[]);
 for(const mutation of ['missing','edited','duplicate']){const value=JSON.parse(saved);if(mutation==='missing')delete value.hooks.Stop;else if(mutation==='edited')value.hooks.Stop[1].hooks[0].command='replacement';else value.hooks.Stop.push(value.hooks.Stop[1]);await write(input.target,value);await assert.rejects(planSetup(input),/owned-entry/);await assert.rejects(planRemoval(input.directory),/owned-entry/);}
 await writeFile(input.target,saved,{mode:0o600});const value=JSON.parse(saved);value.preference='new';await write(input.target,value);await assert.rejects(removeSetup(input.directory,removal.digest,access),/changed/);assert.equal(access.active.size,1);
});
test('an edit during credential provisioning is retained with disabled emission',async t=>{
 const input=await fixture(t),access=authority(),plan=await planSetup(input);const changed={hooks:{},preference:'NEW'};
 await assert.rejects(applySetup(input,plan.digest,{...access,grant:async(...args)=>{await access.grant(...args);await write(input.target,changed);}}),/changed/);assert.deepEqual(await read(input.target),changed);assert.equal((await inspectSetup(input.directory)).enabled,false);
});
