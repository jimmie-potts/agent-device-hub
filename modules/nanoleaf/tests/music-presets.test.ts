import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {connectState, initialize} from '../src/database.js';
import {REACTIVE_LIMITS, REACTIVE_TARGET} from '../src/music-preset-data.js';
import {prepareReactiveSave, readReactiveCatalog, saveReactivePreset, ReactiveFailure} from '../src/music-presets.js';
import {freezeMusicRecipe, MUSIC_DIRECTIONS} from '../src/music-recipe-data.js';
import {DIRECTIONS} from '../src/effects.js';
import {readShowVersion, saveShow} from '../src/music-shows.js';
import {execute, first, rows, transaction} from '../src/sqlite.js';
import {FIXTURES, suite, temporary, test} from './support.js';

const recipe = () => ({rendererVersion: 1, effect: 'traveling-wave', palette: ['#ABCDEF'], intensity: 0.2, direction: 'counterclockwise', periodMs: 6000});
const draft = (presetId = 'preset-one', expectedRevision = 0) => ({presetId, expectedRevision, name: 'Synthetic ocean', recipe: recipe()});
const refused = (code: ReactiveFailure['code']) => (error: unknown): boolean => error instanceof ReactiveFailure && error.code === code;

suite('private frozen reactive recipes', () => {
  test('every V1 effect freezes defaults and explicit fields, copies input and survives reopen', context => {
    const directory = temporary(context); let db = connectState(directory);
    const effects = ['level-glow', 'bass-pulse', 'spectrum', 'traveling-wave', 'ambient'];
    let revision = 0;
    for (const effect of effects) {
      const input = {rendererVersion: 1, effect, palette: ['#ABCDEF']};
      const saved = transaction(db, () => saveReactivePreset(db, {...draft(`preset-${effect}`, revision), recipe: input}, revision + 1));
      input.palette[0] = '#000000'; revision++;
      assert.equal(saved.recipe.palette[0], '#abcdef'); assert.equal(saved.recipe.sensitivity, 1);
      assert.equal(saved.recipe.smoothingMs, effect === 'ambient' ? 1500 : 100);
      assert.ok(Object.isFrozen(saved.recipe) && Object.isFrozen(saved.recipe.palette));
    }
    const before = readReactiveCatalog(db); db.close(); db = connectState(directory);
    try {assert.deepEqual(readReactiveCatalog(db), before);} finally {db.close();}
    assert.deepEqual(MUSIC_DIRECTIONS, DIRECTIONS);
  });

  test('closed recipe and command parameters refuse before modifying earlier presets', context => {
    const db = connectState(temporary(context)); context.after(() => db.close());
    transaction(db, () => saveReactivePreset(db, draft(), 1)); const before = readReactiveCatalog(db);
    for (const input of [
      {...draft('preset-two', 1), audio: []}, {...draft('preset-two', 1), name: '  '}, {...draft('preset-two', 1), name: '\u0000'},
      {...draft('../preset', 1)}, {...draft('preset-two', 1), expectedRevision: 1.1},
      ...[{rendererVersion: 2}, {effect: 'unknown'}, {palette: []}, {intensity: 1.01}, {sensitivity: 0}, {smoothingMs: 2001},
        {direction: 'diagonal'}, {periodMs: 399}, {noiseGate: 0.1}, {calibration: 1}, {rawAudio: 'synthetic'}, {halfLifeMs: 150}]
        .map(patch => ({...draft('preset-two', 1), recipe: {...recipe(), ...patch}})),
    ]) assert.throws(() => transaction(db, () => saveReactivePreset(db, input, 2)), refused('invalid-request'));
    assert.throws(() => transaction(db, () => saveReactivePreset(db, draft('preset-two', 0), 2)), refused('revision-conflict'));
    assert.throws(() => transaction(db, () => saveReactivePreset(db, draft('preset-one', 1), 2)), refused('revision-conflict'));
    assert.deepEqual(readReactiveCatalog(db), before);
    assert.throws(() => saveReactivePreset(db, draft(), 2), /owner transaction/);
    assert.equal(prepareReactiveSave(draft()).recipe.intensity, 0.2);
  });

  test('maximal catalog remains bounded and capacity never removes previous presets', context => {
    const db = connectState(temporary(context)); context.after(() => db.close());
    for (let index = 0; index < REACTIVE_LIMITS.presets; index++) transaction(db, () => saveReactivePreset(db, {
      ...draft(`preset-${'a'.repeat(54)}-${String(index)}`, index), name: '😀'.repeat(80),
      recipe: {...recipe(), palette: Array.from({length: 8}, () => '#ffffff'), intensity: 0.9999999999999999,
        sensitivity: 7.999999999999999, smoothingMs: 1999.9999999999998, periodMs: 9999.999999999998},
    }, index + 1));
    const before = readReactiveCatalog(db);
    const encoded = Buffer.byteLength(JSON.stringify(before), 'utf8'); assert.ok(encoded <= REACTIVE_LIMITS.catalogBytes);
    assert.ok(rows(db, 'SELECT length(CAST(body AS BLOB)) FROM nanoleaf_reactive_presets').every(row => typeof row[0] === 'number' && row[0] <= REACTIVE_LIMITS.documentBytes));
    assert.throws(() => transaction(db, () => saveReactivePreset(db, draft('preset-overflow', 32), 33)), refused('capacity'));
    assert.deepEqual(readReactiveCatalog(db), before);
  });

  test('a genuine previous-source schema gains only empty additive tables and preserves favorites/shows', context => {
    const directory = temporary(context), db = new DatabaseSync(join(directory, 'status.sqlite'));
    context.after(() => db.close());
    db.exec(readFileSync(join(FIXTURES, 'reactive-presets/prior-d7-schema.sql'), 'utf8'));
    db.exec("INSERT INTO meta VALUES ('model_version','4'); INSERT INTO animation_favorites VALUES ('synthetic','{}')");
    transaction(db, () => saveShow(db, {showId: 'show-before', expectedVersion: 0, name: 'Before', versionName: 'First',
      timeline: {version: 1, durationMs: 1000, cues: [{id: 'cue', offsetMs: 0, durationMs: 1000, recipe: {preset: 'ocean'}}]}}, 5));
    const before = {favorites: rows(db, 'SELECT * FROM animation_favorites'), shows: rows(db, 'SELECT * FROM nanoleaf_show_versions'),
      show: readShowVersion(db, 'show-before', 1)};
    assert.equal(first(db, "SELECT 1 FROM sqlite_master WHERE name='nanoleaf_reactive_presets'"), undefined);
    initialize(db); initialize(db);
    assert.deepEqual({favorites: rows(db, 'SELECT * FROM animation_favorites'), shows: rows(db, 'SELECT * FROM nanoleaf_show_versions'),
      show: readShowVersion(db, 'show-before', 1)}, before);
    assert.deepEqual(readReactiveCatalog(db), {id: REACTIVE_TARGET, revision: 0, presets: []});
  });

  test('catalog insertion failure rolls back and corrupted stored bytes are preserved', context => {
    const db = connectState(temporary(context)); context.after(() => db.close());
    const saved = transaction(db, () => saveReactivePreset(db, draft(), 1));
    const before = readReactiveCatalog(db);
    db.exec("CREATE TRIGGER reject_reactive BEFORE UPDATE ON nanoleaf_reactive_catalog BEGIN SELECT RAISE(ABORT,'synthetic'); END");
    assert.throws(() => transaction(db, () => saveReactivePreset(db, draft('preset-two', 1), 2)));
    assert.deepEqual(readReactiveCatalog(db), before); db.exec('DROP TRIGGER reject_reactive');
    for (const corrupt of ['{', JSON.stringify({...saved, recipe: {rendererVersion: 1, effect: 'ambient', palette: ['#fffaaa']}}),
      JSON.stringify({...saved, presetId: 'preset-other'}), 'x'.repeat(REACTIVE_LIMITS.documentBytes + 1)]) {
      execute(db, 'UPDATE nanoleaf_reactive_presets SET body=?', corrupt);
      assert.throws(() => readReactiveCatalog(db), refused('invalid-state'));
      assert.equal(first(db, 'SELECT body FROM nanoleaf_reactive_presets')?.[0], corrupt);
    }
    execute(db, 'UPDATE nanoleaf_reactive_presets SET body=?', JSON.stringify(saved));
    db.exec('UPDATE nanoleaf_reactive_catalog SET revision=-1');
    assert.throws(() => readReactiveCatalog(db), refused('invalid-state'));
    assert.deepEqual(freezeMusicRecipe(saved.recipe), saved.recipe);
  });
});

test('a fresh process reloads the exact frozen recipe without an audio source', context => {
  const directory = temporary(context), database = new URL('../src/database.js', import.meta.url).href;
  const store = new URL('../src/music-presets.js', import.meta.url).href, sqlite = new URL('../src/sqlite.js', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import {connectState} from ${JSON.stringify(database)};
    import {saveReactivePreset} from ${JSON.stringify(store)};
    import {transaction} from ${JSON.stringify(sqlite)};
    const db=connectState(process.argv[1]);
    transaction(db,()=>saveReactivePreset(db,${JSON.stringify(draft())},1)); db.close();
  `, directory], {encoding: 'utf8'});
  assert.equal(child.status, 0, child.stderr);
  const db = connectState(directory); context.after(() => db.close());
  assert.deepEqual(readReactiveCatalog(db).presets[0]?.recipe, freezeMusicRecipe(recipe()));
});

test('failed previous-schema initialization rolls back and leaves earlier data available', context => {
  const directory = temporary(context), db = new DatabaseSync(join(directory, 'status.sqlite')); context.after(() => db.close());
  db.exec(readFileSync(join(FIXTURES, 'reactive-presets/prior-d7-schema.sql'), 'utf8'));
  db.exec("INSERT INTO meta VALUES ('model_version','4'); INSERT INTO animation_favorites VALUES ('preserved','{}')");
  const before = rows(db, 'SELECT * FROM animation_favorites');
  db.exec('PRAGMA page_size=512; VACUUM');
  const pages = first(db, 'PRAGMA page_count')?.[0]; assert.equal(typeof pages, 'number');
  db.exec(`PRAGMA max_page_count=${String(pages)}`);
  assert.throws(() => initialize(db), error => error instanceof Error && 'errcode' in error && error.errcode === 13);
  assert.equal(db.isTransaction, false); assert.deepEqual(rows(db, 'SELECT * FROM animation_favorites'), before);
  assert.equal(first(db, "SELECT 1 FROM sqlite_master WHERE name='nanoleaf_reactive_presets'"), undefined);
  db.exec('PRAGMA max_page_count=1073741823'); initialize(db);
  assert.deepEqual(readReactiveCatalog(db), {id: REACTIVE_TARGET, revision: 0, presets: []});
  assert.deepEqual(rows(db, 'SELECT * FROM animation_favorites'), before);
});
