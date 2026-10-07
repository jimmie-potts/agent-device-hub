// The module test kit (Hub #882, #919): one conformance suite that every module runs in a few lines. A small bulb module
// and a configured beacon pass it; each broken variant fails exactly the checks that see its fault.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {errorBody, type ErrorCode, type Message} from '@jimmie-potts/event-contracts/v2';
import {InProcessBus, Outbox, type BunnyModule, type Command, type ModuleContext, type StateDraft} from '../src/index.js';
import {CHECKS, ModuleHarness, checkModuleRecord, conformanceChecks, moduleConformance, type ConformanceSpec, type HarnessRecord} from '../src/testing/index.js';
import {it} from './support.js';

const BASE = 'https://bunny.invalid/events/';
const BULB_SCHEMA = `${BASE}kit-bulb/2.0`;
const SWITCH_SCHEMA = `${BASE}kit-bulb-switch/2.0`;
const block = (name: string): object => ({$ref: `${BASE}blocks/2.0#/$defs/${name}`});
const power = {enum: ['on', 'off']};
const BEACON_SCHEMA = `${BASE}kit-beacon/2.0`;
const PING_SCHEMA = `${BASE}kit-beacon-ping/2.0`;
const schemas = {
  [BULB_SCHEMA]: {type: 'object', additionalProperties: false, required: ['id', 'revision', 'power'], properties: {id: block('id'), revision: block('revision'), power}},
  [SWITCH_SCHEMA]: {type: 'object', additionalProperties: false, required: ['requestId', 'power'], properties: {requestId: block('requestId'), power}},
  [BEACON_SCHEMA]: {
    type: 'object', additionalProperties: false, required: ['id', 'revision', 'availability'],
    properties: {id: block('id'), revision: block('revision'), availability: {enum: ['unknown', 'available', 'unavailable']}, label: {type: 'string', maxLength: 64}},
  },
  [PING_SCHEMA]: {type: 'object', additionalProperties: false, required: ['requestId'], properties: {requestId: block('requestId')}},
};

/** What a broken bulb gets wrong. */
type Fault = {
  apiVersion?: string; plainOutcome?: boolean; refuseWith?: ErrorCode; hangingStop?: boolean; dimState?: boolean;
  /** Its outbox gets neither the module's log nor its tracing, so it records nothing. */
  silentOutbox?: boolean;
  /** Its device span continues a context that no recorded span or message has. */
  strayParent?: boolean;
  /** A record the bulb writes when it switches, in place of its registered `command.completed`. */
  switchRecord?: {event: string; fields: Readonly<Record<string, string | number | boolean>>};
};
type Switch = {power: 'on' | 'off'};

const STRAY = {traceparent: '00-0af7651916cd43dd8448eb211c80319c-00000000000000aa-01'};

/**
 * A bulb module: it serves its bulbs through sync, switches one on command in a device span and reports the outcome
 * through its outbox, which records through the module's log and tracing.
 */
function bulb(fault: Fault = {}): BunnyModule {
  return {
    manifest: {name: 'bulb', apiVersion: fault.apiVersion ?? '1.0'},
    async start({sdk, database, clock, log, trace}) {
      const db = database();
      db.exec('CREATE TABLE IF NOT EXISTS bulbs (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, power TEXT NOT NULL)');
      db.exec('INSERT OR IGNORE INTO bulbs VALUES (\'b1\', 0, \'off\')');
      const outbox = new Outbox({sdk, database: db, clock, ...(fault.silentOutbox === true ? {} : {log, trace})});
      await outbox.republish();
      const state = (row: {id: string; revision: number; power: string}) => ({
        type: 'org.bunny.kit-bulb.updated', subject: row.id, dataschema: BULB_SCHEMA,
        data: {id: row.id, revision: row.revision, power: fault.dimState === true ? 'dim' : row.power},
      });
      const rows = () => db.prepare('SELECT id, revision, power FROM bulbs ORDER BY id').all() as {id: string; revision: number; power: string}[];
      await sdk.serveSync(['kit-bulb'], () => ({revision: Math.max(0, ...rows().map(row => row.revision)), states: rows().map(state)}));
      await sdk.respond<Switch>('bunny.cmd.kit-bulb.*', async (command: Command<Switch>) => {
        const found = rows().find(row => row.id === command.subject);
        if (found === undefined) return errorBody(fault.refuseWith ?? 'not-found', {detail: 'no such bulb'});
        const outcome = {
          kind: 'outcome' as const, type: 'org.bunny.kit-bulb.switch.completed', subject: found.id, dataschema: `${BASE}outcome/2.0`,
          data: {requestId: command.data.requestId, result: 'succeeded', evidence: 'observed'},
        };
        // The device call has its own span; its context never goes to the device.
        trace.start('bunny.device.call', {parent: fault.strayParent === true ? STRAY : command, kind: 'client', attributes: {'bunny.device.id': found.id}}).end();
        await outbox.transaction(add => {
          const revision = found.revision + 1;
          db.prepare('UPDATE bulbs SET revision = ?, power = ? WHERE id = ?').run(revision, command.data.power, found.id);
          add(`bunny.state.kit-bulb.${found.id}`, {kind: 'state', ...state({...found, revision, power: command.data.power})}, {parent: command});
          if (fault.plainOutcome !== true) add(`bunny.event.kit-bulb.${found.id}`, outcome, {parent: command});
        });
        if (fault.plainOutcome === true) await sdk.publish(`bunny.event.kit-bulb.${found.id}`, outcome, {parent: command});
        const {event, fields} = fault.switchRecord ?? {event: 'command.completed', fields: {'bunny.device.id': found.id, 'bunny.outcome': 'succeeded'}};
        log.info(event, fields, command);
        return {status: 'accepted'};
      });
    },
    stop: () => fault.hangingStop === true ? new Promise(() => {}) : undefined,
  };
}

const spec = (fault: Fault = {}): ConformanceSpec => ({
  create: () => bulb(fault),
  schemas,
  serves: ['kit-bulb'],
  accepted: {key: 'bunny.cmd.kit-bulb.b1', draft: {type: 'org.bunny.kit-bulb.switch.requested', subject: 'b1', dataschema: SWITCH_SCHEMA, data: {power: 'on'}}},
  refused: {key: 'bunny.cmd.kit-bulb.b9', draft: {type: 'org.bunny.kit-bulb.switch.requested', subject: 'b9', dataschema: SWITCH_SCHEMA, data: {power: 'on'}}, code: 'not-found'},
  timeoutMs: 500,
});

/** The names of the checks that fail. */
async function failing(given: ConformanceSpec): Promise<string[]> {
  const failed: string[] = [];
  for (const check of conformanceChecks(given)) {
    try {
      await check.run();
    } catch {
      failed.push(check.name);
    }
  }
  return failed;
}

// A conforming module runs the whole suite in one line.
moduleConformance(spec());

it('a conforming module passes every check', async () => {
  assert.deepEqual(conformanceChecks(spec()).map(check => check.name), [
    CHECKS.manifest, CHECKS.lifecycle, CHECKS.serves, CHECKS.accepts, CHECKS.refuses, CHECKS.outbox,
  ], 'no copies check without copied families');
  assert.deepEqual(await failing(spec()), []);
});

it('the kit catches a module that reports its outcome without the outbox', async () => {
  assert.deepEqual(await failing(spec({plainOutcome: true})), [CHECKS.outbox]);
});

it('the kit catches a manifest the runtime would refuse', async () => {
  assert.deepEqual(await failing(spec({apiVersion: '2.0'})), [CHECKS.manifest]);
});

it('the kit catches a refusal with another code than the module declares', async () => {
  assert.deepEqual(await failing(spec({refuseWith: 'invalid-state'})), [CHECKS.refuses]);
});

it('the kit catches a stop that never finishes', async () => {
  assert.deepEqual(await failing(spec({hangingStop: true})), [CHECKS.lifecycle, CHECKS.outbox]);
});

it('the kit catches an outbox that records nothing, naming the missing publication record', async () => {
  assert.deepEqual(await failing(spec({silentOutbox: true})), [CHECKS.outbox]);
  const check = conformanceChecks(spec({silentOutbox: true})).find(item => item.name === CHECKS.outbox);
  await assert.rejects(check?.run() ?? Promise.resolve(), /recorded once: pass the module's log and trace to its Outbox/);
});

it('the kit catches a span whose parent is lost', async () => {
  assert.deepEqual(await failing(spec({strayParent: true})), [CHECKS.accepts, CHECKS.outbox]);
});

it('the kit catches a message that breaks its payload schema', async () => {
  // Every state the bulb sends says `dim`, which its schema does not allow: in a sync and in what the command publishes.
  assert.deepEqual(await failing(spec({dimState: true})), [CHECKS.serves, CHECKS.accepts, CHECKS.outbox]);
});

it('the kit catches a module that logs an event the diagnostic catalog does not register for modules', async () => {
  // Every check that sees the record fails: the accepted command's and the outbox's.
  assert.deepEqual(await failing(spec({switchRecord: {event: 'bulb.switched', fields: {}}})), [CHECKS.accepts, CHECKS.outbox]);
  assert.deepEqual(await failing(spec({switchRecord: {event: 'runtime.module.started', fields: {}}})), [CHECKS.accepts, CHECKS.outbox],
    'a module cannot write the runtime\'s own events');
});

it('the kit catches a module record with an unregistered attribute or a value outside its registered type', async () => {
  const leak = 'GET http://192.0.2.7/api?token=secret-token refused';
  assert.deepEqual(await failing(spec({switchRecord: {event: 'command.completed', fields: {'error.message': leak}}})), [CHECKS.accepts, CHECKS.outbox]);
  assert.deepEqual(await failing(spec({switchRecord: {event: 'command.completed', fields: {'bunny.device.id': leak}}})), [CHECKS.accepts, CHECKS.outbox]);
});

it('a module record is checked as the runtime writes it: the module scope, its name and the registered vocabulary', () => {
  const entry = (event: string, fields: Readonly<Record<string, string | number | boolean>> = {}): HarnessRecord => ({level: 'info', event, fields});
  assert.equal(checkModuleRecord('bulb', entry('command.completed', {'bunny.outcome': 'succeeded'})), undefined);
  assert.equal(checkModuleRecord('bulb', {...entry('operation.completed'), trace: {traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'}}), undefined);
  assert.match(checkModuleRecord('bulb', entry('bulb.switched')) ?? '', /bulb\.switched is not a registered module event/);
  assert.match(checkModuleRecord('bulb', entry('runtime.failed')) ?? '', /not a registered module event/);
  assert.match(checkModuleRecord('bulb', entry('command.completed', {detail: 'secret-token'})) ?? '', /unregistered attribute: detail/);
  const invalid = checkModuleRecord('bulb', entry('command.completed', {'bunny.outcome': 'secret-token'})) ?? '';
  assert.match(invalid, /outside its registered type/);
  assert.equal(invalid.includes('secret-token'), false, 'a problem never quotes a value');
  assert.match(checkModuleRecord('Bad Name', entry('command.completed')) ?? '', /outside its registered type/, 'the module name is a registered attribute too');
});

it('a module that only consumes runs the checks that apply to it', async () => {
  const MODE = `${BASE}mode/2.0`;
  const listener: BunnyModule = {
    manifest: {name: 'listener', apiVersion: '1.0'},
    async start({sdk}) {
      const synced = await sdk.sync(['mode'], () => {}, {timeoutMs: 500});
      if (synced.status === 'rejected') throw new Error('the mode did not sync');
    },
    stop: () => {},
  };
  const mode: StateDraft<{id: string; revision: number; mode: string; selectedAtMs: number}> = {
    type: 'org.bunny.mode.updated', subject: 'hub', dataschema: MODE, data: {id: 'hub', revision: 1, mode: 'work', selectedAtMs: 1_791_288_000_000},
  };
  const consumer: ConformanceSpec = {
    create: () => listener,
    copies: {families: ['mode'], snapshot: {revision: 1, states: [mode]}},
    timeoutMs: 500,
  };
  assert.deepEqual(conformanceChecks(consumer).map(check => check.name), [CHECKS.manifest, CHECKS.lifecycle, CHECKS.copies]);
  assert.deepEqual(await failing(consumer), []);
});

it('the harness stops a module as the runtime does: a participant without close, deadlines, and cleanup after errors', async context => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-harness-'));
  context.after(() => rm(dir, {recursive: true, force: true}));
  let seen: ModuleContext | undefined;
  const failure = new Error('the stop failed');
  const host = (stop: () => void | Promise<void>): ModuleHarness => new ModuleHarness({
    manifest: {name: 'probe', apiVersion: '1.0'},
    start: given => {
      seen = given;
      given.database().exec('CREATE TABLE IF NOT EXISTS t (x INTEGER)');
    },
    stop,
  }, {bus: new InProcessBus(), stateDir: dir, stopTimeoutMs: 100});

  const throwing = host(() => { throw failure; });
  await throwing.start();
  assert.equal(seen !== undefined && 'close' in seen.sdk, false, 'the module cannot close its own participant');
  await throwing.stop();
  assert.equal(throwing.databaseOpen(), false, 'the database closes even when stop throws');
  assert.deepEqual(throwing.failures, [failure]);

  const hanging = host(() => new Promise(() => {}));
  await hanging.start();
  const started = performance.now();
  await hanging.stop();
  assert.ok(performance.now() - started < 2000, 'the stop deadline ends the wait');
  assert.equal(hanging.databaseOpen(), false);
  assert.equal(hanging.failures.length, 1, 'a stop past its deadline is a failure');
});

/** The synthetic secret the beacon's token file holds (Hub #919). It must never reach a message, record or reply. */
const SECRET = 'tok_SYNTHETIC919';

/** A beacon's device: online, or offline and never answering, as a device that is switched off, until the call ends. */
class Lantern {
  readonly tokens: string[] = [];
  readonly #online: boolean;

  constructor(online: boolean) {
    this.#online = online;
  }

  reach(token: string, signal: AbortSignal): Promise<void> {
    this.tokens.push(token);
    if (this.#online) return Promise.resolve();
    return new Promise((_, reject) => { signal.addEventListener('abort', () => { reject(new Error('the beacon did not answer')); }, {once: true}); });
  }
}

/** What a broken beacon gets wrong: it waits on its device in start, or puts its secret in a record, a message or a reply. */
type BeaconFault = {waitInStart?: boolean; leak?: 'log' | 'message' | 'reply'};
type Beacon = {id: string; revision: number; availability: 'unknown' | 'available' | 'unavailable'; label?: string};

/**
 * A configured module (Hub #919): its section names the beacon's address and its token file. Its start reads the token,
 * keeps a file in its private folder and serves its beacon's availability, and reaches the beacon only afterwards, on
 * its scheduler, with a deadline: a beacon that never answers is `unavailable` (policy A). It refuses every command.
 */
function beacon(device: Lantern, fault: BeaconFault = {}): BunnyModule<{address: string}> {
  return {
    manifest: {
      name: 'beacon', apiVersion: '1.1',
      configure: section => {
        const {address, secrets} = section as {address?: unknown; secrets?: {token?: unknown}};
        if (typeof address !== 'string' || secrets?.token === undefined) return errorBody('invalid-request', {detail: 'a beacon needs an address and a token'});
        return {config: {address}, devices: ['beacon-1']};
      },
    },
    async start({sdk, config, secrets, files, scheduler, log}) {
      const token = await secrets.read('token');
      await writeFile(join(files(), 'layout.json'), JSON.stringify({address: config.address}), {mode: 0o600});
      const beacon: Beacon = {id: 'beacon-1', revision: 0, availability: 'unknown', ...(fault.leak === 'message' ? {label: token} : {})};
      const state = (): StateDraft<Beacon> => ({type: 'org.bunny.kit-beacon.updated', subject: beacon.id, dataschema: BEACON_SCHEMA, data: {...beacon}});
      await sdk.serveSync(['kit-beacon'], () => ({revision: beacon.revision, states: [state()]}));
      await sdk.respond('bunny.cmd.kit-beacon.*', () => errorBody('invalid-state', {detail: fault.leak === 'reply' ? `the beacon holds ${token}` : 'the beacon takes no commands'}));
      if (fault.leak === 'log') log.info('operation.completed', {'bunny.message.id': token});
      if (fault.leak === 'message') await sdk.publish('bunny.state.kit-beacon.beacon-1', {kind: 'state', ...state()});
      const reach = async (): Promise<void> => {
        const controller = new AbortController();
        const cancel = scheduler.after(100, () => { controller.abort(); });
        try {
          await device.reach(token, controller.signal);
          beacon.availability = 'available';
        } catch {
          beacon.availability = 'unavailable';
        } finally {
          cancel();
        }
        beacon.revision += 1;
        await sdk.publish('bunny.state.kit-beacon.beacon-1', {kind: 'state', ...state()});
      };
      if (fault.waitInStart === true) await device.reach(token, new AbortController().signal);
      else scheduler.after(0, reach);
    },
    stop: () => {},
  };
}

const beaconSpec = (fault: BeaconFault = {}, config: unknown = {address: '192.0.2.20', secrets: {token: '/nowhere/beacon-token'}}): ConformanceSpec => ({
  create: () => beacon(new Lantern(true), fault),
  schemas,
  serves: ['kit-beacon'],
  config,
  secrets: {token: SECRET},
  refused: {key: 'bunny.cmd.kit-beacon.beacon-1', draft: {type: 'org.bunny.kit-beacon.ping.requested', subject: 'beacon-1', dataschema: PING_SCHEMA, data: {}}, code: 'invalid-state'},
  offline: {
    create: () => beacon(new Lantern(false), fault),
    unavailable: (message: Message) => message.dataschema === BEACON_SCHEMA && (message.data as Partial<Beacon>).availability === 'unavailable',
  },
  timeoutMs: 1000,
});

it('a configured module gets its own section, secret and folder, and passes every check, policy A\'s included', async () => {
  assert.deepEqual(conformanceChecks(beaconSpec()).map(check => check.name), [CHECKS.manifest, CHECKS.lifecycle, CHECKS.offline, CHECKS.serves, CHECKS.refuses]);
  assert.deepEqual(await failing(beaconSpec()), []);
});

it('the kit fails a module whose start waits on its device: policy A\'s check', async () => {
  // Reached in start, an online beacon answers at once, so only the check with an offline beacon catches it.
  assert.deepEqual(await failing(beaconSpec({waitInStart: true})), [CHECKS.offline]);
});

it('the kit catches a configuration the module refuses or lacks: the module never starts', async () => {
  const every = [CHECKS.manifest, CHECKS.lifecycle, CHECKS.offline, CHECKS.serves, CHECKS.refuses];
  assert.deepEqual(await failing(beaconSpec({}, {address: 7})), every);
  assert.deepEqual(await failing({...beaconSpec(), config: undefined}), every, 'a module with configure needs a section');
});

it('the kit catches a module that puts a secret it read in a log record, a message or a reply', async () => {
  assert.deepEqual(await failing(beaconSpec({leak: 'log'})), [CHECKS.lifecycle, CHECKS.offline, CHECKS.serves, CHECKS.refuses]);
  assert.deepEqual(await failing(beaconSpec({leak: 'message'})), [CHECKS.lifecycle, CHECKS.offline, CHECKS.serves, CHECKS.refuses]);
  assert.deepEqual(await failing(beaconSpec({leak: 'reply'})), [CHECKS.refuses]);
});

it('the harness gives a module only the secrets its section names, from memory, and a private folder', async context => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-harness-'));
  context.after(() => rm(dir, {recursive: true, force: true}));
  let seen: ModuleContext | undefined;
  const harness = new ModuleHarness({manifest: {name: 'probe', apiVersion: '1.1'}, start: given => { seen = given; }, stop: () => {}}, {
    bus: new InProcessBus(), stateDir: dir, section: {secrets: {token: '/nowhere/token', missing: '/nowhere/missing'}}, secrets: {token: `${SECRET}\n`, other: 'x'},
  });
  await harness.start();
  assert.ok(seen);
  assert.equal(await seen.secrets.read('token'), SECRET, 'without its trailing line break');
  const code = (expected: string) => (error: unknown): boolean => error instanceof Error && 'body' in error && (error.body as {error: {code: string}}).error.code === expected;
  await assert.rejects(seen.secrets.read('other'), code('not-found'), 'a secret the section does not name');
  await assert.rejects(seen.secrets.read('missing'), code('not-found'), 'a named secret with no file');
  const folder = seen.files();
  assert.equal(folder, join(dir, 'probe'));
  assert.equal((await stat(folder)).mode & 0o777, 0o700);
  assert.equal(seen.config, undefined, 'a module without configure has no configuration');
  await harness.stop();
  await assert.rejects(seen.secrets.read('token'), code('invalid-state'));
  assert.throws(() => seen?.files(), code('invalid-state'));
});

it('loading the kit neither loads nor starts node:test, so another runner can use its checks', () => {
  const kit = new URL('../src/testing/index.js', import.meta.url).href;
  const probe = `await import(${JSON.stringify(kit)}); console.log(process.moduleLoadList.some(name => name.includes('test_runner')));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'false');
});
