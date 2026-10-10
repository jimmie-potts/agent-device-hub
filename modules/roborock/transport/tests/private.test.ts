import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, chmod, symlink, rm, stat, mkdir, link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {SdkError} from '@jimmie-potts/sdk';
import {loadPrivateConfig, loadPrivateSession, savePrivateSession, validateConfig, type Config, type Session} from '../src/transport/private.js';
const config: Config = {schemaVersion: 1, deviceId: 'synthetic-robot', address: '192.168.10.20', broker: 'mqtts://mqtt-us.roborock.com:8883', region: 'us'};
const session: Session = {schemaVersion: 1, deviceId: config.deviceId, model: 'roborock.vacuum.a97', protocol: '1.0', localKey: '0123456789abcdef', rriot: {u: 'synthetic-user', s: 'sentinel-auth-secret', k: 'sentinel-auth-key'}, broker: config.broker};
const safe = (error: unknown): boolean => error instanceof SdkError && !JSON.stringify(error.body).includes('sentinel');
async function directory(): Promise<string> { return mkdtemp(join(tmpdir(), 'roborock-private-test-')); }
void test('loads exact private target and atomically saves only the reusable session fields', async () => {
  const dir = await directory();
  try {
    const target = join(dir, 'config.json'); const credentials = join(dir, 'session.json');
    await writeFile(target, JSON.stringify(config), {mode: 0o600});
    assert.deepEqual(await loadPrivateConfig(target), config);
    await savePrivateSession(credentials, session);
    assert.deepEqual(await loadPrivateSession(credentials, config), session);
    assert.equal((await stat(credentials)).mode & 0o777, 0o600);
    const changed: Session = {...session, rriot: {...session.rriot, s: 'replacement-secret'}};
    await savePrivateSession(credentials, changed);
    assert.deepEqual(await loadPrivateSession(credentials, config), changed);
  } finally { await rm(dir, {recursive: true, force: true}); }
});
void test('refuses unsafe modes, symlinks, oversized files, target mismatch and additional secret fields', async () => {
  const dir = await directory();
  try {
    const file = join(dir, 'session.json');
    await writeFile(file, JSON.stringify(session), {mode: 0o644});
    await assert.rejects(async () => loadPrivateSession(file, config), safe);
    await chmod(file, 0o600);
    const link = join(dir, 'linked.json'); await symlink(file, link);
    await assert.rejects(async () => loadPrivateSession(link, config), safe);
    await assert.rejects(async () => loadPrivateSession(file, {...config, deviceId: 'different'}), safe);
    await writeFile(file, JSON.stringify({...session, token: 'sentinel-token'}));
    await assert.rejects(async () => loadPrivateSession(file, config), safe);
    await writeFile(file, ' '.repeat(65537));
    await assert.rejects(async () => loadPrivateSession(file, config), safe);
    await chmod(dir, 0o755);
    await assert.rejects(async () => loadPrivateSession(file, config), safe);
  } finally { await rm(dir, {recursive: true, force: true}); }
});
void test('failed replacement preserves the previous valid private session', async () => {
  const dir = await directory();
  try {
    const file = join(dir, 'session.json'); await writeFile(file, JSON.stringify(session), {mode: 0o600});
    await assert.rejects(async () => savePrivateSession(file, {...session, localKey: 'bad'}), safe);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')) as unknown, session);
  } finally { await rm(dir, {recursive: true, force: true}); }
});

void test('private identifiers, keys and endpoints refuse trailing newlines before any persistence', async () => {
  const dir = await directory();
  try {
    const file = join(dir, 'session.json');
    for (const changed of [
      {...session, deviceId: `${session.deviceId}\n`},
      {...session, localKey: `${session.localKey}\n`},
      {...session, broker: `${session.broker}\n`},
      {...session, rriot: {...session.rriot, s: `${session.rriot.s}\n`}},
    ]) await assert.rejects(savePrivateSession(file, changed), safe);
  } finally {await rm(dir, {recursive: true, force: true});}
});

void test('Git markers, symlink ancestors and hard-linked sessions are refused', async () => {
  const dir = await directory();
  try {
    const privateDir = join(dir, 'private'); await mkdir(privateDir, {mode: 0o700});
    const file = join(privateDir, 'session.json'); await writeFile(file, JSON.stringify(session), {mode: 0o600});
    const alias = join(dir, 'alias'); await symlink(privateDir, alias);
    await assert.rejects(loadPrivateSession(join(alias, 'session.json'), config), safe);
    await link(file, join(privateDir, 'hardlink.json'));
    await assert.rejects(loadPrivateSession(file, config), safe);
    await rm(join(privateDir, 'hardlink.json'));
    await writeFile(join(dir, '.git'), 'gitdir: synthetic', {mode: 0o600});
    await assert.rejects(loadPrivateSession(file, config), safe);
    assert.throws(() => validateConfig({...config, address: '8.8.8.8'}), safe);
    assert.throws(() => validateConfig({...config, broker: 'mqtts://roborock.com.attacker.invalid:8883'}), safe);
    assert.throws(() => validateConfig({...config, address: '192.168.1.1\n'}), safe);
  } finally {await rm(dir, {recursive: true, force: true});}
});
