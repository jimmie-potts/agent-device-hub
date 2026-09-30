import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { datasetIdentity } from '../reference.mjs';
import { definitionDigest as recordsDigest } from '../digest.mjs';
import { CATALOG, catalogIdentity, fullGuideView, validateView, resolveView, rebindView, semanticContent, allowedLink } from './reference.mjs';
import { definitionDigest } from './digest.mjs';

const json = url => JSON.parse(readFileSync(url));
const records = () => json(new URL('../fixtures/valid.json', import.meta.url));
const composed = () => json(new URL('./fixtures/composed.json', import.meta.url));
const schema = json(new URL('./guide-views.schema.json', import.meta.url));
const policy = { asOf: '2026-09-29T12:01:00Z', maxAgeMs: 300_000 };
const A = 'jimmie-potts/agent-device-hub#900001';
const B = 'jimmie-potts/agent-device-hub#900002';
const setPath = (value, path, content) => {
  const keys = path.split('.'); const last = keys.pop();
  keys.reduce((object, key) => object[key], value)[last] = content;
};
// Applies a named fixture change; a records change rebinds the view unless the case tests that binding.
function scenario(fixture = {}) {
  const dataset = records(); const view = composed();
  for (const [path, content] of Object.entries(fixture.records ?? {})) setPath(dataset, path, content);
  dataset.datasetId = datasetIdentity(dataset);
  if (!fixture.keepDatasetId) view.datasetId = dataset.datasetId;
  view.components.push(...(fixture.add ?? []));
  for (const [path, content] of Object.entries(fixture.view ?? {})) setPath(view, path, content);
  return { dataset, view, policy: { ...policy, ...fixture.policy } };
}
const node = (model, id) => model.nodes.find(x => x.id === id);
const code = name => error => error.message.startsWith(name + ':');

test('catalog enumerations and bounds agree with the canonical schema', () => {
  const defs = schema.$defs;
  assert.equal(CATALOG.catalogVersion, 'guide-views/1.0');
  assert.deepEqual(defs.section.properties.group.enum, Object.keys(CATALOG.groups));
  assert.deepEqual(defs.section.properties.group.enum, CATALOG.components.section.properties.group);
  assert.deepEqual(defs.composed.properties.layout.enum, Object.keys(CATALOG.layouts).filter(x => x !== 'full-guide'));
  assert.deepEqual(defs.composed.properties.transition.enum.filter(x => x !== 'none'),
    Object.entries(CATALOG.motion.presets).filter(([, x]) => x.use === 'transition').map(([id]) => id));
  assert.deepEqual(defs.reasons.items.oneOf.map(x => defs[x.$ref.split('/').pop()].properties.code.const), Object.keys(CATALOG.reasons));
  assert.deepEqual(defs.composed.properties.components.items.oneOf.map(x => defs[x.$ref.split('/').pop()].properties.kind.const),
    Object.keys(CATALOG.components));
  const { bounds } = CATALOG;
  assert.equal(defs.composed.properties.components.maxItems, bounds.maxComponents);
  assert.equal(defs.composed.properties.root.maxItems, bounds.maxRootSections);
  assert.equal(defs.children.maxItems, bounds.maxChildren);
  assert.equal(defs.subguidePanel.properties.children.maxItems, bounds.maxChildren);
  assert.equal(defs.reasons.maxItems, bounds.maxReasons);
  assert.equal(defs.questionMatch.properties.evidence.maxItems, bounds.maxEvidence);
  const recordDefs = json(new URL('../guide-records.schema.json', import.meta.url)).$defs;
  for (const [kind, rule] of Object.entries(CATALOG.components)) {
    const fields = Object.keys(recordDefs[rule.record]?.properties ?? {});
    assert.ok(rule.requiredData.every(field => fields.includes(field)), kind);
  }
  for (const preset of Object.values(CATALOG.motion.presets)) {
    assert.equal(preset.iterations, 1);
    assert.ok(preset.maxDurationMs <= CATALOG.motion.settleMs);
  }
});

test('valid composed view resolves every claim from records', () => {
  const { dataset, view } = scenario();
  assert.equal(view.catalogId, catalogIdentity(CATALOG));
  const model = resolveView(view, { dataset, policy });
  assert.deepEqual(model.nodes.map(x => x.id), ['answer', 'next-card', 'context', 'guide-panel', 'done-card', 'graph', 'prerequisites']);
  for (const item of model.nodes) for (const reason of item.reasons ?? []) assert.equal(reason.state, 'supported', `${item.id} ${reason.code}`);
  assert.equal(node(model, 'next-card').position, 1);
  assert.match(node(model, 'answer').sequence, /not a recorded dependency/);
  assert.deepEqual({ ids: node(model, 'prerequisites').ids, complete: node(model, 'prerequisites').complete }, { ids: [B], complete: true });
  // The model carries references and computed claims, never copied issue facts.
  assert.ok(!JSON.stringify(model).includes(dataset.issues[0].title));
});

for (const fixture of json(new URL('./fixtures/cases.json', import.meta.url))) test(fixture.name, () => {
  const { dataset, view, policy: at } = scenario(fixture);
  if (fixture.invalid) {
    assert.throws(() => validateView(view, { dataset }), code(fixture.invalid));
    assert.deepEqual(validateView(fullGuideView()), fullGuideView());
    return;
  }
  const item = node(resolveView(view, { dataset, policy: at }), fixture.node);
  const claim = fixture.reason ? item.reasons.find(x => x.code === fixture.reason) : item;
  if (fixture.state) assert.equal(claim.state, fixture.state);
  if ('complete' in fixture) assert.equal(claim.complete, fixture.complete);
  const reasons = claim.withheld ?? claim.reasons;
  assert.ok(reasons.some(x => x.code === fixture.withheld && x.source.startsWith('https://')), JSON.stringify(reasons));
});

test('Full guide is constant, needs no records or provider and matches the ordinary guide', () => {
  assert.deepEqual(fullGuideView(), { schemaVersion: 'guide-views/1.0', layout: 'full-guide' });
  const model = resolveView(fullGuideView());
  assert.deepEqual(model.motion, { transition: 'none', acknowledge: 'none' });
  assert.deepEqual(model.regions, CATALOG.fullGuide.regions);
  assert.throws(() => validateView({ ...fullGuideView(), root: [] }), code('schema'));
});

test('Full guide regions, disclosure defaults and features match the generated guide', () => {
  const html = readFileSync(new URL('../../outputs/agent-device-work-guides.html', import.meta.url), 'utf8');
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  const topics = spawnSync('python3', ['-c', 'import json; from guide_paths import TOPICS; print(json.dumps([t[0] for t in TOPICS]))'],
    { cwd: fileURLToPath(new URL('../../work/', import.meta.url)), encoding: 'utf8' });
  assert.equal(topics.status, 0, topics.stderr);
  const guides = [...main.matchAll(/<details class="guide" id="([^"]+)"[^>]*>/g)];
  assert.deepEqual(guides.map(x => x[1]), JSON.parse(topics.stdout));
  assert.ok(guides.every(x => / open>$/.test(x[0])));
  const tag = id => main.match(new RegExp(`<(\\w+)[^>]*\\bid="${id}"[^>]*>`));
  let previous = -1;
  for (const region of CATALOG.fullGuide.regions) {
    const found = region.each === 'guide' ? guides[0] : tag(region.id);
    assert.ok(found, region.id);
    assert.ok(found.index > previous, `${region.id} order`);
    previous = found.index;
    if (region.disclosure === 'fixed') assert.notEqual(found[1], 'details', region.id);
    else assert.equal(/ open>$/.test(found[0]), region.disclosure === 'open', region.id);
    for (const nested of region.nestedCollapsed ?? []) {
      const opened = [...main.matchAll(new RegExp(`<details class="${nested}"[^>]*>`, 'g'))];
      assert.ok(opened.length && opened.every(x => !/ open>$/.test(x[0])), nested);
    }
  }
  for (const feature of CATALOG.fullGuide.features) {
    if (feature === 'skip') assert.match(html, /<a class="skip" href="#main">/);
    else if (feature === 'navigation') assert.match(html, /<aside class="sidebar"[^>]*>[\s\S]*?<nav aria-label=/);
    else if (feature === 'brief') assert.match(html, /<dialog id="brief"/);
    else assert.match(html, new RegExp(`\\bid="${feature}"`), feature);
  }
});

test('reduced motion keeps identical facts, reasons, order and actions', () => {
  const { dataset, view } = scenario();
  const moving = resolveView(view, { dataset, policy });
  const still = resolveView(view, { dataset, policy, reducedMotion: true });
  assert.deepEqual(semanticContent(still), semanticContent(moving));
  assert.deepEqual(still.motion, { transition: 'none', acknowledge: 'none' });
  assert.ok(still.nodes.every(x => (x.motion ?? 'none') === 'none'));
  assert.equal(node(moving, 'next-card').motion, 'emphasize');
  view.transition = 'rearrange';
  assert.deepEqual(semanticContent(resolveView(view, { dataset, policy })), semanticContent(moving));
  view.components[1].density = 'compact';
  assert.notDeepEqual(semanticContent(resolveView(view, { dataset, policy })), semanticContent(moving));
});

test('a content refresh re-binds the open view only when it fully revalidates', () => {
  const { dataset, view } = scenario();
  const refreshed = scenario({ records: { 'issues.0.title': 'Changed title' } }).dataset;
  assert.throws(() => validateView(view, { dataset: refreshed }), code('dataset-mismatch'));
  const rebound = rebindView(view, { dataset: refreshed });
  assert.equal(rebound.datasetId, refreshed.datasetId);
  assert.equal(view.datasetId, dataset.datasetId);
  assert.deepEqual({ ...rebound, datasetId: view.datasetId }, view);
  assert.deepEqual(semanticContent(resolveView(rebound, { dataset: refreshed, policy })), semanticContent(resolveView(view, { dataset, policy })));
  const moved = scenario({ records: { 'subguides.0.members': ['jimmie-potts/agent-device-hub#900001'] } }).dataset;
  assert.throws(() => rebindView(view, { dataset: moved }), code('membership'));
  const private_ = scenario({ records: { 'issues.0.publicFields': ['labels'] } }).dataset;
  assert.throws(() => rebindView(view, { dataset: private_ }), code('evidence-not-public'));
  const other = { ...CATALOG, groups: { ...CATALOG.groups, ideas: { ...CATALOG.groups.ideas, heading: 'Other' } } };
  assert.throws(() => rebindView(view, { dataset: refreshed, catalog: other }), code('catalog-mismatch'));
  assert.deepEqual(rebindView(fullGuideView(), { dataset: refreshed }), fullGuideView());
});

test('one record may appear in several instances without changing its facts or membership', () => {
  const { dataset, view } = scenario();
  const before = structuredClone(dataset);
  view.root.push('matches');
  view.components.push(
    { id: 'matches', kind: 'section', group: 'matches', sequence: 'none', disclosure: 'open', children: ['match-card'] },
    { id: 'match-card', kind: 'issue-card', record: A, density: 'compact', emphasis: 'none',
      reasons: [{ code: 'question-match', evidence: [{ field: 'guide.note' }] }] });
  const model = resolveView(view, { dataset, policy });
  assert.equal(node(model, 'match-card').record, node(model, 'next-card').record);
  assert.notEqual(node(model, 'match-card').id, node(model, 'next-card').id);
  assert.deepEqual(dataset, before);
});

test('tree size and depth bounds are enforced', () => {
  const { dataset, view } = scenario();
  const cards = Array.from({ length: CATALOG.bounds.maxComponents }, (_, n) => ({ id: `extra-${n}`, kind: 'issue-card',
    record: A, density: 'compact', emphasis: 'none', reasons: [{ code: 'ready-candidate', evidence: [] }] }));
  assert.throws(() => validateView({ ...view, components: [...view.components, ...cards] }, { dataset }), code('schema'));
  const shallow = { ...CATALOG, bounds: { ...CATALOG.bounds, maxDepth: 2 } };
  assert.throws(() => validateView({ ...view, catalogId: catalogIdentity(shallow) }, { dataset, catalog: shallow }), code('depth-exceeded'));
});

test('links come only from referenced records and only to GitHub pages', () => {
  const { dataset, view } = scenario({ records: { 'subguides.0.source': 'https://api.github.com/repos/example/planning' } });
  const panel = node(resolveView(view, { dataset, policy }), 'guide-panel');
  assert.equal(panel.link, null);
  assert.deepEqual(panel.actions, ['toggle']);
  assert.equal(node(resolveView(view, { dataset, policy }), 'next-card').link, dataset.issues[0].url);
  for (const url of ['https://example.com/x', 'javascript:alert(1)', 'https://user:pass@github.com/x', 'not a url']) assert.equal(allowedLink(url), null);
});

test('dependency lists are computed in code and unknown is never empty', () => {
  const { dataset, view } = scenario();
  Object.assign(view.components[6], { direction: 'dependents', scope: 'transitive' });
  assert.deepEqual(node(resolveView(view, { dataset, policy }), 'prerequisites').ids, []);
  view.components[6].record = B;
  const closed = node(resolveView(view, { dataset, policy }), 'prerequisites');
  assert.deepEqual([closed.ids, closed.complete, closed.reasons[0].code], [null, false, 'dependents-unavailable']);
  const partial = scenario({ records: { 'repositories.0.inventory.complete': false, 'repositories.0.inventory.reason': 'Page unavailable' } });
  Object.assign(partial.view.components[6], { direction: 'dependents', scope: 'direct' });
  assert.equal(node(resolveView(partial.view, partial), 'prerequisites').ids, null);
  Object.assign(partial.view.components[6], { direction: 'prerequisites', scope: 'transitive' });
  assert.deepEqual(node(resolveView(partial.view, partial), 'prerequisites').ids, [B]);
});

test('fake-provider journey keeps Full guide as the default and the reset target', () => {
  const { dataset, view } = scenario();
  let providerCalls = 0;
  const provider = question => { providerCalls += 1; assert.equal(typeof question, 'string'); return structuredClone(view); };
  // Open: the default view uses no records, catalog selection or inference.
  let current = fullGuideView();
  assert.equal(resolveView(current).layout, 'full-guide');
  assert.equal(providerCalls, 0);
  // Explicit query: the application validates the candidate before replacing the view.
  const candidate = provider('Show work for this guide');
  current = validateView(candidate, { dataset });
  const first = resolveView(current, { dataset, policy });
  // Refinement keeps surviving instance IDs, which still resolve to the same records.
  const refined = structuredClone(current);
  refined.root = ['answer', 'context'];
  refined.components = refined.components.filter(x => !['graph', 'prerequisites'].includes(x.id));
  refined.transition = 'rearrange';
  const second = resolveView(validateView(refined, { dataset }), { dataset, policy });
  for (const item of second.nodes) assert.deepEqual(semanticContent({ nodes: [item] }), semanticContent({ nodes: [node(first, item.id)] }));
  // A reply built for other records or another catalog is rejected; the current view stays.
  const refreshed = scenario({ records: { 'issues.0.title': 'Changed title' } }).dataset;
  assert.throws(() => validateView(candidate, { dataset: refreshed }), code('dataset-mismatch'));
  assert.throws(() => validateView({ ...candidate, catalogId: 'sha256:' + '1'.repeat(64) }, { dataset }), code('catalog-mismatch'));
  // Full guide clears the composition without another provider call.
  current = fullGuideView();
  assert.equal(resolveView(current).nodes.length, 0);
  assert.equal(providerCalls, 1);
});

test('the approved guide-records definition this contract consumes is unchanged', () => {
  const spec = fileURLToPath(new URL('../../../../openspec/specs/guide-records/spec.md', import.meta.url));
  assert.equal(recordsDigest(spec), 'f2eea2bf8a737bbe3b5542ffbf2c04961e4564dd8fe27326464726f44a00e34d');
});

test('approval digest tolerates archive headings but changes with normative text', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'guide-views-digest-'));
  try {
    const path = join(scratch, 'spec.md');
    const text = '## Purpose\n\nExample.\n\n## ADDED Requirements\n\nMust validate views.\n';
    writeFileSync(path, text);
    const original = definitionDigest(path);
    writeFileSync(path, '# guide-views Specification\n\n' + text.replace('ADDED Requirements', 'Requirements'));
    assert.equal(definitionDigest(path), original);
    writeFileSync(path, text.replace('validate', 'trust'));
    assert.notEqual(definitionDigest(path), original);
  } finally { rmSync(scratch, { recursive: true }); }
});
