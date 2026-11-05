import assert from 'node:assert/strict';
import {MessageValidator} from '@jimmie-potts/event-contracts/v2';
import {nanoleafSchemas} from '../src/module/schemas.js';
import {acknowledgmentOf} from '@jimmie-potts/sdk';
import {readReactiveCatalog} from '../src/music-presets.js';
import type {ReactiveCatalog} from '../src/music-preset-data.js';
import {ModuleWorld, NANOLEAF_OWNER} from './module-support.js';
import {suite, test} from './support.js';

const recipe = {rendererVersion: 1, effect: 'level-glow', palette: ['#12ab34'], intensity: 0.5, sensitivity: 1, smoothingMs: 100};
const request = (world: ModuleWorld, requestId: string, expectedRevision = 0, presetId = 'preset-one') =>
  world.request('bunny.cmd.nanoleaf-reactive-preset-save.reactive-presets', {
    type: 'org.bunny.nanoleaf-reactive-preset.save.requested', subject: 'reactive-presets',
    dataschema: 'https://bunny.invalid/events/nanoleaf-reactive-preset-save/2.0',
    data: {requestId, presetId, expectedRevision, name: 'Synthetic green', recipe},
  });

suite('module-owned reactive preset saves', () => {
  test('an explicit metadata save creates a preset without device changes', async context => {
    const world = await ModuleWorld.open(context); await world.start(); await world.advance(2000);
    const before = {devices: world.query('SELECT * FROM nanoleaf_devices'), meta: world.query('SELECT * FROM meta'),
      journal: world.query('SELECT * FROM control_journal'), commands: world.query('SELECT * FROM nanoleaf_commands'), writes: world.writes().length};
    assert.equal((await request(world, 'preset-save-one')).status, 'accepted');
    await world.until(() => world.outcomes('preset-save-one').length === 1, 1000, 'saved recipe outcome');
    assert.deepEqual(world.outcomes('preset-save-one')[0]?.data, {requestId: 'preset-save-one', result: 'succeeded', evidence: 'observed'});
    assert.equal(world.query('SELECT id FROM nanoleaf_reactive_presets').length, 1);
    assert.deepEqual({devices: world.query('SELECT * FROM nanoleaf_devices'), meta: world.query('SELECT * FROM meta'),
      journal: world.query('SELECT * FROM control_journal'), commands: world.query('SELECT * FROM nanoleaf_commands'), writes: world.writes().length}, before);
    world.verifyMessages();
  });
});

suite('reactive metadata faults and ownership', () => {
  test('concurrent catalog CAS creates one preset and restart republishes the exact committed outcome', async context => {
    const world = await ModuleWorld.open(context); await world.start();
    const answers = await Promise.all([request(world, 'preset-race-a'), request(world, 'preset-race-b', 0, 'preset-two')]);
    assert.deepEqual(answers.map(answer => answer.status).sort(), ['accepted', 'rejected']);
    assert.equal(answers.find(answer => answer.status === 'rejected')?.error.error.code, 'revision-conflict');
    const id = answers[0]?.status === 'accepted' ? 'preset-race-a' : 'preset-race-b';
    const outcome = world.outcomes(id)[0]; assert.ok(outcome !== undefined);
    const db = world.harness.moduleDatabase(); assert.ok(db !== undefined); const before = readReactiveCatalog(db);
    await world.restart();
    const restarted = world.harness.moduleDatabase(); assert.ok(restarted !== undefined);
    assert.deepEqual(readReactiveCatalog(restarted), before); assert.deepEqual(world.outcomes(id).at(-1), outcome);
    assert.equal((await request(world, 'preset-next', before.revision, 'preset-three')).status, 'accepted');
    assert.equal(readReactiveCatalog(restarted).presets.length, 2); world.verifyMessages();
  });

  test('mixed device/show/preset sync stays above high water, including restart with an earlier clock', async context => {
    const world = await ModuleWorld.open(context); await world.start();
    const seen: ReactiveCatalog[] = [];
    const sync = await world.operator.sync<ReactiveCatalog>(['device', 'nanoleaf-shows', 'nanoleaf-reactive-presets'], change => {
      if (change.type === 'updated' && change.entity.family === 'nanoleaf-reactive-presets') seen.push(change.message.data);
    }, {owner: NANOLEAF_OWNER, timeoutMs: 1000});
    assert.equal(sync.status, 'synced'); if (sync.status !== 'synced') return; context.after(() => sync.copy.close());
    await request(world, 'preset-sync-one');
    await world.until(() => seen.some(value => value.presets.length === 1), 1000, 'first reactive state after mixed sync');
    const revision = seen.at(-1)?.revision; assert.ok(revision !== undefined);
    world.clock.ms -= 10000; await world.restart();
    await request(world, 'preset-sync-two', revision, 'preset-two');
    await world.until(() => seen.some(value => value.presets.length === 2), 1000, 'restarted reactive state above high water');
    assert.ok((seen.at(-1)?.revision ?? 0) > revision); world.verifyMessages();
  });

  test('catalog/state/outcome insertion faults roll back the entire save', async context => {
    const world = await ModuleWorld.open(context); await world.start();
    const db = world.harness.moduleDatabase(); assert.ok(db !== undefined);
    for (const failure of ['catalog', 'state', 'outcome']) {
      const before = readReactiveCatalog(db);
      db.exec(failure === 'catalog'
        ? "CREATE TRIGGER refuse_reactive BEFORE INSERT ON nanoleaf_reactive_catalog BEGIN SELECT RAISE(ABORT,'synthetic'); END"
        : `CREATE TRIGGER refuse_reactive BEFORE INSERT ON bunny_outbox WHEN NEW.kind='${failure}' BEGIN SELECT RAISE(ABORT,'synthetic'); END`);
      const answer = await request(world, `preset-fault-${failure}`);
      assert.equal(answer.status === 'rejected' && answer.error.error.code, 'internal');
      assert.deepEqual(readReactiveCatalog(db), before); assert.equal(world.outcomes(`preset-fault-${failure}`).length, 0);
      db.exec('DROP TRIGGER refuse_reactive');
    }
    assert.equal((await request(world, 'preset-recovered')).status, 'accepted'); world.verifyMessages();
  });

  test('post-commit publication loss retains state and outcome until restart and core acknowledgment', async context => {
    const world = await ModuleWorld.open(context); await world.start(); world.refuseReactivePublication = true;
    assert.equal((await request(world, 'preset-deferred')).status, 'accepted');
    assert.equal(world.query('SELECT id FROM nanoleaf_reactive_presets').length, 1); assert.equal(world.outcomes('preset-deferred').length, 0);
    const waiting = world.query("SELECT message FROM bunny_outbox WHERE routing_key LIKE '%nanoleaf-reactive%' ORDER BY seq");
    assert.equal(waiting.length, 2); world.refuseReactivePublication = false; await world.restart();
    const outcome = world.outcomes('preset-deferred')[0]; assert.ok(outcome !== undefined);
    assert.equal(JSON.stringify(outcome), waiting[1]?.[0]);
    const forged = acknowledgmentOf(outcome); await world.operator.publish(forged.key, forged.draft); await world.advance(0);
    assert.equal(world.query("SELECT id FROM bunny_outbox WHERE kind='outcome'").length, 1);
    await world.core.recordOutcome(outcome); await world.advance(0);
    assert.equal(world.query("SELECT id FROM bunny_outbox WHERE kind='outcome'").length, 0);
    assert.equal(world.query('SELECT id FROM nanoleaf_reactive_presets').length, 1);
    assert.deepEqual(world.invalid, ['org.bunny.outcome.recorded: invalid-message envelope /source not the core']);
  });

  test('SQLITE_FULL preserves earlier presets and refuses before accepting', async context => {
    const world = await ModuleWorld.open(context); await world.start(); await request(world, 'preset-before-full');
    const db = world.harness.moduleDatabase(); assert.ok(db !== undefined); const before = readReactiveCatalog(db);
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA page_size=512; VACUUM; PRAGMA journal_mode=WAL');
    const pages = world.query('PRAGMA page_count')[0]?.[0]; assert.equal(typeof pages, 'number');
    db.exec(`PRAGMA max_page_count=${String(pages)}`);
    try {
      const answer = await world.request('bunny.cmd.nanoleaf-reactive-preset-save.reactive-presets', {
        type: 'org.bunny.nanoleaf-reactive-preset.save.requested', subject: 'reactive-presets',
        dataschema: 'https://bunny.invalid/events/nanoleaf-reactive-preset-save/2.0', data: {
          requestId: 'preset-full', presetId: `preset-${'a'.repeat(57)}`, expectedRevision: before.revision, name: '😀'.repeat(80),
          recipe: {rendererVersion: 1, effect: 'traveling-wave', direction: 'counterclockwise', palette: Array.from({length: 8}, () => '#ffffff'),
            intensity: 0.9999999999999999, sensitivity: 7.999999999999999, smoothingMs: 1999.9999999999998, periodMs: 9999.999999999998},
        },
      });
      assert.equal(answer.status === 'rejected' && answer.error.error.code, 'capacity');
    } finally {db.exec('PRAGMA max_page_count=1073741823');}
    assert.deepEqual(readReactiveCatalog(db), before); assert.equal(world.outcomes('preset-full').length, 0); world.verifyMessages();
  });

  test('corrupt library refuses only its sync, leaving stored bytes and device reads intact', async context => {
    const world = await ModuleWorld.open(context); await world.start(); await request(world, 'preset-corrupt');
    const db = world.harness.moduleDatabase(); assert.ok(db !== undefined); db.exec("UPDATE nanoleaf_reactive_presets SET body='{'");
    const result = await world.operator.sync(['nanoleaf-reactive-presets'], () => {}, {owner: NANOLEAF_OWNER, timeoutMs: 1000});
    assert.equal(result.status === 'rejected' && result.error.error.code, 'invalid-state');
    const device = await world.operator.sync(['device'], () => {}, {owner: NANOLEAF_OWNER, timeoutMs: 1000});
    assert.equal(device.status, 'synced'); if (device.status === 'synced') await device.copy.close();
    assert.equal(world.query('SELECT body FROM nanoleaf_reactive_presets')[0]?.[0], '{'); world.verifyMessages();
  });

  test('an expired queued save never reaches storage', async context => {
    const world = await ModuleWorld.open(context); await world.start();
    const pending = world.operator.request('bunny.cmd.nanoleaf-reactive-preset-save.reactive-presets', {
      type: 'org.bunny.nanoleaf-reactive-preset.save.requested', subject: 'reactive-presets',
      dataschema: 'https://bunny.invalid/events/nanoleaf-reactive-preset-save/2.0', data: {
        requestId: 'preset-expired', presetId: 'preset-expired', expectedRevision: 0, name: 'Expired', recipe,
      },
    }, {requestId: 'preset-expired', timeoutMs: 1});
    world.clock.advance(2); await world.advance(0); const answer = await pending;
    assert.equal(answer.status === 'rejected' && answer.error.error.code, 'expired');
    assert.equal(world.query('SELECT id FROM nanoleaf_reactive_presets').length, 0); world.verifyMessages();
  });
});

test('registered profile-2 preset schemas reject undeclared parameters and unsupported variants', () => {
  const validator = new MessageValidator();
  for (const [schema, shape] of Object.entries(nanoleafSchemas)) validator.register(schema, shape);
  const command = {specversion: '1.0', bunnyprofile: '2.0', id: 'preset-schema', source: 'bunny/core',
    type: 'org.bunny.nanoleaf-reactive-preset.save.requested', subject: 'reactive-presets', kind: 'command',
    time: '2026-11-05T00:00:00.000Z', expiresat: '2027-11-05T00:00:00.000Z', datacontenttype: 'application/json',
    traceparent: '00-11111111111111111111111111111111-1111111111111111-01',
    dataschema: 'https://bunny.invalid/events/nanoleaf-reactive-preset-save/2.0',
    data: {requestId: 'preset-schema', presetId: 'preset-one', expectedRevision: 0, name: 'Synthetic', recipe}};
  assert.equal(validator.validate(command).ok, true);
  for (const patch of [{rendererVersion: 2}, {effect: 'unknown'}, {rawAudio: 'synthetic'}, {intensity: 2}, {direction: 'right'}])
    assert.equal(validator.validate({...command, data: {...command.data, recipe: {...recipe, ...patch}}}).ok, false);
  assert.equal(validator.validate({...command, data: {...command.data, configuredLayout: 'private'}}).ok, false);
  const catalog = {...command, kind: 'state', type: 'org.bunny.nanoleaf-reactive-presets.updated',
    dataschema: 'https://bunny.invalid/events/nanoleaf-reactive-presets/2.0',
    data: {id: 'reactive-presets', revision: 1, presets: []}};
  const {expiresat: _expires, ...state} = catalog;
  assert.equal(validator.validate(state).ok, true);
});
