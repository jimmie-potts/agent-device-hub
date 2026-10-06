// The module test kit (Hub #882): one conformance suite that every module runs in a few lines. A small bulb module
// passes it; each broken variant fails exactly the check that names its fault.
import assert from 'node:assert/strict';
import {errorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {Outbox, type BunnyModule, type Command} from '../src/index.js';
import {CHECKS, conformanceChecks, moduleConformance, type ConformanceSpec} from '../src/testing/index.js';
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
type Fault = {name?: string; plainOutcome?: boolean; refuseWith?: ErrorCode; hangingStop?: boolean; dimState?: boolean};
type Switch = {power: 'on' | 'off'};

/** A bulb module: it serves its bulbs through sync, switches one on command and reports the outcome through its outbox. */
function bulb(fault: Fault = {}): BunnyModule {
  return {
    manifest: {name: fault.name ?? 'bulb', apiVersion: '1.0'},
    async start({sdk, database, clock, scheduler}) {
      const db = database();
      db.exec('CREATE TABLE IF NOT EXISTS bulbs (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, power TEXT NOT NULL)');
      db.exec('INSERT OR IGNORE INTO bulbs VALUES (\'b1\', 0, \'off\')');
      const outbox = new Outbox({sdk, database: db, clock, scheduler});
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
        await outbox.transaction(add => {
          const revision = found.revision + 1;
          db.prepare('UPDATE bulbs SET revision = ?, power = ? WHERE id = ?').run(revision, command.data.power, found.id);
          add(`bunny.state.kit-bulb.${found.id}`, {kind: 'state', ...state({...found, revision, power: command.data.power})}, {parent: command});
          if (fault.plainOutcome !== true) add(`bunny.event.kit-bulb.${found.id}`, outcome, {parent: command});
        });
        if (fault.plainOutcome === true) await sdk.publish(`bunny.event.kit-bulb.${found.id}`, outcome, {parent: command});
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
  assert.deepEqual(await failing(spec({name: 'Bulb'})), [CHECKS.manifest]);
});

it('the kit catches a refusal with another code than the module declares', async () => {
  assert.deepEqual(await failing(spec({refuseWith: 'invalid-state'})), [CHECKS.refuses]);
});

it('the kit catches a stop that never finishes', async () => {
  assert.deepEqual(await failing(spec({hangingStop: true})), [CHECKS.lifecycle, CHECKS.outbox]);
});

it('the kit catches a message that breaks its payload schema', async () => {
  // Every state the bulb sends says `dim`, which its schema does not allow: in a sync and in what the command publishes.
  assert.deepEqual(await failing(spec({dimState: true})), [CHECKS.serves, CHECKS.accepts, CHECKS.outbox]);
});
