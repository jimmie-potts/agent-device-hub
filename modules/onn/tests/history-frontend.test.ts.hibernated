import assert from 'node:assert/strict';
import {test} from 'node:test';
import {dateFilters, readState, readRecord, readPage, readDetail, sessionFacts, currentStatus, historyPath, detailPath, recordOrder} from '../src/frontend/history-data.js';
import type {HistoryState, HistoryObservation, HistoryOccurrence} from '../src/history.js';
import {Ajv2020} from 'ajv/dist/2020.js';
import {historyStateSchema,historyRecordSchema,historyPageSchema,historyDetailSchema} from '../src/history-contract.js';
const state: HistoryState = {schema:'onn-history-state/2.0',enabled:true,status:'fresh',current:[],ambiguous:false,currentEvidence:'fresh-observation',lastAccepted:{intakeId:'sample-1',runId:'run-1',poll:1,sequence:1,receivedAtMs:1000,deviceElapsedMs:500,reader:{sha256:'a'.repeat(64),sourceVersion:'synthetic'}},coverage:{collectionStartedAtMs:1000,gapCount:0,recentGaps:[],storageAvailable:true,pendingGap:null,semantics:'observations-only',limits:{pollMs:5000,staleMs:15000,candidates:500,textBytes:512,responseBytes:131072,recentGaps:20,sourceSessions:8,sourceTextBytes:8192,sourceReplyBytes:262144}}};
void test('local inclusive dates use calendar boundaries on 23/25-hour days and midnight',()=>{
  const previousZone=process.env.TZ; process.env.TZ='America/New_York';
  try {
  for(const [date,hours] of [['2026-03-08',23],['2026-11-01',25],['2026-10-11',24]] as const){
    const range=dateFilters(date,date);
    assert.ok(range.fromMs!==undefined && range.toMs!==undefined);
    assert.equal(range.fromMs,new Date(date+'T00:00:00').getTime());
    assert.equal((range.toMs-range.fromMs)/3_600_000,hours);
    assert.equal(new Date(range.toMs).getHours(),0);
  }
  assert.deepEqual(dateFilters('',''),{});
  assert.throws(()=>dateFilters('2026-02-30',''),/date/i);
  assert.throws(()=>dateFilters('2026-10-12','2026-10-11'),/range/i);
  } finally {if(previousZone===undefined)delete process.env.TZ;else process.env.TZ=previousZone;}
});
void test('browser guards agree with authoritative schemas for state/record/page/detail and nested malformed JSON',()=>{
  const accepted=state.lastAccepted;assert.ok(accepted!==null);
  const observation:HistoryObservation={...accepted,id:'obs-1',app:'stremio',metadata:{title:'SYNTHETIC episode',displayTitle:null,subtitle:'Episode 2',artist:null,album:'SYNTHETIC series',genre:null,description:null,mediaId:'source-1',durationMs:100000},playback:{state:3,positionMs:1200,speed:1,positionUpdatedElapsedMs:500},omissions:[{field:'description',reason:'credential-redacted'}],projectionOmissions:[{field:'title',reason:'projection-limit',originalBytes:600}],provenance:{source:'android-media-session',readerSchema:'onn-metadata/2.0',semantics:'title-observed'}};
  const occurrence:HistoryOccurrence={id:'occ-1',app:'stremio',firstObservedAtMs:1000,matchingObservedAtMs:1000,identityConfidence:'source-id',observation};
  const common={cutoff:1,nextCursor:'SYNTHETIC.cursor-1',coverage:{...state.coverage,gapCount:1,recentGaps:[{intakeId:'gap-1',runId:'run-1',poll:2,receivedAtMs:2000,sequence:2,reason:'busy'}],pendingGap:{intakeId:'gap-2',runId:'run-1',poll:3,receivedAtMs:3000,reason:'storage'}},pageOmissions:[{reason:'response-limit',continuation:true}]};
  const variants:[object,(value:unknown)=>unknown,unknown][]=[
    [historyStateSchema,readState,{...state,current:[observation].map(({app,metadata,playback,omissions,projectionOmissions})=>({app,metadata,playback,omissions,projectionOmissions}))}],
    [historyRecordSchema,readRecord,{...state,id:'onn',revision:2,configurationRevision:1}],
    [historyPageSchema,readPage,{schema:'onn-history/2.0',...common,ordering:'evidence-desc',items:[occurrence]}],
    [historyDetailSchema,readDetail,{schema:'onn-history-detail/2.0',...common,occurrence,observations:[observation]}],
  ];
  const ajv=new Ajv2020({strict:true});
  for(const [schema,read,fixture] of variants){
    const validate=ajv.compile(schema);
    const compare=(value:unknown)=>assert.equal(read(value)!==undefined,validate(value),JSON.stringify(validate.errors));
    compare(fixture);
    const mutate=(value:unknown,path:(string|number)[]=[])=>{
      for(const replacement of [null,{},[],true,-1,'unsupported']){
        const copy=structuredClone(fixture);let target=copy as Record<string|number,unknown>;
        if(path.length===0)compare(replacement);
        else {for(const key of path.slice(0,-1))target=target[key] as Record<string|number,unknown>;const last=path.at(-1);assert.ok(last!==undefined);target[last]=replacement;compare(copy);}
      }
      if(value!==null&&typeof value==='object')for(const [key,child]of Object.entries(value))mutate(child,[...path,Array.isArray(value)?Number(key):key]);
    };
    mutate(fixture);
  }
  const emptyPage={schema:'onn-history/2.0',...common,ordering:'evidence-desc',items:[]};
  assert.ok(readPage(emptyPage)?.nextCursor!==null);
  assert.equal(readPage({...emptyPage,items:new Array(1)}),undefined);
});
void test('continuation retains exact submitted filters and limit, with separate detail cursors',()=>{
  const filters={app:'youtube' as const,from:'2026-10-11',through:'2026-10-11',title:'SYNTHETIC & + title'};
  const first=new URL(historyPath(filters),'https://synthetic.invalid'),next=new URL(historyPath(filters,'opaque.+/&?'),'https://synthetic.invalid');
  assert.equal(next.searchParams.get('cursor'),'opaque.+/&?');
  next.searchParams.delete('cursor');assert.equal(next.search,first.search);
  assert.equal(next.searchParams.get('limit'),'50');
  const detail=new URL(detailPath('occ-1','detail.+/&?'),'https://synthetic.invalid');
  assert.equal(detail.searchParams.get('id'),'occ-1');assert.equal(detail.searchParams.get('limit'),'50');assert.equal(detail.searchParams.get('cursor'),'detail.+/&?');
});
void test('source values remain reported, missing fields stay unknown, and freshness expires at 15 seconds',()=>{
  const facts=sessionFacts({app:'youtube',metadata:{title:'<script>SYNTHETIC</script>',displayTitle:null,subtitle:null,artist:'SYNTHETIC channel',album:null,genre:null,description:null,mediaId:null,durationMs:100000},playback:{state:3,positionMs:-1,speed:2,positionUpdatedElapsedMs:100},omissions:[],projectionOmissions:[]});
  assert.ok(facts.some(([label,value])=>label==='Title' && value==='<script>SYNTHETIC</script>'));
  assert.ok(facts.some(([label,value])=>label==='Source position' && value==='Unknown'));
  assert.ok(facts.some(([label,value])=>label==='Source duration' && value==='100000 ms'));
  assert.equal(currentStatus(state,true,15999),'fresh');
  assert.equal(currentStatus(state,true,16000),'stale');
  assert.equal(currentStatus(state,true,999),'stale');
  assert.equal(currentStatus(state,false,1000),'stale');
  assert.equal(currentStatus({...state,status:'unavailable'},true,1000),'unavailable');
  assert.equal(currentStatus({...state,enabled:false,status:'disabled'},true,1000),'disabled');
});
void test('authoritative schema accepts supported documents and rejects malformed or unsupported values',()=>{
  assert.equal(readState(state),state);
  for(const malformed of [null,{}, {...state,schema:'onn-history-state/9.0'}, {...state,extra:'private'}, {...state,current:[{}]}, {...state,lastAccepted:{...state.lastAccepted,receivedAtMs:-1}}]) assert.equal(readState(malformed),undefined);
});

void test('single-owner current evidence retires conflicting owners',()=>{
  const current = {...state,id:'onn',revision:5,configurationRevision:1};
  assert.equal(recordOrder(current,{...current,revision:4}),'ignore');
  assert.equal(recordOrder(current,{...current,revision:6}),'accept');
  assert.equal(recordOrder(current,{...current,id:'other-owner',revision:6}),'conflict');
  assert.equal(recordOrder(current,{...current,id:'other-owner',revision:4}),'conflict');
  assert.equal(recordOrder(current,{...current,status:'stale'}),'conflict');
});
void test('title filters match the owning UTF-16 boundary',()=>{
  assert.throws(()=>historyPath({app:'',from:'',through:'',title:'😀'.repeat(129)}),/long/);
  assert.ok(historyPath({app:'',from:'',through:'',title:'😀'.repeat(128)}).includes('title='));
});
