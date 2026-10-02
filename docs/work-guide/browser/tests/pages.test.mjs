import { test } from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { makeView, pageBundle } from '../pages.mjs';
import * as runtime from '../runtime/records.mjs';
import * as reference from '../../contracts/epic-guide/records.mjs';
import {resolveView} from '../runtime/views.mjs';
import {resolveView as referenceResolve} from '../../contracts/epic-guide/views.mjs';
const fixture=()=>JSON.parse(readFileSync(new URL('../../contracts/epic-guide/fixtures/dataset.json',import.meta.url)));
test('production record algorithms conform to approved reference fixtures',()=> {
 const d=fixture(); assert.deepEqual(runtime.validateDataset(d),reference.validateDataset(d));
 assert.equal(runtime.datasetIdentity(d),reference.datasetIdentity(d));
 assert.deepEqual(runtime.publicationGate(d),reference.publicationGate(d));
 for(const issue of d.issues) {assert.deepEqual(runtime.placementOf(d,issue),reference.placementOf(d,issue));assert.deepEqual(runtime.prerequisiteState(d,issue),reference.prerequisiteState(d,issue));}
});
test('every generated page meets approved coverage and resolves identically',()=> {
 const d=fixture(),bundle=pageBundle(d),policy=bundle.policy;
 for(const {view,resolved} of Object.values(bundle.pages)) if(view) assert.deepEqual(resolved,referenceResolve(view,{dataset:d,policy}));
});
test('large epic has complete canonical coverage before bounded DOM rendering',()=> {
 const d=fixture(),template=d.issues.find(x=>x.state==='OPEN'&&x.placement.state==='epic'&&!x.labels.includes('epic'));
 for(let i=0;i<240;i++){const x=structuredClone(template);x.number=910000+i;x.id=x.repository+'#'+x.number;x.nodeId='large-'+i;x.url=`https://github.com/${x.repository}/issues/${x.number}`;x.children.ids=[];x.children.evidence.pagination.itemCount=x.children.evidence.pagination.totalCount=0;d.issues.push(x);}
 for(const repo of d.repositories)repo.inventory.pagination.itemCount=repo.inventory.pagination.totalCount=d.issues.filter(x=>x.repository===repo.name&&x.state==='OPEN').length;
 d.datasetId=runtime.datasetIdentity(d);
 const view=makeView(d,'epic',template.placement.epic);const resolved=resolveView(view,{dataset:d,policy:{asOf:d.asOf,maxAgeMs:86400000}});
 assert.ok(resolved.nodes.filter(x=>x.primary).length>=240);
});
