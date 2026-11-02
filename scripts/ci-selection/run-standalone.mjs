#!/usr/bin/env node
// Fixed owning commands, without file filters or caller-supplied shell fragments.
import {spawnSync,execFileSync} from 'node:child_process';
import {appendFileSync,readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {OWNERS,OWNER_NOTICE_TITLE,ownerHash,readCommandEvidence} from './standalone.mjs';
export function wemoCoverage(text){
 const rows=text.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 const totals=rows.filter(row=>row.file===null),changed=rows.filter(row=>row.file===OWNERS.wemo.compiled);
 if(totals.length!==1||changed.length!==1)throw new Error('missing or ambiguous full-suite/changed-file summary');
 for(const row of rows){
  const c=row.counts;
  if(!row.success||!c||!Number.isSafeInteger(c.tests)||c.tests<=0||c.passed!==c.tests||c.failed!==0||c.cancelled!==0||c.skipped!==0||c.todo!==0)throw new Error('empty, failed or skipped Node test execution');
 }
 const c=totals[0].counts;
 return {file:OWNERS.wemo.compiled,tests:c.tests,passed:c.passed,changedTests:changed[0].counts.tests,failed:c.failed,cancelled:c.cancelled,skipped:c.skipped};
}
export function browserCompleted(result){
 if(result.status!==0||result.error||!String(result.stdout).split(/\r?\n/).includes(OWNERS['microduck-browser'].marker))throw new Error('full MicroDuck journey did not complete');
}
export function runStandalone({env=process.env,run=spawnSync,git=execFileSync}={}){
 const owners=JSON.parse(env.STANDALONE_OWNERS??'[]');
 if(!Array.isArray(owners)||new Set(owners).size!==owners.length||owners.some(id=>!Object.hasOwn(OWNERS,id)))throw new Error('invalid standalone owners');
 if(!owners.length)return [];
 const head=env.STANDALONE_HEAD;
 if(!/^[a-f0-9]{40}$/.test(head??'')||git('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head
   ||git('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim())throw new Error('standalone commands require the exact clean candidate checkout');
 const identity={head,runId:Number(env.GITHUB_RUN_ID),attempt:Number(env.GITHUB_RUN_ATTEMPT)};
 const scripts=JSON.parse(readFileSync('package.json','utf8')).scripts;
 const directory=mkdtempSync(join(tmpdir(),'bunny-standalone-'));
 const results=[];
 const execute=(script,options={})=>{
  const result=run('npm',['run',script],{env,encoding:'utf8',timeout:40*60*1000,maxBuffer:32*1024*1024,...options});
  if(result.stdout)process.stdout.write(result.stdout);
  if(result.stderr)process.stderr.write(result.stderr);
  if(result.status!==0||result.error)throw new Error(`${script} failed or did not complete`);
  return result;
 };
 try{
  for(const owner of owners){
   for(const [script,command] of Object.entries(OWNERS[owner].scripts))if(scripts[script]!==command)throw new Error(`owning command changed: ${script}`);
   let evidence={schema:'standalone-command/1',owner,...identity,commandHash:ownerHash(owner),result:'success'};
   if(owner==='wemo'){
    if(env.NODE_OPTIONS)throw new Error('standalone reporter requires an unmodified Node test environment');
    const destination=join(directory,'summary.jsonl');
    const reporter=pathToFileURL(join(process.cwd(),'scripts/ci-selection/node-summary.mjs')).href;
    execute('test:wemo:built',{env:{...env,NODE_OPTIONS:`--test-reporter=spec --test-reporter=${reporter} --test-reporter-destination=stdout --test-reporter-destination=${destination}`}});
    evidence={...evidence,coverage:wemoCoverage(readFileSync(destination,'utf8'))};
   }else{
    execute('test:runtime-dashboard:smoke');
    browserCompleted(execute('test:microduck:browser'));
    evidence={...evidence,completion:'microduck-full-journey',smoke:'success'};
   }
   if(!readCommandEvidence(JSON.stringify(evidence),{owner,...identity}))throw new Error('invalid command completion');
   results.push(evidence);
   console.log(`::notice title=${OWNER_NOTICE_TITLE}::${JSON.stringify(evidence)}`);
  }
  if(env.GITHUB_OUTPUT)appendFileSync(env.GITHUB_OUTPUT,`owners=${JSON.stringify(owners)}\n`);
  return results;
 }finally{rmSync(directory,{recursive:true,force:true});}
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href){try{runStandalone();}catch(error){console.error(`::error::${String(error.message).replace(/[\r\n%]/g,' ')}`);process.exitCode=1;}}
