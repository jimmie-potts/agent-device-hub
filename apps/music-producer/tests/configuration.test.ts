import assert from 'node:assert/strict';
import {mkdtemp, writeFile, chmod, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {loadConfiguration} from '../src/configuration.js';

void test('private configuration selects only an origin, opaque token and explicit helper', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'music-config-'));
  const file = join(directory, 'config.json'), tokenFile = join(directory, 'token');
  const data = {schema: 'music-producer/1.0', edgeOrigin: 'http://127.0.0.1:8790', tokenFile, helper: '/private/helper'};
  const config = async (value: object): Promise<void> => {await writeFile(file, JSON.stringify(value), {mode: 0o600});};
  try {
    await writeFile(tokenFile, 'synthetic-credential-1234567890123456\n', {mode: 0o600});
    await config(data);
    assert.deepEqual(await loadConfiguration(file), {...data, token: 'synthetic-credential-1234567890123456'});
    for (const bad of [{...data, source: 'bunny/core'}, {...data, helper: 'relative'}, {...data, tokenFile: 'relative'},
      {...data, edgeOrigin: 'https://name:secret@example.com'}, {...data, edgeOrigin: 'https://example.com/path'},
      {...data, edgeOrigin: 'https://example.com?token=x'}, {...data, edgeOrigin: 'file:///private/file'}]) {
      await config(bad); await assert.rejects(loadConfiguration(file), /Music producer configuration is invalid\./);
    }
    await config(data); await chmod(file, 0o644);
    await assert.rejects(loadConfiguration(file), /Music producer configuration is invalid\./);
    await chmod(file, 0o600); await chmod(tokenFile, 0o644);
    await assert.rejects(loadConfiguration(file), /Music producer configuration is invalid\./);
    await chmod(tokenFile, 0o600); await writeFile(tokenFile, 'x'.repeat(513));
    await assert.rejects(loadConfiguration(file), /Music producer configuration is invalid\./);
    await writeFile(tokenFile, 'synthetic\nembedded\ncredential');
    await assert.rejects(loadConfiguration(file), /Music producer configuration is invalid\./);
    const link = join(directory, 'symlink'); await symlink(file, link);
    await assert.rejects(loadConfiguration(link), /Music producer configuration is invalid\./);
    await writeFile(file, ' '.repeat(8193));
    await assert.rejects(loadConfiguration(file), /Music producer configuration is invalid\./);
  } finally {await rm(directory, {recursive: true, force: true});}
});
