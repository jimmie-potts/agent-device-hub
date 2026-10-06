import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collect } from '../collector.mjs';

const repos = ['jimmie-potts/agent-device-hub', 'jimmie-potts/codex-nanoleaf', 'jimmie-potts/divoom-app-upgrade'];
const raw = (repo, number = 1) => ({ number, node_id: repo + number, html_url: `https://github.com/${repo}/issues/${number}`, title: 'Work', body: null, labels: [], state: 'open', state_reason: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', closed_at: null, sub_issues_summary: {total:0} });
function api({ truncated = false, mutated = false, recentFailure = false } = {}) {
  return async path => {
    const repo = path.match(/^repos\/([^/]+\/[^/]+)/)?.[1];
    if (path.endsWith('?state=open&per_page=100&page=1')) return { data: [raw(repo)], next: false };
    if (path.includes('state=closed')) { if (recentFailure) throw Error('denied'); return {data:[], next:false}; }
    if (path.endsWith('/sub_issues?per_page=100&page=1') || path.endsWith('/blocked_by?per_page=100&page=1')) return {data:[], next:false};
    if (path.endsWith('/parent')) return {data:null, next:false};
    if (/issues\/1$/.test(path)) { return { data: { ...raw(repo), title: mutated ? 'Changed' : 'Work' }, next:false, observedAt:'2026-10-02T00:00:00.000Z' }; }
    if (path.startsWith('inventory:')) return {data: truncated ? [] : [1], next:false};
    throw Error(path);
  };
}

test('every open issue appears exactly once with optional metadata absent', async () => {
  const result = await collect({ request: api() });
  assert.equal(result.issues.length, 3);
  assert.ok(result.issues.every(x => x.facts.observedAt==='2026-10-02T00:00:00.000Z'),'preserve original issue-read receipts');
  assert.deepEqual(result.repositories.map(x => x.name), repos);
  assert.ok(result.issues.every(x => x.project.member === null));
});
test('truncated required inventory fails independent reconciliation', async () => {
  await assert.rejects(collect({request:api({truncated:true})}), /inventory/);
});
test('source mutation rejects the whole collection attempt', async () => {
  await assert.rejects(collect({request:api({mutated:true})}), /changed/);
});
test('partial recent history permits a candidate with explicit gaps', async () => {
  const result = await collect({request:api({recentFailure:true})});
  assert.equal(result.issues.length,3);
  assert.ok(result.repositories.every(x => !x.recentClosures.complete));
});

test('unavailable outside-Guide facts remain unresolved while primary reads stay required', async()=> {
  const base=api();
  const request=async path=> {
    if(path==='repos/'+repos[0]+'/issues/1/parent')return {data:{...raw('example/public-reference',7),_stub:true},next:false};
    if(path==='repos/example/public-reference/issues/7')throw Error('HTTP 404 external issue unavailable');
    return base(path);
  };
  request.checkPublic=async()=>{};
  const result=await collect({request});
  assert.equal(result.issues.length,3);assert.equal(result.issues[0].placement.state,'unresolved');
  assert.equal(result.issues[0].parent.evidence.complete,false);
  assert.deepEqual(result.issues[0].parent.ids,['example/public-reference#7']);
  request.prime=async raws=>{if(raws.some(x=>x.html_url.includes('example/public-reference')))throw Error('GraphQL missing external node');};
  assert.equal((await collect({request})).issues.length,3);
  await assert.rejects(collect({request:async path=>{if(path==='repos/'+repos[0]+'/issues/1/parent')throw Error('required parent denied');return base(path);}}),/required parent denied/);
  await assert.rejects(collect({request:async path=>{if(path==='repos/'+repos[0]+'/issues/1')throw Error('HTTP 404 primary unavailable');return base(path);}}),/primary unavailable/);
});

test('external priming failure falls back to required native reads, including consistency rereads', async()=> {
  for(const failOn of [1,2]) {
    const base=api();let parentReads=0;
    const request=async path=> {
      if(path==='repos/'+repos[0]+'/issues/1/parent')return {data:raw('example/public-reference',7),next:false};
      if(path==='repos/example/public-reference/issues/7')return {data:raw('example/public-reference',7),next:false};
      if(path==='repos/example/public-reference/issues/7/parent') {
        if(++parentReads===failOn)throw Error('required external parent read failed');
        return {data:null,next:false};
      }
      return base(path);
    };
    request.checkPublic=async()=>{};
    request.prime=async raws=>{if(raws.some(x=>x.html_url.includes('example/public-reference'))&&parentReads===failOn-1)throw Error('required native graph read failed');};
    await assert.rejects(collect({request}),/required external parent read failed/);
  }
});
