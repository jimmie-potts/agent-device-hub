import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MIGRATION_ORDER, assertPreparationDigest, prepareCutover, type CutoverFacts, type MigrationFact} from '../src/install/planner.js';

function present<T>(value: T | undefined): T {
  assert.ok(value !== undefined, 'fixture entry exists');
  return value;
}

function facts(): CutoverFacts {
  const migrations: MigrationFact[] = MIGRATION_ORDER.map(group => ({group, selection: 'not-configured', reason: 'synthetic installation has no section'}));
  migrations[0] = {group: 'nanoleaf', selection: 'convert', inputs: ['wall'], bytes: 20, converter: 'nanoleaf.migrate', verifier: 'nanoleaf.verify'};
  migrations[1] = {group: 'pixoo-library', selection: 'convert', inputs: ['library'], bytes: 30, converter: 'pixoo.migrate', verifier: 'pixoo.verify'};
  return {
    owner: 'fixture-owner', source: {revision: 'a'.repeat(40), tree: 'b'.repeat(40)},
    destinations: {backup: {path: '/fixture/backup', volume: 'disk'}, runtime: {path: '/fixture/new', volume: 'disk'}},
    volumes: [{id: 'disk', availableBytes: 1000, reserveBytes: 10}], releaseBytes: 100,
    writers: [{id: 'wall-writer', kind: 'process-set', target: 'fixture-wall-workers'}, {id: 'library-writer', kind: 'user-unit', target: 'fixture-library.service'}],
    stores: [
      {id: 'wall', path: '/fixture/old/wall', kind: 'directory', bytes: 100, sha256: 'c'.repeat(64), writers: ['wall-writer'], use: 'migration-input'},
      {id: 'library', path: '/fixture/old/library', kind: 'directory', bytes: 200, sha256: 'd'.repeat(64), writers: ['library-writer'], use: 'migration-input'},
    ],
    migrations: migrations.reverse(),
  };
}

void test('prepares every writer and backup before conversions in owner order, without execution or input mutation', () => {
  const input = facts();
  const before = structuredClone(input);
  const plan = prepareCutover(input);
  assert.deepEqual(plan.steps, [
    {kind: 'stop-writers', writers: ['library-writer', 'wall-writer']},
    {kind: 'backup', stores: ['library', 'wall']},
    {kind: 'verify-backups', stores: ['library', 'wall']},
    {kind: 'convert', group: 'nanoleaf', inputs: ['wall']},
    {kind: 'convert', group: 'pixoo-library', inputs: ['library']},
    {kind: 'verify-conversions', groups: ['nanoleaf', 'pixoo-library']},
    {kind: 'await-execution-qualification'},
  ]);
  assert.equal(plan.kind, 'runtime-cutover-preparation');
  assert.equal(plan.execution, 'unavailable');
  assert.deepEqual(input, before);
});

void test('refuses missing, duplicate or uncovered inventory and conflicting paths', () => {
  const input = facts();
  const wall = present(input.stores[0]);
  const library = present(input.stores[1]);
  const cases: [string, CutoverFacts][] = [
    ['missing owner', {...input, owner: ''}],
    ['short source revision', {...input, source: {...input.source, revision: 'main'}}],
    ['no writers', {...input, writers: []}],
    ['duplicate writer', {...input, writers: [...input.writers, present(input.writers[0])]}],
    ['unknown writer', {...input, stores: [{...wall, writers: ['missing']}, library]}],
    ['no writer for source', {...input, stores: [{...wall, writers: []}, library]}],
    ['duplicate store', {...input, stores: [...input.stores, wall]}],
    ['nested physical sources', {...input, stores: [wall, {...library, path: `${wall.path}/child`}]}],
    ['relative source', {...input, stores: [{...wall, path: 'relative'}, library]}],
    ['dot segments', {...input, stores: [{...wall, path: '/fixture/../old/wall'}, library]}],
    ['source root', {...input, stores: [{...wall, path: '/'}, library]}],
    ['backup overlaps source', {...input, destinations: {...input.destinations, backup: {path: wall.path, volume: 'disk'}}}],
    ['nested destinations', {...input, destinations: {...input.destinations, runtime: {path: '/fixture/backup/runtime', volume: 'disk'}}}],
    ['missing migration selection', {...input, migrations: input.migrations.slice(1)}],
    ['duplicate migration selection', {...input, migrations: [...input.migrations, present(input.migrations[0])]}],
    ['missing source reference', {...input, migrations: input.migrations.map(m => m.group === 'nanoleaf' && m.selection === 'convert' ? {...m, inputs: ['missing']} : m)}],
    ['unused conversion source', {...input, migrations: input.migrations.map(m => m.group === 'nanoleaf' ? {group: m.group, selection: 'not-configured', reason: 'fixture has none'} : m)}],
    ['backup-only converted', {...input, stores: [{...wall, use: 'backup-only'}, library]}],
    ['empty not-configured reason', {...input, migrations: input.migrations.map(m => m.selection === 'not-configured' ? {...m, reason: ''} : m)}],
  ];
  for (const [name, candidate] of cases) assert.throws(() => prepareCutover(candidate), /cutover-plan-invalid/, name);
});

void test('backs up fresh-state sources once and permits several conversions to read one physical source', () => {
  const input = facts();
  const shared: CutoverFacts = {
    ...input,
    stores: [...input.stores, {id: 'history', path: '/fixture/old/history', kind: 'sqlite', bytes: 15, sha256: 'e'.repeat(64), writers: ['library-writer'], use: 'backup-only'}],
    migrations: input.migrations.map(m => m.group === 'pixoo-configuration'
      ? {group: m.group, selection: 'convert', inputs: ['library'], bytes: 1, converter: 'pixoo.settings', verifier: 'pixoo.settings.verify'} : m),
  };
  const plan = prepareCutover(shared);
  assert.deepEqual(plan.steps.find(step => step.kind === 'backup'), {kind: 'backup', stores: ['history', 'library', 'wall']});
  assert.equal(plan.steps.filter(step => step.kind === 'convert' && step.inputs.includes('library')).length, 2);
  assert.deepEqual(plan.space, [{volume: 'disk', requiredBytes: 476, availableBytes: 1000}], '315 backup + 51 converted + 100 release + 10 reserve');
  assert.equal(prepareCutover({...shared, volumes: [{id: 'disk', availableBytes: 476, reserveBytes: 10}]}).status, 'prepared', 'a shared source is charged once at the capacity boundary');
});

void test('orders all selected converter groups by the accepted cutover sequence', () => {
  const expected = ['nanoleaf', 'pixoo-library', 'pixoo-configuration', 'lifx', 'tidbyt', 'playback', 'hub-edge', 'codex-desktop', 'automation', 'wispr-configuration'] as const;
  const migrations: MigrationFact[] = [...expected].reverse().map(group => ({
    group, selection: 'convert', inputs: [group === 'nanoleaf' ? 'wall' : 'library'], bytes: 1,
    converter: `${group}.convert`, verifier: `${group}.verify`,
  }));
  const plan = prepareCutover({...facts(), migrations});
  assert.equal(plan.status, 'prepared');
  assert.deepEqual(plan.steps.filter(step => step.kind === 'convert').map(step => step.group), expected);
  assert.deepEqual(plan.steps.find(step => step.kind === 'verify-conversions'), {kind: 'verify-conversions', groups: expected});
});

void test('blocks missing converters and verifiers without representing their operations as completed', () => {
  const input = facts();
  const plan = prepareCutover({...input, migrations: input.migrations.map(m => m.group === 'nanoleaf' && m.selection === 'convert'
    ? {...m, converter: null, verifier: null} : m)});
  assert.equal(plan.status, 'blocked');
  assert.deepEqual(plan.blockers, [{kind: 'missing-converter', group: 'nanoleaf'}, {kind: 'missing-verifier', group: 'nanoleaf'}]);
  assert.equal(plan.execution, 'unavailable');
});

void test('combines allocations on a shared volume and counts its reserve once', () => {
  const input = facts();
  const plan = prepareCutover(input);
  // 300 source + 50 converted + 100 release + 10 reserve.
  assert.deepEqual(plan.space, [{volume: 'disk', requiredBytes: 460, availableBytes: 1000}]);
  assert.equal(plan.status, 'prepared');
  const short = prepareCutover({...input, volumes: [{id: 'disk', availableBytes: 459, reserveBytes: 10}]});
  assert.equal(short.status, 'blocked');
  assert.deepEqual(short.blockers, [{kind: 'insufficient-space', volume: 'disk', requiredBytes: 460, availableBytes: 459}]);
  assert.equal(prepareCutover({...input, volumes: [{id: 'disk', availableBytes: 460, reserveBytes: 10}]}).status, 'prepared');
});

void test('cannot spend spare backup-volume capacity on another runtime volume', () => {
  const input = facts();
  const plan = prepareCutover({
    ...input, destinations: {...input.destinations, runtime: {path: '/fixture/new', volume: 'runtime-disk'}},
    volumes: [{id: 'disk', availableBytes: 10000, reserveBytes: 10}, {id: 'runtime-disk', availableBytes: 160, reserveBytes: 20}],
  });
  assert.deepEqual(plan.space, [
    {volume: 'disk', requiredBytes: 310, availableBytes: 10000},
    {volume: 'runtime-disk', requiredBytes: 170, availableBytes: 160},
  ]);
  assert.deepEqual(plan.blockers, [{kind: 'insufficient-space', volume: 'runtime-disk', requiredBytes: 170, availableBytes: 160}]);
});

void test('refuses unsafe byte counts, overflow and missing or duplicate volume observations', () => {
  const input = facts();
  for (const bytes of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => prepareCutover({...input, releaseBytes: bytes}), /cutover-plan-invalid/);
    assert.throws(() => prepareCutover({...input, stores: input.stores.map(s => ({...s, bytes}))}), /cutover-plan-invalid/);
    assert.throws(() => prepareCutover({...input, volumes: [{id: 'disk', availableBytes: bytes, reserveBytes: 0}]}), /cutover-plan-invalid/);
    assert.throws(() => prepareCutover({...input, volumes: [{id: 'disk', availableBytes: 1000, reserveBytes: bytes}]}), /cutover-plan-invalid/);
    assert.throws(() => prepareCutover({...input, migrations: input.migrations.map(m => m.selection === 'convert' ? {...m, bytes} : m)}), /cutover-plan-invalid/);
  }
  assert.throws(() => prepareCutover({...input, releaseBytes: Number.MAX_SAFE_INTEGER}), /cutover-plan-invalid/);
  assert.throws(() => prepareCutover({...input, volumes: []}), /cutover-plan-invalid/);
  assert.throws(() => prepareCutover({...input, volumes: [...input.volumes, present(input.volumes[0])]}), /cutover-plan-invalid/);
});

void test('binds every meaningful fact and refuses old digests after drift', () => {
  const input = facts();
  const original = prepareCutover(input);
  assert.match(original.digest, /^[a-f0-9]{64}$/);
  assertPreparationDigest(input, original.digest);
  assert.throws(() => assertPreparationDigest(input, 'yes'), /cutover-preparation-changed/);
  assert.throws(() => assertPreparationDigest(input, '0'.repeat(64)), /cutover-preparation-changed/);
  const variants: CutoverFacts[] = [
    {...input, owner: 'another-owner'},
    {...input, source: {...input.source, revision: 'f'.repeat(40)}},
    {...input, source: {...input.source, tree: 'f'.repeat(40)}},
    {...input, destinations: {...input.destinations, backup: {path: '/fixture/another-backup', volume: 'disk'}}},
    {...input, destinations: {...input.destinations, runtime: {path: '/fixture/another-runtime', volume: 'disk'}}},
    {...input, releaseBytes: 101},
    {...input, volumes: [{id: 'disk', availableBytes: 999, reserveBytes: 10}]},
    {...input, volumes: [{id: 'disk', availableBytes: 1000, reserveBytes: 11}]},
    {...input, writers: input.writers.map(w => ({...w, target: `other-${w.target}`}))},
    {...input, writers: input.writers.map(w => ({...w, kind: 'process-set'}))},
    {...input, stores: input.stores.map(s => ({...s, sha256: 'f'.repeat(64)}))},
    {...input, stores: input.stores.map(s => ({...s, path: `${s.path}-other`}))},
    {...input, stores: input.stores.map(s => ({...s, bytes: s.bytes + 1}))},
    {...input, stores: input.stores.map(s => ({...s, kind: 'sqlite'}))},
    {...input, stores: input.stores.map(s => ({...s, writers: input.writers.map(w => w.id)}))},
    {...input, migrations: input.migrations.map(m => m.selection === 'convert' ? {...m, converter: 'other.converter'} : m)},
    {...input, migrations: input.migrations.map(m => m.selection === 'convert' ? {...m, verifier: 'other.verifier'} : m)},
    {...input, migrations: input.migrations.map(m => m.selection === 'convert' ? {...m, bytes: m.bytes + 1} : m)},
    {...input, migrations: input.migrations.map(m => m.selection === 'not-configured' ? {...m, reason: 'another explicit observation'} : m)},
  ];
  for (const variant of variants) {
    assert.notEqual(prepareCutover(variant).digest, original.digest);
    assert.throws(() => assertPreparationDigest(variant, original.digest), /cutover-preparation-changed/);
  }
});

void test('normalizes object and set ordering without changing preparation or digest', () => {
  const input = facts();
  const reordered: CutoverFacts = {
    migrations: [...input.migrations].reverse(), stores: [...input.stores].reverse(), writers: [...input.writers].reverse(),
    releaseBytes: input.releaseBytes, volumes: [...input.volumes].reverse(),
    destinations: {runtime: {volume: 'disk', path: '/fixture/new'}, backup: {volume: 'disk', path: '/fixture/backup'}},
    source: {tree: input.source.tree, revision: input.source.revision}, owner: input.owner,
  };
  assert.deepEqual(prepareCutover(reordered), prepareCutover(input));
  assertPreparationDigest(reordered, prepareCutover(input).digest);
});

void test('refuses a trailing-slash destination alias that would hide a nested source', () => {
  const input = facts();
  assert.throws(() => prepareCutover({...input,
    destinations: {...input.destinations, backup: {path: '/fixture/old/', volume: 'disk'}},
  }), /cutover-plan-invalid/);
});
