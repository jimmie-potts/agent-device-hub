import assert from 'node:assert/strict';
import {connectState, initialize} from '../src/database.js';
import {first, rows, transaction} from '../src/sqlite.js';
import {initShows, readShowVersion, saveShow, showCatalog, ShowFailure} from '../src/music-shows.js';
import {SHOW_LIMITS} from '../src/music-show-data.js';
import {suite, temporary, test} from './support.js';

const plan = () => ({version: 1, durationMs: 2000, cues: [
  {id: 'first', offsetMs: 0, durationMs: 1000, recipe: {preset: 'ocean'}, intensity: 0.5},
]});
const draft = (showId = 'show-one', expectedVersion = 0) => ({showId, expectedVersion, name: 'Ocean study', versionName: 'First draft', timeline: plan()});
const refused = (code: ShowFailure['code']) => (error: unknown): boolean => error instanceof ShowFailure && error.code === code;

suite('private decorative show versions', () => {
  test('a save freezes recipes, appends an immutable version and survives reopen', context => {
    const directory = temporary(context);
    let db = connectState(directory);
    initShows(db);
    const initial = transaction(db, () => saveShow(db, draft(), 100));
    assert.equal(initial.version, 1);
    assert.equal(initial.kind, 'decorative');
    assert.equal(initial.timeline.cues[0]?.recipe.pattern, 'wave');
    assert.ok(!JSON.stringify(initial).includes('preset'));
    const original = readShowVersion(db, 'show-one', 1);
    const second = {...draft('show-one', 1), versionName: 'Quieter', timeline: {...plan(), cues: [{...plan().cues[0], intensity: 0.2}]}};
    transaction(db, () => saveShow(db, second, 101));
    assert.deepEqual(readShowVersion(db, 'show-one', 1), original);
    assert.equal(showCatalog(db).shows[0]?.version, 2);
    db.close(); db = connectState(directory);
    try {
      assert.deepEqual(readShowVersion(db, 'show-one', 1), original);
      assert.equal(readShowVersion(db, 'show-one', 2).versionName, 'Quieter');
      assert.deepEqual(showCatalog(db).shows[0]?.versions.map(version => version.version), [1, 2]);
    } finally {db.close();}
  });

  test('stale saves, malformed plans and identities leave the entire catalog unchanged', context => {
    const db = connectState(temporary(context)); context.after(() => db.close());
    transaction(db, () => saveShow(db, draft(), 100));
    const before = showCatalog(db), original = readShowVersion(db, 'show-one', 1);
    assert.throws(() => transaction(db, () => saveShow(db, draft(), 101)), refused('revision-conflict'));
    for (const input of [
      {...draft('show-one', 1), name: '  '}, {...draft('show-one', 1), versionName: 'a\u0000b'},
      {...draft('show-one', 1), showId: '../show'}, {...draft('show-one', 1), expectedVersion: 1.5},
      {...draft('show-one', 1), extra: true}, {...draft('show-one', 1), timeline: {...plan(), cues: [...plan().cues, ...plan().cues]}},
      {...draft('show-one', 1), timeline: {...plan(), cues: [{...plan().cues[0], recipe: {favorite: 'private'}}]}},
    ]) assert.throws(() => transaction(db, () => saveShow(db, input, 101)), refused('invalid-request'));
    assert.deepEqual(showCatalog(db), before);
    assert.deepEqual(readShowVersion(db, 'show-one', 1), original);
  });

  test('library count and total version caps refuse without pruning', context => {
    const db = connectState(temporary(context)); context.after(() => db.close());
    for (let index = 0; index < SHOW_LIMITS.shows; index++) transaction(db, () => saveShow(db, draft(`show-${String(index)}`), index + 1));
    assert.throws(() => transaction(db, () => saveShow(db, draft('show-extra'), 1000)), refused('capacity'));
    for (let index = SHOW_LIMITS.shows; index < SHOW_LIMITS.versions; index++) {
      transaction(db, () => saveShow(db, draft('show-0', index - SHOW_LIMITS.shows + 1), index + 1));
    }
    const before = showCatalog(db);
    assert.throws(() => transaction(db, () => saveShow(db, draft('show-0', SHOW_LIMITS.versions - SHOW_LIMITS.shows + 1), 1000)), refused('capacity'));
    assert.equal(rows(db, 'SELECT version FROM nanoleaf_show_versions').length, SHOW_LIMITS.versions);
    assert.equal(readShowVersion(db, 'show-0', 1).version, 1);
    assert.deepEqual(showCatalog(db), before);
  });

  test('failure after the version insert rolls back head, version and catalog together', context => {
    const db = connectState(temporary(context)); context.after(() => db.close());
    transaction(db, () => saveShow(db, draft(), 100));
    const before = showCatalog(db);
    db.exec("CREATE TRIGGER reject_show_head BEFORE UPDATE ON nanoleaf_shows BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END");
    assert.throws(() => transaction(db, () => saveShow(db, draft('show-one', 1), 101)));
    assert.deepEqual(showCatalog(db), before);
    assert.equal(rows(db, 'SELECT version FROM nanoleaf_show_versions').length, 1);
  });

  test('additive initialization preserves earlier tables and is idempotent', context => {
    const db = connectState(temporary(context)); context.after(() => db.close());
    db.exec("DROP TABLE nanoleaf_shows; DROP TABLE nanoleaf_show_versions; DROP TABLE nanoleaf_show_catalog; INSERT INTO animation_favorites VALUES ('synthetic', '{}'); INSERT INTO meta VALUES ('synthetic-preserved', 'yes')");
    const before = {favorites: rows(db, 'SELECT * FROM animation_favorites'), meta: rows(db, 'SELECT * FROM meta')};
    initialize(db); initialize(db);
    assert.deepEqual({favorites: rows(db, 'SELECT * FROM animation_favorites'), meta: rows(db, 'SELECT * FROM meta')}, before);
    assert.deepEqual(showCatalog(db), {id: 'shows', revision: 0, shows: []});
  });

  test('exact stored JSON bytes are bounded and corrupted versions remain untouched', context => {
    const db = connectState(temporary(context)); context.after(() => db.close());
    const saved = transaction(db, () => saveShow(db, {...draft(), name: '😀'.repeat(80)}, 100));
    const encoded = JSON.stringify(saved);
    assert.deepEqual(first(db, 'SELECT body,length(CAST(body AS BLOB)) FROM nanoleaf_show_versions'), [encoded, Buffer.byteLength(encoded)]);
    for (const corrupt of ['{', JSON.stringify({...saved, kind: 'recording'}), JSON.stringify({...saved, timeline: {...saved.timeline, version: 2}}), 'x'.repeat(SHOW_LIMITS.versionBytes + 1)]) {
      db.prepare('UPDATE nanoleaf_show_versions SET body=?').run(corrupt);
      assert.throws(() => readShowVersion(db, 'show-one', 1), refused('invalid-state'));
      assert.equal(first(db, 'SELECT body FROM nanoleaf_show_versions')?.[0], corrupt);
    }
    assert.throws(() => readShowVersion(db, 'show-missing', 1), refused('not-found'));
    for (const version of [0, -1, 1.5, Infinity, 257]) assert.throws(() => readShowVersion(db, 'show-one', version), refused('invalid-request'));
  });
});
