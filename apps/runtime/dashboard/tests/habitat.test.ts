import assert from 'node:assert/strict';
import test from 'node:test';
import type {Notice} from '@jimmie-potts/event-contracts/v2/families';
import {buildSession,type SessionFacts,type SessionView} from '@jimmie-potts/event-contracts/v2/session-view';
import {assignSession,conversationFor,presentation,reconcileBindings,settingsFrom} from '../src/habitat/session.ts';
import {exportPreferences,importPreferences,parsePreferences,PREFERENCE_KEYS} from '../src/habitat/preferences.ts';
function stored(n:number):SessionFacts{return {id:`session-${n}`,revision:1,generation:1,identity:{provider:'codex',client:'desktop',hostId:'host-sim',sourceId:'codex-desktop',sessionId:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`},parent:{status:'top-level'},turn:{status:'known',id:'turn-1'},work:'active',attention:[],notices:[],read:'unknown',unavailable:[],ordering:{status:'unknown'},observedAtMs:n,lastEvidenceAtMs:n,children:{working:0,unconfirmed:0}};}
/** One synthetic Codex Desktop session's session/3.0 record, which is its view. */
const record=(n:number,change:Partial<SessionFacts>={}):SessionView=>buildSession({...stored(n),...change});
void test('ten stable assignments, overflow, children and an authoritative removal',()=>{
 const records=Array.from({length:12},(_,n)=>record(n)),first=reconcileBindings([],records);
 assert.equal(first.length,10);assert.equal(new Set(first.map(b=>b.bunnyId)).size,10);assert.equal(first[0]?.sessionId,'session-11');
 assert.deepEqual(reconcileBindings(first,records.map(r=>({...r,lastEvidenceAtMs:100-r.lastEvidenceAtMs})).reverse()),first);
 const next=reconcileBindings(first,records.filter(r=>r.id!==first[3]?.sessionId));assert.equal(next.find(b=>b.bunnyId===3)?.sessionId,'session-1');
 for(const binding of first.filter(b=>b.bunnyId!==3))assert.deepEqual(next.find(b=>b.bunnyId===binding.bunnyId),binding);
 assert.deepEqual(reconcileBindings([],[record(1,{parent:{status:'known',identity:stored(0).identity}}),record(2,{parent:{status:'unknown'}})]),[{sessionId:'session-2',bunnyId:0}]);
});
void test('legacy preferences migrate and malformed or duplicate bindings do not multiply residents',()=>{
 assert.deepEqual(settingsFrom(null,JSON.stringify({sessionId:'a',bunnyId:6})).bindings,[{sessionId:'a',bunnyId:6}]);
 assert.deepEqual(settingsFrom(JSON.stringify({version:2,automatic:false,bindings:[{sessionId:'a',bunnyId:3},{sessionId:'b',bunnyId:3},{sessionId:'a',bunnyId:4},{sessionId:'c',bunnyId:10},{sessionId:'d',bunnyId:7}]})),{version:2,automatic:false,bindings:[{sessionId:'a',bunnyId:3},{sessionId:'d',bunnyId:7}]});
 assert.deepEqual(settingsFrom('{'),{version:2,automatic:true,bindings:[]});
 const original=[{sessionId:'a',bunnyId:0},{sessionId:'b',bunnyId:1}];assert.deepEqual(assignSession(original,'a',1),[{sessionId:'b',bunnyId:0},{sessionId:'a',bunnyId:1}]);assert.equal(original[0]?.sessionId,'a');
});
void test('session meaning stays with the shell and qualified navigation is independent of work confirmation',()=>{
 const current=record(1);assert.equal(presentation(current,true).state,'working');assert.equal(presentation(current,false).uncertain,true);
 assert.equal(conversationFor(record(1,{unconfirmed:'deadline'}),'Win32').href,`codex://threads/${current.identity.sessionId}`);
 for(const value of [conversationFor(current,'iPhone'),conversationFor(record(1,{identity:{...current.identity,client:'cli'}}),'Win32'),conversationFor(record(1,{identity:{...current.identity,sessionId:'x/?foo'}}),'Win32')])assert.equal(value.href,undefined);
});
void test('a resident is uncertain only for an unknown status, unconfirmed working or an unsynced copy (#1865)',()=>{
 const question={id:{status:'known',id:'question-1'},kind:'question',turn:{status:'known',id:'turn-1'}} as const;
 const finished=[{id:'n'.repeat(64),kind:'turn-ended',turn:{status:'known',id:'turn-1'},acknowledgedBy:[]}] as Notice[];
 assert.deepEqual(presentation(record(1,{unconfirmed:'deadline'}),true),{state:'working',name:stored(1).identity.sessionId,client:'Codex Desktop',uncertain:true});
 assert.equal(presentation(record(1,{unconfirmed:'deadline',attention:[question]}),true).uncertain,false,'a question waits however long it is silent');
 assert.deepEqual(presentation(record(1,{work:'idle',notices:finished}),true),{state:'finished',name:stored(1).identity.sessionId,client:'Codex Desktop',uncertain:false});
 assert.equal(presentation(record(1,{work:'unknown'}),true).uncertain,true);
});
void test('bindings do not churn on progress or reconnect',()=>{
 const sessions=Array.from({length:12},(_,n)=>record(n)),first=reconcileBindings([],sessions);
 // Progress: every session publishes newer evidence in the reverse order, and silence makes work unconfirmed.
 const progressed=sessions.map((_,n)=>record(n,{revision:5,lastEvidenceAtMs:1000-n,...(n%2===0?{unconfirmed:'deadline' as const}:{})}));
 assert.deepEqual(reconcileBindings(first,progressed),first,'newer evidence moves no resident');
 // Reconnect: the replacement copy brings the same sessions in another order, then one more that waits for a spot.
 assert.deepEqual(reconcileBindings(first,[...progressed].reverse()),first,'a resynced copy in another order moves no resident');
 assert.deepEqual(reconcileBindings(first,[...progressed,record(12,{lastEvidenceAtMs:5000})]),first,'a new arrival waits for a free spot');
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
