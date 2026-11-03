// The Volcano module's rig: the real module on a bus and a private store, a manual clock and scheduler, and a synthetic
// collector part that publishes snapshots as the real one does. All data here is synthetic.
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {VOLCANO_OBSERVATION_SCHEMA, VOLCANO_OBSERVATION_TYPE, volcanoFeedId, volcanoObservationKey, type VolcanoFeed, type VolcanoObservation, type VolcanoReading} from '@jimmie-potts/event-contracts/v2/families';
import {InProcessBus, type Participant, type Scheduler} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createVolcanoModule, type SyntheticFeed} from '../src/module.js';
import type {VolcanoStatus} from '../src/status.js';

export const SECTION = {id: 'volcano', label: 'Volcano', hostId: 'host-a', sourceId: 'volcano-a'};
export const FEED: VolcanoFeed = {provider: 'storz-bickel', client: 'volcano', hostId: 'host-a', sourceId: 'volcano-a'};
export const FEED_ID = volcanoFeedId(FEED);
export const COLLECTOR = 'bunny/parts/hub-00000000000000000000000000000615';
export const START = Date.parse('2026-11-03T20:00:00.000Z');
/** Register values from the live trial: idle, heater on, the device's own pump run, and a pump run from the button. */
export const IDLE = 0x0603, HEATING = 0x0623, SELF_PUMP = 0x2623, BUTTON_PUMP = 0x3623;

export const reading = (fields: Partial<VolcanoReading> = {}): VolcanoReading =>
  ({status1: IDLE, status2: 0x0200, currentDeciC: 400, targetDeciC: 1850, heatingHours: 12, heatingMinutes: 5, ...fields});

export function manualClock(start = START): {now: () => number; scheduler: Scheduler; advance: (ms: number) => void} {
  let now = start;
  const timers = new Set<{at: number; callback: () => void}>();
  return {
    now: () => now,
    scheduler: {after: (delayMs, callback) => {
      const timer = {at: now + delayMs, callback};
      timers.add(timer);
      return () => { timers.delete(timer); };
    }},
    advance: ms => {
      now += ms;
      for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
        if (timer.at > now) break;
        if (timers.delete(timer)) timer.callback();
      }
    },
  };
}

export const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 8; turn += 1) await new Promise(resolve => { setImmediate(resolve); });
};

type Part = Pick<Participant, 'publish'>;

export class Rig {
  readonly clock = manualClock();
  readonly bus = new InProcessBus({now: this.clock.now});
  readonly collector = this.bus.connect(COLLECTOR);
  readonly operator = this.bus.connect('bunny/parts/operator');
  readonly observer = this.bus.connect('bunny/parts/observer');
  statuses: VolcanoStatus[] = [];
  devices: DeviceRecord[] = [];
  outcomes: Message[] = [];
  host!: ModuleHarness;
  dir = '';
  epoch = 'epoch-a';
  sequence = 0;
  /** While true, whatever the module publishes is lost as a crash would lose it. */
  publicationsLost = false;
  feed: SyntheticFeed | undefined;

  static async open(feed?: SyntheticFeed): Promise<Rig> {
    const rig = new Rig();
    rig.feed = feed;
    rig.dir = await mkdtemp(join(tmpdir(), 'volcano-module-'));
    await rig.observer.subscribe<VolcanoStatus>('bunny.state.volcano-status.*', message => { rig.statuses.push(message.data); });
    await rig.observer.subscribe<DeviceRecord>('bunny.state.device.*', message => { rig.devices.push(message.data); });
    await rig.observer.subscribe('bunny.event.volcano-session-gap.*', message => { rig.outcomes.push(message); });
    await rig.start();
    return rig;
  }

  module = createVolcanoModule();

  async start(): Promise<void> {
    this.module = createVolcanoModule(this.feed === undefined ? {} : {feed: this.feed});
    const {bus} = this;
    const lossy = {connect: (source: string) => {
      const participant = bus.connect(source);
      return new Proxy(participant, {get: (target, property, receiver) => {
        if (property !== 'publishMessage') {
          const value: unknown = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        }
        return (key: string, message: Message) => {
          if (this.publicationsLost) return Promise.reject(new Error('synthetic lost publication'));
          return target.publishMessage(key, message);
        };
      }});
    }} as unknown as InProcessBus;
    this.host = new ModuleHarness(this.module, {bus: lossy, clock: {now: this.clock.now}, scheduler: this.clock.scheduler, stateDir: this.dir, section: SECTION});
    await this.host.start();
    await settle();
  }

  async stopModule(): Promise<void> {
    await this.host.stop();
  }

  async restart(): Promise<void> {
    await this.stopModule();
    await this.start();
  }

  async close(): Promise<void> {
    await this.host.stop();
    await Promise.all([this.collector.close(), this.operator.close(), this.observer.close()]);
    await rm(this.dir, {recursive: true, force: true});
  }

  /** One snapshot on the feed's key, stamped now unless it says otherwise, as the collector sends it. */
  async send(fields: Partial<Omit<VolcanoObservation, 'feed'>> = {}, part: Part = this.collector, feed: VolcanoFeed = FEED): Promise<void> {
    this.sequence += 1;
    const data: VolcanoObservation = {feed, observedAtMs: this.clock.now(), collectorEpoch: this.epoch, sequence: this.sequence, link: 'connected', reading: reading(), ...fields};
    await part.publish(volcanoObservationKey(FEED), {kind: 'occurrence', type: VOLCANO_OBSERVATION_TYPE, subject: volcanoFeedId(feed), dataschema: VOLCANO_OBSERVATION_SCHEMA, data});
    await settle();
  }

  /** Moves the clock by `ms` and sends one snapshot. */
  async after(ms: number, fields: Partial<Omit<VolcanoObservation, 'feed'>> = {}): Promise<void> {
    this.clock.advance(ms);
    await this.send(fields);
  }

  /** One authenticated read through the module's own manifest, as the gateway calls it. */
  async read<T>(ref: string, query: Record<string, string> = {}): Promise<T> {
    const content = await this.module.manifest.content?.(ref, {query, signal: new AbortController().signal});
    if (content === undefined) throw new Error(`${ref} is not served`);
    if (!('bytes' in content)) return content as T;
    return JSON.parse(Buffer.from(content.bytes).toString('utf8')) as T;
  }

  status(): Promise<VolcanoStatus> {
    return this.read<VolcanoStatus>('status');
  }

  async facts(): Promise<{kind: string; [key: string]: unknown}[]> {
    return (await this.read<{facts: {kind: string}[]}>('timeline')).facts;
  }

  factRows(): number {
    return Number((this.host.moduleDatabase()?.prepare('SELECT COUNT(*) AS n FROM volcano_facts').get() as {n: number} | undefined)?.n);
  }

  gap(data: Record<string, unknown>, requestId: string, timeoutMs = 1000): ReturnType<Participant['request']> {
    return this.operator.request('bunny.cmd.volcano-session-gap.volcano', {type: 'org.bunny.volcano-session.gap.requested', subject: 'volcano', dataschema: 'https://bunny.invalid/events/volcano-session-gap/2.0', data}, {requestId, timeoutMs});
  }
}
