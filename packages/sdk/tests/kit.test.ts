// The module test kit (Hub #882): one conformance suite that every module runs in a few lines. A small bulb module
// passes it; each broken variant fails exactly the check that names its fault.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {errorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {InProcessBus, Outbox, type BunnyModule, type Command, type ModuleContext, type StateDraft} from '../src/index.js';
import {CHECKS, ModuleHarness, checkModuleRecord, conformanceChecks, moduleConformance, type ConformanceSpec, type HarnessRecord} from '../src/testing/index.js';
import {it} from './support.js';

const BASE = 'https://bunny.invalid/events/';
const BULB_SCHEMA = `${BASE}kit-bulb/2.0`;
const SWITCH_SCHEMA = `${BASE}kit-bulb-switch/2.0`;
const block = (name: string): object => ({$ref: `${BASE}blocks/2.0#/$defs/${name}`});
const power = {enum: ['on', 'off']};
const schemas = {
  [BULB_SCHEMA]: {type: 'object', additionalProperties: false, required: ['id', 'revision', 'power'], properties: {id: block('id'), revision: block('revision'), power}},
  [SWITCH_SCHEMA]: {type: 'object', additionalProperties: false, required: ['requestId', 'power'], properties: {requestId: block('requestId'), power}},
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

it('loading the kit neither loads nor starts node:test, so another runner can use its checks', () => {
  const kit = new URL('../src/testing/index.js', import.meta.url).href;
  const probe = `await import(${JSON.stringify(kit)}); console.log(process.moduleLoadList.some(name => name.includes('test_runner')));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'false');
});
