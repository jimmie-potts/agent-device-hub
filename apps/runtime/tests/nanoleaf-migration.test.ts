// The Nanoleaf migration's command-line tool (Hub #933), as the installer (#935) runs it: its exit codes and JSON lines,
// the module's store, folder, secret files and section it writes, its refusals of a running runtime, a destination that
// already has files and a source it cannot carry, its removal of what it wrote when it fails, and its verifier.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chmod, lstat, mkdir, readdir, readFile, realpath, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {LINES_ADDRESS, PANELS_ADDRESS, SYNTHETIC_TOKEN, writeSyntheticNanoleafState} from '@jimmie-potts/nanoleaf';
import {holdRuntimeLease} from '../src/lease.js';
import {EXIT, runNanoleafMigration} from '../src/nanoleaf-migration.js';
import {CONFIG_SCHEMA} from '../src/state.js';
import {it, stateDir, waitFor} from './support.js';

const MAIN = fileURLToPath(new URL('../src/main.js', import.meta.url));
const ENTRY = fileURLToPath(new URL('../src/migrate-nanoleaf.js', import.meta.url));

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
async function tool(argv: readonly string[], beforeSecrets?: () => Promise<void>): Promise<{exit: number; line: Line; text: string}> {
  const lines: string[] = [];
  const exit = await runNanoleafMigration(argv, {write: line => { lines.push(line); }, ...(beforeSecrets === undefined ? {} : {beforeSecrets})});
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
  assert.ok(await untouched(p));
});

it('refuses while a runtime runs on the state directory, and a runtime that starts while it runs cannot take the lease', async context => {
  const p = await paths(context);
  await mkdir(p.state, {mode: 0o700});
  const runtime = await startRuntime(p.state);
  try {
    for (const operation of ['migrate', 'verify']) {
      const {exit, line} = await tool(args(operation, p));
      assert.deepEqual([exit, line.result, line.code], [EXIT.refused, 'refused', 'runtime-running'], operation);
    }
    assert.ok(await untouched(p));
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
  }
});

it('refuses a source it cannot carry, naming the code, and writes nothing', async context => {
  const empty = await paths(context);
  const {exit, line} = await tool(['migrate', '--source', empty.root, ...args('migrate', empty).slice(3)]);
  assert.deepEqual([exit, line.code, line.message], [EXIT.refused, 'source-missing', 'The source directory holds no status.sqlite or no config.json.']);
  assert.ok(await untouched(empty));
  const unconfigured = await paths(context, false);
  const refused = await tool(args('migrate', unconfigured));
  assert.deepEqual([refused.exit, refused.line.code], [EXIT.refused, 'source-not-configured']);
  assert.ok(await untouched(unconfigured));
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
});

it('removes what it wrote when it fails after writing began, and exits 4', async context => {
  const p = await paths(context);
  // Another process makes a secret file between the checks and the write: the tool fails, removes its own files and keeps that one.
  const {exit, line} = await tool(args('migrate', p), async () => { await writeFile(join(p.secrets, 'nanoleaf-panels-token'), 'theirs', {mode: 0o600}); });
  assert.deepEqual([exit, line.result, line.code, line.destination], [EXIT.failed, 'failed', 'internal', 'removed']);
  assert.ok(await absent(join(p.state, 'modules', 'nanoleaf.sqlite')));
  assert.ok(await absent(join(p.state, 'modules', 'nanoleaf')));
  assert.ok(await absent(p.section));
  assert.deepEqual(await readdir(p.secrets), ['nanoleaf-panels-token']);
  assert.equal(await readFile(join(p.secrets, 'nanoleaf-panels-token'), 'utf8'), 'theirs', 'the other file is not the tool\'s to remove');
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
