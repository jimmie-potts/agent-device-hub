import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { definitionDigest as recordsOneDigest } from '../digest.mjs';
import { validateDataset, datasetIdentity, placementOf, projectOf, eligibility, publicProjection, validateProjection,
  dependents, primaryPage, recentlyDone } from './records.mjs';
import { CATALOG, catalogIdentity, validateView, resolveView, rebindView, allowedLink, literalText, epicCounts } from './views.mjs';
import { definitionDigest } from './digest.mjs';

const json = name => JSON.parse(readFileSync(new URL(name, import.meta.url)));
const policy = { asOf: '2026-09-30T12:01:00Z', maxAgeMs: 300_000 };
const H = n => `jimmie-potts/agent-device-hub#${n}`;
const N102 = 'jimmie-potts/codex-nanoleaf#900102';
const P104 = 'jimmie-potts/divoom-app-upgrade#900104';
const code = name => error => error.message.startsWith(name + ':');
// Paths address array items by identity with '@': issues by number, components by instance ID.
const step = (object, key) => key.startsWith('@')
  ? object.find(x => x.id === key.slice(1) || x.id?.endsWith('#' + key.slice(1))) : object[key];
const setPath = (value, path, content) => {
  const keys = path.split('.'); const last = keys.pop();
  keys.reduce(step, value)[last] = content;
};
const dropPath = (value, path) => {
  const keys = path.split('.'); const last = keys.pop();
  delete keys.reduce(step, value)[last];
};
// The producer recomputes placement and Project states after any source change, as the adapter must.
function produced(dataset) {
  for (let pass = 0; pass < 2; pass++) for (const issue of dataset.issues) {
    issue.placement = placementOf(dataset, issue);
    issue.project = projectOf(dataset, issue);
  }
  dataset.datasetId = datasetIdentity(dataset);
  return dataset;
}
function records(changes = {}, recompute = true) {
  const dataset = json('./fixtures/dataset.json');
  for (const [path, content] of Object.entries(changes)) setPath(dataset, path, content);
  if (recompute) return produced(dataset);
  dataset.datasetId = datasetIdentity(dataset);
  return dataset;
}
function view(fixture) {
  const dataset = records(fixture.records ?? {});
  const value = json(`./fixtures/${fixture.base}.json`);
  if (!fixture.keepDatasetId) value.datasetId = dataset.datasetId;
  value.components = value.components.filter(x => !(fixture.remove ?? []).includes(x.id));
  value.components.push(...(fixture.add ?? []));
  for (const [path, content] of Object.entries(fixture.set ?? {})) setPath(value, path, content);
  for (const path of fixture.drop ?? []) dropPath(value, path);
  return { dataset, value, policy: { ...policy, ...fixture.policy } };
}
const find = (dataset, id) => dataset.issues.find(x => x.id === id);
const node = (model, id) => model.nodes.find(x => x.id === id);

// Records 2.0

test('valid records place every issue by its nearest explicit epic', () => {
  const dataset = validateDataset(json('./fixtures/dataset.json'));
  const states = Object.fromEntries(dataset.issues.map(x => [x.id, [x.placement.state, x.placement.epic, x.placement.path, x.placement.reason]]));
  assert.deepEqual(states[H(900100)], ['root', null, [], null]);
  assert.deepEqual(states[N102], ['epic', H(900100), [], null], 'cross-repository child');
  assert.deepEqual(states[P104], ['epic', H(900100), [H(900103)], null], 'deep descendant keeps its full path');
  assert.deepEqual(states[H(900105)], ['standalone', null, [H(900110)], null], 'an old closed parent keeps the path');
  assert.deepEqual(states[H(900108)], ['unresolved', null, [], 'parent-unknown']);
  assert.ok(find(dataset, H(900109)).body.includes('## Guide'), 'legacy Guide metadata stays inert body text');
});

test('every open issue has exactly one primary page', () => {
  const dataset = json('./fixtures/dataset.json');
  const pages = dataset.issues.filter(x => x.state === 'OPEN').map(x => [x.id, primaryPage(x)]);
  assert.equal(new Set(pages.map(x => x[0])).size, pages.length);
  assert.deepEqual(Object.fromEntries(pages), {
    [H(900100)]: `epic:${H(900100)}`, [H(900101)]: `epic:${H(900100)}`, [N102]: `epic:${H(900100)}`,
    [H(900103)]: `epic:${H(900100)}`, [P104]: `epic:${H(900100)}`, [H(900105)]: 'not-in-epic',
    [H(900108)]: 'not-in-epic', [H(900109)]: `epic:${H(900100)}` });
});

for (const fixture of json('./fixtures/record-cases.json')) test(`records: ${fixture.name}`, () => {
  const dataset = records(fixture.set ?? {}, fixture.recompute !== false);
  if (fixture.invalid) { assert.throws(() => validateDataset(dataset), new RegExp(fixture.invalid)); return; }
  validateDataset(dataset);
  for (const [id, placement] of Object.entries(fixture.placement ?? {})) assert.deepEqual(find(dataset, id).placement, placement, id);
  for (const [id, state] of Object.entries(fixture.phase ?? {})) assert.equal(find(dataset, id).project.phase.state, state, id);
  for (const [id, state] of Object.entries(fixture.commitment ?? {})) assert.equal(find(dataset, id).project.commitment.state, state, id);
  if (fixture.recent) assert.deepEqual(dataset.issues.filter(x => recentlyDone(dataset, x)).map(x => x.id), fixture.recent);
  for (const [id, [allowed, reason]] of Object.entries(fixture.ready ?? {})) {
    const result = eligibility(dataset, id, 'ready', policy);
    assert.equal(result.allowed, allowed, JSON.stringify(result.reasons));
    if (reason) assert.ok(result.reasons.some(x => x.code === reason && x.source.startsWith('https://')), JSON.stringify(result.reasons));
    assert.equal(eligibility(dataset, id, 'browse').allowed, true);
  }
});

test('a conflicting Phase never erases the recorded value or blocks work', () => {
  const dataset = json('./fixtures/dataset.json');
  assert.deepEqual(find(dataset, N102).project.phase, { state: 'conflict', value: null,
    recorded: 'Development activity at a glance', from: H(900100) });
  assert.equal(find(dataset, H(900101)).project.phase.state, 'inherited');
  assert.equal(eligibility(dataset, H(900101), 'ready', policy).allowed, true, 'Phase and Commitment never gate readiness');
});

test('public projection carries only selected fields and never Project values or bodies', () => {
  const dataset = json('./fixtures/dataset.json');
  find(dataset, H(900101)).body += '\nghp_FAKE_TOKEN_SENTINEL';
  const projection = publicProjection(produced(dataset));
  const text = JSON.stringify(projection);
  assert.ok(!text.includes('SENTINEL') && !text.includes('Commitment') && !text.includes('Ask the guide') && !text.includes('"project"'));
  validateProjection(projection, dataset);
  projection.issues[0].fields.title = 'invented';
  assert.throws(() => validateProjection(projection, dataset), /projection mismatch/);
  assert.throws(() => validateDataset({ ...dataset, token: 'x' }), /additional properties/);
});

test('fetch-only refresh keeps content identity; content changes replace it', () => {
  const dataset = json('./fixtures/dataset.json');
  const original = dataset.datasetId;
  for (const evidence of [dataset.project.evidence, ...dataset.repositories.flatMap(x => [x.inventory, x.recentClosures]),
    ...dataset.issues.flatMap(x => [x.facts, x.parent.evidence, x.children.evidence, x.blockedBy.evidence])]) {
    evidence.observedAt = '2026-09-30T11:59:00Z';
    if (evidence.pagination) evidence.pagination.pages += 1;
  }
  dataset.issues.reverse();
  assert.equal(datasetIdentity(dataset), original);
  validateDataset(dataset);
  find(dataset, H(900101)).project.commitment.value = 'Later';
  assert.notEqual(datasetIdentity(dataset), original, 'an owner selection change is content');
});

test('exact dependent sets are unknown until the whole inventory is fresh', () => {
  const dataset = json('./fixtures/dataset.json');
  assert.deepEqual(dependents(dataset, H(900101), policy), { direct: [], transitive: [], reasons: [] });
  const partial = records({ 'repositories.1.inventory.complete': false, 'repositories.1.inventory.reason': 'Page unavailable' });
  assert.equal(dependents(partial, H(900101), policy).direct, null);
});

// Views 1.0

test('catalog enumerations agree with the view schema and records', () => {
  const schema = json('./views.schema.json').$defs;
  const records2 = json('./records.schema.json').$defs;
  assert.deepEqual(schema.section.properties.group.enum, Object.keys(CATALOG.groups));
  assert.deepEqual(json('./views.schema.json').properties.page.properties.kind.enum, Object.keys(CATALOG.pages));
  assert.deepEqual(json('./views.schema.json').properties.components.items.oneOf
    .map(x => schema[x.$ref.split('/').pop()].properties.kind.const), Object.keys(CATALOG.components));
  assert.deepEqual(schema.reasons.items.oneOf.map(x => schema[x.$ref.split('/').pop()].properties.code.const), Object.keys(CATALOG.reasons));
  assert.deepEqual(schema.questionMatch.properties.evidence.items.properties.field.enum, records2.publicField.enum);
  for (const page of Object.values(CATALOG.pages)) for (const group of page.groups) assert.ok(CATALOG.groups[group], group);
  for (const group of Object.values(CATALOG.groups)) assert.ok(group.requires in CATALOG.predicates, group.requires);
  for (const kind of Object.values(CATALOG.components))
    assert.ok((kind.requiredData ?? []).every(field => field in records2.issue.properties), JSON.stringify(kind.requiredData));
  assert.equal(schema.reasons.maxItems, CATALOG.bounds.composed.maxReasons);
  assert.equal(schema.questionMatch.properties.evidence.maxItems, CATALOG.bounds.composed.maxEvidence);
});

test('the ordinary epic page lists each placed issue once and counts from placement', () => {
  const { dataset, value } = view({ base: 'epic-page' });
  const model = resolveView(value, { dataset, policy });
  assert.equal(model.page.route.epic, 'epics/jimmie-potts/agent-device-hub/900100/');
  const primary = model.nodes.filter(x => x.primary).map(x => x.record).sort();
  assert.deepEqual(primary, [H(900101), H(900103), H(900109), N102, P104].sort());
  assert.equal(node(model, 'wall-titles').route.issue, 'epics/jimmie-potts/agent-device-hub/900100/#jimmie-potts/codex-nanoleaf/900102');
  assert.deepEqual(node(model, 'pixoo-previews').placement.path, [H(900103)], 'depth bound never truncates ancestry');
  assert.deepEqual([node(model, 'layout-draft').stateReason, node(model, 'layout-draft').closedAt], ['completed', '2026-09-23T12:00:00Z']);
  assert.deepEqual([node(model, 'done').window, node(model, 'done').complete, node(model, 'done').total],
    [{ start: '2026-09-23T12:00:00Z', end: '2026-09-30T12:00:00Z' }, true, 1]);
  assert.equal(node(model, 'browser').presentation, 'full');
  assert.deepEqual([node(model, 'epic-pages-prerequisites').ids, node(model, 'epic-pages-prerequisites').complete], [[H(900106)], true]);
  assert.deepEqual(epicCounts(dataset, H(900100), policy), { open: 5, active: 2, blocked: 0, ready: 1, recentlyDone: 1 });
  assert.ok(!JSON.stringify(model).includes(find(dataset, H(900101)).title), 'the model carries references, not copied text');
});

test('ordinary and composed views resolve the same records through the same components', () => {
  const epic = view({ base: 'epic-page' }); const answer = view({ base: 'composed' });
  const ordinary = node(resolveView(epic.value, epic), 'epic-pages');
  const composed = node(resolveView(answer.value, answer), 'next-card');
  for (const key of ['record', 'route', 'link', 'workflow', 'placement', 'phase', 'commitment', 'actions'])
    assert.deepEqual(composed[key], ordinary[key], key);
  const ordinaryEpic = node(resolveView(epic.value, epic), 'browser');
  const composedEpic = node(resolveView(answer.value, answer), 'browser-epic');
  for (const key of ['record', 'route', 'link', 'counts', 'phase', 'commitment', 'presentation']) assert.deepEqual(composedEpic[key], ordinaryEpic[key], key);
  assert.equal(node(resolveView(answer.value, answer), 'answer').sequence, CATALOG.sequences.suggested);
});

test('home repeats cards without changing unique counts', () => {
  const { dataset, value } = view({ base: 'epic-page' });
  const home = { ...value, page: { kind: 'home', record: null }, root: ['epics', 'current', 'recent'], components: [
    { id: 'epics', kind: 'section', group: 'epics', record: null, sequence: 'none', disclosure: 'open', children: ['browser'] },
    { id: 'browser', kind: 'epic', record: H(900100), presentation: 'summary', children: [] },
    { id: 'current', kind: 'section', group: 'current-work', record: null, sequence: 'none', disclosure: 'open', children: ['wall', 'legacy'] },
    { id: 'wall', kind: 'issue-card', record: N102, presentation: 'row', primary: false },
    { id: 'legacy', kind: 'issue-card', record: H(900109), presentation: 'row', primary: false },
    { id: 'recent', kind: 'section', group: 'newly-added', record: null, sequence: 'none', disclosure: 'open', children: ['bug', 'wall-again'] },
    { id: 'bug', kind: 'issue-card', record: H(900105), presentation: 'row', primary: false },
    { id: 'wall-again', kind: 'issue-card', record: N102, presentation: 'row', primary: false }] };
  const model = resolveView(home, { dataset, policy });
  assert.deepEqual(node(model, 'browser').counts, epicCounts(dataset, H(900100), policy));
  home.components[3].primary = true;
  assert.throws(() => validateView(home, { dataset }), code('coverage'));
});

test('Not in an epic and All issues pages cover their issues exactly once', () => {
  const { dataset, value } = view({ base: 'epic-page' });
  const card = (id, record, primary) => ({ id, kind: 'issue-card', record, presentation: 'row', primary });
  const standalone = { ...value, page: { kind: 'not-in-epic', record: null }, root: ['list'], components: [
    { id: 'list', kind: 'section', group: 'not-in-epic', record: null, sequence: 'none', disclosure: 'open', children: ['bug', 'unknown-parent'] },
    card('bug', H(900105), true), card('unknown-parent', H(900108), true)] };
  resolveView(standalone, { dataset, policy });
  standalone.components[0].children = ['bug']; standalone.components.pop();
  assert.throws(() => validateView(standalone, { dataset }), code('coverage'));
  const open = dataset.issues.filter(x => x.state === 'OPEN');
  const all = { ...value, page: { kind: 'all', record: null }, root: ['list'], components: [
    { id: 'list', kind: 'section', group: 'all', record: null, sequence: 'none', disclosure: 'open', children: open.map((_, n) => `i${n}`) },
    ...open.map((x, n) => card(`i${n}`, x.id, false))] };
  resolveView(all, { dataset, policy });
});

test('boards reuse cards and place them by Commitment, Phase or workflow without creating order', () => {
  const { dataset, value } = view({ base: 'epic-page' });
  const board = by => ({ ...value, page: { kind: 'portfolio', record: null }, root: ['portfolio'], components: [
    { id: 'portfolio', kind: 'section', group: 'portfolio', record: null, sequence: 'none', disclosure: 'open', children: ['board'] },
    { id: 'board', kind: 'board', by, children: ['browser', 'pages', 'wall', 'bug', 'unknown-parent'] },
    { id: 'browser', kind: 'epic', record: H(900100), presentation: 'summary', children: [] },
    ...[['pages', H(900101)], ['wall', N102], ['bug', H(900105)], ['unknown-parent', H(900108)]]
      .map(([id, record]) => ({ id, kind: 'issue-card', record, presentation: 'card', primary: false }))] });
  const columns = by => Object.fromEntries(node(resolveView(board(by), { dataset, policy }), 'board').columns.map(x => [x.name, x.children]));
  assert.deepEqual(columns('commitment'), { Now: ['browser'], Next: ['pages'], Later: [], Ideas: [], Unselected: ['wall', 'bug', 'unknown-parent'], Unknown: [] });
  assert.deepEqual(columns('phase'), { 'Ask the guide': ['browser', 'pages'], 'Development activity at a glance': [],
    Unassigned: ['bug'], Conflict: ['wall'], Unknown: ['unknown-parent'] });
  assert.deepEqual(columns('workflow')['status:ready'], ['pages', 'bug']);
  const hidden = records({ 'project.public': false, 'project.evidence.state': 'unknown', 'project.evidence.complete': false, 'project.evidence.reason': 'Project is private' });
  const unknown = { ...board('commitment'), datasetId: hidden.datasetId };
  assert.deepEqual(node(resolveView(unknown, { dataset: hidden, policy }), 'board').columns.find(x => x.name === 'Unknown').children,
    ['browser', 'pages', 'wall', 'bug', 'unknown-parent'], 'an unreadable Project is unknown, never an empty portfolio');
});

test('task briefs offer all four commands whatever the recommendation state', () => {
  const { dataset, value } = view({ base: 'epic-page' });
  const brief = record => ({ ...value, page: { kind: 'issue', record }, root: ['brief'], components: [{ id: 'brief', kind: 'task-brief', record }] });
  const stale = node(resolveView(brief(H(900101)), { dataset, policy }), 'brief');
  assert.deepEqual([stale.commands, stale.recommendation.state, stale.useRecommendation], [['explain', 'plan', 'implement', 'review'], 'stale', false]);
  const missing = node(resolveView(brief(H(900105)), { dataset, policy }), 'brief');
  assert.deepEqual([missing.commands.length, missing.recommendation.state, missing.useRecommendation], [4, 'missing', false]);
  const current = records({ 'issues.1.planning.0.state': 'current' });
  assert.equal(node(resolveView({ ...brief(H(900101)), datasetId: current.datasetId }, { dataset: current, policy }), 'brief').useRecommendation, true);
});

for (const fixture of json('./fixtures/view-cases.json')) test(`views: ${fixture.name}`, () => {
  const { dataset, value, policy: at } = view(fixture);
  if (fixture.invalid) { assert.throws(() => validateView(value, { dataset }), code(fixture.invalid)); return; }
  const item = node(resolveView(value, { dataset, policy: at }), fixture.node);
  const claim = fixture.reason ? item.reasons.find(x => x.code === fixture.reason) : item;
  if (fixture.state) assert.equal(claim.state, fixture.state);
  if ('complete' in fixture) assert.equal(claim.complete, fixture.complete);
  const reasons = claim.withheld ?? claim.reasons;
  assert.ok(reasons.some(x => x.code === fixture.withheld && x.source.startsWith('https://')), JSON.stringify(reasons));
});

test('a large epic page lists every placed issue while a composed view stays bounded', () => {
  const dataset = json('./fixtures/dataset.json');
  const epic = find(dataset, H(900100)); const template = find(dataset, H(900103));
  const extra = Array.from({ length: 40 }, (_, n) => {
    const issue = structuredClone(template); const number = 901000 + n;
    Object.assign(issue, { number, id: H(number), nodeId: `FIXTURE_I_${number}`, url: `https://github.com/jimmie-potts/agent-device-hub/issues/${number}`,
      title: `Large epic item ${n}` });
    issue.children = { ids: [], evidence: { ...template.children.evidence, pagination: { pages: 1, itemCount: 0, totalCount: 0, hasNextPage: false } } };
    return issue;
  });
  dataset.issues.push(...extra);
  epic.children.ids.push(...extra.map(x => x.id));
  epic.children.evidence.pagination.itemCount = epic.children.evidence.pagination.totalCount = epic.children.ids.length;
  dataset.repositories[0].inventory.pagination.itemCount += 40; dataset.repositories[0].inventory.pagination.totalCount += 40;
  produced(dataset);
  const page = json('./fixtures/epic-page.json'); page.datasetId = dataset.datasetId;
  const cards = extra.map((x, n) => ({ id: `large-${n}`, kind: 'issue-card', record: x.id, presentation: 'row', primary: true }));
  page.components.push(...cards);
  page.components.find(x => x.id === 'other-work').children.push(...cards.map(x => x.id));
  const model = resolveView(page, { dataset, policy });
  assert.equal(node(model, 'other-work').total, 41);
  assert.equal(node(model, 'browser').counts.open, 45);
  page.components.find(x => x.id === 'other-work').children.pop(); page.components.pop();
  assert.throws(() => validateView(page, { dataset }), code('coverage'), 'an ordinary page never truncates');
  const answer = json('./fixtures/composed.json'); answer.datasetId = dataset.datasetId;
  const bounded = cards.slice(0, 13).map(x => ({ ...x, primary: false, reasons: [{ code: 'epic-member', evidence: [{ epic: H(900100) }] }] }));
  answer.components.push(...bounded.map(x => ({ ...x, id: x.id + '-a' })));
  answer.components.find(x => x.id === 'answer').children.push(...bounded.map(x => x.id + '-a'));
  assert.throws(() => validateView(answer, { dataset }), code('size-exceeded'));
});

test('composed views stay within their bounds; ordinary pages are never truncated', () => {
  const { dataset, value } = view({ base: 'composed' });
  const cards = Array.from({ length: CATALOG.bounds.composed.maxChildren }, (_, n) => ({ id: `extra-${n}`, kind: 'issue-card',
    record: H(900101), presentation: 'row', primary: false, reasons: [{ code: 'ready-candidate', evidence: [] }] }));
  value.components.push(...cards);
  value.components[0].children.push(...cards.map(x => x.id));
  assert.throws(() => validateView(value, { dataset }), code('size-exceeded'));
  const shallow = { ...CATALOG, bounds: { ...CATALOG.bounds, maxDepth: 1 } };
  const answer = view({ base: 'composed' }).value;
  assert.throws(() => validateView({ ...answer, catalogId: catalogIdentity(shallow) }, { dataset, catalog: shallow }), code('depth-exceeded'));
});

test('links are computed from records; hostile text stays literal', () => {
  const { dataset, value } = view({ base: 'composed', records: { 'issues.1.title': '<img src=x onerror=alert(1)>' } });
  const model = resolveView(value, { dataset, policy });
  assert.equal(node(model, 'next-card').link, 'https://github.com/jimmie-potts/agent-device-hub/issues/900101');
  assert.ok(!JSON.stringify(model).includes('onerror'));
  assert.equal(literalText(find(dataset, H(900101)).title), '&lt;img src=x onerror=alert(1)&gt;');
  for (const url of ['https://example.com/x', 'javascript:alert(1)', 'https://user:pass@github.com/x', 'not a url']) assert.equal(allowedLink(url), null);
});

test('a content refresh re-binds the open view only when it fully revalidates', () => {
  const { dataset, value } = view({ base: 'composed' });
  const refreshed = records({ 'issues.1.title': 'Changed title' });
  assert.throws(() => validateView(value, { dataset: refreshed }), code('dataset-mismatch'));
  const rebound = rebindView(value, { dataset: refreshed });
  assert.deepEqual({ ...rebound, datasetId: value.datasetId }, value);
  assert.equal(value.datasetId, dataset.datasetId);
  const moved = records({ 'issues.2.parent.ids': [], 'issues.2.parent.evidence.pagination.itemCount': 0, 'issues.2.parent.evidence.pagination.totalCount': 0 });
  assert.throws(() => rebindView(value, { dataset: moved }), code('evidence-unverified'));
});

test('ordinary browsing needs no model call and the default view is ordinary', () => {
  let providerCalls = 0;
  const provider = () => { providerCalls += 1; return json('./fixtures/composed.json'); };
  const { dataset, value } = view({ base: 'epic-page' });
  resolveView(value, { dataset, policy });
  assert.equal(providerCalls, 0);
  const answer = provider();
  answer.datasetId = dataset.datasetId;
  resolveView(validateView(answer, { dataset }), { dataset, policy });
  assert.equal(providerCalls, 1);
});

// Compatibility and approval

test('the approved guide-records/1.0 definition is unchanged', () => {
  const spec = fileURLToPath(new URL('../../../../openspec/specs/guide-records/spec.md', import.meta.url));
  assert.equal(recordsOneDigest(spec), 'f2eea2bf8a737bbe3b5542ffbf2c04961e4564dd8fe27326464726f44a00e34d');
  assert.throws(() => validateDataset(json('../fixtures/valid.json')), /unsupported schemaVersion/);
});

test('approval digest tolerates archive headings but changes with normative text', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'epic-guide-digest-'));
  try {
    const path = join(scratch, 'spec.md');
    const text = '## Purpose\n\nExample.\n\n## ADDED Requirements\n\nMust place issues.\n';
    writeFileSync(path, text);
    const original = definitionDigest(path);
    writeFileSync(path, '# epic-guide Specification\n\n' + text.replace('ADDED Requirements', 'Requirements'));
    assert.equal(definitionDigest(path), original);
    writeFileSync(path, text.replace('place', 'guess'));
    assert.notEqual(definitionDigest(path), original);
  } finally { rmSync(scratch, { recursive: true }); }
});
