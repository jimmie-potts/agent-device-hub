import test from 'node:test';
import assert from 'node:assert/strict';
import {createPinoEmitter, DiagnosticContext} from '../dist/node.js';
import {parseTraceparent,traceHeaders} from '../dist/index.js';
import {record} from './sample.mjs';

test('concurrent context and captured queue work restore their own parent',async()=>{
 const context=new DiagnosticContext();
 const a=parseTraceparent('00-11111111111111111111111111111111-1111111111111111-01',{authenticated:true,owned:true});
 const b={...a,span_id:'2222222222222222'};
 const reads=await Promise.all([a,b].map(value=>context.run(value,async()=>{await new Promise(r=>setImmediate(r));return context.current();})));
 assert.deepEqual(reads,[a,b]);assert.equal(context.current(),undefined);
 const queued=context.run(a,()=>context.capture());
 assert.deepEqual(context.run(b,()=>context.run(queued,()=>context.current())),a);
 assert.equal(context.current(),undefined);
 assert.throws(()=>context.run(a,()=>{throw Error('private');}));assert.equal(context.current(),undefined);
 assert.deepEqual(traceHeaders(a,{authenticated:true,owned:false}),{});
});

test('Pino emits canonical fields and suppresses private unknown content',async()=>{
 const lines=[];const logger=createPinoEmitter(line=>{lines.push(line);});
 logger.emit({...record,err:new Error('SECRET'),payload:'SECRET',headers:{authorization:'SECRET'}});
 await logger.close();
 assert.equal(lines.length,1);assert.deepEqual(JSON.parse(lines[0]),record);
 assert.equal(lines[0].includes('SECRET'),false);assert.equal(logger.counts().failed,0);
});

test('stalled output bounds retained work and shutdown',async()=>{
 const logger=createPinoEmitter(()=>new Promise(()=>{}),{maxRecords:2,maxBytes:8192,flushMs:20});
 assert.equal(logger.emit(record),true);assert.equal(logger.emit(record),true);assert.equal(logger.emit(record),false);
 assert.equal(logger.counts().queued,2);assert.equal(logger.counts().dropped,1);
 const before=performance.now();await logger.close();assert.ok(performance.now()-before<200);
 assert.equal(logger.counts().queued,0);assert.equal(logger.counts().dropped,3);
 assert.equal(logger.emit(record),false);
});

test('throwing and rejecting sinks fail open without secret diagnostics',async()=>{
 for(const sink of [()=>{throw Error('SECRET');},async()=>{throw Error('SECRET');}]){
  const logger=createPinoEmitter(sink);assert.equal(logger.emit(record),true);await logger.close();
  assert.equal(logger.counts().failed,1);assert.equal(JSON.stringify(logger.counts()).includes('SECRET'),false);
 }
});

test('byte bound drops whole records and debug filtering is separate from loss',async()=>{
 const tiny=createPinoEmitter(()=>{}, {maxBytes:1});
 assert.equal(tiny.emit(record),false);assert.equal(tiny.counts().bytes,0);assert.equal(tiny.counts().dropped,1);
 await tiny.close();
 const host=createPinoEmitter(()=>{});
 assert.equal(host.emit({...record,severity_text:'DEBUG'}),false);
 assert.equal(host.counts().dropped,0);
 await host.close();
});

test('untrusted, missing and malformed context never becomes a parent',()=>{
 const header=`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`;
 for(const value of [undefined,null,'',header.toUpperCase(),header.replace('00-','01-'),`00-${'0'.repeat(32)}-${'b'.repeat(16)}-01`,header+'\n'])
  assert.equal(parseTraceparent(value,{authenticated:true,owned:true}),undefined);
 assert.equal(parseTraceparent(header,{authenticated:false,owned:true}),undefined);
 assert.equal(parseTraceparent(header,{authenticated:true,owned:false}),undefined);
 assert.deepEqual(traceHeaders(undefined,{authenticated:true,owned:true}),{});
});
