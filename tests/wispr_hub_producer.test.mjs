import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {aggregate,contribution} from '../apps/wispr-collector/dist/numeric.js';
const row=(id,overrides={})=>({id,timestamp:'2026-03-08 06:30:00 +00:00',status:'formatted',numWords:60,duration:60,speechDuration:30,numWordsCorrected:null,numDictionaryReplacements:null,appName:'Slack',invalid:[],...overrides});
export const producer=()=>aggregate([
 row('a'),row('b',{timestamp:'2026-03-08 07:30:00 +00:00',numWords:40,duration:20,speechDuration:10,numWordsCorrected:0,numDictionaryReplacements:2}),
 row('c',{numWords:20,duration:0,speechDuration:null,appName:'ChatGPT'}),row('d',{numWords:10,duration:-1,speechDuration:-1,appName:'C:\\private\\CANARY.exe'}),
 row('e',{status:'raw',numWords:500}),row('f',{numWords:0}),row('g',{timestamp:'2026-02-31T12:00:00Z'})
].map(r=>contribution(r)),{namespace:'11111111-1111-4111-8111-111111111111',generation:'22222222-2222-4222-8222-222222222222',revision:1,now:'2026-03-09T00:00:00.000Z',timezone:'America/New_York'});
test('the bundled Hub numeric fixture is exact current collector output',async()=>{
 const fixture=JSON.parse(await readFile(new URL('../apps/hub/fixtures/wispr-numeric.json',import.meta.url),'utf8'));assert.deepEqual(fixture,producer());assert.equal(JSON.stringify(fixture).includes('CANARY'),false);
});
