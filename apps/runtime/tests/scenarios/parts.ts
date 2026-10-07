// What every execution adapter of the scenario catalog shares (Hub #846, #920): the parts' sources, the reader's
// copies, the validator every message a harness sees must pass, and how a request's result reads as an answer.
import {chmod, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {MessageValidator, SCHEMA_BASE, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerDeviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {registerLifxFamilies} from '@jimmie-potts/lifx';
import type {SimulatedSpeakers} from '@jimmie-potts/playback';
import type {Participant, RequestResult, SyncChange, SyncedCopy} from '@jimmie-potts/sdk';
import {standInAckSchemas} from '@jimmie-potts/sdk/testing';
import {CONFIG_SCHEMA} from '../../src/index.js';
import {historySchemas} from '../fixtures/core.js';
import {lampSchemas} from '../fixtures/lamp.js';
import {SYNTHETIC_TOKEN, signSchemas} from '../fixtures/sign.js';
import type {Follow, ReaderView, Role, Seed, Simulation} from './catalog.js';

/** A part's source: `bunny/parts/<role>`, never a module's or the core's. */
export const sourceOf = (role: Role): string => `bunny/parts/${role}`;

/** Profile 2.0 with the core and device families, and every module and fixture family the catalog's messages use. */
export function scenarioValidator(): MessageValidator {
  const validator = new MessageValidator();
  registerCoreFamilies(validator);
  registerDeviceFamilies(validator);
  for (const [dataschema, schema] of Object.entries({...standInAckSchemas, ...lampSchemas, ...signSchemas, ...historySchemas})) validator.register(dataschema, schema);
  registerLifxFamilies(validator);
  return validator;
}

/**
 * Writes a seed's configuration as the cutover's installer would (Hub #919, #935): in `dir`, a private configuration
 * file with each configured module's section, and one private token file per module holding the synthetic token,
 * which the module's section names as `secrets.token`. Returns the configuration file's path for `--config`.
 */
export async function writeConfiguration(dir: string, config: NonNullable<Seed['config']>): Promise<string> {
  const secrets = join(dir, 'secrets');
  for (const folder of [dir, secrets]) {
    await mkdir(folder, {recursive: true, mode: 0o700});
    await chmod(folder, 0o700);
  }
  const modules: Record<string, object> = {};
  for (const [name, section] of Object.entries(config)) {
    const token = join(secrets, `${name}-token`);
    await writeFile(token, `${SYNTHETIC_TOKEN}\n`, {mode: 0o600});
    await chmod(token, 0o600);
    modules[name] = {...section, secrets: {token}};
  }
  const file = join(dir, 'runtime-config.json');
  await writeFile(file, `${JSON.stringify({schema: CONFIG_SCHEMA, modules}, null, 2)}\n`, {mode: 0o600});
  await chmod(file, 0o600);
  return file;
}

/** Makes the playback module's simulated speakers do what a scenario asks (Hub #929), in either harness. */
export function simulatePlayback(speakers: SimulatedSpeakers, {speaker, action, title}: Extract<Simulation, {device: 'playback'}>): void {
  switch (action) {
    case 'play':
      speakers.play(speaker, title === undefined ? undefined : {title});
      return;
    case 'pause':
      speakers.pause(speaker);
      return;
    case 'stop':
      speakers.stop(speaker);
      return;
    case 'other-input':
      speakers.otherInput(speaker);
      return;
    case 'silent':
      speakers.silent(speaker);
      return;
    case 'slow':
      speakers.slow(speaker);
      return;
    case 'answer':
      speakers.answer(speaker);
      return;
    case 'refuse-next':
      speakers.nextCommand(speaker, 'refuse');
      return;
    case 'hang-next':
      speakers.nextCommand(speaker, 'hang');
      return;
  }
}

/** A request's answer as the catalog reads it: `accepted`, or the refusal's or uncertain result's error code. */
export const answerOf = (result: RequestResult): string => result.status === 'accepted' ? 'accepted' : result.error.error.code;

export const describe = (error: unknown): string => error instanceof Error ? `${error.name}: ${error.message}` : String(error);

type Copy = SyncedCopy<Record<string, unknown>>;
/** One copy the reader keeps: its families, and the owner it names, if any. */
type Group = {families: readonly string[]; owner?: string};
const groupOf = (follow: Follow): Group => 'families' in follow ? follow : {families: follow};
/** A group as a problem names it: its families, and its owner when it names one. */
const named = ({families, owner}: Group): string => `${families.join(',')}${owner === undefined ? '' : ` from ${owner}`}`;

/** The reader's copies, one per owner, how often each synced, every occurrence and outcome it heard and its gap notices. */
export class Reader implements ReaderView {
  readonly groups: readonly Group[];
  copies: (Copy | undefined)[] = [];
  readonly counts: number[];
  readonly messages: Message[] = [];
  gapNotices = 0;

  constructor(follows: Seed['follows']) {
    this.groups = follows.map(groupOf);
    this.counts = follows.map(() => 0);
  }

  families(): readonly string[] {
    return [...new Set(this.groups.flatMap(group => group.families))];
  }

  /** The current states of `family` in the copies that hold it, or only in the copy from `owner` when one is named. */
  states<T>(family: string, owner?: string): Message<T>[] {
    return this.#holding(family, owner).flatMap(index => this.copies[index]?.states() ?? [])
      .filter(state => state.dataschema === `${SCHEMA_BASE}${family}/2.0`) as Message<T>[];
  }

  syncs(family: string, owner?: string): number {
    const [index] = this.#holding(family, owner);
    return index === undefined ? 0 : this.counts[index] ?? 0;
  }

  /** The indexes of the copies that hold `family`, from `owner` when one is named. */
  #holding(family: string, owner: string | undefined): number[] {
    return this.groups.flatMap((group, index) => group.families.includes(family) && (owner === undefined || group.owner === owner) ? [index] : []);
  }

  heard(): readonly Message[] {
    return this.messages;
  }

  gaps(): number {
    return this.gapNotices;
  }
}

/** Where a harness sends what it saw: each message to check against profile 2.0, and each problem. */
export type Observer = {check: (message: unknown, where: string) => void; problem: (text: string) => void};

/**
 * The reader hears every occurrence and outcome on `participant`, and keeps a copy of each owner's families, synced
 * from the owner by name when the seed names one.
 */
export async function follow(participant: Participant, reader: Reader, follows: Seed['follows'], observer: Observer): Promise<void> {
  await participant.subscribe('bunny.event.*.*', message => {
    observer.check(message, 'a message the reader heard');
    reader.messages.push(message);
  }, {onOverflow: () => { reader.gapNotices += 1; }});
  for (const [index, group] of follows.map(groupOf).entries()) {
    const {families, owner} = group;
    const result = await participant.sync(families, change => { changed(reader, index, change, group, observer); }, {timeoutMs: 5000, ...owner === undefined ? {} : {owner}});
    if (result.status === 'rejected') observer.problem(`the reader could not sync ${named(group)}: ${result.error.error.code}`);
    else reader.copies[index] = result.copy;
  }
}

function changed(reader: Reader, index: number, change: SyncChange<Record<string, unknown>>, group: Group, observer: Observer): void {
  switch (change.type) {
    case 'updated':
      observer.check(change.message, 'a synced state');
      return;
    case 'removed':
      return;
    case 'synced':
      observer.check(change.message, 'sync.completed');
      reader.counts[index] = (reader.counts[index] ?? 0) + 1;
      return;
    case 'failed':
      observer.problem(`the reader's copy of ${named(group)} stopped: ${change.error.error.code}`);
      return;
  }
}
