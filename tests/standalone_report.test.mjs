import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,targets} from '../scripts/performance/standalone-report.mjs';
const complete=()=>({profiles:[1,10].map(tasks=>({tasks,samples:Array.from({length:200},()=>({hookMs:40,pixooMs:60,nanoleafMs:70}))})),scenarios:Object.fromEntries(['confinement','startup','burst','dashboard','control','stalledConsumer','offlineConsumer','hostOutage','restart','exclusiveOwner','noReplay'].map(k=>[k,true])),failures:[],allHookMs:Array(400).fill(40),peakHubRssMiB:100});
test('only complete observations within targets can qualify',()=>assert.equal(evaluate(complete()).qualified,true));
test('missing consumer, missing scenario and incomplete samples fail',()=>{for(const mutate of [r=>delete r.profiles[0].samples[2].nanoleafMs,r=>delete r.scenarios.restart,r=>r.allHookMs.pop(),r=>r.profiles[1].samples.pop()]){const r=complete();mutate(r);assert.equal(evaluate(r).qualified,false);}});
test('hard deadline, practical p95, resource and recorded failures cannot pass',()=>{for(const mutate of [r=>r.allHookMs.push(3001),r=>r.peakHubRssMiB=257,r=>r.failures.push('failed-attempt'),r=>r.profiles[0].samples.forEach(s=>s.hookMs=targets.hookP95Ms[1]+1)]){const r=complete();mutate(r);assert.equal(evaluate(r).qualified,false);}});

test('large reports reach a pipe intact before the worker exits', async()=>{
 const {spawn}=await import('node:child_process');
 const script="import {writeReport} from './scripts/performance/standalone-report.mjs';await writeReport({payload:'x'.repeat(300000)});process.exit(0);";
 const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
 const code=await new Promise(resolve=>child.once('close',resolve));assert.equal(code,0,err);assert.equal(JSON.parse(out).result.payload.length,300000);
});
