// Tier 1 of the runtime's scenario catalog (Hub #846): the in-memory harness. It hosts the scenario's modules in the
// runtime's own module host, in this process, on a manual clock and scheduler, with simulated devices that outlive a
// runtime crash as real ones would. The scenario's parts join the host's bus directly (in process), or reach it through
// a RemoteEdge served on 127.0.0.1 with run-generated tokens (remote). Its state lives in a private temporary directory
// outside every Git checkout, which `close` removes. Nothing reaches an installed service, port, personal state or
// device.
import {randomBytes} from 'node:crypto';
import {mkdtemp, realpath, rm} from 'node:fs/promises';
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MessageValidator, SCHEMA_BASE, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {
  RemoteEdge, connectRemote, type BunnyModule, type CommandDraft, type EdgeLogRecord, type Participant, type RequestResult, type SyncChange,
  type SyncedCopy,
} from '@jimmie-potts/sdk';
import {standInAckSchemas} from '@jimmie-potts/sdk/testing';
import {ModuleHost} from '../../src/host.js';
import type {LogRecord, ModuleHealth} from '../../src/index.js';
import {LogWriter} from '../../src/log.js';
import {prepareStateDirectory} from '../../src/state.js';
import {SimulatedChime, createChimeModule} from '../fixtures/chime.js';
import {createCoreModule, historySchemas} from '../fixtures/core.js';
import {SimulatedLamps, createLampModule, lampSchemas} from '../fixtures/lamp.js';
import {manualClock} from '../support.js';
import {ROLES, type DeviceStates, type Generational, type Harness, type ModuleName, type ReaderView, type Role, type Seed, type Simulation, type TransportName} from './catalog.js';

/** The ports of the installed Hub, the local controllers and their services, which a harness never listens on. */
export const INSTALLED_PORTS: readonly number[] = [8765, 8787, 8788, 8791, 41231];
/** How long a dropped part waits before it connects again, as the remote client's backoff does. */
const RECONNECT_MS = 20;
/** How far virtual time moves before real I/O, such as the edge's HTTP, gets to run. */
const STEP_MS = 10;
const SYNC_TIMEOUT_MS = 5000;

export interface MemoryHarness extends Harness {
  /** The private state directory the runtime uses across restarts. */
  readonly stateDir: string;
  /** The edge's origin on loopback, remotely; undefined in process. */
  readonly url: string | undefined;
  /** What went wrong outside the steps: messages that break profile 2.0, and errors a part or the runtime reported. */
  problems(): readonly string[];
  edgeLog(): readonly EdgeLogRecord[];
  /** The run-generated tokens, one per part, so a test can show they never leak. */
  tokens(): readonly string[];
  /** Stops everything the harness started and removes its state directory. */
  close(): Promise<void>;
}

const describe = (error: unknown): string => error instanceof Error ? `${error.name}: ${error.message}` : String(error);
const answerOf = (result: RequestResult): string => result.status === 'accepted' ? 'accepted' : result.error.error.code;
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 4; turn += 1) await new Promise(resolve => { setImmediate(resolve); });
  await new Promise(resolve => { setTimeout(resolve, 1); });
};

/** Listens on a free loopback port that `refused` accepts, by default one no installed service uses. */
export async function listenLoopback(server: Server, refused: (port: number) => boolean = port => INSTALLED_PORTS.includes(port)): Promise<number> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen({host: '127.0.0.1', port: 0}, () => {
        server.off('error', reject);
        resolve();
      });
    });
    const {port} = server.address() as AddressInfo;
    if (!refused(port)) return port;
    await new Promise<void>(resolve => { server.close(() => { resolve(); }); });
  }
  throw new Error('found no free loopback port outside the installed services\' ports');
}

type Generation = {host: ModuleHost; edge: RemoteEdge | undefined; watcher: Participant};
type Part = {role: Role; source: string; token: string; participant: Participant | undefined; closed: boolean};
type Copy = SyncedCopy<Record<string, unknown>>;

class Reader implements ReaderView {
  readonly groups: readonly (readonly string[])[];
  copies: (Copy | undefined)[] = [];
  readonly counts: number[];
  readonly messages: Message[] = [];

  constructor(groups: readonly (readonly string[])[]) {
    this.groups = groups;
    this.counts = groups.map(() => 0);
  }

  states<T>(family: string): Message<T>[] {
    const copy = this.copies[this.groups.findIndex(group => group.includes(family))];
    return (copy?.states() ?? []).filter(state => state.dataschema === `${SCHEMA_BASE}${family}/2.0`) as Message<T>[];
  }

  syncs(family: string): number {
    return this.counts[this.groups.findIndex(group => group.includes(family))] ?? 0;
  }

  heard(): readonly Message[] {
    return this.messages;
  }
}

class Memory implements MemoryHarness {
  readonly tier = 'memory';
  readonly transport: TransportName;
  readonly stateDir: string;
  readonly reader: Reader;
  url: string | undefined;
  readonly #seed: Seed;
  readonly #clock = manualClock();
  readonly #validator = new MessageValidator();
  readonly #lamps = new SimulatedLamps(['lamp-1']);
  readonly #chime = new SimulatedChime();
  readonly #parts: ReadonlyMap<Role, Part>;
  readonly #generations: Generation[] = [];
  readonly #logs: Generational<{record: LogRecord}>[] = [];
  readonly #published: Generational<{message: Message}>[] = [];
  readonly #edgeLog: EdgeLogRecord[] = [];
  readonly #problems: string[] = [];
  readonly #answers = new Map<string, string>();
  /** Participants that died with a crashed runtime: their requests are `lost`, whatever the old bus answers. */
  readonly #crashed = new WeakSet<Participant>();
  /** A restart or reconnect under way. Every call waits for them, and virtual time stands still meanwhile. */
  readonly #pending = new Set<Promise<void>>();
  /** What the retired runtimes and parts still release. */
  readonly #retiring: Promise<unknown>[] = [];
  #server: Server | undefined;
  #edge: Promise<RemoteEdge>;
  #edgeReady: (edge: RemoteEdge) => void = () => {};
  #armed = false;
  #loseAcknowledgment = false;
  #closing: Promise<void> | undefined;

  constructor(seed: Seed, transport: TransportName, stateDir: string) {
    this.#seed = seed;
    this.transport = transport;
    this.stateDir = stateDir;
    this.reader = new Reader(seed.follows);
    this.#parts = new Map(ROLES.map(role => [role, {role, source: `bunny/parts/${role}`, token: randomBytes(32).toString('base64url'), participant: undefined, closed: false}]));
    this.#edge = this.#nextEdge();
    registerCoreFamilies(this.#validator);
    for (const [dataschema, schema] of Object.entries({...standInAckSchemas, ...lampSchemas, ...historySchemas})) this.#validator.register(dataschema, schema);
  }

  async open(): Promise<void> {
    await prepareStateDirectory(this.stateDir);
    if (this.transport === 'remote') {
      const server = createServer((request, response) => { this.#serve(request, response); });
      // The edge never closes an idle connection under a remote part that is about to reuse it.
      server.keepAliveTimeout = 0;
      this.#server = server;
      this.url = `http://127.0.0.1:${await listenLoopback(server)}`;
    }
    await this.#boot();
    const report = this.#current().host.health().filter(module => !module.healthy);
    if (report.length > 0) throw new Error(`the runtime did not start: ${JSON.stringify(report)}`);
    for (const part of this.#parts.values()) await this.#connect(part);
  }

  now(): number {
    return this.#clock.now();
  }

  generation(): number {
    return this.#generations.length;
  }

  sdk(role: Role): Participant {
    const {participant} = this.#part(role);
    if (participant === undefined) throw new Error(`the ${role} is not connected`);
    return participant;
  }

  send(role: Role, label: string, {key, draft}: {key: string; draft: CommandDraft<object>}, options: {timeoutMs: number; requestId: string}): Promise<string> {
    const start = (): Promise<string> => {
      const participant = this.sdk(role);
      this.#answers.set(label, 'pending');
      return participant.request(key, draft, options).then(answerOf, (error: unknown) => `threw ${describe(error)}`).then(answer => {
        const final = this.#crashed.has(participant) ? 'lost' : answer;
        this.#answers.set(label, final);
        return final;
      });
    };
    // A request starts at once, so it keeps its place in the order a scenario sends them.
    return this.#pending.size === 0 ? start() : this.#settled().then(start);
  }

  answer(label: string): string {
    return this.#answers.get(label) ?? 'unsent';
  }

  devices(): DeviceStates {
    return {lamp: this.#lamps.state(), chime: this.#chime.state()};
  }

  simulate(simulation: Simulation): void {
    if (simulation.device === 'chime') {
      this.#chime.faultNext();
      return;
    }
    switch (simulation.action) {
      case 'hold':
        this.#lamps.hold();
        return;
      case 'release':
        this.#lamps.release();
        return;
      case 'fail-next':
        this.#lamps.failNext();
        return;
    }
  }

  async health(): Promise<readonly ModuleHealth[]> {
    await this.#settled();
    return this.#current().host.health();
  }

  logs(): readonly Generational<{record: LogRecord}>[] {
    return this.#logs;
  }

  published(): readonly Generational<{message: Message}>[] {
    return this.#published;
  }

  edgeLog(): readonly EdgeLogRecord[] {
    return this.#edgeLog;
  }

  tokens(): readonly string[] {
    return [...this.#parts.values()].map(part => part.token);
  }

  problems(): readonly string[] {
    const failed = this.#logs.filter(({record}) => record.event_name === 'runtime.handler.failed').map(({record}) => `runtime.handler.failed ${JSON.stringify(record.attributes)}`);
    return [...this.#problems, ...failed];
  }

  async wait(ms: number): Promise<void> {
    await this.#settled();
    for (let elapsed = 0; elapsed < ms; elapsed += STEP_MS) {
      this.#clock.advance(Math.min(STEP_MS, ms - elapsed));
      await settle();
      await this.#settled();
    }
  }

  async disconnect(role: Role): Promise<void> {
    await this.#settled();
    const part = this.#part(role);
    if (this.transport === 'remote') {
      // The edge ends the part's stream; the remote client reconnects after its backoff and tells its copies to sync.
      this.#current().edge?.disconnect(part.source);
      return;
    }
    await this.#retire(part, false);
    this.#clock.scheduler.after(RECONNECT_MS, () => { this.#track(this.#connect(part)); });
  }

  async closePart(role: Role): Promise<void> {
    await this.#settled();
    const part = this.#part(role);
    part.closed = true;
    await this.#retire(part, false);
  }

  armCrash(): void {
    this.#armed = true;
  }

  loseAcknowledgment(): void {
    this.#loseAcknowledgment = true;
  }

  async restart(): Promise<void> {
    await this.#settled();
    const old = this.#current();
    this.#edge = this.#nextEdge();
    await old.host.stop();
    // The stopped process's connections end with it.
    this.#server?.closeAllConnections();
    if (this.transport === 'in-process') for (const part of this.#parts.values()) await this.#retire(part, false);
    this.#release(old.edge?.close(), old.watcher.close());
    await this.#boot();
    if (this.transport === 'in-process') for (const part of this.#parts.values()) await this.#connect(part);
  }

  close(): Promise<void> {
    this.#closing ??= (async () => {
      // A held switch would keep the lamp's handler, and so its stop, waiting for good.
      this.#lamps.release();
      await this.#settled().catch(() => {});
      for (const part of this.#parts.values()) {
        part.closed = true;
        await this.#retire(part, false);
      }
      for (const generation of this.#generations) await generation.edge?.close();
      const server = this.#server;
      if (server !== undefined) {
        server.closeAllConnections();
        await new Promise<void>(resolve => { server.close(() => { resolve(); }); });
      }
      for (const generation of this.#generations) await Promise.all([generation.watcher.close(), generation.host.stop()]);
      await Promise.allSettled(this.#retiring);
      await rm(this.stateDir, {recursive: true, force: true});
    })();
    return this.#closing;
  }

  /** Starts the next runtime on the same state directory: a fresh module host, bus and edge, with every module rebuilt. */
  async #boot(): Promise<void> {
    const number = this.#generations.length + 1;
    const clock = {now: this.#clock.now};
    const logs = new LogWriter(record => { this.#logs.push({generation: number, record}); }, 'info', clock);
    const modules = this.#seed.modules.map(name => this.#build(name));
    const host = new ModuleHost(modules, {clock, scheduler: this.#clock.scheduler, stateDir: this.stateDir, logs, startTimeoutMs: 10_000, stopTimeoutMs: 5000});
    const watcher = host.bus.connect('bunny/harness/watcher');
    await watcher.subscribe('bunny.*.*.*', message => {
      this.#check(message, 'a published message');
      this.#published.push({generation: number, message});
    });
    await host.start();
    const edge = this.transport === 'remote' ? new RemoteEdge({
      bus: host.bus, validator: this.#validator, grants: [...this.#parts.values()].map(({source, token}) => ({source, token})),
      log: record => { this.#edgeLog.push(record); }, now: this.#clock.now, scheduler: this.#clock.scheduler,
    }) : undefined;
    this.#generations.push({host, edge, watcher});
    if (edge !== undefined) this.#edgeReady(edge);
  }

  /** Each module from its factory, with its simulated transport. */
  #build(name: ModuleName): BunnyModule {
    switch (name) {
      case 'core':
        return createCoreModule();
      case 'lamp':
        return createLampModule({transport: this.#lamps, beforePublish: () => { this.#crashPoint(); }, onAcknowledgment: () => {
          if (!this.#loseAcknowledgment) return 'apply';
          this.#loseAcknowledgment = false;
          return 'lose';
        }});
      case 'chime':
        return createChimeModule({transport: this.#chime});
    }
  }

  /**
   * The armed crash, between the lamp's commit and its publish. Remote parts see the runtime go away: every connection
   * to its edge ends at once, with the calls in flight. In-process parts die with it. The throw ends the lamp's work
   * there, as the process's end would, and the runtime starts again on the same state directory.
   */
  #crashPoint(): void {
    if (!this.#armed) return;
    this.#armed = false;
    const old = this.#current();
    this.#edge = this.#nextEdge();
    this.#server?.closeAllConnections();
    // Marked at once, before the old bus can answer any of their requests.
    for (const {participant} of this.#parts.values()) if (this.transport === 'in-process' && participant !== undefined) this.#crashed.add(participant);
    this.#track((async () => {
      if (this.transport === 'in-process') for (const part of this.#parts.values()) await this.#retire(part, true);
      // Nothing of the old runtime is used again; its host is stopped only to release what it holds.
      this.#release(old.edge?.close(), old.watcher.close(), old.host.stop());
      await this.#boot();
      if (this.transport === 'in-process') for (const part of this.#parts.values()) await this.#connect(part);
    })());
    throw new Error('the runtime crashed');
  }

  /** A request to the edge waits while the runtime restarts, as a remote part's connection would wait for the port. */
  #serve(request: IncomingMessage, response: ServerResponse): void {
    void this.#edge.then(edge => { edge.handle(request, response); });
  }

  #nextEdge(): Promise<RemoteEdge> {
    return new Promise(resolve => { this.#edgeReady = resolve; });
  }

  async #connect(part: Part): Promise<void> {
    if (part.closed) return;
    const url = this.url;
    const participant = this.transport === 'remote' && url !== undefined ? await connectRemote({
      url, source: part.source, token: part.token, now: this.#clock.now, scheduler: this.#clock.scheduler, reconnectDelayMs: RECONNECT_MS,
      onError: (error, scope) => { this.#problem(`${scope.source} on ${scope.pattern}: ${describe(error)}`); },
    }) : this.#current().host.bus.connect(part.source);
    part.participant = participant;
    if (part.role === 'reader') await this.#follow(participant);
  }

  /** The reader hears every occurrence and outcome, and keeps a copy of each owner's families. */
  async #follow(participant: Participant): Promise<void> {
    await participant.subscribe('bunny.event.*.*', message => { this.reader.messages.push(message); });
    for (const [index, families] of this.#seed.follows.entries()) {
      const result = await participant.sync(families, change => { this.#change(index, change); }, {timeoutMs: SYNC_TIMEOUT_MS});
      if (result.status === 'rejected') this.#problem(`the reader could not sync ${families.join(',')}: ${result.error.error.code}`);
      else this.reader.copies[index] = result.copy;
    }
  }

  #change(index: number, change: SyncChange<Record<string, unknown>>): void {
    switch (change.type) {
      case 'updated':
        this.#check(change.message, 'a synced state');
        return;
      case 'removed':
        return;
      case 'synced':
        this.#check(change.message, 'sync.completed');
        this.reader.counts[index] = (this.reader.counts[index] ?? 0) + 1;
        return;
      case 'failed':
        this.#problem(`the reader's copy of ${this.#seed.follows[index]?.join(',') ?? ''} stopped: ${change.error.error.code}`);
        return;
    }
  }

  /** Closes the part's participant. One that `crashed` died with the runtime, so its requests are `lost`. */
  async #retire(part: Part, crashed: boolean): Promise<void> {
    const {participant} = part;
    part.participant = undefined;
    if (part.role === 'reader' && this.transport === 'in-process') this.reader.copies = [];
    if (participant === undefined) return;
    if (crashed) this.#crashed.add(participant);
    await participant.close();
  }

  #part(role: Role): Part {
    const part = this.#parts.get(role);
    if (part === undefined) throw new Error(`no part ${role}`);
    return part;
  }

  #current(): Generation {
    const generation = this.#generations.at(-1);
    if (generation === undefined) throw new Error('the runtime has not started');
    return generation;
  }

  #check(message: unknown, where: string): void {
    const result = this.#validator.validate(message);
    if (!result.ok) this.#problem(`${where}: ${result.error.code} ${result.error.detail ?? ''}`);
  }

  #problem(text: string): void {
    this.#problems.push(text);
  }

  #release(...work: (Promise<unknown> | undefined)[]): void {
    for (const promise of work) if (promise !== undefined) this.#retiring.push(promise);
  }

  #track(work: Promise<void>): void {
    const tracked = work.catch((error: unknown) => { this.#problem(`the harness failed: ${describe(error)}`); });
    this.#pending.add(tracked);
    void tracked.finally(() => { this.#pending.delete(tracked); });
  }

  async #settled(): Promise<void> {
    while (this.#pending.size > 0) await Promise.all([...this.#pending]);
  }
}

/**
 * Starts the runtime with the seed's modules, connects the scenario's parts over `transport` and syncs the reader's
 * copies. `root` holds the state directory; it defaults to the system temporary directory, which must lie outside every
 * Git checkout, as the runtime requires.
 */
export async function startMemoryHarness(seed: Seed, transport: TransportName, {root = tmpdir()}: {root?: string} = {}): Promise<MemoryHarness> {
  const harness = new Memory(seed, transport, await realpath(await mkdtemp(join(root, 'bunny-scenario-'))));
  try {
    await harness.open();
  } catch (error) {
    await harness.close();
    throw error;
  }
  return harness;
}
