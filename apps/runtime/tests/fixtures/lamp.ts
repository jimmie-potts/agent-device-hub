// The fixture module (Hub #882, #846): a lamp, the stand-in device module that later stories use. It shows the module
// factory convention: `createLampModule({transport})` takes how the module reaches its device, so a test or a run passes
// a simulated lamp and no hardware is touched. It passes the module test kit. It serves its lamps through sync, follows
// the core's mode and sessions, switches a lamp on command and reports the change, an occurrence and the outcome
// through its outbox. Quiet mode keeps the lamps off, and its indicator shows when an agent session waits for a person.
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {errorBody, type ErrorBody, type ErrorDetail} from '@jimmie-potts/event-contracts/v2';
import {Outbox, type BunnyModule, type Command, type CommandDraft, type Draft, type Snapshot, type StateDraft} from '@jimmie-potts/sdk';
import {followStandInAcks, type ConformanceSpec} from '@jimmie-potts/sdk/testing';

const BASE = 'https://bunny.invalid/events/';
export const LAMP_SCHEMA = `${BASE}lamp/2.0`;
export const LAMP_SWITCH_SCHEMA = `${BASE}lamp-switch/2.0`;
export const LAMP_SWITCHED_SCHEMA = `${BASE}lamp-switched/2.0`;
const OUTCOME_SCHEMA = `${BASE}outcome/2.0`;
const MODE_SCHEMA = `${BASE}mode/2.0`;
const SESSION_SCHEMA = `${BASE}session/2.0`;
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

/** How the lamp module reaches its lamps. A real transport would speak the device's protocol. */
export interface LampTransport {
  /** Switches one lamp and resolves with the power it reports afterwards. Rejects when the lamp cannot be reached. */
  switch(lamp: string, power: Power): Promise<Power>;
  /** Shows on the lamp's indicator whether an agent session waits for a person. */
  show(indicator: Indicator): void;
}

/**
 * Simulated lamps, the transport tests and runs give the lamp module. Like real lamps, they keep their state when the
 * runtime crashes or restarts. A test can hold every switch until it releases them, or make the next switch fail.
 */
export class SimulatedLamps implements LampTransport {
  readonly #power = new Map<string, Power>();
  readonly #calls: {lamp: string; power: Power}[] = [];
  #indicator: Indicator = 'idle';
  #held: {promise: Promise<void>; release: () => void} | undefined;
  #failNext = false;

  constructor(lamps: readonly string[] = ['lamp-1']) {
    for (const lamp of lamps) this.#power.set(lamp, 'off');
  }

  async switch(lamp: string, power: Power): Promise<Power> {
    // A lamp that cannot be reached never got the switch.
    if (this.#failNext) {
      this.#failNext = false;
      throw new Error('the lamp did not answer');
    }
    this.#calls.push({lamp, power});
    if (this.#held !== undefined) await this.#held.promise;
    if (!this.#power.has(lamp)) throw new Error('no such lamp');
    this.#power.set(lamp, power);
    return power;
  }

  show(indicator: Indicator): void {
    this.#indicator = indicator;
  }

  /** Holds every switch, from the next one on, until `release`. */
  hold(): void {
    if (this.#held !== undefined) return;
    let release = (): void => {};
    const promise = new Promise<void>(resolve => { release = resolve; });
    this.#held = {promise, release};
  }

  release(): void {
    this.#held?.release();
    this.#held = undefined;
  }

  /** The next switch fails as if the lamp could not be reached. */
  failNext(): void {
    this.#failNext = true;
  }

  state(): LampDeviceState {
    return {power: Object.fromEntries(this.#power), indicator: this.#indicator, held: this.#held !== undefined, calls: this.#calls.map(call => ({...call}))};
  }
}

export type LampOptions = {
  /** How the module reaches its lamps. */
  transport: LampTransport;
  /** The lamps it serves, off until switched. Defaults to `lamp-1`. */
  lamps?: readonly string[];
  /** Runs just before each message leaves the outbox. A crash test ends the runtime here, after the commit. */
  beforePublish?: () => void;
  /**
   * Hears each acknowledgment from the core before the outbox applies it. `lose` drops it, as a message lost on its way
   * would be, so the lamp keeps the outcome and reports it again at its next start.
   */
  onAcknowledgment?: () => 'apply' | 'lose';
};

/** A command that switches one lamp. */
export const switchLamp = (lamp: string, to: Power): {key: string; draft: CommandDraft<{power: Power}>} => ({
  key: `bunny.cmd.lamp.${lamp}`,
  draft: {type: 'org.bunny.lamp.switch.requested', subject: lamp, dataschema: LAMP_SWITCH_SCHEMA, data: {power: to}},
});

const lampState = ({id, revision, power: on}: Lamp): StateDraft<Lamp> =>
  ({type: 'org.bunny.lamp.updated', subject: id, dataschema: LAMP_SCHEMA, data: {id, revision, power: on}});
type Outcome = {requestId: string; result: 'succeeded' | 'failed'; evidence: 'observed' | 'none'; error?: ErrorDetail};

export function createLampModule({transport, lamps: served = ['lamp-1'], beforePublish, onAcknowledgment}: LampOptions): BunnyModule {
  return {
    manifest: {name: 'lamp', apiVersion: '1.0'},
    async start({sdk, database, clock, log}) {
      const db = database();
      db.exec(`CREATE TABLE IF NOT EXISTS lamps (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, power TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS handled (source TEXT NOT NULL, request_id TEXT NOT NULL, PRIMARY KEY (source, request_id)) STRICT`);
      const seed = db.prepare('INSERT OR IGNORE INTO lamps (id, revision, power) VALUES (?, 0, \'off\')');
      for (const id of served) seed.run(id);
      const lamps = (): Lamp[] => db.prepare('SELECT id, revision, power FROM lamps ORDER BY id').all() as Lamp[];
      const revision = (): number => Math.max(0, ...lamps().map(row => row.revision));
      const handled = db.prepare('SELECT 1 FROM handled WHERE source = ? AND request_id = ?');
      const handle = db.prepare('INSERT INTO handled (source, request_id) VALUES (?, ?)');

      const outbox = new Outbox({
        sdk: {source: sdk.source, publishMessage: (key, message) => {
          beforePublish?.();
          return sdk.publishMessage(key, message);
        }},
        database: db, clock,
      });
      // Until Hub #782 defines the core's acknowledgment, the stand-in core's lets the outbox forget a recorded outcome.
      const acknowledgments = {acknowledge: (id: string): boolean => onAcknowledgment?.() !== 'lose' && outbox.acknowledge(id)};
      await followStandInAcks(sdk, acknowledgments, id => { log.info('outbox.acknowledged', {'bunny.message.id': id}); });
      // What a crash kept from going out, and every outcome the core has not acknowledged, go out again.
      const count = await outbox.republish();
      log.info('outbox.republished', {'bunny.outbox.republished_count': count});

      // The core's mode and sessions: quiet mode keeps the lamps off, and the indicator shows a session that waits.
      let mode = 'work';
      const waiting = new Set<string>();
      let shown: Indicator | undefined;
      const follow = await sdk.sync<{id: string; mode?: string; attention?: SessionRecord['attention']}>(['mode', 'session'], change => {
        if (change.type === 'updated' && change.message.dataschema === MODE_SCHEMA) mode = change.message.data.mode ?? mode;
        if (change.type === 'updated' && change.message.dataschema === SESSION_SCHEMA) {
          if ((change.message.data.attention ?? []).length > 0) waiting.add(change.entity.id);
          else waiting.delete(change.entity.id);
        }
        if (change.type === 'removed' && change.entity.family === 'session') waiting.delete(change.entity.id);
        const indicator: Indicator = waiting.size > 0 ? 'attention' : 'idle';
        if (indicator !== shown) {
          shown = indicator;
          transport.show(indicator);
          log.info('feed.changed');
        }
      }, {timeoutMs: 5000});
      if (follow.status === 'rejected') throw new Error(`the lamp could not sync the core's mode and sessions: ${follow.error.error.code}`);

      await sdk.serveSync(['lamp'], (): Snapshot => ({revision: revision(), states: lamps().map(lampState)}));
      await sdk.respond<{power: Power}>('bunny.cmd.lamp.*', async (command: Command<{power: Power}>): Promise<{status: 'accepted'} | ErrorBody> => {
        const {requestId, power: wanted} = command.data;
        log.info('command.executing', {'bunny.device.id': command.subject, 'bunny.operation': 'power', 'bunny.request.id': requestId}, command);
        const found = lamps().find(row => row.id === command.subject);
        if (found === undefined) return errorBody('not-found', {detail: 'no such lamp'});
        // A command the lamp already handled, such as a retry with the same requestId, is accepted again and changes
        // nothing: its outcome went out once.
        if (handled.get(command.source, requestId) !== undefined) {
          log.info('command.completed', {'bunny.device.id': found.id, 'bunny.request.id': requestId, 'bunny.outcome': 'duplicate'}, command);
          return {status: 'accepted'};
        }
        if (mode === 'quiet' && wanted === 'on') return errorBody('invalid-state', {detail: 'quiet mode keeps the lamps off'});
        let next: Lamp | undefined;
        let outcome: Outcome;
        try {
          next = {id: found.id, revision: revision() + 1, power: await transport.switch(found.id, wanted)};
          outcome = {requestId, result: 'succeeded', evidence: 'observed'};
        } catch {
          // The device never answered: the outcome is failed, with no evidence that anything reached it.
          outcome = {requestId, result: 'failed', evidence: 'none', error: errorBody('unavailable', {requestId, detail: 'the lamp did not answer'}).error};
        }
        await outbox.transaction(add => {
          handle.run(command.source, requestId);
          if (next !== undefined) {
            db.prepare('UPDATE lamps SET revision = ?, power = ? WHERE id = ?').run(next.revision, next.power, next.id);
            const switched: Draft<{lamp: string; power: Power; revision: number}> = {
              kind: 'occurrence', type: 'org.bunny.lamp.switched', subject: next.id, dataschema: LAMP_SWITCHED_SCHEMA,
              data: {lamp: next.id, power: next.power, revision: next.revision},
            };
            add(`bunny.state.lamp.${next.id}`, {kind: 'state', ...lampState(next)}, {parent: command});
            add(`bunny.event.lamp.${next.id}`, switched, {parent: command});
          }
          add(`bunny.event.lamp.${found.id}`, {
            kind: 'outcome', type: 'org.bunny.lamp.switch.completed', subject: found.id, dataschema: OUTCOME_SCHEMA, data: outcome,
          }, {parent: command});
        });
        log.info('command.completed', {
          'bunny.device.id': found.id, 'bunny.request.id': requestId,
          ...(next === undefined ? {'bunny.outcome': 'failed', 'bunny.reason': 'unavailable'} : {'bunny.outcome': 'succeeded'}),
        }, command);
        return {status: 'accepted'};
      });
    },
    stop: () => {},
  };
}

/** The core's mode as the kit's stand-in owner serves it. */
export type ModeRecord = {id: string; revision: number; mode: 'work' | 'free' | 'quiet'; selectedAtMs: number};
export const modeState = (mode: ModeRecord['mode'], selectedAtMs = Date.parse('2026-10-06T12:00:00.000Z')): StateDraft<ModeRecord> => ({
  type: 'org.bunny.mode.updated', subject: 'hub', dataschema: MODE_SCHEMA, data: {id: 'hub', revision: 1, mode, selectedAtMs},
});

/** The kit's description of the lamp, on a fresh simulated device. */
export const lampSpec = (options: Omit<LampOptions, 'transport'> = {}): ConformanceSpec => ({
  create: () => createLampModule({...options, transport: new SimulatedLamps(options.lamps)}),
  schemas: lampSchemas,
  serves: ['lamp'],
  copies: {families: ['mode', 'session'], snapshot: {revision: 1, states: [modeState('work')]}},
  accepted: switchLamp('lamp-1', 'on'),
  refused: {...switchLamp('lamp-9', 'on'), code: 'not-found'},
});
