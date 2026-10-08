// The Nanoleaf migration's command-line tool (Hub #933), as the installer (#935) runs it: its exit codes and JSON lines,
// the module's store, folder, secret files and section it writes, its refusals of a running runtime, a destination that
// already has files and a source it cannot carry, its removal of what it wrote when it fails, and its verifier.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chmod, lstat, mkdir, readdir, readFile, realpath, symlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {LINES_ADDRESS, PANELS_ADDRESS, SYNTHETIC_TOKEN, writeSyntheticNanoleafState} from '@jimmie-potts/nanoleaf';
import {holdRuntimeLease} from '../src/lease.js';
import {EventEmitter} from 'node:events';
import {EXIT, runNanoleafMigration, type NanoleafMigrationOptions} from '../src/nanoleaf-migration.js';
import {abortOnSignals} from '../src/signals.js';
import {CONFIG_SCHEMA} from '../src/state.js';
import {it, stateDir, waitFor} from './support.js';

const MAIN = fileURLToPath(new URL('../src/main.js', import.meta.url));
const ENTRY = fileURLToPath(new URL('../src/migrate-nanoleaf.js', import.meta.url));
const INTERRUPT = fileURLToPath(new URL('./fixtures/nanoleaf-interrupt.js', import.meta.url));

type Line = {
  schema: string; operation: string; result: string; code?: string; message?: string; destination?: string;
  counts?: Record<string, number>; leftInBackup?: Record<string, number>; mismatches?: Record<string, number>; digest?: Record<string, string>;
};

/** One test's directories: the bridge's state, the runtime's state, the secrets directory and the section file. */
type Paths = {root: string; source: string; state: string; secrets: string; section: string};

async function paths(context: TestContext, configured = true): Promise<Paths> {
  const root = await realpath(await stateDir(context));
  const source = join(root, 'bridge');
  await mkdir(source, {mode: 0o700});
  await writeSyntheticNanoleafState(source, configured ? {} : {qualifiedSources: null});
  const out = join(root, 'out');
  await mkdir(out, {mode: 0o700});
  return {root, source, state: join(root, 'state'), secrets: join(root, 'secrets'), section: join(out, 'nanoleaf-section.json')};
}

const args = (operation: string, p: Paths, ...rest: string[]): string[] =>
  [operation, '--source', p.source, '--state-dir', p.state, '--secrets-dir', p.secrets, '--section', p.section, ...rest];

/** Runs the tool in this process, returning its exit code and its one line. */
async function tool(argv: readonly string[], extra: Omit<NanoleafMigrationOptions, 'write'> = {}): Promise<{exit: number; line: Line; text: string}> {
  const lines: string[] = [];
  const exit = await runNanoleafMigration(argv, {write: line => { lines.push(line); }, ...extra});
  assert.equal(lines.length, 1, 'one line');
  const [text = ''] = lines;
  assert.ok(text.endsWith('\n'));
  return {exit, line: JSON.parse(text) as Line, text};
}

async function absent(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch {
    return true;
  }
}

/** Whether the tool left nothing: no module database or folder, no secret file and no section. */
async function untouched(p: Paths): Promise<boolean> {
  const secrets = await absent(p.secrets) ? [] : await readdir(p.secrets);
  return await absent(join(p.state, 'modules', 'nanoleaf.sqlite')) && await absent(join(p.state, 'modules', 'nanoleaf')) && secrets.length === 0 &&
    await absent(p.section);
}

/** Whether no refusal created anything: no state directory and no secrets directory. */
const nothingCreated = async (p: Paths): Promise<boolean> => await absent(p.state) && await absent(p.secrets);

const mode = async (path: string): Promise<number> => (await lstat(path)).mode & 0o777;

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
  const p = await paths(context);
  const migrated = await tool(args('migrate', p));
  assert.equal(migrated.exit, EXIT.ok, migrated.text);
  assert.deepEqual([migrated.line.schema, migrated.line.operation, migrated.line.result], ['nanoleaf-migration/1.0', 'migrate', 'migrated']);
  assert.deepEqual(migrated.line.counts, {devices: 2, projects: 3, palette: 2, elements: 5, mapSettings: 2, pendingEdits: 1, favorites: 2, deviceState: 8,
    layouts: 2, scenes: 2, qualifiedSources: 1, codexMetadata: 0, secrets: 2});
  assert.equal(migrated.line.leftInBackup?.bindings, 2);
  const verified = await tool(args('verify', p));
  assert.equal(verified.exit, EXIT.ok, verified.text);
  assert.equal(verified.line.result, 'verified');
  assert.equal(verified.line.mismatches?.total, 0);
  assert.deepEqual(verified.line.digest, migrated.line.digest);
  assert.deepEqual(verified.line.counts, migrated.line.counts);

  // The module's files are private, as the runtime creates them, and the database closed cleanly.
  assert.equal(await mode(join(p.state, 'modules', 'nanoleaf.sqlite')), 0o600);
  assert.equal(await mode(join(p.state, 'modules', 'nanoleaf')), 0o700);
  // Opened as the runtime opens it (#972): WAL with exclusive locking, so no index file, and closed, so no log either.
  const header = await readFile(join(p.state, 'modules', 'nanoleaf.sqlite'));
  assert.deepEqual([header[18], header[19]], [2, 2], 'the file is in WAL mode');
  for (const suffix of ['-wal', '-shm', '-journal']) assert.ok(await absent(join(p.state, 'modules', `nanoleaf.sqlite${suffix}`)), suffix);
  assert.deepEqual((await readdir(join(p.state, 'modules', 'nanoleaf'))).sort(), ['layout.json', 'scene-state.json', 'scene-state.panels.json']);
  // Each token is a private secret file the section names, holding the token alone.
  assert.equal(await mode(p.secrets), 0o700);
  assert.deepEqual((await readdir(p.secrets)).sort(), ['nanoleaf-panels-token', 'nanoleaf-wall-token']);
  for (const name of await readdir(p.secrets)) {
    assert.equal(await mode(join(p.secrets, name)), 0o600, name);
    assert.equal(await readFile(join(p.secrets, name), 'utf8'), SYNTHETIC_TOKEN, name);
  }
  assert.equal(await mode(p.section), 0o600);
  const section = JSON.parse(await readFile(p.section, 'utf8')) as {devices: {id: string; address: string; secret: string}[]; secrets: Record<string, string>};
  assert.deepEqual(section.devices.map(device => [device.id, device.address, device.secret]), [['wall', LINES_ADDRESS, 'wall-token'],
    ['panels', PANELS_ADDRESS, 'panels-token']]);
  assert.deepEqual(section.secrets, {'wall-token': join(p.secrets, 'nanoleaf-wall-token'), 'panels-token': join(p.secrets, 'nanoleaf-panels-token')});
});

it('a second migration of one source into other folders gives the same line', async context => {
  const p = await paths(context);
  const first = await tool(args('migrate', p));
  const q = {...p, state: join(p.root, 'state-2'), secrets: join(p.root, 'secrets-2'), section: join(p.root, 'out-2', 'section.json')};
  const second = await tool(args('migrate', q));
  assert.equal(second.exit, EXIT.ok);
  // The configuration digest names each secret by its file's name, so it does not follow the secrets directory.
  assert.equal(second.text, first.text);
});

it('keeps every token, address, path and name out of its lines, the section and the module\'s store', async context => {
  const p = await paths(context);
  const lines = [await tool(args('migrate', p)), await tool(args('verify', p)), await tool(args('migrate', p))].map(result => result.text);
  for (const marker of [SYNTHETIC_TOKEN, LINES_ADDRESS, PANELS_ADDRESS, 'Marker', p.root, '/home/fixture', 'wall', 'panels', 'project-']) {
    for (const text of lines) assert.ok(!text.includes(marker), `a line holds ${marker}`);
  }
  const stored = [await readFile(p.section, 'utf8'), (await readFile(join(p.state, 'modules', 'nanoleaf.sqlite'))).toString('latin1')];
  for (const name of await readdir(join(p.state, 'modules', 'nanoleaf'))) stored.push(await readFile(join(p.state, 'modules', 'nanoleaf', name), 'utf8'));
  for (const text of stored) assert.ok(!text.includes(SYNTHETIC_TOKEN), 'only the secret files hold the token');
});

it('the entry point prints the line and exits with the code', async context => {
  const p = await paths(context);
  const child = spawn(process.execPath, [ENTRY, ...args('migrate', p)], {stdio: ['ignore', 'pipe', 'pipe']});
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
  const p = await paths(context);
  for (const argv of [[], ['copy'], ['migrate'], args('migrate', p).slice(0, 7), ['migrate', '--source', 'relative', ...args('migrate', p).slice(3)],
    args('migrate', p, '--extra'), [...args('migrate', p).slice(0, 7), '--section', 'relative.json']]) {
    const {exit, line} = await tool(argv);
    assert.deepEqual([exit, line.result, line.code], [EXIT.usage, 'refused', 'usage'], JSON.stringify(argv));
  }
  assert.ok(await nothingCreated(p));
});

it('refuses while a runtime runs on the state directory, and a runtime that starts while it runs cannot take the lease', async context => {
  const p = await paths(context);
  await mkdir(p.state, {mode: 0o700});
  const runtime = await startRuntime(p.state);
  try {
    const migrate = await tool(args('migrate', p));
    assert.deepEqual([migrate.exit, migrate.line.result, migrate.line.code], [EXIT.refused, 'refused', 'runtime-running']);
    // With nothing migrated yet, verify finds no database before it would take the lease.
    const verify = await tool(args('verify', p));
    assert.deepEqual([verify.exit, verify.line.code], [EXIT.refused, 'destination-missing']);
    assert.ok(await untouched(p));
    assert.ok(await absent(p.secrets), 'the lease is refused before the output folders are made');
  } finally {
    await runtime.stop();
  }
  // Once the runtime has stopped, the migration runs.
  assert.equal((await tool(args('migrate', p))).exit, EXIT.ok);
  const again = await startRuntime(p.state);
  try {
    const {exit, line} = await tool(args('verify', p));
    assert.deepEqual([exit, line.code], [EXIT.refused, 'runtime-running']);
  } finally {
    await again.stop();
  }
  // The reverse: while the tool holds the lease, a runtime's core waits for it until its deadline and fails.
  const lease = await holdRuntimeLease(p.state);
  try {
    const child = spawn(process.execPath, [MAIN, '--port', '0', '--state-dir', p.state], {stdio: ['ignore', 'pipe', 'pipe']});
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    const [code] = await once(child, 'exit') as [number | null];
    assert.equal(code, 1);
    assert.match(stderr, /"error\.code":"core-failed"/);
  } finally {
    lease.release();
  }
});

it('refuses a destination that already has files, and a verify with nothing to verify', async context => {
  const p = await paths(context);
  const nothing = await tool(args('verify', p));
  assert.deepEqual([nothing.exit, nothing.line.code], [EXIT.refused, 'destination-missing']);
  assert.equal((await tool(args('migrate', p))).exit, EXIT.ok);
  const again = await tool(args('migrate', p));
  assert.deepEqual([again.exit, again.line.code], [EXIT.refused, 'destination-not-empty']);
  // The refusal left the earlier migration whole.
  assert.equal((await tool(args('verify', p))).exit, EXIT.ok);

  // A stray file in the module's folder, a secret file or a section already there each count, before anything is written.
  for (const plant of [
    async (q: Paths) => {
      await mkdir(join(q.state, 'modules', 'nanoleaf'), {recursive: true, mode: 0o700});
      await writeFile(join(q.state, 'modules', 'nanoleaf', 'stray'), 'x', {mode: 0o600});
    },
    async (q: Paths) => {
      await mkdir(q.secrets, {mode: 0o700});
      await writeFile(join(q.secrets, 'nanoleaf-wall-token'), 'other', {mode: 0o600});
    },
    async (q: Paths) => { await writeFile(q.section, '{}', {mode: 0o600}); },
  ]) {
    const q = await paths(context);
    await plant(q);
    const {exit, line} = await tool(args('migrate', q));
    assert.deepEqual([exit, line.code], [EXIT.refused, 'destination-not-empty']);
    assert.ok(await absent(join(q.state, 'modules', 'nanoleaf.sqlite')));
    assert.ok(await absent(join(q.state, 'modules', 'core.sqlite-owner')), 'refused before the lease');
  }
});

it('refuses a source it cannot carry, naming the code, and writes nothing', async context => {
  const empty = await paths(context);
  const nothing = join(empty.root, 'nothing');
  await mkdir(nothing, {mode: 0o700});
  const {exit, line} = await tool(['migrate', '--source', nothing, ...args('migrate', empty).slice(3)]);
  assert.deepEqual([exit, line.code, line.message], [EXIT.refused, 'source-missing', 'The source directory, its status.sqlite or its config.json is missing.']);
  assert.ok(await nothingCreated(empty), 'a source refusal creates no folder and takes no lease');
  const unconfigured = await paths(context, false);
  const refused = await tool(args('migrate', unconfigured));
  assert.deepEqual([refused.exit, refused.line.code], [EXIT.refused, 'source-not-configured']);
  assert.ok(await nothingCreated(unconfigured));
});

it('refuses a secrets directory or a section folder that others can open', async context => {
  const p = await paths(context);
  await mkdir(p.secrets, {mode: 0o700});
  await chmod(p.secrets, 0o755);
  const secrets = await tool(args('migrate', p));
  assert.deepEqual([secrets.exit, secrets.line.code], [EXIT.refused, 'secrets-dir-refused']);
  await chmod(p.secrets, 0o700);
  await chmod(join(p.root, 'out'), 0o755);
  const section = await tool(args('migrate', p));
  assert.deepEqual([section.exit, section.line.code], [EXIT.refused, 'section-dir-refused']);
  assert.ok(await untouched(p));
  assert.ok(await absent(p.state), 'neither refusal created the state directory or took the lease');
});

it('refuses a modules folder or module folder that others may open or that is a link, before the lease, and leaves it as it was', async context => {
  const cases: [string, (state: string) => Promise<string>][] = [
    ['modules folder open to others', async state => {
      await mkdir(join(state, 'modules'), {recursive: true, mode: 0o700});
      await chmod(join(state, 'modules'), 0o755);
      return join(state, 'modules');
    }],
    ['module folder open to others', async state => {
      await mkdir(join(state, 'modules', 'nanoleaf'), {recursive: true, mode: 0o700});
      await chmod(join(state, 'modules', 'nanoleaf'), 0o750);
      return join(state, 'modules', 'nanoleaf');
    }],
    ['module folder a link', async state => {
      await mkdir(join(state, 'modules'), {recursive: true, mode: 0o700});
      await mkdir(join(state, 'elsewhere'), {mode: 0o700});
      await symlink(join(state, 'elsewhere'), join(state, 'modules', 'nanoleaf'));
      return join(state, 'modules', 'nanoleaf');
    }],
    ['modules folder a link', async state => {
      await mkdir(join(state, 'elsewhere'), {recursive: true, mode: 0o700});
      await symlink(join(state, 'elsewhere'), join(state, 'modules'));
      return join(state, 'modules');
    }],
  ];
  for (const [name, plant] of cases) {
    const p = await paths(context);
    const folder = await plant(p.state);
    const before = await lstat(folder);
    const {exit, line} = await tool(args('migrate', p));
    assert.deepEqual([exit, line.result, line.code, line.message], [EXIT.refused, 'refused', 'module-folder-not-private',
      'The Nanoleaf module\'s folder, or the modules folder, is not a private directory.'], name);
    // Nothing was written, through the link or not: no database, no lease file, no secrets directory and no section.
    assert.ok(await absent(join(p.state, 'modules', 'nanoleaf.sqlite')), name);
    assert.ok(await absent(join(p.state, 'modules', 'core.sqlite-owner')), `${name}: refused before the lease`);
    assert.ok(await absent(p.secrets), name);
    assert.ok(await absent(p.section), name);
    assert.deepEqual(await readdir(join(p.state, 'elsewhere')).catch(() => []), [], `${name}: nothing was made through the link`);
    const after = await lstat(folder);
    assert.deepEqual([after.mode, after.isSymbolicLink()], [before.mode, before.isSymbolicLink()], `${name}: the folder is as it was`);
  }
});

it('removes what it wrote when it fails after writing began, and exits 4', async context => {
  const p = await paths(context);
  // Another process makes a secret file between the checks and the write: the tool fails, removes its own files and keeps that one.
  const {exit, line} = await tool(args('migrate', p), {stage: async name => {
    if (name === 'secrets') await writeFile(join(p.secrets, 'nanoleaf-panels-token'), 'theirs', {mode: 0o600});
  }});
  assert.deepEqual([exit, line.result, line.code, line.destination], [EXIT.failed, 'failed', 'internal', 'removed']);
  assert.ok(await absent(join(p.state, 'modules', 'nanoleaf.sqlite')));
  assert.ok(await absent(join(p.state, 'modules', 'nanoleaf')));
  assert.ok(await absent(p.section));
  assert.deepEqual(await readdir(p.secrets), ['nanoleaf-panels-token']);
  assert.equal(await readFile(join(p.secrets, 'nanoleaf-panels-token'), 'utf8'), 'theirs', 'the other file is not the tool\'s to remove');
});

it('a log left beside the database after its close fails the migration, and nothing is reported migrated', async context => {
  const p = await paths(context);
  // As when the final checkpoint met a full disk: SQLite's close keeps the log without an error.
  const {exit, line} = await tool(args('migrate', p), {stage: async name => {
    if (name === 'closed') await writeFile(join(p.state, 'modules', 'nanoleaf.sqlite-wal'), Buffer.alloc(4096, 1), {mode: 0o600});
  }});
  assert.deepEqual([exit, line.result, line.code, line.destination], [EXIT.failed, 'failed', 'destination-not-clean', 'removed']);
  assert.ok(await untouched(p));
  assert.ok(await absent(join(p.state, 'modules', 'nanoleaf.sqlite-wal')));
});

it('a signal stops a migration: before it writes, nothing is written; once it has written, what it wrote is removed', async context => {
  for (const stage of ['checkpoint', 'closed', 'secrets', 'section'] as const) {
    const p = await paths(context);
    const controller = new AbortController();
    const {exit, line} = await tool(args('migrate', p), {signal: controller.signal, stage: name => {
      if (name === stage) controller.abort();
      return Promise.resolve();
    }});
    assert.deepEqual([exit, line.result, line.code, line.destination], [EXIT.failed, 'failed', 'interrupted', 'removed'], stage);
    assert.ok(await untouched(p), stage);
  }
  const p = await paths(context);
  const before = new AbortController();
  before.abort();
  const early = await tool(args('migrate', p), {signal: before.signal});
  assert.deepEqual([early.exit, early.line.result, early.line.code], [EXIT.refused, 'refused', 'interrupted']);
  assert.ok(await untouched(p));
  // The entry point aborts on the first SIGINT or SIGTERM and then stops listening, so a second signal stops the process at once.
  for (const name of ['SIGINT', 'SIGTERM']) {
    const target = new EventEmitter();
    const signal = abortOnSignals(target);
    assert.equal(signal.aborted, false);
    target.emit(name);
    assert.equal(signal.aborted, true, name);
    assert.deepEqual([target.listenerCount('SIGINT'), target.listenerCount('SIGTERM')], [0, 0], `after ${name}, either signal stops the process`);
  }
});

it('a real SIGINT or SIGTERM mid-run removes the database with its log, the folder and the secrets, and exits 4 with one failed line', async context => {
  for (const [signal, stage] of [['SIGINT', 'checkpoint'], ['SIGTERM', 'section']] as const) {
    const p = await paths(context);
    const child = spawn(process.execPath, [INTERRUPT, stage, ...args('migrate', p)], {stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    const exited = once(child, 'exit');
    await waitFor(() => stderr.includes(`paused ${stage}`), 15_000, `the child paused at ${stage}`);
    // What the signal interrupts: the open database with every row in its log, or the written secrets.
    if (stage === 'checkpoint') assert.ok((await lstat(join(p.state, 'modules', 'nanoleaf.sqlite-wal'))).size > 0, 'the log holds the rows');
    else assert.deepEqual((await readdir(p.secrets)).sort(), ['nanoleaf-panels-token', 'nanoleaf-wall-token']);
    child.kill(signal);
    const [code, killed] = await exited as [number | null, NodeJS.Signals | null];
    assert.deepEqual([code, killed], [EXIT.failed, null], `${signal}: ${stderr}`);
    const lines = stdout.split('\n').filter(line => line !== '');
    assert.equal(lines.length, 1, 'one line');
    const line = JSON.parse(lines[0] ?? '{}') as Line;
    assert.deepEqual([line.result, line.code, line.destination], ['failed', 'interrupted', 'removed'], signal);
    for (const suffix of ['', '-wal', '-shm', '-journal']) assert.ok(await absent(join(p.state, 'modules', `nanoleaf.sqlite${suffix}`)), `${signal} ${suffix}`);
    assert.ok(await untouched(p), signal);
  }
});

it('a signal during the source read stops the tool before it takes the lease, and creates nothing', async context => {
  const p = await paths(context);
  // A signal that comes after the first check: the next check, before the lease, sees it.
  let reads = 0;
  const signal = {get aborted() { reads += 1; return reads > 1; }} as unknown as AbortSignal;
  const {exit, line} = await tool(args('migrate', p), {signal});
  assert.deepEqual([exit, line.result, line.code], [EXIT.refused, 'refused', 'interrupted']);
  assert.ok(await nothingCreated(p), 'no state directory, lease file or secrets directory');
});

it('refuses a destination inside the source, and the source inside a destination, creating nothing', async context => {
  const p = await paths(context);
  const before = await readdir(p.source);
  for (const inside of [{state: join(p.source, 'state')}, {secrets: join(p.source, 'secrets')}, {section: join(p.source, 'out', 'section.json')},
    {state: p.root}, {secrets: p.root}, {section: join(p.root, 'section.json')}]) {
    const q = {...p, ...inside};
    const {exit, line} = await tool(args('migrate', q));
    assert.deepEqual([exit, line.code], [EXIT.refused, 'paths-overlap'], JSON.stringify(inside));
    const verify = await tool(args('verify', q));
    assert.equal(verify.line.code, 'paths-overlap', JSON.stringify(inside));
  }
  assert.deepEqual(await readdir(p.source), before, 'nothing was made in the source');
  assert.ok(await nothingCreated(p));
});

it('verify counts a secret file with a line break after its token, and a device the section lists twice', async context => {
  const p = await paths(context);
  assert.equal((await tool(args('migrate', p))).exit, EXIT.ok);
  // The runtime's reader strips trailing line breaks, so only the file's own bytes show one.
  await writeFile(join(p.secrets, 'nanoleaf-wall-token'), `${SYNTHETIC_TOKEN}\n`, {mode: 0o600});
  const newline = await tool(args('verify', p));
  assert.deepEqual([newline.exit, newline.line.mismatches?.secrets, newline.line.mismatches?.total], [EXIT.mismatch, 1, 1]);
  await writeFile(join(p.secrets, 'nanoleaf-wall-token'), SYNTHETIC_TOKEN, {mode: 0o600});
  const section = JSON.parse(await readFile(p.section, 'utf8')) as {devices: unknown[]};
  await writeFile(p.section, JSON.stringify({...section, devices: [...section.devices, section.devices[0]]}), {mode: 0o600});
  const twice = await tool(args('verify', p));
  assert.deepEqual([twice.exit, twice.line.mismatches?.configuration, twice.line.mismatches?.total], [EXIT.mismatch, 1, 1]);
});

it('verify exits 1 and counts a changed secret, a changed address and a changed store', async context => {
  const p = await paths(context);
  assert.equal((await tool(args('migrate', p))).exit, EXIT.ok);
  await writeFile(join(p.secrets, 'nanoleaf-wall-token'), 'tok_OTHER', {mode: 0o600});
  const secret = await tool(args('verify', p));
  assert.deepEqual([secret.exit, secret.line.result, secret.line.mismatches?.secrets, secret.line.mismatches?.total], [EXIT.mismatch, 'mismatch', 1, 1]);
  assert.ok(!secret.text.includes('tok_OTHER'));
  await writeFile(join(p.secrets, 'nanoleaf-wall-token'), SYNTHETIC_TOKEN, {mode: 0o600});
  const original = await readFile(p.section, 'utf8');
  await writeFile(p.section, original.replace(PANELS_ADDRESS, '192.0.2.99'), {mode: 0o600});
  const address = await tool(args('verify', p));
  assert.deepEqual([address.exit, address.line.mismatches?.configuration, address.line.mismatches?.total], [EXIT.mismatch, 1, 1]);
  await writeFile(p.section, original, {mode: 0o600});
  await writeFile(join(p.state, 'modules', 'nanoleaf', 'stray'), 'x', {mode: 0o600});
  const stray = await tool(args('verify', p));
  assert.deepEqual([stray.exit, stray.line.mismatches?.unexpected, stray.line.mismatches?.total], [EXIT.mismatch, 1, 1]);
});

it('verify reads the section from the runtime\'s configuration file that the installer wrote', async context => {
  const p = await paths(context);
  assert.equal((await tool(args('migrate', p))).exit, EXIT.ok);
  const config = join(p.root, 'out', 'runtime-config.json');
  await writeFile(config, JSON.stringify({schema: CONFIG_SCHEMA, modules: {nanoleaf: JSON.parse(await readFile(p.section, 'utf8')) as unknown}}), {mode: 0o600});
  const verified = await tool([...args('verify', p).slice(0, 7), '--section', config]);
  assert.deepEqual([verified.exit, verified.line.result], [EXIT.ok, 'verified']);
});
