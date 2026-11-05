import assert from 'node:assert/strict';
import {acknowledgmentOf} from '@jimmie-potts/sdk';
import {NANOLEAF_FAMILIES, schemaOf} from '../src/module/schemas.js';
import {readShowVersion, showCatalog} from '../src/music-shows.js';
import type {ShowCatalog} from '../src/music-show-data.js';
import {showContent} from '../src/module/show-content.js';
import {ModuleWorld, NANOLEAF_OWNER} from './module-support.js';
import {suite, test} from './support.js';

const data = (requestId: string, expectedVersion = 0) => ({requestId, showId: 'show-one', expectedVersion, name: 'Synthetic ocean', versionName: 'Draft',
  timeline: {version: 1, durationMs: 2000, cues: [{id: 'first', offsetMs: 0, durationMs: 1000, recipe: {preset: 'ocean'}, intensity: 0.5}]}});
const request = (world: ModuleWorld, requestId: string, expectedVersion = 0) => world.request('bunny.cmd.nanoleaf-show-save.shows', {
  type: NANOLEAF_FAMILIES.showSave.type, subject: 'shows', dataschema: schemaOf('nanoleaf-show-save'), data: data(requestId, expectedVersion),
});

suite('module-owned decorative show saves', () => {
  test('saving metadata completes without changing device revisions, outcomes, journals or writes', async context => {
    const world = await ModuleWorld.open(context);
    await world.start();
    await world.advance(2000);
    const before = {device: world.query('SELECT * FROM nanoleaf_devices'), commands: world.query('SELECT * FROM nanoleaf_commands'),
      writes: world.writes().length, meta: world.query('SELECT * FROM meta')};
    assert.equal((await request(world, 'show-save-one')).status, 'accepted');
    await world.until(() => world.outcomes('show-save-one').length === 1, 1000, 'the saved metadata outcome');
    const outcome = world.outcomes('show-save-one')[0];
    assert.deepEqual(outcome?.data, {requestId: 'show-save-one', result: 'succeeded', evidence: 'observed'});
    assert.equal(outcome?.subject, 'shows');
    assert.deepEqual({device: world.query('SELECT * FROM nanoleaf_devices'), commands: world.query('SELECT * FROM nanoleaf_commands'),
      writes: world.writes().length, meta: world.query('SELECT * FROM meta')}, before);
    assert.equal(world.query('SELECT version FROM nanoleaf_show_versions').length, 1);
    world.verifyMessages();
  });

  test('competing head guards create one version; restart republishes the same retained outcome', async context => {
    const world = await ModuleWorld.open(context); await world.start();
    const answers = await Promise.all([request(world, 'show-race-a'), request(world, 'show-race-b')]);
    assert.deepEqual(answers.map(answer => answer.status).sort(), ['accepted', 'rejected']);
    assert.equal(answers.find(answer => answer.status === 'rejected')?.error.error.code, 'revision-conflict');
    const id = answers[0]?.status === 'accepted' ? 'show-race-a' : 'show-race-b';
    const outcome = world.outcomes(id)[0]; assert.ok(outcome !== undefined);
    const db = world.harness.moduleDatabase(); assert.ok(db !== undefined);
    const version = readShowVersion(db, 'show-one', 1);
    assert.equal(world.query("SELECT kind FROM bunny_outbox WHERE kind='outcome'").length, 1);
    await world.restart();
    assert.equal(world.query('SELECT version FROM nanoleaf_show_versions').length, 1);
    assert.deepEqual(world.outcomes(id).at(-1), outcome);
    const restarted = world.harness.moduleDatabase(); assert.ok(restarted !== undefined);
    assert.deepEqual(readShowVersion(restarted, 'show-one', 1), version);
    assert.equal((await request(world, 'show-after-restart', 1)).status, 'accepted');
    assert.equal(readShowVersion(restarted, 'show-one', 2).version, 2);
    world.verifyMessages();
  });

  test('catalog updates remain visible above the mixed device sync high-water mark', async context => {
    const world = await ModuleWorld.open(context); await world.start();
    const seen: ShowCatalog[] = [];
    const result = await world.operator.sync<ShowCatalog>(['device', 'nanoleaf-shows'], change => {
      if (change.type === 'updated' && change.entity.family === 'nanoleaf-shows') seen.push(change.message.data);
    }, {owner: NANOLEAF_OWNER, timeoutMs: 1000});
    assert.equal(result.status, 'synced'); if (result.status !== 'synced') return;
    context.after(() => result.copy.close());
    assert.ok([...result.copy.states()].some(state => state.data.id === 'shows'));
    await request(world, 'show-sync-one');
    await world.until(() => seen.some(catalog => catalog.shows[0]?.version === 1), 1000, 'catalog after mixed sync');
    await request(world, 'show-sync-two', 1);
    await world.until(() => seen.some(catalog => catalog.shows[0]?.version === 2), 1000, 'second catalog update');
    const first = seen.find(catalog => catalog.shows[0]?.version === 1), second = seen.find(catalog => catalog.shows[0]?.version === 2);
    assert.ok(first !== undefined && second !== undefined && second.revision > first.revision);
    world.verifyMessages();
  });

  test('catalog or outcome insertion failure rolls back the complete save', async context => {
    const world = await ModuleWorld.open(context); await world.start();
    const db = world.harness.moduleDatabase(); assert.ok(db !== undefined);
    const before = showCatalog(db);
    for (const failure of ['catalog', 'outcome']) {
      db.exec(failure === 'catalog'
        ? "CREATE TRIGGER refuse_show BEFORE INSERT ON nanoleaf_show_catalog BEGIN SELECT RAISE(ABORT,'synthetic'); END"
        : "CREATE TRIGGER refuse_show BEFORE INSERT ON bunny_outbox WHEN NEW.kind='outcome' BEGIN SELECT RAISE(ABORT,'synthetic'); END");
      const answer = await request(world, `show-fail-${failure}`);
      assert.equal(answer.status === 'rejected' && answer.error.error.code, 'internal');
      assert.deepEqual(showCatalog(db), before);
      assert.equal(world.query('SELECT version FROM nanoleaf_show_versions').length, 0);
      assert.equal(world.outcomes(`show-fail-${failure}`).length, 0);
      db.exec('DROP TRIGGER refuse_show');
    }
    assert.equal((await request(world, 'show-recovered')).status, 'accepted');
    world.verifyMessages();
  });

  test('bounded version reads and corrupt catalog refusal preserve data and module availability', async context => {
    const world = await ModuleWorld.open(context); await world.start(); await request(world, 'show-read');
    const db = world.harness.moduleDatabase(); assert.ok(db !== undefined);
    const content = (query: Record<string, string>, signal = new AbortController().signal) => showContent(db, {query, signal});
    const before = world.query('SELECT total_changes()');
    const answer = content({showId: 'show-one', version: '1'});
    assert.ok(!('error' in answer));
    const decoded: unknown = JSON.parse(Buffer.from(answer.bytes).toString());
    assert.ok(typeof decoded === 'object' && decoded !== null && 'showId' in decoded && decoded.showId === 'show-one');
    for (const query of [{}, {showId: '../show', version: '1'}, {showId: 'show-one', version: '01'}, {showId: 'show-one', version: '1', extra: 'x'}]) {
      const reply = content(query); assert.equal('error' in reply && reply.error.code, 'invalid-request');
    }
    const absent = content({showId: 'show-missing', version: '1'}); assert.equal('error' in absent && absent.error.code, 'not-found');
    const controller = new AbortController(); controller.abort();
    const aborted = content({showId: 'show-one', version: '1'}, controller.signal); assert.equal('error' in aborted && aborted.error.code, 'cancelled');
    assert.deepEqual(world.query('SELECT total_changes()'), before);
    db.exec("UPDATE nanoleaf_show_catalog SET revision=-1");
    const result = await world.operator.sync(['nanoleaf-shows'], () => {}, {owner: NANOLEAF_OWNER, timeoutMs: 1000});
    assert.equal(result.status === 'rejected' && result.error.error.code, 'invalid-state');
    const device = await world.operator.sync(['device'], () => {}, {owner: NANOLEAF_OWNER, timeoutMs: 1000});
    assert.equal(device.status, 'synced'); if (device.status === 'synced') await device.copy.close();
    assert.equal(world.query('SELECT revision FROM nanoleaf_show_catalog')[0]?.[0], -1);
    world.verifyMessages();
  });

  test('publication failure after commit retains one save and only core acknowledgment forgets its outcome', async context => {
    const world = await ModuleWorld.open(context); await world.start();
    world.refuseShowPublication = true;
    assert.equal((await request(world, 'show-deferred')).status, 'accepted');
    assert.equal(world.query('SELECT version FROM nanoleaf_show_versions').length, 1);
    assert.equal(world.outcomes('show-deferred').length, 0, 'publication has not succeeded');
    const waiting = world.query("SELECT message FROM bunny_outbox WHERE routing_key LIKE '%nanoleaf-show%' ORDER BY seq");
    assert.equal(waiting.length, 2, 'catalog and outcome remain committed');
    world.refuseShowPublication = false;
    await world.restart();
    const outcome = world.outcomes('show-deferred')[0]; assert.ok(outcome !== undefined);
    assert.equal(world.query('SELECT version FROM nanoleaf_show_versions').length, 1);
    assert.equal(JSON.stringify(outcome), waiting[1]?.[0], 'restart publishes the exact committed identity and trace');
    const forged = acknowledgmentOf(outcome);
    await world.operator.publish(forged.key, forged.draft); await world.advance(0);
    assert.equal(world.query("SELECT id FROM bunny_outbox WHERE kind='outcome'").length, 1, 'another sender cannot discard evidence');
    await world.core.recordOutcome(outcome); await world.advance(0);
    assert.equal(world.query("SELECT id FROM bunny_outbox WHERE kind='outcome'").length, 0);
    assert.equal(world.query('SELECT version FROM nanoleaf_show_versions').length, 1);
    assert.deepEqual(world.invalid, ['org.bunny.outcome.recorded: invalid-message envelope /source not the core'], 'only the deliberately forged acknowledgment is invalid');
    assert.deepEqual(world.harnesses.flatMap(harness => harness.failures), []);
  });

  test('a full store refuses with capacity and preserves earlier versions', async context => {
    const world = await ModuleWorld.open(context); await world.start(); await request(world, 'show-before-full');
    const db = world.harness.moduleDatabase(); assert.ok(db !== undefined);
    const before = showCatalog(db), original = readShowVersion(db, 'show-one', 1);
    db.exec('PRAGMA journal_mode = DELETE; PRAGMA page_size = 512; VACUUM; PRAGMA journal_mode = WAL');
    const pages = world.query('PRAGMA page_count')[0]?.[0]; assert.equal(typeof pages, 'number');
    db.exec(`PRAGMA max_page_count = ${String(pages)}`);
    const large = data('show-full', 1);
    large.timeline = {version: 1, durationMs: 30000, cues: Array.from({length: 200}, (_, index) => ({id: `cue-${String(index)}`, offsetMs: index * 100, durationMs: 100, recipe: {preset: 'ocean'}, intensity: 0.5}))};
    try {
      const result = await world.request('bunny.cmd.nanoleaf-show-save.shows', {type: NANOLEAF_FAMILIES.showSave.type, subject: 'shows', dataschema: schemaOf('nanoleaf-show-save'), data: large});
      assert.equal(result.status === 'rejected' && result.error.error.code, 'capacity');
    } finally {db.exec('PRAGMA max_page_count = 1073741823');}
    assert.deepEqual(showCatalog(db), before); assert.deepEqual(readShowVersion(db, 'show-one', 1), original);
    assert.equal(world.outcomes('show-full').length, 0); world.verifyMessages();
  });

  test('an expired queued request cannot create a version', async context => {
    const world = await ModuleWorld.open(context); await world.start();
    const pending = world.operator.request('bunny.cmd.nanoleaf-show-save.shows', {type: NANOLEAF_FAMILIES.showSave.type,
      subject: 'shows', dataschema: schemaOf('nanoleaf-show-save'), data: data('show-expired')}, {requestId: 'show-expired', timeoutMs: 1});
    world.clock.advance(2); await world.advance(0);
    const result = await pending;
    assert.equal(result.status === 'rejected' && result.error.error.code, 'expired');
    assert.equal(world.query('SELECT version FROM nanoleaf_show_versions').length, 0);
    assert.equal(world.outcomes('show-expired').length, 0); world.verifyMessages();
  });
});
