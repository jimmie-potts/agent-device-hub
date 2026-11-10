import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readCommandEvidence,ownerHash} from '../scripts/ci-selection/standalone.mjs';
const head='a'.repeat(40),identity={head,runId:41,attempt:1};
const wemo={schema:'standalone-command/1',owner:'wemo',...identity,commandHash:ownerHash('wemo'),result:'success',
 coverage:{file:'modules/wemo/dist/tests/module.test.js',tests:29,passed:29,changedTests:6,failed:0,cancelled:0,skipped:0}};
const read=(value,owner='wemo')=>readCommandEvidence(JSON.stringify(value),{owner,...identity});
test('complete owning execution evidence is positive and exact-head',()=>{assert.deepEqual(read(wemo),wemo);});
test('missing, failed, skipped, empty and wrong revision execution refuse',()=>{
 for(const extra of [{head:'b'.repeat(40)},{runId:42},{attempt:2},{result:'failure'},{result:'skipped'},
 {commandHash:'0'.repeat(64)},{coverage:undefined},{coverage:{...wemo.coverage,tests:0,passed:0,changedTests:0}},
 {coverage:{...wemo.coverage,changedTests:0}},{coverage:{...wemo.coverage,skipped:1}}])assert.equal(read({...wemo,...extra}),null);
 assert.equal(readCommandEvidence('',{owner:'wemo',...identity}),null);
});
test('native completion metadata is closed and bounded',()=>{
 assert.equal(read({...wemo,unexpected:'unreviewed metadata'}),null);
 assert.equal(read({...wemo,coverage:{...wemo.coverage,unexpected:true}}),null);
 assert.equal(readCommandEvidence(' '.repeat(5000)+JSON.stringify(wemo),{owner:'wemo',...identity}),null);
});
test('selected MicroDuck requires full-journey and smoke completion rather than a test count',()=>{
 const browser={schema:'standalone-command/1',owner:'microduck-browser',...identity,commandHash:ownerHash('microduck-browser'),result:'success',completion:'microduck-full-journey',smoke:'success'};
 assert.deepEqual(read(browser,'microduck-browser'),browser);
 for(const extra of [{completion:undefined},{completion:'not-completed'},{smoke:'skipped'},{result:'failure'},{head:'b'.repeat(40)}])assert.equal(read({...browser,...extra},'microduck-browser'),null);
});

import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {wemoCoverage,browserCompleted,runStandalone} from '../scripts/ci-selection/run-standalone.mjs';
import {gateVerdict,selectChecks} from '../scripts/ci-selection/selection.mjs';
const counts={tests:2,passed:2,failed:0,cancelled:0,skipped:0,todo:0};
const summaries=rows=>rows.map(row=>JSON.stringify(row)).join('\n');
test('Node coverage requires both overall and actual changed compiled entry summaries',()=>{
 const rows=[{file:null,counts,success:true},{file:'modules/wemo/dist/tests/module.test.js',counts,success:true}];
 assert.equal(wemoCoverage(summaries(rows)).changedTests,2);
 for(const bad of [[],[rows[0]],[rows[1]],[...rows,rows[1]],rows.map(row=>({...row,success:false})),
  rows.map(row=>({...row,counts:{...counts,tests:0}})),rows.map(row=>({...row,counts:{...counts,skipped:1}})),
  rows.map(row=>({...row,counts:{...counts,todo:1}}))])assert.throws(()=>wemoCoverage(summaries(bad)));
});
test('MicroDuck requires successful complete marker, never partial stdout',()=>{
 const marker='MicroDuck browser passed: finite gestures, local Stop, exact held recovery, status-only MCP, passive reload and keyboard/narrow.';
 browserCompleted({status:0,stdout:marker+'\n'});
 for(const result of [{status:1,stdout:marker},{status:0,stdout:'smoke passed'},{status:0,stdout:marker,error:new Error('terminated')}])assert.throws(()=>browserCompleted(result));
});
test('final gate refuses missing completion even when the standalone Core job is green',()=>{
 const selection=selectChecks({event:'pull_request',paths:['modules/wemo/tests/module.test.ts'],complete:true,
  changes:[{filename:'modules/wemo/tests/module.test.ts',status:'modified',mode:'100644',beforeMode:'100644'}]});
 const outputs={mode:selection.mode,groups:'[]',owners:'["wemo"]',...Object.fromEntries(Object.entries(selection.jobs).map(([k,v])=>[k,String(v)]))};
 const needs={select:{result:'success',outputs},core:{result:'success',outputs:{}},...Object.fromEntries(Object.keys(selection.jobs).map(k=>[k,{result:'skipped'}]))};
 assert.equal(gateVerdict(needs).ok,false);
 needs.core.outputs.owners='["wemo"]';assert.equal(gateVerdict(needs).ok,true);
 needs.core.outputs.owners='["microduck-browser"]';assert.equal(gateVerdict(needs).ok,false);
});
test('unchanged complete npm glob with parallel Node reporters executes changed entry and sibling',t=>{
 const directory=mkdtempSync(join(tmpdir(),'standalone-reporter-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const path of ['modules/wemo/dist/tests','scripts/ci-selection'])mkdirSync(join(directory,path),{recursive:true});
 copyFileSync(new URL('../scripts/ci-selection/node-summary.mjs',import.meta.url),join(directory,'scripts/ci-selection/node-summary.mjs'));
 writeFileSync(join(directory,'package.json'),JSON.stringify({type:'module',scripts:{'test:wemo:built':'node --test modules/wemo/dist/tests/*.test.js'}}));
 for(const name of ['module','sibling'])writeFileSync(join(directory,`modules/wemo/dist/tests/${name}.test.js`),`import {test} from 'node:test';test('${name}',()=>{});`);
 const destination=join(directory,'summary.jsonl');
 const options=`--test-reporter=spec --test-reporter=${new URL('file://'+join(directory,'scripts/ci-selection/node-summary.mjs')).href} --test-reporter-destination=stdout --test-reporter-destination=${destination}`;
 const {NODE_TEST_CONTEXT:_context,...childEnv}=process.env;
 const result=spawnSync('npm',['run','test:wemo:built'],{cwd:directory,env:{...childEnv,NODE_OPTIONS:options},encoding:'utf8',timeout:30000});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/sibling/);assert.match(result.stdout,/module/);
 const coverage=wemoCoverage(readFileSync(destination,'utf8'));assert.equal(coverage.tests,2);assert.equal(coverage.changedTests,1);
});
test('runner refuses wrong head, dirty source and arbitrary owners before commands',()=>{
 for(const env of [{STANDALONE_OWNERS:'["unknown"]'}, {STANDALONE_OWNERS:'["wemo"]',STANDALONE_HEAD:'b'.repeat(40)}]){
  assert.throws(()=>runStandalone({env,git:()=>head,run:()=>assert.fail('must not execute')}));
 }
 assert.throws(()=>runStandalone({env:{STANDALONE_OWNERS:'["wemo"]',STANDALONE_HEAD:head},git:(_cmd,args)=>args[0]==='rev-parse'?head:' M changed.ts',run:()=>assert.fail('must not execute')}));
});
