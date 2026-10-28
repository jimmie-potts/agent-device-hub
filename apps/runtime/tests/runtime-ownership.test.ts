import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {test, type TestContext} from 'node:test';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError, type ModuleContext} from '@jimmie-potts/sdk';
import {admitBoundCoreOwnership, bindCoreRuntimeOwnership, createCoreModule} from '../src/core/core.js';
import {takeLock} from '../src/core/store.js';
import {acquireRuntimeOwnership, borrowRuntimeOwnership, type RuntimeOwnership} from '../src/runtime-ownership.js';
import {startRuntime} from '../src/runtime.js';

async function fixture(t: TestContext): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bunny-runtime-ownership-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'modules'), {mode: 0o700});
  await writeFile(join(root, 'modules', 'core.sqlite-owner'), '', {mode: 0o600, flag: 'wx'});
  return root;
}
function safe(error: unknown): boolean {
  assert.ok(error instanceof SdkError);
  assert.deepEqual(error.body, errorBody('unavailable', {detail: 'runtime data ownership is unavailable'}));
  assert.equal(error.cause, undefined);
  return true;
}
const leaseModule = new URL('../src/core/store.js', import.meta.url).href;
function competitor(root: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `const {takeLock}=await import(${JSON.stringify(leaseModule)}); try { const lock=await takeLock(process.argv[1],AbortSignal.abort());lock.release();process.exitCode=0; } catch { process.exitCode=1; }`, join(root, 'modules', 'core.sqlite')], {stdio: 'ignore'});
    child.once('error', reject); child.once('close', resolve);
  });
}
function message(child: ChildProcess, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {cleanup(); reject(new Error(`fixture timeout: ${expected}`));}, 15_000);
    const cleanup = (): void => {clearTimeout(timeout); child.off('message', received); child.off('exit', exited);};
    const received = (value: unknown): void => {if (value === expected) {cleanup(); resolve();}};
    const exited = (): void => {cleanup(); reject(new Error('fixture exited early'));};
    child.on('message', received); child.once('exit', exited);
  });
}
void test('missing lease refuses without creating bootstrap metadata', async t => {
  const root = await fixture(t);
  await rm(join(root, 'modules', 'core.sqlite-owner'));
  await assert.rejects(acquireRuntimeOwnership(root), safe);
  assert.deepEqual(await readdir(join(root, 'modules')), []);
});
void test('existing-only acquisition rejects unsafe bootstrap without repair', async t => {
  for (const kind of ['missing-root', 'missing-modules', 'public-root', 'public-modules', 'public-lease', 'hardlink', 'root-link', 'module-link', 'lease-link', 'directory']) {
    await t.test(kind, async tt => {
      const root = await fixture(tt), modules = join(root, 'modules'), lease = join(modules, 'core.sqlite-owner');
      let input = root;
      if (kind === 'missing-root') input = join(root, 'absent');
      if (kind === 'missing-modules') await rm(modules, {recursive: true});
      if (kind === 'public-root') await chmod(root, 0o755);
      if (kind === 'public-modules') await chmod(modules, 0o755);
      if (kind === 'public-lease') await chmod(lease, 0o644);
      if (kind === 'hardlink') await link(lease, join(root, 'alias'));
      if (kind === 'root-link') {input = `${root}-link`; await symlink(root, input); tt.after(() => rm(input));}
      if (kind === 'module-link') {await rename(modules, join(root, 'other')); await symlink('other', modules);}
      if (kind === 'lease-link') {await rename(lease, join(modules, 'other')); await symlink('other', lease);}
      if (kind === 'directory') {await rm(lease); await mkdir(lease, {mode: 0o700});}
      const before = await lstat(lease).catch(() => undefined);
      await assert.rejects(acquireRuntimeOwnership(input), safe);
      const after = await lstat(lease).catch(() => undefined);
      assert.equal(after?.ino, before?.ino); assert.equal(after?.mode, before?.mode);
      if (kind === 'missing-root') await assert.rejects(lstat(input), {code: 'ENOENT'});
    });
  }
});
void test('real exclusive lease interoperates with old tools, including same-process contention', async t => {
  const root = await fixture(t), path = join(root, 'modules', 'core.sqlite-owner');
  const before = await lstat(path), bytes = await readFile(path);
  const owner = await acquireRuntimeOwnership(root); t.after(() => owner.releaseBeforeStartup());
  assert.equal(await competitor(root), 1);
  await assert.rejects(acquireRuntimeOwnership(root), safe);
  await assert.rejects(takeLock(join(root, 'modules', 'core.sqlite'), AbortSignal.abort()));
  assert.equal(await competitor(root), 1, 'same-process contenders must not drop the POSIX lock');
  owner.releaseBeforeStartup(); owner.releaseBeforeStartup();
  assert.equal(await competitor(root), 0);
  assert.equal((await lstat(path)).ino, before.ino); assert.deepEqual(await readFile(path), bytes);
  const legacy = await takeLock(join(root, 'modules', 'core.sqlite'), AbortSignal.abort());
  try {await assert.rejects(acquireRuntimeOwnership(root), safe);} finally {legacy.release();}
});
void test('forged, released, copied and cross-core capabilities cannot confer ownership', async t => {
  const root = await fixture(t), core = createCoreModule();
  assert.throws(() => bindCoreRuntimeOwnership(core, {} as RuntimeOwnership), safe);
  const released = await acquireRuntimeOwnership(root); released.releaseBeforeStartup();
  assert.throws(() => bindCoreRuntimeOwnership(core, released), safe);
  const owner = await acquireRuntimeOwnership(root);
  assert.throws(() => bindCoreRuntimeOwnership({...core}, owner), safe);
  bindCoreRuntimeOwnership(core, owner);
  assert.throws(() => bindCoreRuntimeOwnership(createCoreModule(), owner), safe);
  assert.throws(() => bindCoreRuntimeOwnership(core, owner), safe);
  assert.throws(() => owner.releaseBeforeStartup(), safe);
  assert.throws(() => core.start({} as ModuleContext), safe, 'direct start before admission refuses before accessing context');
  await admitBoundCoreOwnership([core], root);
  assert.throws(() => borrowRuntimeOwnership({token: owner, core: {}}, join(root, 'modules', 'core.sqlite')), safe);
  assert.throws(() => borrowRuntimeOwnership({token: owner, core}, join(root, 'wrong.sqlite')), safe);
  const borrowed = borrowRuntimeOwnership({token: owner, core}, join(root, 'modules', 'core.sqlite'));
  borrowed.release();
  assert.throws(() => borrowRuntimeOwnership({token: owner, core}, join(root, 'modules', 'core.sqlite')), safe);
  assert.equal(await competitor(root), 1);
});
void test('wrong state path and changed identity refuse before preparation, spans, logs or modules', async t => {
  for (const kind of ['wrong-path', 'lease-replaced', 'modules-replaced', 'root-mode']) await t.test(kind, async tt => {
    const root = await fixture(tt), core = createCoreModule(), owner = await acquireRuntimeOwnership(root);
    bindCoreRuntimeOwnership(core, owner);
    const input = kind === 'wrong-path' ? join(root, 'absent') : root;
    if (kind === 'lease-replaced') {const path = join(root, 'modules', 'core.sqlite-owner'); await rename(path, `${path}-old`); await writeFile(path, '', {mode: 0o600});}
    if (kind === 'modules-replaced') {await rename(join(root, 'modules'), join(root, 'old')); await mkdir(join(root, 'modules'), {mode: 0o700}); await writeFile(join(root, 'modules', 'core.sqlite-owner'), '', {mode: 0o600});}
    if (kind === 'root-mode') await chmod(root, 0o755);
    const before = await readdir(root); let effects = 0;
    const options = {stateDir: input, port: 0, modules: [core, {manifest: {name: 'probe', apiVersion: '1.3'}, start: () => {effects++;}, stop: () => {}}], spans: 'state-file' as const, log: () => {effects++;}};
    await assert.rejects(startRuntime(options), safe);
    await assert.rejects(startRuntime(options), safe, 'failed admission cannot be reused');
    assert.equal(effects, 0); assert.deepEqual(await readdir(root), before);
    if (kind === 'wrong-path') await assert.rejects(lstat(input), {code: 'ENOENT'});
  });
});
void test('process ownership outlives core/host teardown, concurrent startup, late work and GC', async t => {
  for (const mode of ['normal', 'concurrent', 'core-failure', 'late-start', 'late-stop', 'timer']) await t.test(mode, async tt => {
    const root = await fixture(tt);
    const child = spawn(process.execPath, ['--expose-gc', fileURLToPath(new URL('./fixtures/runtime-ownership-child.js', import.meta.url)), root, mode], {stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
    let stderr = ''; child.stderr?.on('data', (value: Buffer) => {stderr += value.toString();});
    const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
    tt.after(async () => {child.kill('SIGKILL'); await closed;});
    await message(child, 'stopped').catch(error => {throw new Error(stderr, {cause: error});});
    assert.equal(await competitor(root), 1, 'host.stop and GC must retain the real transaction');
    if (mode.startsWith('late-') || mode === 'timer') {
      const finished = message(child, 'late-finished'); child.send('continue'); await finished;
      assert.equal(await readFile(join(root, 'late-effect'), 'utf8'), 'synthetic');
      assert.equal(await competitor(root), 1, 'late callback actually ran under retained exclusion');
    }
    child.kill('SIGKILL'); await closed;
    assert.equal(await competitor(root), 0, 'only terminal process exit releases ownership');
  });
});

void test('discarded bound capabilities retain the actual lease through garbage collection', async t => {
  const root = await fixture(t);
  const module = new URL('../src/runtime-ownership.js', import.meta.url).href;
  const coreModule = new URL('../src/core/core.js', import.meta.url).href;
  const script = `const {acquireRuntimeOwnership}=await import(${JSON.stringify(module)}); const {createCoreModule,bindCoreRuntimeOwnership}=await import(${JSON.stringify(coreModule)}); await (async()=>{const owner=await acquireRuntimeOwnership(process.argv[1]);bindCoreRuntimeOwnership(createCoreModule(),owner);})(); for(let i=0;i<30;i++){global.gc();await new Promise(r=>setTimeout(r,5));} process.send('held');setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['--expose-gc', '--input-type=module', '-e', script, root], {stdio: ['ignore', 'ignore', 'ignore', 'ipc']});
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  t.after(async () => {child.kill('SIGKILL'); await closed;});
  await message(child, 'held');
  assert.equal(await competitor(root), 1);
  child.kill('SIGKILL'); await closed;
  assert.equal(await competitor(root), 0);
});

void test('legacy alternate paths cannot open and close the retained lease inode', async t => {
  for (const kind of ['dot', 'directory-link', 'renamed', 'hardlink']) await t.test(kind, async tt => {
    const root = await fixture(tt), lease = join(root, 'modules', 'core.sqlite-owner');
    const owner = await acquireRuntimeOwnership(root); tt.after(() => owner.releaseBeforeStartup());
    let path = root + '/modules/./core.sqlite';
    if (kind === 'directory-link') {await symlink('modules', join(root, 'alias')); path = join(root, 'alias', 'core.sqlite');}
    if (kind === 'renamed') {await rename(lease, join(root, 'modules', 'moved.sqlite-owner')); path = join(root, 'modules', 'moved.sqlite');}
    if (kind === 'hardlink') {await link(lease, join(root, 'modules', 'alias.sqlite-owner')); path = join(root, 'modules', 'alias.sqlite');}
    await assert.rejects(takeLock(path, AbortSignal.abort()));
    // Restore the namespace, then prove the original kernel lock still excludes a separate process.
    if (kind === 'renamed') await rename(join(root, 'modules', 'moved.sqlite-owner'), lease);
    if (kind === 'hardlink') await rm(join(root, 'modules', 'alias.sqlite-owner'));
    assert.equal(await competitor(root), 1);
    owner.releaseBeforeStartup(); assert.equal(await competitor(root), 0);
  });
});
void test('strict bootstrap refuses nonempty SQLite and every recovery sidecar without changing bytes', async t => {
  for (const kind of ['database', '-journal', '-wal', '-shm']) await t.test(kind, async tt => {
    const root = await fixture(tt), path = join(root, 'modules', 'core.sqlite-owner');
    if (kind === 'database') {
      const db = new DatabaseSync(path); db.exec('PRAGMA journal_mode=WAL;CREATE TABLE unexpected(value);INSERT INTO unexpected VALUES(1)'); db.close();
    } else await writeFile(path + kind, 'synthetic', {mode: 0o600});
    const before = await readFile(path), files = await readdir(join(root, 'modules'));
    await assert.rejects(acquireRuntimeOwnership(root), safe);
    assert.deepEqual(await readFile(path), before); assert.deepEqual(await readdir(join(root, 'modules')), files);
    if (kind !== 'database') assert.equal(await readFile(path + kind, 'utf8'), 'synthetic');
  });
});
void test('copies of a bound core cannot silently take the unbound runtime path', async t => {
  const root = await fixture(t), core = createCoreModule(), owner = await acquireRuntimeOwnership(root);
  bindCoreRuntimeOwnership(core, owner);
  const wrong = join(root, 'absent'); let effects = 0;
  await assert.rejects(startRuntime({stateDir: wrong, port: 0, modules: [{...core}], spans: 'state-file', log: () => {effects++;}}), safe);
  await assert.rejects(lstat(wrong), {code: 'ENOENT'}); assert.equal(effects, 0);
  // The rejected copy did not reserve or damage the intended original's admission.
  await admitBoundCoreOwnership([core], root);
  assert.equal(await competitor(root), 1);
});
