// Each module's own settings, secrets and private folder (Hub #919). The runtime reads one private configuration file,
// gives each module only its own section, reads only the secret files that section names, and gives each module a
// private folder beside its SQLite file. A module with a missing or invalid section is refused alone, and health names
// the reason. #880's state rules apply to the file, the secrets and the folders: no link, private to the owner, a size
// bound, and nothing inside a Git checkout. No secret reaches a log record, a health body or an error body.
import assert from 'node:assert/strict';
import {chmod, link, lstat, mkdir, readFile, rename, rm, symlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError, type BunnyModule, type ModuleContext} from '@jimmie-potts/sdk';
import {CONFIG_SCHEMA, RuntimeError, startRuntime, type LogRecord, type RuntimeHealth} from '../src/index.js';
import {LogWriter, Redactions} from '../src/log.js';
import {PrivateFileError, readPrivateFile} from '../src/state.js';
import {contextOf, entry, fixture, health, it, manualClock, run, stateDir, waitFor, type Fixture} from './support.js';

/** The synthetic secret every test writes into a token file. It must never reach a record, health or an error body. */
const SECRET = 'tok_SYNTHETIC919';
const WORKERS = new URL('./fixtures/', import.meta.url);

/** Writes `text` to `path` with `mode`, whatever the umask. */
async function privateFile(path: string, text: string, mode = 0o600): Promise<string> {
  await writeFile(path, text, {mode});
  await chmod(path, mode);
  return path;
}

/** Writes a configuration file with these module sections into a fresh private directory, and returns its path. */
async function configFile(context: TestContext, modules: Readonly<Record<string, unknown>>, extra: object = {}): Promise<string> {
  const dir = await stateDir(context);
  return privateFile(join(dir, 'runtime-config.json'), JSON.stringify({schema: CONFIG_SCHEMA, modules, ...extra}));
}

/** A fresh private directory holding a token file with the synthetic secret, as an installer would write it. */
async function tokenFile(context: TestContext, text = `${SECRET}\n`): Promise<string> {
  return privateFile(join(await stateDir(context), 'token'), text);
}

/** A module whose `configure` accepts any object section as its configuration and names the section's `devices`. */
function configured(name: string, body: (context: ModuleContext) => void | Promise<void> = () => {}): Fixture {
  const module = fixture(name, body, '1.1');
  return Object.assign(module, {manifest: {...module.manifest, configure: (section: unknown) => {
    const {devices} = section as {devices?: unknown};
    return {config: section, ...(Array.isArray(devices) ? {devices: devices as string[]} : {})};
  }}});
}

/** A module with this `configure`. */
function configuring(name: string, configure: NonNullable<BunnyModule['manifest']['configure']>): Fixture {
  const module = fixture(name, () => {}, '1.1');
  return Object.assign(module, {manifest: {...module.manifest, configure}});
}

const code = (expected: string) => (error: unknown): boolean => error instanceof SdkError && error.body.error.code === expected;
const runtimeCode = (expected: string) => (error: unknown): boolean => error instanceof RuntimeError && error.code === expected;
const refusedRecord = (logs: readonly LogRecord[], name: string): LogRecord | undefined =>
  logs.find(record => record.event_name === 'runtime.module.refused' && record.attributes['bunny.module'] === name);

it('each module gets only its own section, the secrets it names and its own private folder', async context => {
  const alpha = configured('alpha');
  const beta = configured('beta');
  const alphaToken = await tokenFile(context);
  const file = await configFile(context, {
    alpha: {greeting: 'hello', secrets: {token: alphaToken}},
    beta: {greeting: 'other', secrets: {token: await tokenFile(context, 'tok_BETA_ONLY'), extra: await tokenFile(context, 'tok_BETA_EXTRA')}},
  });
  const dir = await stateDir(context);
  await run(context, {modules: [alpha, beta], stateDir: dir, configFile: file});
  const {config, secrets, files} = contextOf(alpha);
  assert.deepEqual(config, {greeting: 'hello', secrets: {token: alphaToken}}, 'its own section, never another module\'s');
  assert.equal(await secrets.read('token'), SECRET, 'its own token, without the trailing line break');
  assert.equal(await contextOf(beta).secrets.read('token'), 'tok_BETA_ONLY', 'the other module reads only its own');
  await assert.rejects(secrets.read('extra'), code('not-found'), 'another module\'s secret is not named in its section');
  const folder = files();
  assert.equal(folder, join(dir, 'modules', 'alpha'));
  assert.equal((await lstat(folder)).mode & 0o777, 0o700);
  assert.equal(contextOf(beta).files(), join(dir, 'modules', 'beta'));
});

it('a module whose section is missing or invalid is refused alone, and health names the registry code', async context => {
  const lacking = configured('lacking');
  const malformed = configured('malformed');
  const secretless = fixture('secretless');
  const refusing = configuring('refusing', () => errorBody('invalid-request', {detail: 'the sign needs an address'}));
  const throwing = configuring('throwing', () => { throw new TypeError(`a configure bug quoting ${SECRET}`); });
  const steady = fixture('steady', async ({sdk}) => { await sdk.respond('bunny.cmd.mode.steady', () => ({status: 'accepted'})); });
  const file = await configFile(context, {malformed: ['not', 'an', 'object'], secretless: {secrets: 'token'}, refusing: {}, throwing: {}, steady: {}});
  const {runtime, logs} = await run(context, {modules: [lacking, malformed, secretless, refusing, throwing, steady], configFile: file});
  const report = runtime.health();
  assert.equal(report.status, 'degraded');
  const reasons = Object.fromEntries(report.modules.map(module => [module.name, [module.state, module.reason?.code, module.reason?.detail]]));
  assert.deepEqual(reasons, {
    lacking: ['refused', 'not-found', 'the configuration has no section for this module'],
    malformed: ['refused', 'invalid-request', 'the module\'s section of the configuration must be a JSON object'],
    secretless: ['refused', 'invalid-request', 'the section\'s secrets must map at most 16 names to absolute file paths'],
    refusing: ['refused', 'invalid-request', 'the sign needs an address'],
    throwing: ['refused', 'internal', 'the module\'s configure failed'],
    steady: ['running', undefined, undefined],
  });
  for (const module of [lacking, malformed, secretless, refusing, throwing]) assert.equal(module.context, undefined, `${module.manifest.name} never started`);
  assert.deepEqual(refusedRecord(logs, 'lacking')?.attributes, {'bunny.module': 'lacking', 'bunny.code': 'not-found', 'bunny.phase': 'manifest', 'bunny.provenance': 'source'});
  assert.deepEqual(refusedRecord(logs, 'throwing')?.attributes, {
    'bunny.module': 'throwing', 'bunny.code': 'internal', 'bunny.phase': 'manifest', 'error.type': 'TypeError', 'bunny.provenance': 'source',
  });
  assert.equal(JSON.stringify(logs).includes(SECRET), false, 'the record never quotes what configure threw');
});

it('without a configuration file, a module that takes none starts and one that needs a section is refused', async context => {
  const needs = configured('needs');
  const plain = fixture('plain');
  const {runtime} = await run(context, {modules: [needs, plain]});
  assert.deepEqual(entry(runtime.health(), 'needs').reason, {code: 'not-found', detail: 'the configuration has no section for this module'});
  assert.equal(entry(runtime.health(), 'plain').state, 'running');
  assert.equal(contextOf(plain).config, undefined);
  await assert.rejects(contextOf(plain).secrets.read('token'), code('not-found'));
});

it('a section only for a module this runtime does not host is ignored, and one named for an object prototype key finds nothing', async context => {
  const constructor = configured('constructor');
  const file = await configFile(context, {retired: {greeting: 'old'}});
  const {runtime} = await run(context, {modules: [constructor], configFile: file});
  assert.deepEqual(entry(runtime.health(), 'constructor').reason?.code, 'not-found');
});

it('a module that names a device another module already named is refused', async context => {
  const first = configured('first');
  const second = configured('second');
  const third = configured('third');
  const file = await configFile(context, {first: {devices: ['sign-1', 'sign-2']}, second: {devices: ['sign-2']}, third: {devices: ['sign-3']}});
  const {runtime} = await run(context, {modules: [first, second, third], configFile: file});
  assert.equal(entry(runtime.health(), 'first').state, 'running');
  assert.deepEqual(entry(runtime.health(), 'second').reason, {code: 'invalid-request', detail: 'another module already names one of this module\'s devices'});
  assert.equal(entry(runtime.health(), 'third').state, 'running');
});

it('a secret file that is missing, a link, readable by others, oversized, has a second link, or lies in a Git checkout refuses its module', async context => {
  const root = await stateDir(context);
  const good = await privateFile(join(root, 'good'), SECRET);
  await symlink(good, join(root, 'linked'));
  await mkdir(join(root, 'real'), {mode: 0o700});
  await privateFile(join(root, 'real', 'token'), SECRET);
  await symlink(join(root, 'real'), join(root, 'dir-link'));
  await privateFile(join(root, 'shared'), SECRET, 0o640);
  await privateFile(join(root, 'big'), 'x'.repeat(65_537));
  await privateFile(join(root, 'twice'), SECRET);
  await link(join(root, 'twice'), join(root, 'twice-again'));
  await mkdir(join(root, 'checkout', '.git'), {recursive: true});
  await privateFile(join(root, 'checkout', 'token'), SECRET);
  await mkdir(join(root, 'folder'), {mode: 0o700});
  await privateFile(join(root, 'unreadable'), SECRET, 0o000);
  const cases: Readonly<Record<string, readonly [string, string, string]>> = {
    missing: [join(root, 'nowhere'), 'not-found', 'the secret file for token does not exist'],
    linked: [join(root, 'linked'), 'forbidden', 'the secret file for token must not be reached through a link'],
    'dir-link': [join(root, 'dir-link', 'token'), 'forbidden', 'the secret file for token must not be reached through a link'],
    shared: [join(root, 'shared'), 'forbidden', 'the secret file for token must be private to its owner: readable by it, with no permissions for group or others and one link'],
    big: [join(root, 'big'), 'invalid-request', 'the secret file for token must be at most 65536 bytes'],
    twice: [join(root, 'twice'), 'forbidden', 'the secret file for token must be private to its owner: readable by it, with no permissions for group or others and one link'],
    checkout: [join(root, 'checkout', 'token'), 'forbidden', 'the secret file for token must be outside every Git checkout'],
    folder: [join(root, 'folder'), 'forbidden', 'the secret file for token must be a regular file'],
    mounted: ['/mnt/bunny-runtime-test/token', 'forbidden', 'the secret file for token must not be on a Windows mount'],
    // Root reads any file, so only another user sees this refusal.
    ...(process.getuid?.() === 0 ? {} : {unreadable: [join(root, 'unreadable'), 'forbidden', 'the secret file for token must be private to its owner: readable by it, with no permissions for group or others and one link'] as const}),
  };
  const modules = Object.keys(cases).map(name => configured(name));
  const fine = configured('fine');
  const file = await configFile(context, {
    ...Object.fromEntries(Object.entries(cases).map(([name, [path]]) => [name, {secrets: {token: path}}])),
    fine: {secrets: {token: good}},
  });
  const {runtime} = await run(context, {modules: [...modules, fine], configFile: file});
  for (const [name, [, expected, detail]] of Object.entries(cases)) {
    assert.deepEqual(entry(runtime.health(), name).reason, {code: expected, detail}, name);
  }
  assert.equal(entry(runtime.health(), 'fine').state, 'running');
});

it('reading a secret checks its file again each time, and a stopped module reads none', async context => {
  const token = await tokenFile(context);
  const reader = configured('reader');
  const file = await configFile(context, {reader: {secrets: {token}}});
  const {runtime} = await run(context, {modules: [reader], configFile: file});
  const {secrets} = contextOf(reader);
  assert.equal(await secrets.read('token'), SECRET);
  await chmod(token, 0o644);
  await assert.rejects(secrets.read('token'), code('forbidden'));
  await rm(token);
  await assert.rejects(secrets.read('token'), code('not-found'));
  await writeFile(token, Buffer.from([0xc3, 0x28]), {mode: 0o600});
  await assert.rejects(secrets.read('token'), code('invalid-request'), 'a file that is not UTF-8 text');
  await runtime.stop();
  await assert.rejects(secrets.read('token'), code('invalid-state'));
  assert.throws(() => contextOf(reader).files(), code('invalid-state'));
});

it('a configuration file that the runtime cannot trust is refused before it serves or starts a module', async context => {
  const root = await stateDir(context);
  const valid = JSON.stringify({schema: CONFIG_SCHEMA, modules: {}});
  const good = await privateFile(join(root, 'good.json'), valid);
  await symlink(good, join(root, 'linked.json'));
  const holder = await stateDir(context);
  await symlink(root, join(holder, 'via'));
  await privateFile(join(root, 'shared.json'), valid, 0o644);
  await privateFile(join(root, 'big.json'), JSON.stringify({schema: CONFIG_SCHEMA, modules: {pad: 'x'.repeat(1_048_576)}}));
  await mkdir(join(root, 'checkout', '.git'), {recursive: true});
  await privateFile(join(root, 'checkout', 'config.json'), valid);
  // The refusals never quote the file: these hold the synthetic token where a malformed file might hold a secret.
  await privateFile(join(root, 'text.json'), `not json ${SECRET}`);
  await privateFile(join(root, 'other.json'), JSON.stringify({schema: SECRET, modules: {}}));
  await privateFile(join(root, 'extra.json'), JSON.stringify({schema: CONFIG_SCHEMA, modules: {}, edge: {token: SECRET}}));
  await privateFile(join(root, 'hard.json'), valid);
  await link(join(root, 'hard.json'), join(root, 'hard-again.json'));
  await privateFile(join(root, 'unreadable.json'), valid, 0o000);
  await privateFile(join(root, 'list.json'), JSON.stringify({schema: CONFIG_SCHEMA, modules: []}));
  await privateFile(join(root, 'none.json'), JSON.stringify({schema: CONFIG_SCHEMA}));
  const cases: readonly (readonly [string, string])[] = [
    ['relative/config.json', 'config-relative'],
    ['/mnt/bunny-runtime-test/config.json', 'config-mount'],
    [join(root, 'missing.json'), 'config-missing'],
    [join(root, 'linked.json'), 'config-link'],
    [join(holder, 'via', 'good.json'), 'config-link'],
    [join(root, 'shared.json'), 'config-not-private'],
    [join(root, 'hard.json'), 'config-not-private'],
    ...(process.getuid?.() === 0 ? [] : [[join(root, 'unreadable.json'), 'config-not-private'] as const]),
    [join(root, 'big.json'), 'config-too-large'],
    [join(root, 'checkout', 'config.json'), 'config-checkout'],
    [root, 'config-not-file'],
    [join(root, 'text.json'), 'config-invalid'],
    [join(root, 'other.json'), 'config-invalid'],
    [join(root, 'extra.json'), 'config-invalid'],
    [join(root, 'list.json'), 'config-invalid'],
    [join(root, 'none.json'), 'config-invalid'],
  ];
  for (const [file, expected] of cases) {
    const started = fixture('started');
    // A runtime that starts after all is stopped after the test, so a failure here cannot keep the process alive.
    const starting = startRuntime({port: 0, stateDir: await stateDir(context), modules: [started], configFile: file, log: () => {}});
    context.after(async () => { await (await starting.catch(() => undefined))?.stop(); });
    await assert.rejects(starting, error => runtimeCode(expected)(error) && error instanceof Error && !error.message.includes(SECRET), file);
    assert.equal(started.context, undefined, `${file}: no module started`);
  }
  const fine = await startRuntime({port: 0, stateDir: await stateDir(context), modules: [], configFile: good, log: () => {}});
  await fine.stop();
});

it('a module\'s private folder sits beside its database, is mode 700, keeps its files across restarts, and is never a link', async context => {
  const dir = await stateDir(context);
  const keeper = fixture('keeper', async ({files, database}) => {
    database();
    await writeFile(join(files(), 'layout.json'), '{"panels":3}', {mode: 0o600});
  });
  const first = await run(context, {modules: [keeper], stateDir: dir});
  await first.runtime.stop();
  assert.equal(await readFile(join(dir, 'modules', 'keeper', 'layout.json'), 'utf8'), '{"panels":3}');
  assert.equal((await lstat(join(dir, 'modules', 'keeper'))).mode & 0o777, 0o700);
  assert.ok((await lstat(join(dir, 'modules', 'keeper.sqlite'))).isFile(), 'beside its SQLite file');

  const elsewhere = await stateDir(context);
  await symlink(elsewhere, join(dir, 'modules', 'linked'));
  const linked = fixture('linked');
  await run(context, {modules: [linked], stateDir: dir});
  assert.throws(() => contextOf(linked).files(), runtimeCode('module-folder-not-private'));
  const throughLink = await stateDir(context);
  const target = await stateDir(context);
  await symlink(target, join(throughLink, 'modules'));
  const nested = fixture('nested');
  await run(context, {modules: [nested], stateDir: throughLink});
  assert.throws(() => contextOf(nested).files(), runtimeCode('module-folder-not-private'));
  await assert.rejects(lstat(join(target, 'nested')), 'nothing is created through a linked modules directory');
  await chmod(join(dir, 'modules', 'keeper'), 0o755);
  const again = fixture('keeper');
  await run(context, {modules: [again], stateDir: dir});
  assert.throws(() => contextOf(again).files(), runtimeCode('module-folder-not-private'));
});

it('a worker call returns its reply, ends at its deadline on the runtime\'s scheduler, and ends uncertain when its module stops', async context => {
  const clock = manualClock();
  const results: string[] = [];
  const caller = fixture('caller', async ({workers}) => {
    const reply = await workers.call<{text: string}>(new URL('call-worker.js', WORKERS), {act: 'answer', text: 'hello'}, {timeoutMs: 5000});
    results.push(reply.text);
  });
  const {runtime} = await run(context, {modules: [caller], clock: {now: clock.now}, scheduler: clock.scheduler});
  assert.deepEqual(results, ['HELLO']);
  const {workers} = contextOf(caller);
  const late = workers.call(new URL('call-worker.js', WORKERS), {act: 'silent'}, {timeoutMs: 2000});
  await new Promise(resolve => { setTimeout(resolve, 100); });
  clock.advance(2000);
  await assert.rejects(late, code('uncertain-result'));
  await assert.rejects(workers.call(new URL('call-worker.js', WORKERS), {act: 'throw'}, {timeoutMs: 5000}), code('uncertain-result'));
  assert.equal(entry(runtime.health(), 'caller').state, 'running', 'a failed call never fails its module');
  const held = workers.call(new URL('call-worker.js', WORKERS), {act: 'silent'}, {timeoutMs: 60_000}).then(() => 'resolved', (error: unknown) => error);
  await runtime.stop();
  assert.ok(code('uncertain-result')(await held), 'the stop ended the call, which the worker had, as uncertain');
  await assert.rejects(workers.call(new URL('call-worker.js', WORKERS), {act: 'answer'}, {timeoutMs: 1000}), code('invalid-state'));
});

it('a worker a module starts with its own environment keeps the process\'s NODE_OPTIONS', async context => {
  const before = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = '--no-deprecation';
  context.after(() => { if (before === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = before; });
  const seen: unknown[] = [];
  const starter = fixture('starter', ({workers}) => {
    for (const env of [{ONLY: 'mine'}, {NODE_OPTIONS: '--no-warnings'}, {NODE_OPTIONS: '--no-deprecation'}]) {
      const worker = workers.start(new URL('env-worker.js', WORKERS), {env});
      worker.once('message', (message: unknown) => { seen.push(message); });
    }
  });
  await run(context, {modules: [starter]});
  await waitFor(() => seen.length === 3, 5000, 'every worker to answer');
  assert.deepEqual(seen.sort(), ['--no-deprecation', '--no-deprecation', '--no-deprecation --no-warnings'], 'kept once, before the module\'s own');
});

it('no log record, health body or error body carries a secret, and a record that would is dropped', async context => {
  const token = await tokenFile(context);
  const shared = await privateFile(join(await stateDir(context), 'shared-token'), SECRET, 0o644);
  const leaky = configured('leaky', async ({secrets, log}) => {
    const value = await secrets.read('token');
    // A module bug: a registered attribute with the secret in it. The runtime drops the record.
    log.info('operation.completed', {'bunny.message.id': value});
    log.info('operation.completed', {'bunny.operation': 'setup'});
    throw Object.assign(new Error(`start failed with ${value}`), {code: 'EFIXTURE'});
  });
  const exposed = configured('exposed');
  const failures: unknown[] = [];
  const probe = fixture('probe');
  const file = await configFile(context, {leaky: {secrets: {token}}, exposed: {secrets: {token: shared}}, probe: {secrets: {token}}});
  const {runtime, logs} = await run(context, {modules: [leaky, exposed, probe], configFile: file}, {dropped: 1});
  const {secrets} = contextOf(probe);
  for (const name of ['missing', 'token']) {
    await secrets.read(name).then(value => { assert.equal(value, SECRET); }, (error: unknown) => { failures.push(error); });
  }
  await chmod(token, 0o640);
  await secrets.read('token').catch((error: unknown) => { failures.push(error); });
  const report: RuntimeHealth = (await health(runtime.url)).body;
  await waitFor(() => logs.some(record => record.event_name === 'runtime.module.stopped' && record.attributes['bunny.module'] === 'leaky'));
  const bodies = failures.map(error => error instanceof SdkError ? {body: error.body, message: error.message} : {other: String(error)});
  assert.equal(bodies.length, 2);
  for (const [what, value] of [['log records', logs], ['health', report], ['error bodies', bodies]] as const) {
    assert.equal(JSON.stringify(value).includes(SECRET), false, `no ${what} carry the secret`);
  }
  assert.ok(logs.some(record => record.event_name === 'operation.completed' && record.attributes['bunny.operation'] === 'setup'), 'the module\'s other records arrive');
  assert.equal(entry(report, 'exposed').reason?.code, 'forbidden');
  assert.deepEqual(entry(report, 'leaky').reason, {code: 'internal', detail: 'start failed'});
});

it('a directory along a private file\'s path swapped for a link after the path\'s checks is refused, not followed', async context => {
  const root = await stateDir(context);
  await mkdir(join(root, 'dir'), {mode: 0o700});
  await mkdir(join(root, 'other'), {mode: 0o700});
  await privateFile(join(root, 'dir', 'token'), SECRET);
  await privateFile(join(root, 'other', 'token'), 'tok_OTHER_FILE');
  assert.equal((await readPrivateFile(join(root, 'dir', 'token'), 1024)).toString(), SECRET, 'the file itself, unswapped');
  // As a rename race would, between the checks and the open: dir becomes a link to another private file's directory.
  const swap = async (): Promise<void> => {
    await rename(join(root, 'dir'), join(root, 'dir-moved'));
    await symlink(join(root, 'other'), join(root, 'dir'));
  };
  await assert.rejects(readPrivateFile(join(root, 'dir', 'token'), 1024, {beforeOpen: swap}),
    error => error instanceof PrivateFileError && error.problem === 'link' && !error.message.includes('tok_OTHER_FILE'));
});

it('the log writer drops a record whose attribute holds a read secret as text or as a number\'s digits, and the process\'s record leaves it out', () => {
  const records: LogRecord[] = [];
  const redactions = new Redactions();
  const writer = new LogWriter(record => { records.push(record); }, 'info', {now: () => Date.now()}, undefined, redactions);
  const log = writer.logger('bunny.module', {'bunny.module': 'keypad'});
  // A numeric secret, such as a device PIN, read by a module.
  redactions.add('24680135');
  log.info('operation.completed', {'bunny.duration_ms': 24_680_135});
  log.info('operation.completed', {'bunny.message.id': 'pin-24680135'});
  log.info('operation.completed', {'bunny.duration_ms': 12, 'bunny.outcome': 'succeeded'});
  assert.deepEqual(records.map(record => record.attributes['bunny.duration_ms']), [12], 'only the record without the secret');
  assert.deepEqual(writer.counts(), {written: 1, dropped: 2, failed: 0});
  assert.deepEqual(redactions.without({'error.type': 'Error', 'error.code': 'E24680135'}), {'error.type': 'Error'});
});

it('a span a module records leaves out an attribute that holds a secret the module read, and keeps the rest', async context => {
  const token = await tokenFile(context);
  const spans: string[] = [];
  const caller = configured('caller', async ({secrets, trace}) => {
    const value = await secrets.read('token');
    // A module bug: its token in a registered span attribute (Hub #949's spans, #919's secrets).
    trace.start('bunny.device.call', {attributes: {'bunny.message.id': value, 'bunny.device.id': 'sign-1'}}).end();
  });
  const file = await configFile(context, {caller: {secrets: {token}}});
  const {runtime} = await run(context, {modules: [caller], configFile: file, spans: line => { spans.push(line); }});
  await runtime.stop();
  const call = spans.find(line => line.includes('bunny.device.call'));
  assert.ok(call !== undefined, 'the span is recorded');
  assert.ok(call.includes('sign-1'), 'with its other attributes');
  assert.equal(spans.some(line => line.includes(SECRET)), false, 'no span holds the secret');
});
