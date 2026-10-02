import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as prod from '../runtime/records.mjs';
import * as ref from '../../contracts/epic-guide/records.mjs';
import * as views from '../runtime/views.mjs';
import * as refViews from '../../contracts/epic-guide/views.mjs';
const json=name=>JSON.parse(readFileSync(new URL('../../contracts/epic-guide/'+name,import.meta.url)));
const step=(obj,key)=>key.startsWith('@')?obj.find(x=>x.id===key.slice(1)||x.id?.endsWith('#'+key.slice(1))):obj[key];
const set=(obj,path,value)=>{const keys=path.split('.'),last=keys.pop();keys.reduce(step,obj)[last]=value;};
const drop=(obj,path)=>{const keys=path.split('.'),last=keys.pop();delete keys.reduce(step,obj)[last];};
const records=fixture=> {
 const d=json('fixtures/dataset.json');for(const [path,value] of Object.entries(fixture.set??{}))set(d,path,value);
 for(const path of fixture.drop??[])drop(d,path);
 for(const [path,value] of Object.entries(fixture.setAll??{}))for(const issue of d.issues)set(issue,path,value);
 if(fixture.recompute!==false)for(let pass=0;pass<2;pass++)for(const issue of d.issues){issue.placement=ref.placementOf(d,issue);issue.project=ref.projectOf(d,issue);}
 d.datasetId=ref.datasetIdentity(d);return d;
};
const result=fn=>{try{return {value:fn()};}catch(error){return {error:error.message};}};
const policy={asOf:'2026-09-30T12:01:00Z',maxAgeMs:300000};
for(const fixture of json('fixtures/record-cases.json'))test('record conformance: '+fixture.name,()=> {
 const d=records(fixture);assert.deepEqual(result(()=>prod.validateDataset(d)),result(()=>ref.validateDataset(d)));
 assert.deepEqual(prod.publicationGate(d),ref.publicationGate(d));
 if(result(()=>ref.validateDataset(d)).error)return;
 for(const issue of d.issues){assert.deepEqual(prod.eligibility(d,issue.id,'ready',policy),ref.eligibility(d,issue.id,'ready',policy));assert.deepEqual(prod.prerequisiteState(d,issue),ref.prerequisiteState(d,issue));}
});
for(const fixture of json('fixtures/view-cases.json'))test('view conformance: '+fixture.name,()=> {
 const d=records({set:fixture.records}),v=json('fixtures/'+fixture.base+'.json');if(!fixture.keepDatasetId)v.datasetId=d.datasetId;
 v.components=v.components.filter(x=>!(fixture.remove??[]).includes(x.id));v.components.push(...(fixture.add??[]));
 for(const [path,value] of Object.entries(fixture.set??{}))set(v,path,value);
 for(const path of fixture.drop??[])drop(v,path);
 const options={dataset:d,policy:{...policy,...fixture.policy}};
 assert.deepEqual(result(()=>views.validateView(v,options)),result(()=>refViews.validateView(v,options)));
 assert.deepEqual(result(()=>views.resolveView(v,options)),result(()=>refViews.resolveView(v,options)));
});
