import assert from 'node:assert/strict';
import {chmod, copyFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {MusicPlaybackNative, playbackLauncher} from '../src/playback-native.js';
import {sourceInstance} from './playback-fixtures.js';

void test('real synthetic playback pipes qualify clocks and deliver fragmented independent evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'music-playback-pipes-')), helper = join(directory, 'fragmented');
  try {
    await copyFile(new URL('../../tests/fixtures/playback-child.mjs', import.meta.url), helper); await chmod(helper, 0o700);
    const native = new MusicPlaybackNative({helper}); assert.equal(await native.qualifyClock(), true);
    const read = await native.read(); assert.equal(read.status, 'record');
    if (read.status === 'record') {assert.equal(read.record.status, 'sample'); if (read.record.status === 'sample') assert.equal(read.record.position.status, 'observed');}
    const control = await native.control({action: 'pause', expectedSourceInstance: sourceInstance, deadlineMonotonicMs: Number(process.hrtime.bigint()) / 1e6 + 3000});
    assert.equal(control.status, 'record'); if (control.status === 'record') assert.equal(control.record.status, 'sent');
    assert.deepEqual(await native.close(), {status: 'stopped'});
  } finally {await rm(directory, {recursive: true, force: true});}
});
void test('real synthetic child cancellation confirms exit and delayed control evidence is retained', {timeout: 7000}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'music-playback-late-'));
  try {
    const helper = join(directory, 'hang'); await copyFile(new URL('../../tests/fixtures/playback-child.mjs', import.meta.url), helper); await chmod(helper, 0o700);
    const abort = new AbortController(); let exited = false;
    const native = new MusicPlaybackNative({helper, launch: request => {const port = playbackLauncher(helper)(request);
      port.stdout.once('data', () => abort.abort()); port.onExit(() => {exited = true;}); return port;}});
    const read = await native.read({signal: abort.signal}); assert.equal(read.status, 'failure'); assert.equal(read.cleanup, 'confirmed'); assert.equal(exited, true);
    await native.close();
    const lateHelper = join(directory, 'late-control'); await copyFile(new URL('../../tests/fixtures/playback-child.mjs', import.meta.url), lateHelper); await chmod(lateHelper, 0o700);
    const late = new MusicPlaybackNative({helper: lateHelper});
    const result = await late.control({action: 'next', expectedSourceInstance: sourceInstance, deadlineMonotonicMs: Number(process.hrtime.bigint()) / 1e6 + 300});
    assert.equal(result.status, 'record'); if (result.status === 'record') assert.equal(result.record.status, 'sent'); await late.close();
  } finally {await rm(directory, {recursive: true, force: true});}
});
