import assert from 'node:assert/strict';
import {chmod, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {loadPlaybackConfiguration} from '../src/playback-configuration.js';
import {runPlayback} from '../src/playback-cli.js';

void test('playback configuration requires separate private schema and declared local library scope', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'music-playback-config-'));
  try {
    const path = join(directory, 'config.json'), tokenFile = join(directory, 'token');
    await writeFile(tokenFile, 'synthetic-playback-token\n', {mode: 0o600});
    const config = {schema: 'music-playback-producer/1.0', edgeOrigin: 'http://127.0.0.1:8790', tokenFile, helper: '/synthetic/music-playback', libraryScopeId: 'synthetic-library'};
    await writeFile(path, JSON.stringify(config), {mode: 0o600}); assert.deepEqual(await loadPlaybackConfiguration(path), {...config, token: 'synthetic-playback-token'});
    await chmod(tokenFile, 0o644); await assert.rejects(loadPlaybackConfiguration(path)); await chmod(tokenFile, 0o600);
    for (const invalid of [{...config, schema: 'music-producer/1.0'}, {...config, source: 'bunny/core'}, {...config, libraryScopeId: ''}, {...config, edgeOrigin: 'http://127.0.0.1/a'}]) {
      await writeFile(path, JSON.stringify(invalid)); await assert.rejects(loadPlaybackConfiguration(path));
    }
    const link = join(directory, 'link'); await symlink(path, link); await assert.rejects(loadPlaybackConfiguration(link));
  } finally {await rm(directory, {recursive: true, force: true});}
});
void test('playback CLI requires explicit observation selection before configuration or native work', async () => {
  await assert.rejects(runPlayback([])); await assert.rejects(runPlayback(['--config', '/not-opened']));
  await assert.rejects(runPlayback(['--config', '/not-opened', '--capture']));
});
