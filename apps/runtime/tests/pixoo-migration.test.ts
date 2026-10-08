// The Pixoo library migration's command-line tool (Hub #931), as the installer (#935) runs it: its exit codes and JSON
// lines, its refusals of a running runtime, a short disk and a module that already has files, its removal of what it
// wrote when it fails or is interrupted, a full disk on a real file system, and the runtime's lease that it holds while
// it runs.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {writeFileSync} from 'node:fs';
import {chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, before} from 'node:test';
import {fileURLToPath} from 'node:url';
import {InstalledLibrary, writeSyntheticLibrary, type SyntheticLibrary} from '@jimmie-potts/pixoo';
import {holdRuntimeLease} from '../src/lease.js';
import {DEFAULT_MIN_FREE_BYTES, EXIT, runPixooMigration, spaceNeeded, type PixooMigrationOptions} from '../src/pixoo-migration.js';
import {it, stateDir, waitFor} from './support.js';

const MAIN = fileURLToPath(new URL('../src/main.js', import.meta.url));
const ENTRY = fileURLToPath(new URL('../src/migrate-pixoo.js', import.meta.url));
const FULL_DISK = fileURLToPath(new URL('./fixtures/pixoo-full-disk.js', import.meta.url));

let root: string;
let library: string;
let synthetic: SyntheticLibrary;

before(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pixoo-migration-cli-')));
  library = join(root, 'library');
  synthetic = await writeSyntheticLibrary(library);
});
after(() => rm(root, {recursive: true, force: true}));

type Line = {schema: string; operation: string; result: string; code?: string; message?: string; destination?: string; mismatches?: {total: number; files: number}; counts?: {assets: number}};

/** Runs the tool in this process, returning its exit code and its one line. */
async function tool(argv: readonly string[], options: Omit<PixooMigrationOptions, 'write'> = {}): Promise<{exit: number; line: Line; text: string}> {
  const lines: string[] = [];
  const exit = await runPixooMigration(argv, {...options, write: line => { lines.push(line); }});
  assert.equal(lines.length, 1, 'one line');
  const [text = ''] = lines;
  assert.ok(text.endsWith('\n'));
  return {exit, line: JSON.parse(text) as Line, text};
}

const args = (operation: string, state: string, source = library, ...rest: string[]): string[] => [operation, '--library', source, '--state-dir', state, ...rest];

async function absent(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch {
    return true;
  }
}

/** Whether the Pixoo module has no files in the state directory: no database, log, journal or folder. */
async function untouched(state: string): Promise<boolean> {
  for (const name of ['pixoo.sqlite', 'pixoo.sqlite-wal', 'pixoo.sqlite-journal', 'pixoo.sqlite-shm', 'pixoo']) if (!await absent(join(state, 'modules', name))) return false;
  return true;
}

/** Free space as the file system would report it, with 4 KiB blocks. */
const room = (freeBytes: number): NonNullable<PixooMigrationOptions['freeSpace']> => () => Promise.resolve({freeBytes, blockSize: 4096});
const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });

/** Starts the shipped runtime on `dir` and waits for its ready line. */
async function startRuntime(dir: string): Promise<{stop: () => Promise<void>}> {
  const child = spawn(process.execPath, [MAIN, '--port', '0', '--state-dir', dir], {stdio: ['ignore', 'pipe', 'ignore']});
  let stdout = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  const exited = once(child, 'exit');
  await waitFor(() => stdout.includes('\n'), 15_000, 'the ready line');
  return {stop: async () => {
    child.kill('SIGTERM');
    await exited;
  }};
}

it('migrates and verifies, each with one JSON line of counts and hashes and exit 0', async context => {
  const state = join(await stateDir(context), 'state');
  const migrated = await tool(args('migrate', state));
  assert.equal(migrated.exit, EXIT.ok);
  assert.deepEqual([migrated.line.schema, migrated.line.operation, migrated.line.result], ['pixoo-migration/1.0', 'migrate', 'migrated']);
  assert.equal(migrated.line.counts?.assets, synthetic.assets);
  const verified = await tool(args('verify', state));
  assert.equal(verified.exit, EXIT.ok);
  assert.equal(verified.line.result, 'verified');
  assert.equal(verified.line.mismatches?.total, 0);
  // Counts, codes and hashes only: no path, and no asset or playlist name.
  for (const {text} of [migrated, verified]) {
    for (const leak of [root, state, ...synthetic.names]) assert.ok(!text.includes(leak), 'the line holds a path or a name');
  }
  // The module's files are private, as the runtime creates them.
  assert.equal((await lstat(join(state, 'modules', 'pixoo.sqlite'))).mode & 0o777, 0o600);
  assert.equal((await lstat(join(state, 'modules', 'pixoo'))).mode & 0o777, 0o700);
  assert.ok(await absent(join(state, 'modules', 'pixoo.sqlite-wal')), 'the database closed cleanly');
});

it('the entry point prints the line and exits with the code', async context => {
  const state = join(await stateDir(context), 'state');
  const child = spawn(process.execPath, [ENTRY, ...args('migrate', state)], {stdio: ['ignore', 'pipe', 'pipe']});
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  const [code] = await once(child, 'exit') as [number | null];
  assert.equal(code, EXIT.ok, stderr);
  assert.equal(stderr, '');
  assert.equal((JSON.parse(stdout) as Line).result, 'migrated');
  const bad = spawn(process.execPath, [ENTRY, 'copy'], {stdio: ['ignore', 'pipe', 'ignore']});
  const [usage] = await once(bad, 'exit') as [number | null];
  assert.equal(usage, EXIT.usage);
});

it('refuses malformed arguments with exit 2', async context => {
  const state = join(await stateDir(context), 'state');
  for (const argv of [[], ['copy'], ['migrate'], ['migrate', '--library', 'relative', '--state-dir', state], args('migrate', state, library, '--extra'),
    args('migrate', state, library, '--min-free-bytes', '-1'), args('verify', state, library, '--min-free-bytes', '1')]) {
    const {exit, line} = await tool(argv);
    assert.deepEqual([exit, line.result, line.code], [EXIT.usage, 'refused', 'usage'], JSON.stringify(argv));
  }
  assert.ok(await untouched(state));
});

it('refuses while a runtime runs on the state directory, and a runtime that starts while it runs cannot take the lease', async context => {
  const dir = await stateDir(context);
  const runtime = await startRuntime(dir);
  try {
    for (const operation of ['migrate', 'verify']) {
      const {exit, line} = await tool(args(operation, dir));
      assert.deepEqual([exit, line.result, line.code], [EXIT.refused, 'refused', 'runtime-running'], operation);
    }
    assert.ok(await untouched(dir));
  } finally {
    await runtime.stop();
  }
  // Once the runtime has stopped, the migration runs.
  assert.equal((await tool(args('migrate', dir))).exit, EXIT.ok);
  const runtimeAgain = await startRuntime(dir);
  try {
    const {exit, line} = await tool(args('verify', dir));
    assert.deepEqual([exit, line.code], [EXIT.refused, 'runtime-running']);
  } finally {
    await runtimeAgain.stop();
  }

  // The reverse: while the tool holds the lease, a runtime's core waits for it until its deadline and fails.
  const lease = await holdRuntimeLease(dir);
  try {
    const child = spawn(process.execPath, [MAIN, '--port', '0', '--state-dir', dir], {stdio: ['ignore', 'pipe', 'pipe']});
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    const [code] = await once(child, 'exit') as [number | null];
    assert.equal(code, 1);
    assert.match(stderr, /"error\.code":"core-failed"/);
  } finally {
    lease.release();
  }
});

it('refuses a short disk before writing anything, counting the space to keep free, and creates nothing', async context => {
  const state = join(await stateDir(context), 'state');
  const {exit, line} = await tool(args('migrate', state), {freeSpace: room(DEFAULT_MIN_FREE_BYTES)});
  assert.deepEqual([exit, line.result, line.code], [EXIT.refused, 'refused', 'disk-short']);
  assert.ok(await absent(state), 'a refusal creates no state directory');
  // `--min-free-bytes` raises the space kept free past what the real file system has.
  const huge = await tool(args('migrate', state, library, '--min-free-bytes', String(Number.MAX_SAFE_INTEGER)));
  assert.deepEqual([huge.exit, huge.line.code], [EXIT.refused, 'disk-short']);
  assert.ok(await absent(state));
  // In a state directory that exists without a runtime's lease file, a refusal creates no `modules` folder either.
  await mkdir(state, {mode: 0o700});
  assert.equal((await tool(args('migrate', state), {freeSpace: room(DEFAULT_MIN_FREE_BYTES)})).line.code, 'disk-short');
  assert.deepEqual(await readdir(state), []);
  // Enough space, and the same arguments migrate.
  assert.equal((await tool(args('migrate', state), {freeSpace: room(DEFAULT_MIN_FREE_BYTES * 2)})).exit, EXIT.ok);
});

it('counts each file in whole blocks, each folder, and the catalog twice, for its file and its log', async context => {
  const installed = await InstalledLibrary.open(library);
  const {bytes} = installed.counts;
  const {catalogBytes} = installed;
  const needed = spaceNeeded(installed, 4096, DEFAULT_MIN_FREE_BYTES);
  installed.close();
  // What the first version counted, the bytes alone: too little, since files take whole blocks and the catalog's log needs room too.
  assert.ok(needed > bytes + catalogBytes + DEFAULT_MIN_FREE_BYTES);
  const state = join(await stateDir(context), 'state');
  for (const freeBytes of [bytes + catalogBytes + DEFAULT_MIN_FREE_BYTES, needed - 1]) {
    const {exit, line} = await tool(args('migrate', state), {freeSpace: room(freeBytes)});
    assert.deepEqual([exit, line.code], [EXIT.refused, 'disk-short'], String(freeBytes));
    assert.ok(await untouched(state));
  }
  assert.equal((await tool(args('migrate', state), {freeSpace: room(needed)})).exit, EXIT.ok);
});

it('refuses a module that already has a database or files, and a verify with nothing to verify', async context => {
  const state = join(await stateDir(context), 'state');
  const nothing = await tool(args('verify', state));
  assert.deepEqual([nothing.exit, nothing.line.code], [EXIT.refused, 'destination-missing']);
  assert.equal((await tool(args('migrate', state))).exit, EXIT.ok);
  const again = await tool(args('migrate', state));
  assert.deepEqual([again.exit, again.line.code], [EXIT.refused, 'destination-not-empty']);
  // The refusal names every path the tool creates, so an operator can remove them all.
  for (const name of ['pixoo.sqlite', 'pixoo.sqlite-wal', 'pixoo.sqlite-shm', 'pixoo.sqlite-journal', 'pixoo/']) assert.ok(again.line.message?.includes(`modules/${name}`) === true, name);
  // The refusal left the earlier migration whole.
  assert.equal((await tool(args('verify', state))).exit, EXIT.ok);
  // A folder with anything in it counts as files, even without a database.
  const other = join(await stateDir(context), 'state');
  await mkdir(join(other, 'modules', 'pixoo'), {recursive: true, mode: 0o700});
  await writeFile(join(other, 'modules', 'pixoo', 'stray'), 'x', {mode: 0o600});
  const stray = await tool(args('migrate', other));
  assert.deepEqual([stray.exit, stray.line.code], [EXIT.refused, 'destination-not-empty']);
});

it('refuses a module folder, or a modules folder, that others may open, and leaves it as it was', async context => {
  for (const folder of ['pixoo', '']) {
    const state = join(await stateDir(context), 'state');
    await mkdir(join(state, 'modules', folder), {recursive: true, mode: 0o700});
    await chmod(join(state, 'modules', folder), 0o755);
    const {exit, line} = await tool(args('migrate', state));
    assert.deepEqual([exit, line.result, line.code], [EXIT.refused, 'refused', 'module-folder-not-private'], folder);
    assert.ok(await absent(join(state, 'modules', 'pixoo.sqlite')), 'no database was created');
    assert.equal((await lstat(join(state, 'modules', folder))).mode & 0o777, 0o755, 'the folder is as it was');
  }
});

it('refuses a source library it cannot carry, naming the code, and writes nothing', async context => {
  const state = join(await stateDir(context), 'state');
  const empty = await mkdtemp(join(root, 'empty-'));
  for (const source of [empty, join(library, 'catalog.sqlite')]) {
    const {exit, line} = await tool(args('migrate', state, source));
    assert.deepEqual([exit, line.code, line.message], [EXIT.refused, 'source-missing', 'The library directory holds no catalog file.']);
    assert.ok(await absent(state), 'a mistyped library creates no state directory');
  }
});

it('removes what it wrote when a file does not match its catalog, and exits 4', async context => {
  const state = join(await stateDir(context), 'state');
  const copy = join(await mkdtemp(join(root, 'copy-')), 'library');
  await cp(library, copy, {recursive: true});
  const [rendition = ''] = await readdir(join(copy, 'media', 'renditions'));
  const frame = join(copy, 'media', 'renditions', rendition, '0.png');
  const bytes = await readFile(frame);
  bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
  await writeFile(frame, bytes);
  const {exit, line} = await tool(args('migrate', state, copy));
  assert.deepEqual([exit, line.result, line.code, line.destination], [EXIT.failed, 'failed', 'source-corrupt', 'removed']);
  assert.ok(await untouched(state));
  // A fresh run of the intact library then migrates into the same state directory.
  assert.equal((await tool(args('migrate', state))).exit, EXIT.ok);
});

it('a copy that fails mid-way stops every copy before it removes what it wrote, so nothing is left once it exits', async context => {
  if (process.getuid?.() === 0) {
    context.skip('a superuser reads a file whatever its mode, so no read can be made to fail here');
    return;
  }
  const copy = join(await mkdtemp(join(root, 'copy-')), 'library');
  await cp(library, copy, {recursive: true});
  // The ninth file the tool reads, with several copies under way, cannot be opened.
  const installed = await InstalledLibrary.open(copy);
  const ninth = installed.files[8]?.path ?? '';
  installed.close();
  await chmod(join(copy, 'media', ninth), 0o000);
  for (let run = 0; run < 5; run += 1) {
    const state = join(await stateDir(context), 'state');
    const {exit, line} = await tool(args('migrate', state, copy));
    assert.deepEqual([exit, line.result, line.code, line.destination], [EXIT.failed, 'failed', 'source-corrupt', 'removed'], `run ${String(run)}`);
    await sleep(200);
    assert.ok(await untouched(state), `run ${String(run)}: nothing is written after the tool has finished`);
  }
});

it('a log left beside the database after its close fails the migration, which removes the database', async context => {
  const state = join(await stateDir(context), 'state');
  const {exit, line} = await tool(args('migrate', state), {close: database => {
    database.close();
    // What a close leaves when its checkpoint cannot finish, as on a full disk: the log, with commits the file lacks.
    writeFileSync(join(state, 'modules', 'pixoo.sqlite-wal'), 'synthetic log');
  }});
  assert.deepEqual([exit, line.result, line.code, line.destination], [EXIT.failed, 'failed', 'destination-not-clean', 'removed']);
  assert.ok(await untouched(state));
});

/** Why this host cannot mount a private tmpfs in a user namespace, or undefined when it can. */
function noTmpfs(): string | undefined {
  const probe = spawnSync('unshare', ['-rm', 'sh', '-c', 'mount -t tmpfs -o size=64k tmpfs /mnt'], {encoding: 'utf8'});
  if (probe.error !== undefined) return `unshare could not run (${probe.error.message}), so no private tmpfs can be mounted`;
  if (probe.status !== 0) return `this host refuses an unprivileged user namespace with a tmpfs mount (unshare -rm exited ${String(probe.status)}: ${probe.stderr.trim()})`;
  return undefined;
}

type FullDiskRun = {sizeKiB: number; exit: number; line: Line; left: string[]; verify?: number};

it('on a real full disk, a migration either verifies or fails disk-short and leaves nothing, whichever step the disk fills at', async context => {
  const reason = noTmpfs();
  if (reason !== undefined) {
    context.skip(reason);
    return;
  }
  const dir = await mkdtemp(join(root, 'full-'));
  // Inside a user and mount namespace, the fixture mounts a private tmpfs of each size and migrates into it, past the
  // free-space check, so the copy, the database or its last checkpoint meets ENOSPC, as #972's full-disk test does.
  const child = spawn('unshare', ['-rm', process.execPath, FULL_DISK, dir, library], {stdio: ['ignore', 'pipe', 'pipe']});
  context.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  const [code] = await once(child, 'exit') as [number | null];
  assert.equal(code, 0, stderr);
  const runs = stdout.split('\n').filter(text => text.startsWith('{')).map(text => JSON.parse(text) as FullDiskRun);
  assert.ok(runs.length > 10, stdout);
  for (const run of runs) {
    if (run.exit === EXIT.ok) {
      assert.deepEqual([run.line.result, run.verify, run.left.filter(name => name !== 'pixoo.sqlite' && name !== 'pixoo')], ['migrated', EXIT.ok, []],
        `${String(run.sizeKiB)} KiB: a migration that reports success verifies, with no log left`);
    } else {
      assert.deepEqual([run.exit, run.line.code, run.line.destination, run.left], [EXIT.failed, 'disk-short', 'removed', []],
        `${String(run.sizeKiB)} KiB: a full disk fails the migration and leaves nothing`);
    }
  }
  assert.ok(runs.some(run => run.exit === EXIT.failed) && runs.some(run => run.exit === EXIT.ok), 'the sizes span the full disk and enough room');
});

it('an interrupt before anything is written is a refusal, and SIGINT or SIGTERM while it writes removes what was written', async context => {
  const state = join(await stateDir(context), 'state');
  const aborted = await tool(args('migrate', state), {signal: AbortSignal.abort()});
  assert.deepEqual([aborted.exit, aborted.line.result, aborted.line.code], [EXIT.refused, 'refused', 'interrupted']);
  assert.ok(await absent(state));
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGINT', 'SIGTERM'] as const) {
    const target = join(await stateDir(context), 'state');
    const child = spawn(process.execPath, [ENTRY, ...args('migrate', target)], {stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    const exited = once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>;
    // Once the database exists, the tool is writing: the copy and the library's own check take a few hundred milliseconds.
    await waitFor(async () => !await absent(join(target, 'modules', 'pixoo.sqlite')) || child.exitCode !== null, 15_000, 'the database');
    child.kill(signal);
    const [code, killed] = await exited;
    const lines = stdout.split('\n').filter(text => text !== '');
    assert.equal(lines.length, 1, `${signal}: one line`);
    const line = JSON.parse(lines[0] ?? '') as Line;
    assert.deepEqual([code, killed, line.result, line.code, line.destination], [EXIT.failed, null, 'failed', 'interrupted', 'removed'], signal);
    await sleep(200);
    assert.deepEqual(await readdir(join(target, 'modules')), ['core.sqlite-owner'], `${signal}: only the runtime's lease file is left`);
  }
});

it('verify exits 1 and counts the mismatch when a copied file changed', async context => {
  const state = join(await stateDir(context), 'state');
  assert.equal((await tool(args('migrate', state))).exit, EXIT.ok);
  const originals = join(state, 'modules', 'pixoo', 'media', 'originals');
  const [original = ''] = await readdir(originals);
  await writeFile(join(originals, original), 'replaced', {mode: 0o600});
  const {exit, line} = await tool(args('verify', state));
  assert.deepEqual([exit, line.result, line.mismatches?.files, line.mismatches?.total], [EXIT.mismatch, 'mismatch', 1, 1]);
});
