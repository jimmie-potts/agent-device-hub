// Translated from codex-nanoleaf tests/test_animation_favorites.py: saved animation favorites. Admission, receipts, the
// controller snapshot and the worker's play are not ported, so each edit runs as the integration API ran it: checked,
// then checked again and applied in its own transaction (PORTING.md lists every case and where the rest went).
import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {withState} from '../src/database.js';
import * as effects from '../src/effects.js';
import {Failure, favoriteEdit, favorites, resolveAnimation, validFavoriteEdit, type Favorite, type FavoriteEdit} from '../src/favorites.js';
import {rows} from '../src/sqlite.js';
import {query, setMode, suite, temporary, test, write} from './support.js';

const GROUPS = Array.from({length: 15}, (_, i) => [100 + i * 2, 101 + i * 2]);
const POSITIONS = Array.from({length: 15}, (_, i) => [i * 10, 0]);

/** FavoriteTest: a state directory and the favorite edits the integration API admitted. */
class Favorites {
  readonly directory: string;

  constructor(context: TestContext) {
    this.directory = temporary(context);
  }

  /** An admitted edit: valid, checked at admission, then checked and applied by the worker. */
  edit(command: unknown): void {
    assert.ok(validFavoriteEdit(command), JSON.stringify(command));
    write(this.directory, db => favoriteEdit(db, command));
    write(this.directory, db => favoriteEdit(db, command, true));
  }

  save(name = 'my ripple', recipe: unknown = {pattern: 'wave', colors: ['#123456']}): void {
    this.edit({kind: 'animation.save', name, animation: recipe});
  }

  /** An edit refused at admission with this code, changing nothing. */
  refused(command: FavoriteEdit, code: Failure['code']): void {
    const before = this.list();
    assert.ok(validFavoriteEdit(command), JSON.stringify(command));
    assert.throws(() => write(this.directory, db => favoriteEdit(db, command)), (error: unknown) => error instanceof Failure && error.code === code);
    assert.deepEqual(this.list(), before);
  }

  list(): Favorite[] {
    return withState(this.directory, db => favorites(db));
  }
}

const unsupported = (error: unknown): boolean => error instanceof effects.Rejected && error.code === 'unsupported-capability';

suite('FavoriteTest', () => {
  test('test_save_freezes_recipe_survives_reopen_and_replays', context => {
    // The play through the worker and its receipt move with the worker slice; the resolved recipe's frames are compared.
    const f = new Favorites(context);
    f.save();
    const expected = {pattern: 'wave', colors: ['#123456'], speed: 'medium', direction: 'right', loop: true};
    assert.deepEqual(f.list(), [{name: 'my ripple', animation: expected}]);
    const play = {kind: 'animation.play', favorite: 'my ripple'};
    assert.ok(effects.valid(play));
    const resolved = withState(f.directory, db => resolveAnimation(db, play));
    assert.deepEqual(effects.render(resolved, GROUPS, POSITIONS), effects.render({kind: 'animation.play', ...expected} as effects.ExplicitAnimation, GROUPS, POSITIONS));
  });

  test('test_collision_atomic_rename_delete_bound_and_name_identity', context => {
    const f = new Favorites(context);
    f.save('ripple');
    f.save('Ripple', {preset: 'cozy'});
    for (const command of [{kind: 'animation.save', name: 'ripple', animation: {preset: 'ocean'}},
      {kind: 'animation.rename', name: 'ripple', newName: 'Ripple'}, {kind: 'animation.rename', name: 'ripple', newName: 'ripple'}] as const) {
      f.refused(command, 'revision-conflict');
    }
    f.edit({kind: 'animation.rename', name: 'ripple', newName: 'renamed'});
    assert.deepEqual(f.list().map(item => item.name), ['Ripple', 'renamed']);
    f.edit({kind: 'animation.forget', name: 'renamed'});
    f.refused({kind: 'animation.forget', name: 'missing'}, 'unsupported-capability');
    f.refused({kind: 'animation.rename', name: 'missing', newName: 'available'}, 'unsupported-capability');
    for (let n = 0; n < 31; n += 1) f.save(String(n));
    f.refused({kind: 'animation.save', name: 'overflow', animation: {preset: 'cozy'}}, 'capacity');
    f.edit({kind: 'animation.rename', name: '0', newName: 'at capacity'});
    assert.equal(f.list().length, 32);
    f.edit({kind: 'animation.forget', name: 'at capacity'});
    f.save(' replacement ');
    assert.ok(f.list().some(item => item.name === ' replacement '));
  });

  test('test_preset_defaults_are_frozen_without_snapshot_or_display_mutation', context => {
    // Partly: the controller snapshot and its revision are not ported. The display wake-up must not change.
    const f = new Favorites(context);
    for (const mode of ['work', 'quiet', 'free']) {
      setMode(f.directory, mode);
      const wakeup = query(f.directory, "SELECT value FROM meta WHERE key='event_revision'");
      f.save(mode, {preset: 'cozy'});
      assert.deepEqual(query(f.directory, "SELECT value FROM meta WHERE key='event_revision'"), wakeup, mode);
    }
    const saved = f.list();
    assert.deepEqual(saved[0]?.animation, {...effects.PRESETS.cozy, loop: true});
    // The saved recipe is explicit, so a later change to the preset cannot change it.
    const stored = withState(f.directory, db => rows(db, 'SELECT recipe FROM animation_favorites').map(([recipe]) => String(recipe)));
    assert.ok(stored.every(recipe => !recipe.includes('preset')));
    assert.deepEqual([effects.MAX_FAVORITES, effects.MAX_NAME], [32, 80]);
  });

  test('test_malformed_names_recipes_mixed_selectors_and_bounds_are_rejected', context => {
    // Partly: admission's Free-only rule and request IDs are not ported. The byte bound is checked on a wall too large
    // for the recipe, since the port's MAX_BYTES cannot be patched.
    const f = new Favorites(context);
    for (const name of ['', ' ', '\n', 'a\x00b', 'x'.repeat(81), 'a​b', 17]) {
      for (const command of [{kind: 'animation.save', name, animation: {preset: 'cozy'}}, {kind: 'animation.rename', name: 'old', newName: name},
        {kind: 'animation.forget', name}]) {
        assert.equal(validFavoriteEdit(command), false, JSON.stringify(command));
      }
    }
    for (const recipe of [{}, {favorite: 'other'}, {kind: 'animation.play', preset: 'cozy'}, {preset: 'cozy', speed: 'fast'}, {preset: 'absent'},
      {pattern: 'pulse', colors: ['#ffffff'], direction: 'clockwise'}]) {
      assert.equal(validFavoriteEdit({kind: 'animation.save', name: 'bad', animation: recipe}), false, JSON.stringify(recipe));
    }
    f.save('😀'.repeat(80));
    f.save('bounded');
    for (const extra of [{preset: 'cozy'}, {pattern: 'wave'}, {loop: false}]) {
      assert.equal(effects.valid({kind: 'animation.play', favorite: 'bounded', ...extra}), false, JSON.stringify(extra));
    }
    assert.throws(() => withState(f.directory, db => resolveAnimation(db, {kind: 'animation.play', favorite: 'absent'})), unsupported);
    const huge = Array.from({length: 300}, (_, i) => [1000 + i * 2, 1001 + i * 2]);
    const resolved = withState(f.directory, db => resolveAnimation(db, {kind: 'animation.play', favorite: 'bounded'}));
    assert.throws(() => effects.render(resolved, huge, huge.map((_, i) => [i, 0])),
      (error: unknown) => error instanceof effects.Rejected && error.code === 'capacity');
  });
});

suite('favorite checks the port adds', () => {
  test('a damaged saved recipe cannot be played', context => {
    const f = new Favorites(context);
    write(f.directory, db => db.prepare('INSERT INTO animation_favorites VALUES (?,?)').run('bad', '{"preset":"cozy"}'));
    assert.throws(() => withState(f.directory, db => resolveAnimation(db, {kind: 'animation.play', favorite: 'bad'})), unsupported);
  });
});
