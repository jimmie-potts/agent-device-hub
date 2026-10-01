import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateDataset, eligibility, publicProjection, validateProjection, dependents, datasetIdentity, EXCERPT_CHARACTERS, TOPICS } from './reference.mjs';
import { definitionDigest } from './digest.mjs';

const read = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const policy = { asOf: '2026-09-29T12:01:00Z', maxAgeMs: 300_000 };
const id = 'jimmie-potts/agent-device-hub#900001';
function identified(value) {
  value.datasetId = datasetIdentity(value);
  return value;
}
function changed(changes) {
  const value = read('valid');
  for (const [path, content] of Object.entries(changes)) {
    const keys = path.split('.'); const last = keys.pop();
    keys.reduce((object, key) => object[key], value)[last] = content;
  }
  return identified(value);
}

test('rejects unsupported schema versions before accepting records', () => {
  assert.throws(() => validateDataset({schemaVersion: 'guide-records/99.0'}), /schemaVersion/);
});

test('valid records support browsing, discovery, prerequisites and ready claims', () => {
  const value = read('valid');
  validateDataset(value);
  for (const operation of ['browse', 'discover', 'prerequisites', 'ready']) {
    assert.deepEqual(eligibility(identified(value), id, operation, policy), { allowed: true, reasons: [] });
  }
});

for (const fixture of read('cases')) test(fixture.name, () => {
  const value = changed(fixture.set);
  if (fixture.invalid) assert.throws(() => validateDataset(value), new RegExp(fixture.invalid));
  else {
    validateDataset(value);
    const result = eligibility(identified(value), fixture.id ?? id, fixture.operation, policy);
    assert.equal(result.allowed, fixture.allowed);
    if (fixture.reason) assert.ok(result.reasons.some(x => x.code === fixture.reason && x.source.startsWith('https://')));
    assert.equal(eligibility(identified(value), fixture.id ?? id, 'browse').allowed, true);
  }
});

test('freshness expires at use independently of dataset identity', () => {
  const value = read('valid');
  assert.equal(eligibility(identified(value), id, 'ready', { ...policy, asOf: '2026-09-30T12:00:00Z' }).allowed, false);
});

test('projection excludes raw bodies, execution prompts and unselected source text', () => {
  const value = read('valid');
  value.issues[0].body += '\nPRIVATE_SENTINEL';
  const projection = publicProjection(identified(value));
  assert.ok(!JSON.stringify(projection).includes('PRIVATE_SENTINEL'));
  validateProjection(projection, value);
  projection.issues[0].body = 'PRIVATE_SENTINEL';
  assert.throws(() => validateProjection(projection, value), /projection mismatch/);
});

test('dataset mismatch and altered projected facts fail closed', () => {
  const value = read('valid');
  assert.throws(() => validateDataset(value, 'different'), /dataset mismatch/);
  const projection = publicProjection(identified(value));
  projection.issues[0].fields.title = 'invented';
  assert.throws(() => validateProjection(projection, value), /projection mismatch/);
});

test('partial inventory makes exact counts unknown, never zero', () => {
  const value = read('valid');
  assert.deepEqual(dependents(identified(value), id, policy), { direct: [], transitive: [], reasons: [] });
  value.repositories[0].inventory.complete = false;
  value.repositories[0].inventory.reason = 'Page unavailable';
  const result = dependents(identified(value), id, policy);
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

test('new-story openings preserve parsed sections and existing stories remain valid without one', () => {
  const value = read('valid');
  const baseline = eligibility(identified(value), id, 'ready', policy);
  const samples = ['feature', 'investigation'].map(name => readFileSync(
    new URL(`../../../tests/fixtures/story-openings/${name}.md`, import.meta.url), 'utf8'));
  const opening = samples[0].split('## Outcome and real setup')[0];
  const original = value.issues[0].body;
  const bodies = [original, opening + original, ...samples];
  const result = spawnSync('python3', ['-B', '-c', `
import json, sys
from guide_section import read
from story_sections import _sections
names = ('Outcome and real setup', 'Smallest useful implementation',
         'Behavior and protections to preserve',
         'Observable acceptance and planned evidence', 'Meaningful deferrals')
parsed = []
for body in json.load(sys.stdin):
    lines = body.split('\\n')
    sections = {}
    previous = -1
    for name in names:
        spans = _sections(lines, (name,))
        assert len(spans) == 1, (name, spans)
        start, end = spans[0]
        assert start > previous
        previous = start
        sections[name] = '\\n'.join(lines[start+1:end]).strip()
        assert sections[name]
    guide = read(body)
    assert guide['state'] == 'assigned', guide
    assert _sections(lines, ('Guide',))[0][0] > previous
    parsed.append(dict(sections=sections, guide=guide))
print(json.dumps(parsed))
`], { cwd: fileURLToPath(new URL('../work/', import.meta.url)), input: JSON.stringify(bodies), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(parsed[1], parsed[0], 'opening does not change any detailed section or Guide field');
  for (let index = 0; index < samples.length; index++) {
    for (const section of samples[index].split(/^## .+$/m).slice(2, 7)) {
      assert.ok(Object.values(parsed[index + 2].sections).includes(section.trim()));
    }
    assert.equal(parsed[index + 2].guide.topic, 'desktop-controls');
  }
  validateDataset(value); // The legacy body has no opening and still validates.
  value.issues[0].body = opening + original;
  validateDataset(identified(value));
  assert.deepEqual(eligibility(value, id, 'ready', policy), baseline,
    'summary prose neither adds a wire field nor changes readiness');
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
  const result = eligibility(identified(value), id, 'ready', policy);
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some(x => x.code === 'open-prerequisite'));
  assert.ok(result.reasons.some(x => x.code === 'dependency-cycle'));
  assert.deepEqual(dependents(identified(value), id, policy), { direct: [second.id], transitive: [second.id], reasons: [] });
});

test('public sub-guides use policy selections while editorial provenance stays local', () => {
  const value = read('valid');
  const guide = value.subguides[0];
  guide.publicFields = ['title', 'outcome'];
  const projection = publicProjection(identified(value));
  assert.equal(projection.subguides[0].fields.title, guide.title);
  assert.ok(!('revision' in projection.subguides[0]));
  guide.publicFields = [];
  assert.deepEqual(publicProjection(identified(value)).subguides, []);
});

test('unknown referenced prerequisite is retained as incomplete evidence', () => {
  const value = read('valid');
  value.issues[0].blockedBy.ids = ['example/external#1'];
  value.issues[0].blockedBy.evidence.complete = false;
  value.issues[0].blockedBy.evidence.reason = 'Target inaccessible';
  const result = eligibility(identified(value), id, 'prerequisites', policy);
  assert.ok(result.reasons.some(x => x.code === 'dependency-target-missing'));
  assert.equal(eligibility(identified(value), id, 'browse').allowed, true);
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

test('minimal records require neither a producer commit nor assembly time', () => {
  const value = read('valid');
  assert.ok(!('producerRevision' in value));
  assert.ok(!('assembledAt' in value));
  validateDataset(value);
});


test('routine refresh and producer diagnostics keep identity but content changes invalidate it', () => {
  const value = read('valid');
  const original = value.datasetId;
  value.producerRevision = 'b'.repeat(40);
  for (const record of value.issues) {
    record.facts.observedAt = '2026-09-29T12:01:00Z';
    for (const edge of [record.parent, record.children, record.blockedBy]) {
      edge.evidence.observedAt = '2026-09-29T12:01:00Z';
      edge.evidence.pagination.pages += 1;
    }
  }
  for (const repository of value.repositories) repository.inventory.observedAt = '2026-09-29T12:01:00Z';
  value.issues.reverse();
  value.repositories.reverse();
  assert.equal(datasetIdentity(value), original);
  validateDataset(value);
  value.issues[0].title += ' changed';
  assert.notEqual(datasetIdentity(value), original);
  assert.throws(() => validateDataset(value), /content identity mismatch/);
  assert.throws(() => validateDataset(identified(value), original), /dataset mismatch/);
});

test('stable identity never grants freshness to future or stale observations', () => {
  const value = read('valid');
  const original = value.datasetId;
  value.issues[0].blockedBy.evidence.observedAt = '2026-10-01T12:00:00Z';
  assert.equal(datasetIdentity(value), original);
  assert.equal(eligibility(value, id, 'ready', policy).allowed, false);
});

test('compact search marks literal truncation and retains full local content', () => {
  const value = read('valid');
  const text = '😀'.repeat(EXCERPT_CHARACTERS + 20);
  value.issues[0].story.outcome.text = text;
  const projection = publicProjection(identified(value));
  const entry = projection.issues.find(x => x.id === id);
  assert.equal([...entry.fields['story.outcome.text']].length, EXCERPT_CHARACTERS);
  assert.deepEqual(entry.truncatedFields, ['story.outcome.text']);
  assert.equal(value.issues[0].story.outcome.text, text);
  assert.ok(!('observedAt' in entry) && !('url' in entry));
});

test('existing sections preserve playback, import and reaction distinctions in the full catalog', () => {
  const example = read('search');
  const value = read('valid');
  const template = value.issues[0];
  value.issues = example.records.map(source => {
    const issue = structuredClone(template);
    issue.number = source.number;
    issue.id = `${issue.repository}#${source.number}`;
    issue.url = `https://github.com/${issue.repository}/issues/${source.number}`;
    issue.nodeId = `FIXTURE_I_${source.number}`;
    issue.title = source.title;
    issue.guide.note = source.note;
    issue.guide.topic = 'pixoo-media';
    issue.guide.source = issue.url;
    issue.facts.source = issue.url;
    for (const [key, section] of Object.entries(issue.story)) {
      if (source[key]) section.text = source[key];
      section.source = issue.url;
    }
    issue.body = Object.values(issue.story).map(x => `## ${x.heading}\n\n${x.text}`).join('\n\n')
      + `\n\n## Guide\n\n**Topic:** pixoo-media\n**Note:** ${source.note}\n`;
    for (const kind of ['parent', 'children', 'blockedBy']) {
      issue[kind].ids = [];
      issue[kind].evidence.source = issue.url;
      issue[kind].evidence.pagination.itemCount = 0;
      issue[kind].evidence.pagination.totalCount = 0;
    }
    issue.publicFields = ['title', 'guide.topic', 'guide.note', 'story.outcome.text',
      'story.implementation.text', 'story.deferrals.text'];
    return issue;
  });
  value.repositories[0].inventory.pagination.itemCount = value.issues.length;
  value.repositories[0].inventory.pagination.totalCount = value.issues.length;
  value.subguides = [];
  const projection = publicProjection(identified(value));
  assert.equal(projection.issues.length, example.records.length);
  for (const query of example.queries) {
    const record = projection.issues.find(x => x.id.endsWith(`#${query.desiredNumber}`));
    assert.equal(record.fields[query.supportField], query.supportText);
    assert.deepEqual(record.truncatedFields, []);
  }
  validateProjection(projection, value);
  // A query-specific shortlist cannot masquerade as the complete catalog.
  projection.issues.pop();
  assert.throws(() => validateProjection(projection, value), /projection mismatch/);
});
