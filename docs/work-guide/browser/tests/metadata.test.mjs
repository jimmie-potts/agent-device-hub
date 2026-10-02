import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseMetadata} from '../collector.mjs';
import {datasetIdentity,recentlyDone,eligibility,publicationGate} from '../runtime/records.mjs';
const fixture=async()=>JSON.parse(await readFile(new URL('../../contracts/epic-guide/fixtures/dataset.json',import.meta.url),'utf8'));
test('fence-aware legacy story parsing retains gaps and conflicts',async()=> {
 const issue=(await fixture()).issues[0];issue.body='```text\n## Outcome and real setup\nFake\n```\n## Outcome and scope\nLegacy outcome\n## Acceptance criteria\nReal acceptance\n## Smallest useful implementation\nOne\n## Smallest useful implementation\nTwo';
 const [parsed]=await parseMetadata([issue]);assert.equal(parsed.story.outcome.text,'Legacy outcome');assert.equal(parsed.story.acceptance.text,'Real acceptance');assert.equal(parsed.story.implementation.state,'unsupported');assert.deepEqual(parsed.planning,[]);
});
test('malformed and insufficient recommendations retain generic brief inputs',async()=> {
 const issue=(await fixture()).issues[0];issue.body='## Execution recommendation\nWrong optional data';
 const [parsed]=await parseMetadata([issue]);assert.equal(parsed.planning[0].state,'unsupported');
});
test('UTC seven-day boundary excludes reopened and not-planned closures',async()=> {
 const d=await fixture(),issue=structuredClone(d.issues[0]);issue.state='CLOSED';issue.stateReason='completed';issue.closedAt=new Date(Date.parse(d.asOf)-7*86400000).toISOString();assert.equal(recentlyDone(d,issue),true);issue.closedAt=new Date(Date.parse(issue.closedAt)-1).toISOString();assert.equal(recentlyDone(d,issue),false);issue.closedAt=d.asOf;issue.stateReason='not_planned';assert.equal(recentlyDone(d,issue),false);issue.state='OPEN';issue.stateReason='reopened';assert.equal(recentlyDone(d,issue),false);
});
test('cancelled prerequisite withholds ready even with no open blocker',async()=> {
 const d=await fixture(),policy={asOf:d.asOf,maxAgeMs:86400000};
 const ready=d.issues.find(x=>x.labels.includes('status:ready'));const target=d.issues.find(x=>x.id!==ready.id&&x.state==='CLOSED');
 target.stateReason='not_planned';ready.blockedBy.ids=[target.id];ready.blockedBy.evidence.pagination.itemCount=ready.blockedBy.evidence.pagination.totalCount=1;d.datasetId=datasetIdentity(d);
 const gate=eligibility(d,ready.id,'ready',policy);assert.equal(gate.allowed,false);assert.ok(gate.reasons.some(x=>x.code==='prerequisite-not-completed'));
});
test('partial history and optional section failures permit publication with gaps',async()=> {
 const d=await fixture();d.repositories[0].recentClosures.complete=false;d.repositories[0].recentClosures.reason='Partial page';d.issues[0].story.protections={state:'unsupported',heading:null,text:null,source:d.issues[0].url,parser:'story-sections/1',reason:'duplicate'};d.datasetId=datasetIdentity(d);const gate=publicationGate(d);assert.equal(gate.publishable,true);assert.ok(gate.gaps.some(x=>x.code==='recent-closures-incomplete'));
});
