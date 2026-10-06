// The fixture module (Hub #882): a simulated lamp, the stand-in module that later stories use (#846). It passes the
// module test kit. It serves its lamps through sync, copies the core's mode, switches a lamp on command and reports
// the change, an occurrence and the outcome through its outbox. Quiet mode keeps the lamps off.
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import {Outbox, type BunnyModule, type Command, type CommandDraft, type Draft, type Snapshot, type StateDraft} from '@jimmie-potts/sdk';
import {followStandInAcks, type ConformanceSpec} from '@jimmie-potts/sdk/testing';

const BASE = 'https://bunny.invalid/events/';
export const LAMP_SCHEMA = `${BASE}lamp/2.0`;
export const LAMP_SWITCH_SCHEMA = `${BASE}lamp-switch/2.0`;
export const LAMP_SWITCHED_SCHEMA = `${BASE}lamp-switched/2.0`;
const OUTCOME_SCHEMA = `${BASE}outcome/2.0`;
const block = (name: string): object => ({$ref: `${BASE}blocks/2.0#/$defs/${name}`});
const closed = (properties: Record<string, object>): object =>
  ({type: 'object', additionalProperties: false, required: Object.keys(properties), properties});
const power = {enum: ['on', 'off']};

/** The lamp's payload schemas, by `dataschema`, for validators and the kit. */
export const lampSchemas: Readonly<Record<string, object>> = {
  [LAMP_SCHEMA]: closed({id: block('id'), revision: block('revision'), power}),
  [LAMP_SWITCH_SCHEMA]: closed({requestId: block('requestId'), power}),
  [LAMP_SWITCHED_SCHEMA]: closed({lamp: block('id'), power, revision: block('revision')}),
};

export type Power = 'on' | 'off';
export type Lamp = {id: string; revision: number; power: Power};
/** What the lamp's indicator shows: whether an agent session waits for a person. */
export type Indicator = 'idle' | 'attention';
/** What the simulated lamps show, as plain data: each lamp's power, the indicator, and every switch the device got. */
export type LampDeviceState = {power: Record<string, Power>; indicator: Indicator; held: boolean; calls: {lamp: string; power: Power}[]};
export type LampOptions = {
  /** The lamps it simulates, all off at first. Defaults to `lamp-1`. */
  lamps?: readonly string[];
  /** Runs just before each message leaves the outbox. A crash test kills the process here, after the commit. */
  beforePublish?: () => void;
};

/** A command that switches one lamp. */
export const switchLamp = (lamp: string, to: Power): {key: string; draft: CommandDraft<{power: Power}>} => ({
  key: `bunny.cmd.lamp.${lamp}`,
  draft: {type: 'org.bunny.lamp.switch.requested', subject: lamp, dataschema: LAMP_SWITCH_SCHEMA, data: {power: to}},
});

const lampState = ({id, revision, power: on}: Lamp): StateDraft<Lamp> =>
  ({type: 'org.bunny.lamp.updated', subject: id, dataschema: LAMP_SCHEMA, data: {id, revision, power: on}});

export function lamp(options: LampOptions = {}): BunnyModule {
  return {
    manifest: {name: 'lamp', apiVersion: '1.0'},
    async start({sdk, database, clock, log}) {
      const db = database();
      db.exec('CREATE TABLE IF NOT EXISTS lamps (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, power TEXT NOT NULL) STRICT');
      const seed = db.prepare('INSERT OR IGNORE INTO lamps (id, revision, power) VALUES (?, 0, \'off\')');
      for (const id of options.lamps ?? ['lamp-1']) seed.run(id);
      const lamps = (): Lamp[] => db.prepare('SELECT id, revision, power FROM lamps ORDER BY id').all() as Lamp[];
      const revision = (): number => Math.max(0, ...lamps().map(row => row.revision));

      const {beforePublish} = options;
      const outbox = new Outbox({
        sdk: {source: sdk.source, publishMessage: (key, message) => {
          beforePublish?.();
          return sdk.publishMessage(key, message);
        }},
        database: db, clock,
      });
      // Until Hub #782 defines the core's acknowledgment, the stand-in core's lets the outbox forget a recorded outcome.
      await followStandInAcks(sdk, outbox, id => { log.info('lamp.outcome.acknowledged', {id}); });
      // What a crash kept from going out, and every outcome the core has not acknowledged, go out again.
      const count = await outbox.republish();
      log.info('lamp.outbox.republished', {count});

      const modes = await sdk.sync<{mode: string}>(['mode'], () => {}, {timeoutMs: 5000});
      if (modes.status === 'rejected') throw new Error(`the lamp could not sync the mode: ${modes.error.error.code}`);
      const quiet = (): boolean => modes.copy.states().some(state => state.data.mode === 'quiet');

      await sdk.serveSync(['lamp'], (): Snapshot => ({revision: revision(), states: lamps().map(lampState)}));
      await sdk.respond<{power: Power}>('bunny.cmd.lamp.*', async (command: Command<{power: Power}>): Promise<{status: 'accepted'} | ErrorBody> => {
        log.info('lamp.command.received', {lamp: command.subject, power: command.data.power}, command);
        const found = lamps().find(row => row.id === command.subject);
        if (found === undefined) return errorBody('not-found', {detail: 'no such lamp'});
        if (quiet() && command.data.power === 'on') return errorBody('invalid-state', {detail: 'quiet mode keeps the lamps off'});
        await outbox.transaction(add => {
          const next: Lamp = {id: found.id, revision: revision() + 1, power: command.data.power};
          db.prepare('UPDATE lamps SET revision = ?, power = ? WHERE id = ?').run(next.revision, next.power, next.id);
          const switched: Draft<{lamp: string; power: Power; revision: number}> = {
            kind: 'occurrence', type: 'org.bunny.lamp.switched', subject: next.id, dataschema: LAMP_SWITCHED_SCHEMA,
            data: {lamp: next.id, power: next.power, revision: next.revision},
          };
          const outcome: Draft<{requestId: string; result: 'succeeded'; evidence: 'observed'}> = {
            kind: 'outcome', type: 'org.bunny.lamp.switch.completed', subject: next.id, dataschema: OUTCOME_SCHEMA,
            data: {requestId: command.data.requestId, result: 'succeeded', evidence: 'observed'},
          };
          add(`bunny.state.lamp.${next.id}`, {kind: 'state', ...lampState(next)}, {parent: command});
          add(`bunny.event.lamp.${next.id}`, switched, {parent: command});
          add(`bunny.event.lamp.${next.id}`, outcome, {parent: command});
        });
        log.info('lamp.switched', {lamp: found.id, power: command.data.power}, command);
        return {status: 'accepted'};
      });
    },
    stop: () => {},
  };
}

/** The core's mode as the kit's stand-in owner serves it. */
export type ModeRecord = {id: string; revision: number; mode: 'work' | 'free' | 'quiet'; selectedAtMs: number};
export const modeState = (mode: ModeRecord['mode'], selectedAtMs = Date.parse('2026-10-06T12:00:00.000Z')): StateDraft<ModeRecord> => ({
  type: 'org.bunny.mode.updated', subject: 'hub', dataschema: `${BASE}mode/2.0`, data: {id: 'hub', revision: 1, mode, selectedAtMs},
});

/** The kit's description of the lamp. */
export const lampSpec = (options: LampOptions = {}): ConformanceSpec => ({
  create: () => lamp(options),
  schemas: lampSchemas,
  serves: ['lamp'],
  copies: {families: ['mode'], snapshot: {revision: 1, states: [modeState('work')]}},
  accepted: switchLamp('lamp-1', 'on'),
  refused: {...switchLamp('lamp-9', 'on'), code: 'not-found'},
});
