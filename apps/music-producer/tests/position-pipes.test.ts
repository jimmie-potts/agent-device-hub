import assert from 'node:assert/strict';
import {chmod, copyFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {MusicPositionReader, positionLauncher} from '../src/position.js';

void test('actual child pipes deliver synthetic complete and partial reads, then exit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bunny-position-pipes-'));
  try {
    for (const mode of ['sample', 'partial']) {
      const helper = join(directory, mode);
      await copyFile(new URL('../../tests/position-child.mjs', import.meta.url), helper); await chmod(helper, 0o700);
      let exited = false;
      const reader = new MusicPositionReader({helper, launch: () => {
        const child = positionLauncher(helper)(); child.onExit(() => {exited = true;}); return child;
      }});
      const result = await reader.read(); assert.ok(result.status === 'sample'); assert.equal(exited, true);
      assert.equal(result.sample.position.status, mode === 'partial' ? 'unavailable' : 'observed');
    }
  } finally {await rm(directory, {recursive: true, force: true});}
});

void test('actual hanging synthetic children are killed after cancellation or deadline without retry', {timeout: 10_000}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bunny-position-stop-'));
  try {
    for (const mode of ['hang-cancel', 'hang-timeout']) {
      const helper = join(directory, mode);
      await copyFile(new URL('../../tests/position-child.mjs', import.meta.url), helper); await chmod(helper, 0o700);
      const controller = new AbortController(); let launches = 0, exited = false;
      const reader = new MusicPositionReader({helper, launch: () => {
        launches += 1; const child = positionLauncher(helper)(); child.onExit(() => {exited = true;});
        if (mode === 'hang-cancel') child.stdout.once('data', () => controller.abort());
        return child;
      }});
      const result = await reader.read({signal: controller.signal});
      assert.ok(result.status === 'unavailable'); assert.equal(result.error.code, mode === 'hang-cancel' ? 'cancelled' : 'unavailable');
      assert.equal(exited, true); assert.equal(launches, 1);
    }
  } finally {await rm(directory, {recursive: true, force: true});}
});
