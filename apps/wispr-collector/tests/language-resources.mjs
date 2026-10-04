import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {NumericStore} from '../dist/store.js';
import {diverseText} from './diverse-language.mjs';

/** Synthetic retained-store qualification, not an installed-source benchmark. */
export function qualifyLanguageResources(root){
 mkdirSync(root,{recursive:true});const directory=mkdtempSync(join(root,'language-resources-'));
 const options={directory,namespace:'11111111-1111-4111-8111-111111111111',sourceIdentity:'synthetic-language',timezone:'UTC'};
 const now='2026-10-02T12:00:00.000Z';
 const rows=Array.from({length:42},(_,i)=>{
  const text=diverseText(900,Math.floor(i/3)*900);
  return {id:String(i),timestamp:'2026-10-02T10:00:00Z',status:'formatted',numWords:900,duration:5,speechDuration:3,numWordsCorrected:null,numDictionaryReplacements:null,appName:'Slack',invalid:[],language:{raw:text,formatted:text,observed:null,language:'en',observation:'unknown'}};
 });
 let store;const start=performance.now();
 try{
  store=new NumericStore(options);
  const first=store.ingest(rows,now,{language:{enabled:true}});store.markPublished(first.revision);
  const t=first.language.tables.find(t=>t.preset==='all'&&t.app==='all'&&t.category==='all'&&t.corpus==='raw');
  assert.equal(t.words.length,100);assert.equal(t.omitted.words,12500);assert.equal(t.omitted.phrases,50160);
  const repeat=store.ingest(rows,now,{language:{enabled:true}});store.markPublished(repeat.revision);assert.deepEqual(repeat.language,first.language);
  store.close();store=new NumericStore(options);
  const restored=store.rebuildZone('America/New_York',now);assert.deepEqual(restored.language,first.language);
  const elapsedMs=Math.round(performance.now()-start),peakRssKiB=process.resourceUsage().maxRSS;
  assert.ok(elapsedMs<60_000);assert.ok(peakRssKiB*1024<512*1024*1024);
  return {result:'passed',scope:'synthetic retained-store diverse language import/repeat/restart/zone rebuild',node:process.versions.node,platform:process.platform,elapsedMs,peakRssKiB,tables:first.language.tables.length,exactRepeat:true,exactZoneRebuild:true};
 }finally{store?.close();rmSync(directory,{recursive:true,force:true});}
}
