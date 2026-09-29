import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateDataset, eligibility, publicProjection, validateProjection, dependents, TOPICS } from './reference.mjs';
import { definitionDigest } from './digest.mjs';

const read = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const policy = { asOf: '2026-09-29T12:01:00Z', maxAgeMs: 300_000 };
const id = 'jimmie-potts/agent-device-hub#900001';
function changed(changes) {
  const value = read('valid');
  for (const [path, content] of Object.entries(changes)) {
    const keys = path.split('.'); const last = keys.pop();
    keys.reduce((object, key) => object[key], value)[last] = content;
  }
  return value;
}

test('rejects unsupported schema versions before accepting records', () => {
  assert.throws(() => validateDataset({schemaVersion: 'guide-records/99.0'}), /schemaVersion/);
});

test('valid records support browsing, discovery, prerequisites and ready claims', () => {
  const value = read('valid');
  validateDataset(value);
  for (const operation of ['browse', 'discover', 'prerequisites', 'ready']) {
    assert.deepEqual(eligibility(value, id, operation, policy), { allowed: true, reasons: [] });
  }
});

for (const fixture of read('cases')) test(fixture.name, () => {
  const value = changed(fixture.set);
  if (fixture.invalid) assert.throws(() => validateDataset(value), new RegExp(fixture.invalid));
  else {
    validateDataset(value);
    const result = eligibility(value, fixture.id ?? id, fixture.operation, policy);
    assert.equal(result.allowed, fixture.allowed);
    if (fixture.reason) assert.ok(result.reasons.some(x => x.code === fixture.reason && x.source.startsWith('https://')));
    assert.equal(eligibility(value, fixture.id ?? id, 'browse').allowed, true);
  }
});

test('freshness is measured at use and cannot be renewed by assembly', () => {
  const value = read('valid');
  value.assembledAt = '2026-09-30T12:00:00Z';
  assert.equal(eligibility(value, id, 'ready', { ...policy, asOf: value.assembledAt }).allowed, false);
});

test('projection excludes raw bodies, execution prompts and unselected source text', () => {
  const value = read('valid');
  value.issues[0].body += '\nPRIVATE_SENTINEL';
  const projection = publicProjection(value);
  assert.ok(!JSON.stringify(projection).includes('PRIVATE_SENTINEL'));
  validateProjection(projection, value);
  projection.issues[0].body = 'PRIVATE_SENTINEL';
  assert.throws(() => validateProjection(projection, value), /projection mismatch/);
});

test('dataset mismatch and altered projected facts fail closed', () => {
  const value = read('valid');
  assert.throws(() => validateDataset(value, 'different'), /dataset mismatch/);
  const projection = publicProjection(value);
  projection.issues[0].fields.title = 'invented';
  assert.throws(() => validateProjection(projection, value), /projection mismatch/);
});

test('partial inventory makes exact counts unknown, never zero', () => {
  const value = read('valid');
  assert.deepEqual(dependents(value, id, policy), { direct: [], transitive: [], reasons: [] });
  value.repositories[0].inventory.complete = false;
  value.repositories[0].inventory.reason = 'Page unavailable';
  const result = dependents(value, id, policy);
  assert.equal(result.direct, null);
  assert.equal(result.transitive, null);
});

test('Guide parser and topic vocabulary agree with canonical fixture fields', () => {
  const value = read('valid');
  const result = spawnSync('python3', ['-c', `
import json, sys
from guide_section import read
from guide_paths import PATHS
from story_sections import _sections
value=json.load(sys.stdin)
for issue in value['issues']:
    parsed=read(issue['body'])
    assert parsed['state']==issue['guide']['state']
    for key in ('topic','note','workaround','highlight','extends'):
        assert parsed.get(key)==issue['guide'][key], (key, parsed)
    lines=issue['body'].split('\\n')
    for section in issue['story'].values():
        spans=_sections(lines, (section['heading'],))
        assert len(spans)==1
        start,end=spans[0]
        assert '\\n'.join(lines[start+1:end]).strip()==section['text']
print(json.dumps(sorted(PATHS)))
`], { cwd: fileURLToPath(new URL('../work/', import.meta.url)), input: JSON.stringify(value), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [...TOPICS].sort());
});

test('open native blockers and cycles withhold readiness while traversal terminates', () => {
  const value = read('valid');
  const second = value.issues[1];
  Object.assign(second, { state: 'OPEN', stateReason: null, closedAt: null, labels: ['status:ready'] });
  value.repositories[0].inventory.pagination.itemCount = 2;
  value.repositories[0].inventory.pagination.totalCount = 2;
  second.blockedBy.ids = [id];
  second.blockedBy.evidence.pagination.itemCount = 1;
  second.blockedBy.evidence.pagination.totalCount = 1;
  const result = eligibility(value, id, 'ready', policy);
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some(x => x.code === 'open-prerequisite'));
  assert.ok(result.reasons.some(x => x.code === 'dependency-cycle'));
  assert.deepEqual(dependents(value, id, policy), { direct: [second.id], transitive: [second.id], reasons: [] });
});

test('public sub-guides retain editorial provenance and omit stale publication selection', () => {
  const value = read('valid');
  const guide = value.subguides[0];
  guide.publication = { fields: ['title','outcome'], revision: guide.revision,
    reviewedAt: value.assembledAt, owner: 'fixture-author', source: guide.source };
  const projection = publicProjection(value);
  assert.equal(projection.subguides[0].revision, guide.revision);
  assert.equal(projection.subguides[0].asOf, guide.asOf);
  guide.publication.revision = 'b'.repeat(40);
  assert.deepEqual(publicProjection(value).subguides, []);
});

test('unknown referenced prerequisite is retained as incomplete evidence', () => {
  const value = read('valid');
  value.issues[0].blockedBy.ids = ['example/external#1'];
  value.issues[0].blockedBy.evidence.complete = false;
  value.issues[0].blockedBy.evidence.reason = 'Target inaccessible';
  const result = eligibility(value, id, 'prerequisites', policy);
  assert.ok(result.reasons.some(x => x.code === 'dependency-target-missing'));
  assert.equal(eligibility(value, id, 'browse').allowed, true);
});

test('future or inconsistent source times cannot qualify facts', () => {
  const value = read('valid');
  value.issues[0].facts.observedAt = '2026-09-28T12:00:00Z';
  assert.throws(() => validateDataset(value), /observation predates issue/);
});

test('approval digest tolerates archive headings but changes with normative text', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'guide-digest-'));
  try {
    const path = join(scratch, 'spec.md');
    const text = '## Purpose\n\nExample.\n\n## ADDED Requirements\n\nMust preserve facts.\n';
    writeFileSync(path, text);
    const original = definitionDigest(path);
    writeFileSync(path, '# guide-records Specification\n\n' + text.replace('ADDED Requirements', 'Requirements'));
    assert.equal(definitionDigest(path), original);
    writeFileSync(path, text.replace('preserve', 'invent'));
    assert.notEqual(definitionDigest(path), original);
  } finally { rmSync(scratch, { recursive: true }); }
});
