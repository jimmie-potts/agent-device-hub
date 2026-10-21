import assert from 'node:assert/strict';
import test from 'node:test';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {assignSession,conversationFor,presentation,reconcileBindings,settingsFrom} from '../src/habitat/session.ts';
import {exportPreferences,importPreferences,parsePreferences,PREFERENCE_KEYS} from '../src/habitat/preferences.ts';
function record(n:number):SessionRecord{return {id:`session-${n}`,revision:1,generation:1,identity:{provider:'codex',client:'desktop',hostId:'host-sim',sourceId:'codex-desktop',sessionId:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`},parent:{status:'top-level'},turn:{status:'known',id:'turn-1'},activity:'active',attention:[],notices:[],read:'unknown',unavailable:[],ordering:{status:'unknown'},observedAtMs:n,lastEvidenceAtMs:n,freshness:'current',restartUncertain:false,children:{active:0,uncertain:0}};}
void test('ten stable assignments, overflow, children and an authoritative removal',()=>{
 const records=Array.from({length:12},(_,n)=>record(n)),first=reconcileBindings([],records);
 assert.equal(first.length,10);assert.equal(new Set(first.map(b=>b.bunnyId)).size,10);assert.equal(first[0]?.sessionId,'session-11');
 assert.deepEqual(reconcileBindings(first,records.map(r=>({...r,lastEvidenceAtMs:100-r.lastEvidenceAtMs})).reverse()),first);
 const next=reconcileBindings(first,records.filter(r=>r.id!==first[3]?.sessionId));assert.equal(next.find(b=>b.bunnyId===3)?.sessionId,'session-1');
 for(const binding of first.filter(b=>b.bunnyId!==3))assert.deepEqual(next.find(b=>b.bunnyId===binding.bunnyId),binding);
 assert.deepEqual(reconcileBindings([],[{...record(1),parent:{status:'known',identity:record(0).identity}},{...record(2),parent:{status:'unknown'}}]),[{sessionId:'session-2',bunnyId:0}]);
});
void test('legacy preferences migrate and malformed or duplicate bindings do not multiply residents',()=>{
 assert.deepEqual(settingsFrom(null,JSON.stringify({sessionId:'a',bunnyId:6})).bindings,[{sessionId:'a',bunnyId:6}]);
 assert.deepEqual(settingsFrom(JSON.stringify({version:2,automatic:false,bindings:[{sessionId:'a',bunnyId:3},{sessionId:'b',bunnyId:3},{sessionId:'a',bunnyId:4},{sessionId:'c',bunnyId:10},{sessionId:'d',bunnyId:7}]})),{version:2,automatic:false,bindings:[{sessionId:'a',bunnyId:3},{sessionId:'d',bunnyId:7}]});
 assert.deepEqual(settingsFrom('{'),{version:2,automatic:true,bindings:[]});
 const original=[{sessionId:'a',bunnyId:0},{sessionId:'b',bunnyId:1}];assert.deepEqual(assignSession(original,'a',1),[{sessionId:'b',bunnyId:0},{sessionId:'a',bunnyId:1}]);assert.equal(original[0]?.sessionId,'a');
});
void test('session meaning stays with the shell and qualified navigation is independent of freshness',()=>{
 const current=record(1);assert.equal(presentation(current,true).state,'working');assert.equal(presentation(current,false).uncertain,true);
 assert.equal(conversationFor({...current,freshness:'uncertain'},'Win32').href,`codex://threads/${current.identity.sessionId}`);
 for(const value of [conversationFor(current,'iPhone'),conversationFor({...current,identity:{...current.identity,client:'cli'}},'Win32'),conversationFor({...current,identity:{...current.identity,sessionId:'x/?foo'}},'Win32')])assert.equal(value.href,undefined);
});
function storage(){const data=new Map<string,string>();return {data,getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};}
const envelope=(preferences:Record<string,string>):string=>JSON.stringify({schema:'bunny-habitat-settings/1.0',preferences});
void test('only approved preferences are transferred and malformed input performs no writes',()=>{
 const source=storage(),target=storage();source.setItem(PREFERENCE_KEYS[0],JSON.stringify(Array<string>(10).fill('#345678')));source.setItem('secret','never export');
 const raw=exportPreferences(source);assert.equal(raw.includes('secret'),false);assert.equal(importPreferences(raw,target),true);assert.equal(target.getItem(PREFERENCE_KEYS[0]),source.getItem(PREFERENCE_KEYS[0]));
 const before=Array.from(target.data);
 for(const invalid of ['{',envelope({secret:'"bad"'}),envelope({[PREFERENCE_KEYS[0]]:'["#fff"]'}),envelope({[PREFERENCE_KEYS[7]]:JSON.stringify({version:2,automatic:true,bindings:[{sessionId:'a',bunnyId:1},{sessionId:'b',bunnyId:1}]})}),' '.repeat(65537)]){assert.equal(importPreferences(invalid,target),false);assert.deepEqual(Array.from(target.data),before);}
 assert.equal(parsePreferences(envelope({[PREFERENCE_KEYS[1]]:JSON.stringify(Array.from({length:10},()=>({x:900,y:200,facing:-1,layout:'test'})))}))?.[PREFERENCE_KEYS[1]]?.includes('test'),true);
});
void test('a partial storage failure restores receiving values and retains a recovery backup',()=>{
 const target=storage();target.setItem(PREFERENCE_KEYS[0],JSON.stringify(Array<string>(10).fill('#112233')));
 const original=target.getItem(PREFERENCE_KEYS[0]);let failed=false;
 const limited={...target,setItem:(key:string,value:string)=>{if(key===PREFERENCE_KEYS[7]&&!failed){failed=true;throw new Error('storage-unavailable');}target.setItem(key,value);}};
 assert.equal(importPreferences(envelope({[PREFERENCE_KEYS[0]]:JSON.stringify(Array<string>(10).fill('#ffffff')),[PREFERENCE_KEYS[7]]:JSON.stringify({version:2,automatic:true,bindings:[]})}),limited),false);
 assert.equal(target.getItem(PREFERENCE_KEYS[0]),original);assert.notEqual(target.getItem('bunny.burrow.dashboard-import-backup.v1'),null);assert.equal(target.getItem(PREFERENCE_KEYS[7]),null);
});
void test('legacy-only imports replace receiving v2 assignments, supplied v2 wins and failure restores both',()=>{
 const target=storage(),legacy=PREFERENCE_KEYS[6],current=PREFERENCE_KEYS[7];
 const previous=JSON.stringify({version:2,automatic:false,bindings:[{sessionId:'receiving-session',bunnyId:0}]}),imported=JSON.stringify({sessionId:'preview-session',bunnyId:6});
 target.setItem(current,previous);
 assert.equal(importPreferences(envelope({[legacy]:imported}),target),true);
 assert.deepEqual(settingsFrom(target.getItem(current),target.getItem(legacy)),{version:2,automatic:true,bindings:[{sessionId:'preview-session',bunnyId:6}]});
 const supplied=JSON.stringify({version:2,automatic:false,bindings:[{sessionId:'supplied-v2',bunnyId:4}]});
 assert.equal(importPreferences(envelope({[legacy]:imported,[current]:supplied}),target),true);assert.equal(target.getItem(current),supplied);
 target.setItem(current,previous);target.removeItem(legacy);let failed=false;
 const limited={...target,setItem:(key:string,value:string)=>{if(key===current&&!failed){failed=true;throw new Error('storage-unavailable');}target.setItem(key,value);}};
 assert.equal(importPreferences(envelope({[legacy]:imported}),limited),false);assert.equal(target.getItem(current),previous);assert.equal(target.getItem(legacy),null);
});
