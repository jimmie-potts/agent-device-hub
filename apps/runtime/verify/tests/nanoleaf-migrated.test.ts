// Hub #933: the `nanoleaf-migrated` run, which migrates a synthetic Nanoleaf bridge state into its state directory and
// configuration before the shipped runtime starts on them, as the installer will at the cutover. The Nanoleaf module runs
// on the migrated store with the converted section, serves the migrated preferences, and the migration tool refuses the
// run's state directory while its runtime holds the lease.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {SYNTHETIC_TOKEN} from '@jimmie-potts/nanoleaf';
import {HEALTH_PATH, NANOLEAF_MIGRATION_EXIT, runNanoleafMigration, type RuntimeHealth} from '../../src/index.js';
import {nanoleafMigrationArgs} from '../../tests/scenarios/modules/nanoleaf.js';
import {migrationOf, partTokensOf} from '../seed.js';
import {base, startRun} from './support.js';

type Line = {result: string; code?: string; counts?: Record<string, number>; mismatches?: {total: number}; digest?: unknown};
type Wall = {id: string; mode: string; settings: Record<string, unknown>; palette: Record<string, string>; projects: {id: string; color: string}[]};

void test('the nanoleaf-migrated run serves the migrated preferences, and the tool refuses its running runtime', {timeout: 120_000}, async context => {
  const run = await startRun(context, await base(context), 'nanoleaf-migrated');
  try {
    const migrated = JSON.parse(await readFile(join(migrationOf(run.dataDir), 'nanoleaf-migrate.json'), 'utf8')) as Line;
    const verified = JSON.parse(await readFile(join(migrationOf(run.dataDir), 'nanoleaf-verify.json'), 'utf8')) as Line;
    assert.deepEqual([migrated.result, verified.result, verified.mismatches?.total], ['migrated', 'verified', 0]);
    assert.deepEqual(verified.digest, migrated.digest);
    assert.equal(migrated.counts?.devices, 2);

    const health = await (await fetch(new URL(HEALTH_PATH, run.url))).json() as RuntimeHealth;
    assert.equal(health.modules.find(module => module.name === 'nanoleaf')?.state, 'running', 'the module runs on the converted section and its secrets');

    const {reader} = JSON.parse(await readFile(partTokensOf(run.dataDir), 'utf8')) as {reader: string};
    const read = async <T>(family: string): Promise<T[]> => {
      const response = await fetch(new URL(`/api/v2/families/${family}`, run.url), {headers: {authorization: `Bearer ${reader}`}});
      assert.equal(response.status, 200, family);
      const text = await response.text();
      assert.ok(!text.includes(SYNTHETIC_TOKEN), 'no record holds the token');
      return (JSON.parse(text) as {records: T[]}).records;
    };
    const walls = await read<Wall>('nanoleaf-wall');
    const wall = walls.find(record => record.id === 'wall');
    assert.ok(wall !== undefined);
    assert.deepEqual(wall.settings, {style: 'project', coverage: 'status', rotation: 90, flipX: 1, flipY: 0});
    assert.deepEqual([wall.palette.working, wall.palette.unread], ['#11aa22', '#cc33ff']);
    assert.deepEqual(wall.projects.map(project => [project.id, project.color]), [['project-alpha', '#aa55ff'], ['project-beta', '#123456'], ['project-gamma', '#00aa88']]);
    assert.deepEqual([wall.mode, walls.find(record => record.id === 'panels')?.mode], ['work', 'quiet']);
    const animations = await read<{id: string; favorites: {name: string}[]}>('nanoleaf-animations');
    assert.deepEqual(animations.find(record => record.id === 'wall')?.favorites.map(favorite => favorite.name), ['Marker Favorite Calm', 'Marker Favorite Wave']);

    let text = '';
    const exit = await runNanoleafMigration(nanoleafMigrationArgs('verify', run.dataDir), {write: line => { text += line; }});
    assert.deepEqual([exit, (JSON.parse(text) as Line).code], [NANOLEAF_MIGRATION_EXIT.refused, 'runtime-running']);
  } finally {
    await run.stop();
  }
});
