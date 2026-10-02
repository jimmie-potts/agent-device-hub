import test from 'node:test';
import assert from 'node:assert/strict';
import * as language from '../dist/language.js';
import {presetWindows} from '@jimmie-potts/wispr-contracts';
const now='2026-10-02T12:00:00.000Z',presets=presetWindows(now,'UTC');
const entry=(text,app='slack',time='2026-10-02T10:00:00.000Z')=>({sourceTime:Date.parse(time),app,features:language.analyzeStages({raw:text,formatted:text,observed:text,language:'en',observation:'complete'})});
const table=(result,preset='all',app='all',category='all',corpus='raw')=>result.tables.find(t=>t.preset===preset&&t.app===app&&t.category===category&&t.corpus===corpus);

test('exact subgroup support distinguishes occurrences from distinct dictations',()=>{
 const result=language.aggregateLanguage([entry('hello hello'),entry('hello hello'),entry('hello','outlook')],presets,'UTC');
 assert.deepEqual(table(result).words,[{text:'hello',occurrences:5,dictations:3}]);
 assert.deepEqual(table(result,'all','slack').words,[]);
 assert.deepEqual(table(result,'all','all','messaging').words,[]);
 assert.equal(table(result).coverage.eligible,3);
 assert.equal(table(result,'all','all','all','formatted').comparedDictations,3);
 assert.equal(table(result,'all','all','all','formatted').changedDictations,0);
 assert.equal(table(result,'all','slack','messaging').coverage.eligible,2);
 assert.equal(result.tables.length,336);
});

test('preset ranking aggregates every contribution before top 100 and reports omitted qualified terms',()=>{
 const words=Array.from({length:101},(_,i)=>'term'+String.fromCharCode(97+Math.floor(i/26),97+i%26));
 const rows=[];
 for(let day=0;day<3;day++)for(let repeat=0;repeat<3;repeat++){
  rows.push(entry(words.map(w=>w+String.fromCharCode(97+day)).join(' ')+' shared','slack',`2026-09-${28+day}T12:00:00.000Z`));
 }
 const result=language.aggregateLanguage(rows,presets,'UTC');
 assert.equal(table(result).words[0].text,'shared');assert.equal(table(result).words[0].dictations,9);
 assert.equal(table(result).words.length,100);assert.equal(table(result).omitted.words,204);
 assert.deepEqual(table(result,'today').words,[]);
 assert.deepEqual(table(result,'7d').words,table(result).words);
 assert.ok(!JSON.stringify(result).includes('sourceTime'));
});
