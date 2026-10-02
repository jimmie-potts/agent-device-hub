import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collect } from '../collector.mjs';

const repos = ['jimmie-potts/agent-device-hub', 'jimmie-potts/codex-nanoleaf', 'jimmie-potts/divoom-app-upgrade'];
const raw = (repo, number = 1) => ({ number, node_id: repo + number, html_url: `https://github.com/${repo}/issues/${number}`, title: 'Work', body: null, labels: [], state: 'open', state_reason: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', closed_at: null, sub_issues_summary: {total:0} });
function api({ truncated = false, mutated = false, recentFailure = false } = {}) {
  let rereads = 0;
  return async path => {
    const repo = path.match(/^repos\/([^/]+\/[^/]+)/)?.[1];
    if (path.endsWith('?state=open&per_page=100&page=1')) return { data: [raw(repo)], next: false };
    if (path.includes('state=closed')) { if (recentFailure) throw Error('denied'); return {data:[], next:false}; }
    if (path.endsWith('/sub_issues?per_page=100&page=1') || path.endsWith('/blocked_by?per_page=100&page=1')) return {data:[], next:false};
    if (path.endsWith('/parent')) return {data:null, next:false};
    if (/issues\/1$/.test(path)) { rereads++; return { data: { ...raw(repo), title: mutated ? 'Changed' : 'Work' }, next:false, observedAt:'2026-10-02T00:00:00.000Z' }; }
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
