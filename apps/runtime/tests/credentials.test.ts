// The edge's credentials file and its writers (Hub #835): one credential per ID and per source, none acting as the
// runtime's own sources or the browser sessions', and grants and revocations that never lose each other's change, never
// overwrite a change made meanwhile, and leave nothing behind when a writer crashed. The file holds digests only.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {
  CREDENTIALS_SCHEMA, RuntimeError, grantCredential, parseCredentials, readEdgeCredentials, revokeCredential, tokenDigest, writeEdgeCredentials,
  type EdgeCredential,
} from '../src/index.js';
import {edgeConfig, it} from './support.js';

const credential = (id: string, source = `bunny/parts/${id}`): EdgeCredential =>
  ({id, source, digest: tokenDigest(`tok_SYNTHETIC835_${id}`), scopes: ['ingest'], devices: []});
const codeOf = (error: unknown): string => error instanceof RuntimeError ? error.code : `threw ${String(error)}`;
const ids = async (file: string): Promise<string[]> => (await readEdgeCredentials(file)).map(entry => entry.id).sort();

it('a credentials file gives each credential its own ID, digest and source, never one of the runtime\'s or the browser sessions\'', () => {
  const document = (credentials: unknown[]): unknown => ({schema: CREDENTIALS_SCHEMA, credentials});
  assert.doesNotThrow(() => parseCredentials(document([credential('a'), credential('b')])));
  assert.throws(() => parseCredentials(document([credential('a'), credential('b', 'bunny/parts/a')])), (error: unknown) => codeOf(error) === 'edge-credentials-invalid',
    'two credentials, one source');
  for (const source of ['bunny/parts/dashboard', 'bunny/core', 'bunny/modules/sign', 'bunny/runtime/gateway']) {
    assert.throws(() => parseCredentials(document([credential('a', source)])), (error: unknown) => codeOf(error) === 'edge-credential-source', source);
  }
});

it('a grant adds a credential once, and refuses one whose ID or source another owner holds; a rotation revokes first', async context => {
  const {credentials: file} = await edgeConfig(context, []);
  const hook = credential('hub-0123456789abcdef0123456789abcdef');
  await grantCredential(file, hook);
  await grantCredential(file, hook);
  assert.deepEqual(await ids(file), [hook.id], 'granting the same credential again changes nothing');
  await assert.rejects(grantCredential(file, {...hook, digest: tokenDigest('tok_SYNTHETIC835_other')}), (error: unknown) => codeOf(error) === 'edge-credential-conflict',
    'the same ID with another token belongs to another owner');
  await assert.rejects(grantCredential(file, {...hook, scopes: ['read', 'ingest']}), (error: unknown) => codeOf(error) === 'edge-credential-conflict', 'or other scopes');
  await assert.rejects(grantCredential(file, {...credential('other'), source: hook.source}), (error: unknown) => codeOf(error) === 'edge-credential-conflict',
    'another ID acting as its source');
  const rotated = {...hook, digest: tokenDigest('tok_SYNTHETIC835_rotated')};
  assert.equal(await revokeCredential(file, hook.id), true);
  await grantCredential(file, rotated);
  assert.deepEqual((await readEdgeCredentials(file)).map(entry => entry.digest), [rotated.digest]);
  assert.equal((await readFile(file, 'utf8')).includes('tok_SYNTHETIC835'), false, 'the file holds digests only');
});

it('grants and revocations made at once in one process each take effect, one after another', async context => {
  const {credentials: file} = await edgeConfig(context, []);
  await writeEdgeCredentials(file, [credential('a'), credential('b'), credential('c')]);
  await Promise.all([
    grantCredential(file, credential('d')), revokeCredential(file, 'a'), grantCredential(file, credential('e')), revokeCredential(file, 'c'),
    grantCredential(file, credential('f')),
  ]);
  assert.deepEqual(await ids(file), ['b', 'd', 'e', 'f'], 'no change lost another');
});

it('a change made to the file while a writer rewrote it refuses the write with configuration-changed, and changes nothing', async context => {
  const {credentials: file} = await edgeConfig(context, []);
  await writeEdgeCredentials(file, [credential('a')]);
  const meanwhile = JSON.stringify({schema: CREDENTIALS_SCHEMA, credentials: [credential('a'), credential('hand')]});
  await assert.rejects(grantCredential(file, credential('b'), {beforeReplace: () => writeFile(file, meanwhile, {mode: 0o600})}),
    (error: unknown) => codeOf(error) === 'configuration-changed');
  assert.deepEqual(await ids(file), ['a', 'hand'], 'the change made meanwhile stands');
  await assert.rejects(revokeCredential(file, 'a', {beforeReplace: () => writeFile(file, meanwhile.replace('"hand"', '"edit"'), {mode: 0o600})}),
    (error: unknown) => codeOf(error) === 'configuration-changed');
  assert.deepEqual(await ids(file), ['a', 'edit']);
});

it('a writer in another process holds the file; a lock or temporary file a crashed writer left is taken over', async context => {
  const {credentials: file, dir} = await edgeConfig(context, []);
  await writeEdgeCredentials(file, [credential('a')]);
  // A live process holds the lock: the grant is refused, and the file is unchanged.
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], {stdio: 'ignore'});
  context.after(() => { holder.kill('SIGKILL'); });
  await writeFile(`${file}.lock`, `${String(holder.pid)}\n`, {mode: 0o600});
  await assert.rejects(grantCredential(file, credential('b')), (error: unknown) => codeOf(error) === 'edge-credentials-busy');
  assert.deepEqual(await ids(file), ['a']);
  // Once that process has gone, its lock is a crashed writer's, as is a temporary file beside the credentials.
  holder.kill('SIGKILL');
  await once(holder, 'exit');
  await writeFile(join(dir, '.edge-credentials.json.stale.tmp'), 'partial', {mode: 0o600});
  await grantCredential(file, credential('b'));
  assert.deepEqual(await ids(file), ['a', 'b']);
  assert.deepEqual((await readdir(dir)).filter(name => name.endsWith('.tmp') || name.endsWith('.lock')), [], 'nothing left behind');
});

it('a writer removes only the lock it created, never one another writer holds when it finishes', async context => {
  const {credentials: file} = await edgeConfig(context, []);
  await writeEdgeCredentials(file, [credential('a')]);
  const other = `${String(process.pid)} another-writer\n`;
  // While this writer holds the lock, the lock comes to be another writer's, as after a takeover it lost.
  await grantCredential(file, credential('b'), {beforeReplace: () => writeFile(`${file}.lock`, other, {mode: 0o600})});
  assert.equal(await readFile(`${file}.lock`, 'utf8'), other, 'the other writer\'s lock stands');
  assert.deepEqual(await ids(file), ['a', 'b']);
});
