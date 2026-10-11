import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {OnnHistoryStore} from '../src/history.js';
void test('durable selected-title original and rollback use the caller transaction', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const store = new OnnHistoryStore(database);
    const sample = {schema: 'onn-metadata/2.0' as const, deviceElapsedMs: 1000, sessions: []};
    database.exec('BEGIN');
    assert.equal(store.ingest({intakeId: 'i1', runId: 'r1', poll: 1, receivedAtMs: 1000, sample}), true);
    database.exec('ROLLBACK');
    assert.equal(store.status(1000, true).lastAccepted, null);
    database.exec('BEGIN');
    assert.equal(store.ingest({intakeId: 'i1', runId: 'r1', poll: 1, receivedAtMs: 1000, sample}), true);
    database.exec('COMMIT');
    assert.equal(store.ingest({intakeId: 'i1', runId: 'r1', poll: 1, receivedAtMs: 1000, sample}), false);
    assert.equal(store.status(1000, true).lastAccepted?.intakeId, 'i1');
  } finally {database.close();}
});

import {SdkError} from '@jimmie-potts/sdk';
import type {MetadataSample, MetadataSession} from '../src/metadata.js';
import {HISTORY_RESPONSE_BYTES, type HistoryPage, type HistoryDetail, type Intake} from '../src/history.js';
const session = (app: 'youtube' | 'stremio', title: string | null = 'SYNTHETIC title', mediaId: string | null = null): MetadataSession => ({app,metadata:{title,displayTitle:null,subtitle:null,artist:null,album:null,genre:null,description:null,mediaId,durationMs:null},playback:{state:3,positionMs:100,speed:1,positionUpdatedElapsedMs:0},omissions:[]});
const sample = (sessions: MetadataSession[], elapsed: number): MetadataSample => ({schema:'onn-metadata/2.0',deviceElapsedMs:elapsed,sessions});
const fixture = () => {
  const database = new DatabaseSync(':memory:'); const store = new OnnHistoryStore(database);
  let poll = 0;
  const atomic = <T>(work: () => T): T => {database.exec('BEGIN'); try {const value=work();database.exec('COMMIT');return value;} catch (error) {if (database.isTransaction) database.exec('ROLLBACK');throw error;}};
  const put = (sessions: MetadataSession[], receivedAtMs = (poll+1)*1000, elapsed = receivedAtMs, runId = 'run'): Intake => {
    poll += 1; const input={intakeId:`intake-${poll}`,runId,poll,receivedAtMs}; atomic(()=>store.ingest({...input,sample:sample(sessions,elapsed)})); return input;
  };
  return {database,store,atomic,put,close:()=>database.close()};
};
const present = <T>(value: T | null | undefined): T => {assert.ok(value !== null && value !== undefined);return value;};
const page = (value: ReturnType<OnnHistoryStore['history']>): HistoryPage => {assert.ok(!('error' in value),JSON.stringify(value));return value;};
const detail = (value: ReturnType<OnnHistoryStore['detail']>): HistoryDetail => {assert.ok(!('error' in value),JSON.stringify(value));return value;};
void test('both apps and same-title unsupported identities remain separate with source semantics and nulls', () => {
  const f=fixture();try {
    f.put([session('youtube','Unicode 👩🏽‍🚀 café 漢字')]);f.put([session('stremio','Unicode 👩🏽‍🚀 café 漢字')]);f.put([session('stremio','Unicode 👩🏽‍🚀 café 漢字')]);
    const result=page(f.store.history({}));assert.equal(result.items.length,3);
    assert.equal(new Set(result.items.map(item=>item.id)).size,3);
    assert.ok(result.items.every(item=>item.identityConfidence==='unsupported'));
    assert.equal(result.items.at(-1)?.observation.provenance.semantics,'selected-title-observed');
    assert.equal(result.items[0]?.observation.provenance.semantics,'title-observed');
    assert.equal(result.items[0]?.observation.metadata?.durationMs,null);
    assert.equal(page(f.store.history({title:'漢字'})).items.length,3);
  } finally {f.close();}
});
void test('stable ID retains each source revision; dates select an in-window observation from an earlier occurrence', () => {
  const f=fixture();try {
    f.put([session('stremio','episode','stable')],1000); f.put([session('stremio','episode','stable')],2000);
    f.put([session('stremio','episode newer','stable')],3000);
    const result=page(f.store.history({app:'stremio',fromMs:1500,toMs:2500}));
    assert.equal(result.items.length,1);assert.equal(result.items[0]?.firstObservedAtMs,1000);assert.equal(result.items[0]?.matchingObservedAtMs,2000);
    assert.equal(result.items[0]?.observation.metadata?.title,'episode');
    const occurrence=detail(f.store.detail({id:present(result.items[0]).id}));assert.equal(occurrence.observations.length,3);
    assert.deepEqual(occurrence.observations.map(observation=>observation.receivedAtMs),[3000,2000,1000]);
  } finally {f.close();}
});
void test('current exit, multiple sessions, gap, stale boundary and restart never fabricate current playback', () => {
  const f=fixture();try {
    f.put([session('youtube','a','id')]);assert.equal(f.store.status(1000,true).status,'fresh');assert.equal(f.store.status(16000,true).status,'stale');
    f.put([session('youtube','a','id'),session('stremio','b','other')]);assert.equal(f.store.status(2000,true).ambiguous,true);
    assert.ok(page(f.store.history({})).items.slice(0,2).every(item=>item.identityConfidence==='ambiguous'));
    f.atomic(()=>f.store.gap({intakeId:'gap',runId:'run',poll:3,receivedAtMs:3000,reason:'busy'}));
    assert.equal(f.store.status(3000,true).status,'unavailable');assert.equal(f.store.status(3000,true).currentEvidence,'last-observed');
    assert.equal(f.store.status(3000,false).status,'disabled');
    f.put([],4000);assert.deepEqual(f.store.status(4000,true).current,[]);
    const restarted = new OnnHistoryStore(f.database);assert.equal(restarted.status(4000,true).status,'stale');
    assert.equal(restarted.status(4000,true).currentEvidence,'last-observed');assert.equal(page(restarted.history({})).items.length,3);
  } finally {f.close();}
});
void test('gaps, empty, content changes and clock resets retire source continuity', () => {
  const f=fixture();try {
    f.put([session('youtube','a','id')],1000);f.put([session('youtube','a','id')],2000);
    f.atomic(()=>f.store.gap({intakeId:'gap',runId:'run',poll:3,receivedAtMs:2500,reason:'unavailable'}));
    f.put([session('youtube','a','id')],3000);f.put([],4000);f.put([session('youtube','a','id')],5000);
    f.put([session('youtube','a','id')],6000,100);f.put([session('youtube','a','new')],7000,1100);
    f.put([session('youtube','a','new')],500,2100);
    const result=page(f.store.history({}));assert.equal(result.items.length,6);assert.equal(result.coverage.gapCount,3);
    assert.equal(result.coverage.recentGaps[0]?.reason,'clock');
  } finally {f.close();}
});
void test('conflicting intake is a fixed shared error, rollback preserves originals and unwrapped writes refuse', () => {
  const f=fixture();try {
    const input=f.put([session('youtube','a','id')]);
    assert.throws(()=>f.atomic(()=>f.store.ingest({...input,sample:sample([session('youtube','changed','id')],1000)})),(error:unknown)=>error instanceof SdkError && error.body.error.code==='duplicate-conflict' && !error.message.includes('changed'));
    assert.throws(()=>f.store.gap({intakeId:'unwrapped',runId:'run',poll:2,receivedAtMs:2000,reason:'storage'}),(error:unknown)=>error instanceof SdkError && error.body.error.code==='invalid-state');
    assert.throws(()=>f.atomic(()=>{f.store.ingest({intakeId:'rolled-back',runId:'run',poll:2,receivedAtMs:2000,sample:sample([session('youtube','lost','id')],2000)});throw new Error('abort');}));
    assert.equal(detail(f.store.detail({id:present(page(f.store.history({})).items[0]).id})).observations.length,1);
    assert.equal(f.store.status(2000,true).lastAccepted?.intakeId,input.intakeId);
  } finally {f.close();}
});
void test('history and detail cursors bind filters, limit, scope, cutoff and immutable revisions during intake', () => {
  const f=fixture(); const other=fixture();try {
    f.put([session('youtube','older','stable')],1000);f.put([session('stremio','newer')],2000);
    const first=page(f.store.history({limit:1}));assert.ok(first.nextCursor !== null && first.nextCursor.length > 0);
    f.put([session('youtube','changed','stable')],3000);
    const next=page(f.store.history({limit:1,cursor:first.nextCursor}));assert.equal(next.items[0]?.observation.metadata?.title,'older');assert.equal(next.cutoff,first.cutoff);
    for (const input of [{limit:2,cursor:first.nextCursor},{app:'youtube',limit:1,cursor:first.nextCursor},{limit:1,cursor:first.nextCursor+'a'}]) assert.equal('error' in f.store.history(input),true);
    assert.equal('error' in other.store.history({limit:1,cursor:first.nextCursor}),true);
    const id=present(next.items[0]).id; const one=detail(f.store.detail({id,limit:1}));
    f.put([session('youtube','changed again','stable')],4000);
    if (one.nextCursor !== null && one.nextCursor.length > 0) {const two=detail(f.store.detail({id,limit:1,cursor:one.nextCursor}));assert.equal(two.cutoff,one.cutoff);assert.equal(two.occurrence.matchingObservedAtMs,one.occurrence.matchingObservedAtMs);}
    assert.equal('error' in f.store.detail({id,cursor:first.nextCursor}),true);
  } finally {f.close();other.close();}
});
void test('date/title empty candidate windows advance through bounded evidence instead of scanning archive', () => {
  const f=fixture();try {
    f.put([session('youtube','needle')],1000);
    for(let i=0;i<501;i++)f.put([session('youtube','other')],2000+i);
    const first=page(f.store.history({title:'needle',fromMs:0,toMs:1500}));assert.deepEqual(first.items,[]);assert.ok(first.nextCursor !== null && first.nextCursor.length > 0);
    const next=page(f.store.history({title:'needle',fromMs:0,toMs:1500,cursor:first.nextCursor}));assert.equal(next.items.length,1);assert.equal(next.items[0]?.matchingObservedAtMs,1000);assert.equal(next.nextCursor,null);
    const emptyDate=page(f.store.history({fromMs:0,toMs:1500}));assert.deepEqual(emptyDate.items,[]);assert.ok(emptyDate.nextCursor !== null && emptyDate.nextCursor.length > 0);
  } finally {f.close();}
});
void test('closed query inputs reject unsafe bounds, arbitrary lookup and foreign cursors', () => {
  const f=fixture();try {
    for(const query of [null,[],{app:'other'},{fromMs:-1},{fromMs:NaN},{fromMs:1.5},{toMs:Number.MAX_SAFE_INTEGER+1},{fromMs:2,toMs:1},{title:'x'.repeat(257)},{limit:0},{limit:101},{cursor:null},{path:'/private'},{url:'https://example.invalid'},{__extra:true}]) {
      const result=f.store.history(query);assert.ok('error' in result);assert.equal(result.error.code,'invalid-request');
    }
    for(const query of [{},{id:'0'},{id:'occ-0'},{id:'occ-1',limit:101},{id:'occ-1',extra:1}]){const result=f.store.detail(query);assert.ok('error' in result);assert.equal(result.error.code,'invalid-request');}
    const result=f.store.detail({id:'occ-1'});assert.ok('error' in result);assert.equal(result.error.code,'not-found');
  } finally {f.close();}
});
void test('reply projection preserves Unicode and originals while bounding page and detail bytes', () => {
  const f=fixture();try {
    const text='👩🏽‍🚀 漢字 '.repeat(250);
    for(let i=0;i<50;i++) {
      const value=session('youtube',text);for(const key of ['title','displayTitle','subtitle','artist','album','genre','description','mediaId'] as const)present(value.metadata)[key]=text;
      present(value.metadata).mediaId = `${text}${i}`;
      f.put([value]);
    }
    const result=page(f.store.history({limit:100}));assert.ok(Buffer.byteLength(JSON.stringify(result))<=HISTORY_RESPONSE_BYTES);assert.ok(result.nextCursor !== null && result.nextCursor.length > 0);assert.ok(result.pageOmissions.length>0);
    assert.equal(result.items[0]?.observation.projectionOmissions.length,8);
    assert.ok(result.items[0]?.observation.metadata?.title?.includes('\uFFFD') !== true);
    const raw=f.database.prepare('SELECT session FROM onn_history_observations ORDER BY id LIMIT 1').get() as {session:string};assert.equal((JSON.parse(raw.session) as MetadataSession).metadata?.title,text);
    const one=detail(f.store.detail({id:present(result.items[0]).id,limit:100}));assert.ok(Buffer.byteLength(JSON.stringify(one))<=HISTORY_RESPONSE_BYTES);
  } finally {f.close();}
});
void test('real SQLite capacity fault refuses intake and leaves earlier originals after caller rollback', () => {
  const f=fixture();try {
    f.put([session('youtube','earlier')]);
    const pages=(f.database.prepare('PRAGMA page_count').get() as {page_count:number}).page_count;
    f.database.exec(`PRAGMA max_page_count=${pages}`);
    const huge=session('youtube','x'.repeat(8000));present(huge.metadata).description='y'.repeat(8000);
    let capacity=false;
    for(let i=0;i<30;i++) {
      try {f.put([huge]);} catch(error) {assert.ok(error instanceof SdkError);assert.equal(error.body.error.code,'capacity');capacity=true;break;}
    }
    assert.equal(capacity,true);
    assert.equal(page(f.store.history({title:'earlier'})).items.length,1);
    const rows=f.database.prepare('SELECT intakeId FROM onn_history_intakes WHERE payload LIKE ?').all('%earlier%');assert.equal(rows.length,1);
  } finally {f.close();}
});
void test('source-reported paused, seek, duration and position are retained without derived totals', () => {
  const f=fixture();try {
    const paused=session('stremio','movie','stable');paused.playback={state:2,positionMs:9000,speed:0,positionUpdatedElapsedMs:100};present(paused.metadata).durationMs=10000;
    f.put([paused],1000);const seek=structuredClone(paused);present(seek.playback).positionMs=2000;present(seek.playback).state=6;f.put([seek],2000);
    const result=detail(f.store.detail({id:present(page(f.store.history({})).items[0]).id}));assert.deepEqual(result.observations.map(value=>value.playback?.positionMs),[2000,9000]);
    assert.equal('watchedMs' in result,false);assert.equal('completion' in result,false);assert.equal(result.occurrence.observation.metadata?.durationMs,10000);
  } finally {f.close();}
});

import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
void test('closing and reopening an on-disk lease retains immutable originals and retires continuity', () => {
  const directory=mkdtempSync(join(tmpdir(),'onn-history-test-'));const file=join(directory,'module.sqlite');
  let database=new DatabaseSync(file);
  try {
    let store=new OnnHistoryStore(database);
    database.exec('BEGIN');store.ingest({intakeId:'initial',runId:'run1',poll:1,receivedAtMs:1000,sample:sample([session('stremio','retained','source')],1000)});database.exec('COMMIT');
    database.close();database=new DatabaseSync(file);store=new OnnHistoryStore(database);
    assert.equal(store.status(1000,true).status,'stale');assert.equal(store.status(1000,true).currentEvidence,'last-observed');
    assert.equal(page(store.history({})).items[0]?.observation.metadata?.title,'retained');
    database.exec('BEGIN');store.ingest({intakeId:'after-restart',runId:'run2',poll:1,receivedAtMs:2000,sample:sample([session('stremio','retained','source')],2000)});database.exec('COMMIT');
    assert.equal(page(store.history({})).items.length,2);assert.equal(store.status(10**12,true).status,'stale');assert.equal(page(store.history({})).items.length,2);
  } finally {database.close();rmSync(directory,{recursive:true,force:true});}
});
void test('detail response cap continues over retained large revisions without omitting originals', () => {
  const f=fixture();try {
    const text='漢字👩🏽‍🚀'.repeat(300);const value=session('stremio',text,'stable');
    for(const field of ['displayTitle','subtitle','artist','album','genre','description'] as const)present(value.metadata)[field]=text;
    for(let i=0;i<50;i++)f.put([value]);
    const id=present(page(f.store.history({})).items[0]).id;let cursor:string|null=null;let seen=0;let pages=0;
    do {
      const result=detail(f.store.detail(cursor===null?{id,limit:100}:{id,limit:100,cursor}));
      assert.ok(Buffer.byteLength(JSON.stringify(result))<=HISTORY_RESPONSE_BYTES);if(pages===0){assert.ok(result.pageOmissions.length>0);assert.ok(result.nextCursor !== null && result.nextCursor.length > 0);}
      seen+=result.observations.length;cursor=result.nextCursor;pages+=1;assert.ok(pages<10);
    } while(cursor!==null);
    assert.equal(seen,50);
    const raw=f.database.prepare('SELECT session FROM onn_history_observations ORDER BY id LIMIT 1').get() as {session:string};assert.equal((JSON.parse(raw.session) as MetadataSession).metadata?.title,text);
  } finally {f.close();}
});
void test('unreadable storage returns fixed safe query errors without SQL or paths', () => {
  const f=fixture();f.close();
  for(const result of [f.store.history({}),f.store.detail({id:'occ-1'})]) {assert.ok('error' in result);assert.equal(result.error.code,'unavailable');assert.equal(JSON.stringify(result).includes('sqlite'),false);assert.equal(JSON.stringify(result).includes('SELECT'),false);}
});

void test('intake revalidates credentials before private originals and distrusts redacted source identity', () => {
  const f=fixture();try {
    const value=session('youtube','Personal café user@example.invalid /home/owner https://example.invalid/page?q=ordinary token=SYNTHETIC_TOKEN_123','https://example.invalid/id?token=SYNTHETIC_ID_TOKEN_456');
    present(value.metadata).description='Bearer SYNTHETIC_BEARER_789 ordinary context';
    f.put([value]);f.put([value]);
    const originals=f.database.prepare('SELECT payload FROM onn_history_intakes ORDER BY sequence').all() as {payload:string}[];
    assert.equal(originals.length,2);
    for(const row of originals){
      assert.equal(row.payload.includes('SYNTHETIC_TOKEN_123'),false);assert.equal(row.payload.includes('SYNTHETIC_ID_TOKEN_456'),false);assert.equal(row.payload.includes('SYNTHETIC_BEARER_789'),false);
      assert.ok(row.payload.includes('user@example.invalid'));assert.ok(row.payload.includes('/home/owner'));assert.ok(row.payload.includes('https://example.invalid/page?q=ordinary'));assert.ok(row.payload.includes('credential-redacted'));
    }
    const result=page(f.store.history({}));assert.equal(result.items.length,2);assert.ok(result.items.every(item=>item.identityConfidence==='unsupported'));
    assert.equal(value.metadata?.title?.includes('SYNTHETIC_TOKEN_123'),true,'caller object is not mutated');
    assert.equal(f.store.status(2000,true).current[0]?.omissions.some(item=>item.field==='mediaId'),true);
  } finally {f.close();}
});
void test('omitted stable ID stays unsupported; null fields persist and malformed samples refuse', () => {
  const f=fixture();try {
    const value=session('stremio','same','id');value.omissions=[{field:'mediaId',reason:'oversized'}];
    f.put([value]);f.put([value]);
    const empty:MetadataSession={app:'stremio',metadata:null,playback:null,omissions:[]};f.put([empty]);
    const result=page(f.store.history({}));assert.equal(result.items.length,3);assert.ok(result.items.every(item=>item.identityConfidence==='unsupported'));assert.equal(result.items[0]?.observation.metadata,null);assert.equal(result.items[0]?.observation.playback,null);
    const malformed=sample([session('youtube')],4000);present(present(malformed.sessions[0]).playback).speed=Infinity;
    assert.throws(()=>f.atomic(()=>f.store.ingest({intakeId:'malformed',runId:'run',poll:4,receivedAtMs:4000,sample:malformed})),(error:unknown)=>error instanceof SdkError && error.body.error.code==='invalid-request');
    assert.equal(f.store.status(4000,true).lastAccepted?.poll,3);
  } finally {f.close();}
});

void test('unreadable lease yields honest unavailable current state instead of leaking a database error', () => {
  const f=fixture();f.close();
  const state=f.store.status(1000,true);assert.equal(state.status,'unavailable');assert.equal(state.currentEvidence,'none');assert.deepEqual(state.current,[]);
  assert.equal(state.coverage.storageAvailable,false);assert.equal(state.lastAccepted,null);
  assert.equal(JSON.stringify(state).includes('sqlite'),false);
});

void test('closed queries refuse non-JSON object shapes and accessors without executing them', () => {
  const f=fixture();try {
    let touched=false;const accessor=Object.defineProperty({},'title',{enumerable:true,get(){touched=true;return 'title';}});
    for(const query of [new Date(),Object.create({app:'youtube'}) as unknown,{[Symbol('extra')]:1},accessor]){const result=f.store.history(query);assert.ok('error' in result);assert.equal(result.error.code,'invalid-request');}
    assert.equal(touched,false);
  } finally {f.close();}
});
