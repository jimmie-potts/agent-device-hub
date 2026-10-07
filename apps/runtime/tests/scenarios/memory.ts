// Tier 1 of the runtime's scenario catalog (Hub #846): the in-memory harness. It hosts the scenario's modules in the
// runtime's own module host, in this process, on a manual clock and scheduler, with simulated devices that outlive a
// runtime crash as real ones would. The scenario's parts join the host's bus directly (in process), or reach it through
// the runtime's gateway (#835) on 127.0.0.1, whose SDK edge checks each part's credential and grant (remote). The
// gateway's HTTP routes serve both transports. Its state lives in a private temporary directory outside every Git
// checkout, which `close` removes. Nothing reaches an installed service, port, personal state or device.
import {mkdtemp, realpath, rm} from 'node:fs/promises';
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {SimulatedLifx, createLifxModule} from '@jimmie-potts/lifx';
import {SimulatedNanoleaf, createNanoleafModule} from '@jimmie-potts/nanoleaf';
import {SimulatedPixoo, createPixooModule} from '@jimmie-potts/pixoo';
import {SimulatedSpeakers, createPlaybackModule} from '@jimmie-potts/playback';
import {connectRemote, type BunnyModule, type CommandDraft, type Diagnostic, type Participant} from '@jimmie-potts/sdk';
import {SimulatedCloud, createTidbytModule} from '@jimmie-potts/tidbyt';
import {followStandInAcks} from '@jimmie-potts/sdk/testing';
import {readEdgeCredentials, type EdgeCredential} from '../../src/credentials.js';
import {Gateway, readableFamilies} from '../../src/gateway/gateway.js';
import {ModuleHost} from '../../src/host.js';
import type {LogRecord, ModuleHealth} from '../../src/index.js';
import {INSTANCE_ID, LogWriter} from '../../src/log.js';
import {RUNTIME_SCOPE, runtimeResource} from '../../src/record.js';
import {prepareStateDirectory, readRuntimeConfig, type EdgeConfig, type RuntimeConfig} from '../../src/state.js';
import {startTracing, type RuntimeTracing} from '../../src/tracing.js';
import {SimulatedChime, createChimeModule} from '../fixtures/chime.js';
import {createCoreModule} from '../fixtures/core.js';
import {SimulatedLamps, createLampModule} from '../fixtures/lamp.js';
import {SimulatedSigns, createSignModule} from '../fixtures/sign.js';
import {manualClock} from '../support.js';
import {
  ROLES, type DeviceStates, type GatewayAnswer, type GatewayCall, type Generational, type Harness, type ModuleName, type Role, type Seed, type Simulation,
  type TransportName,
} from './catalog.js';
import {
  GatewayClient, Reader, SCENARIO_SCHEMAS, answerOf, describe, follow, partTokens, scenarioValidator, simulatePlayback, sourceOf, writeConfiguration,
} from './parts.js';

/** The ports of the installed Hub, the local controllers and their services, which a harness never listens on. */
export const INSTALLED_PORTS: readonly number[] = [8765, 8787, 8788, 8791, 41231];
/** How long a dropped part waits before it connects again, as the remote client's backoff does. */
const RECONNECT_MS = 20;
/** How far virtual time moves before real I/O, such as the edge's HTTP, gets to run. */
const STEP_MS = 10;

export interface MemoryHarness extends Harness {
  /** The private state directory the runtime uses across restarts. */
  readonly stateDir: string;
  /** The gateway's origin on loopback, which serves both transports. */
  readonly url: string | undefined;
  /** What went wrong outside the steps: messages that break profile 2.0, and errors a part or the runtime reported. */
  problems(): readonly string[];
  /** The edge's own diagnostics: its parts' connections and disconnections, its refusals and its failures. */
  edgeLog(): readonly Diagnostic[];
  /**
   * The finished spans of every runtime the harness started, as projected OTLP documents, in the order they finished.
   * One recorder serves every generation, so a restart's spans follow the crashed runtime's.
   */
  spans(): Promise<readonly string[]>;
  /** The run-generated tokens, one per part, so a test can show they never leak. */
  tokens(): readonly string[];
  /** Stops everything the harness started and removes its state directory. */
  close(): Promise<void>;
}

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

type Generation = {host: ModuleHost; gateway: Gateway; watcher: Participant; logs: LogWriter};
type Part = {role: Role; source: string; token: string; participant: Participant | undefined; closed: boolean};

class Memory implements MemoryHarness {
  readonly tier = 'memory';
  readonly transport: TransportName;
  readonly stateDir: string;
  readonly reader: Reader;
  url: string | undefined;
  readonly #seed: Seed;
  readonly #clock = manualClock();
  readonly #validator = scenarioValidator();
  readonly #lamps = new SimulatedLamps(['lamp-1']);
  readonly #chime = new SimulatedChime();
  readonly #signs = new SimulatedSigns();
  /** The simulated speakers, a slow one waiting on the harness's virtual time. */
  readonly #speakers = new SimulatedSpeakers({}, {scheduler: this.#clock.scheduler});
  readonly #lifx = new SimulatedLifx();
  /** The simulated Tidbyt cloud, which stamps each push with the harness's virtual time. */
  readonly #cloud = new SimulatedCloud({now: () => this.#clock.now()});
  readonly #pixoo = new SimulatedPixoo();
  readonly #nanoleaf = new SimulatedNanoleaf({now: () => this.#clock.now()});
  readonly #parts: ReadonlyMap<Role, Part>;
  readonly #tokens = partTokens();
  readonly #client: GatewayClient;
  /** The run's configuration file, read as the runtime reads it: the seed's sections and the edge's. */
  #config: RuntimeConfig | undefined;
  #edge: {config: EdgeConfig; credentials: readonly EdgeCredential[]} | undefined;
  readonly #generations: Generation[] = [];
  readonly #logs: Generational<{record: LogRecord}>[] = [];
  readonly #published: Generational<{message: Message}>[] = [];
  readonly #edgeLog: Diagnostic[] = [];
  readonly #spans: string[] = [];
  #tracing: RuntimeTracing | undefined;
  readonly #problems: string[] = [];
  readonly #answers = new Map<string, string>();
  /** Participants that died with a crashed runtime: their requests are `lost`, whatever the old bus answers. */
  readonly #crashed = new WeakSet<Participant>();
  /** A restart or reconnect under way. Every call waits for them, and virtual time stands still meanwhile. */
  readonly #pending = new Set<Promise<void>>();
  /** What the retired runtimes and parts still release. */
  readonly #retiring: Promise<unknown>[] = [];
  #server: Server | undefined;
  #gateway: Promise<Gateway>;
  #gatewayReady: (gateway: Gateway) => void = () => {};
  #armed = false;
  #loseAcknowledgment = false;
  #closing: Promise<void> | undefined;

  constructor(seed: Seed, transport: TransportName, stateDir: string) {
    this.#seed = seed;
    this.transport = transport;
    this.stateDir = stateDir;
    this.reader = new Reader(seed.follows);
    this.#parts = new Map(ROLES.map(role => [role, {role, source: sourceOf(role), token: this.#tokens[role], participant: undefined, closed: false}]));
    this.#client = new GatewayClient(() => this.url ?? '', this.#tokens);
    this.#gateway = this.#nextGateway();
  }

  async open(): Promise<void> {
    await prepareStateDirectory(this.stateDir);
    // A tracing start that fails is the first generation's record, as the runtime writes it before its modules start.
    const opening = new LogWriter(record => { this.#logs.push({generation: 1, record}); }, 'info', {now: this.#clock.now}).logger(RUNTIME_SCOPE);
    this.#tracing = await startTracing(runtimeResource('development', INSTANCE_ID), span => { this.#spans.push(span); }, opening);
    const {config} = this.#seed;
    this.#config = await readRuntimeConfig(await writeConfiguration(join(this.stateDir, 'config'), {...(config === undefined ? {} : {modules: config}), tokens: this.#tokens}));
    const edge = this.#config.edge;
    if (edge === undefined) throw new Error('the harness wrote no edge section');
    this.#edge = {config: edge, credentials: await readEdgeCredentials(edge.credentials)};
    const server = createServer((request, response) => { this.#serve(request, response); });
    // The edge never closes an idle connection under a remote part that is about to reuse it.
    server.keepAliveTimeout = 0;
    this.#server = server;
    this.url = `http://127.0.0.1:${await listenLoopback(server)}`;
    await this.#boot();
    // Only a module the seed expects the runtime to refuse, such as one it configures badly, may be unhealthy here; its
    // scenario checks the refusal.
    const expected: readonly string[] = this.#seed.refused ?? [];
    const report = this.#current().host.health().filter(module => !module.healthy && !(module.state === 'refused' && expected.includes(module.name)));
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
    return {
      lamp: this.#lamps.state(), chime: this.#chime.state(), sign: this.#signs.state(), playback: this.#speakers.state(), lifx: this.#lifx.state(), tidbyt: this.#cloud.state(),
      pixoo: this.#pixoo.state(), nanoleaf: this.#nanoleaf.state(),
    };
  }

  simulate(simulation: Simulation): void {
    switch (simulation.device) {
      case 'chime':
        this.#chime.faultNext();
        return;
      case 'sign':
        if (simulation.action === 'online') this.#signs.online();
        else this.#signs.offline();
        return;
      case 'playback':
        simulatePlayback(this.#speakers, simulation);
        return;
      case 'pixoo':
        this.#pixoo.set(simulation.action);
        return;
      case 'lifx':
        if (simulation.action === 'online') this.#lifx.online(simulation.address);
        else this.#lifx.offline(simulation.address);
        return;
      case 'tidbyt':
        if (simulation.action === 'online') this.#cloud.online();
        else this.#cloud.offline();
        return;
      case 'nanoleaf':
        this.#nanoleaf.act(simulation.action);
        return;
      case 'lamp':
        break;
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

  edgeLog(): readonly Diagnostic[] {
    return this.#edgeLog;
  }

  async gateway(call: GatewayCall): Promise<GatewayAnswer> {
    await this.#settled();
    return this.#client.call(call);
  }

  async spans(): Promise<readonly string[]> {
    // The bounded queue hands each finished span to the sink a few turns after it ends.
    await settle();
    return this.#spans;
  }

  tokens(): readonly string[] {
    return [...this.#parts.values()].map(part => part.token);
  }

  problems(): readonly string[] {
    const failed = this.#logs.filter(({record}) => record.event_name === 'runtime.handler.failed').map(({record}) => `runtime.handler.failed ${JSON.stringify(record.attributes)}`);
    // A record the contract refuses never reaches the log, so only the writer's counts show it (Hub #903).
    const lost = this.#generations.flatMap(({logs}, index) => {
      const {dropped, failed: sinkFailed} = logs.counts();
      return dropped + sinkFailed === 0 ? [] : [`runtime ${index + 1} dropped ${dropped} and lost ${sinkFailed} log records`];
    });
    return [...this.#problems, ...failed, ...lost];
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
      this.#current().gateway.edge.disconnect(part.source);
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
    this.#gateway = this.#nextGateway();
    // As the runtime's stop does: the gateway first, then the modules. Its browser sessions end with it.
    await old.gateway.close();
    this.#client.forget();
    await old.host.stop();
    // The stopped process's connections end with it.
    this.#server?.closeAllConnections();
    if (this.transport === 'in-process') for (const part of this.#parts.values()) await this.#retire(part, false);
    this.#release(old.watcher.close());
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
      for (const generation of this.#generations) await generation.gateway.close();
      const server = this.#server;
      if (server !== undefined) {
        server.closeAllConnections();
        await new Promise<void>(resolve => { server.close(() => { resolve(); }); });
      }
      for (const generation of this.#generations) await Promise.all([generation.watcher.close(), generation.host.stop()]);
      await Promise.allSettled(this.#retiring);
      await this.#tracing?.shutdown();
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
    const host = new ModuleHost(modules, {
      clock, scheduler: this.#clock.scheduler, stateDir: this.stateDir, logs, startTimeoutMs: 10_000, stopTimeoutMs: 5000,
      ...(this.#tracing === undefined ? {} : {tracing: this.#tracing}),
      ...(this.#config === undefined ? {} : {config: this.#config}),
    });
    const watcher = host.bus.connect('bunny/harness/watcher');
    await watcher.subscribe('bunny.*.*.*', message => {
      this.#check(message, 'a published message');
      this.#published.push({generation: number, message});
    });
    await host.start();
    const edge = this.#edge;
    if (edge === undefined) throw new Error('the harness has no edge');
    // As the runtime does, the gateway serves once every module has started, and its edge's decisions become records.
    const gateway = new Gateway({
      bus: host.bus, host, validator: this.#validator, families: readableFamilies(SCENARIO_SCHEMAS), edge: edge.config, credentials: edge.credentials,
      log: logs.logger(RUNTIME_SCOPE), redactions: logs.redactions, clock, scheduler: this.#clock.scheduler, stateDir: this.stateDir,
      onDiagnostic: diagnostic => { this.#edgeLog.push(diagnostic); },
    });
    await gateway.start(this.url ?? '', [new URL(this.url ?? 'http://127.0.0.1').host]);
    this.#generations.push({host, gateway, watcher, logs});
    this.#gatewayReady(gateway);
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
      case 'sign':
        return createSignModule({transport: this.#signs});
      case 'playback':
        // Freshness follows the harness's manual clock, so a silent speaker ages in virtual time.
        return createPlaybackModule({transport: this.#speakers, monotonic: this.#clock.now});
      case 'lifx':
        // The module follows the stand-in core's acknowledgments until #782's, so its outbox forgets what the core took.
        return createLifxModule({transport: this.#lifx, acknowledgments: followStandInAcks});
      case 'tidbyt':
        // A render's worker answers in real time while virtual time runs ahead, so renders get a deadline no step reaches.
        return createTidbytModule({transport: this.#cloud.fetch, renderTimeoutMs: 3_600_000});
      case 'pixoo':
        // The fixture core's stand-in history acknowledges each outcome, until Hub #782.
        return createPixooModule({transport: this.#pixoo, acknowledgments: followStandInAcks});
      case 'nanoleaf':
        return createNanoleafModule({transport: this.#nanoleaf.request});
    }
  }

  /**
   * The armed crash, between the lamp's commit and its publish. Remote parts see the runtime go away: every connection
   * to its edge ends at once, with the calls in flight. In-process parts die with it. The throw refuses the publish, as
   * the process's end would stop it, so the lamp's messages stay stored, and the runtime starts again on the same state
   * directory. The old lamp still answers on the old bus, where nobody hears it any more.
   */
  #crashPoint(): void {
    if (!this.#armed) return;
    this.#armed = false;
    const old = this.#current();
    this.#gateway = this.#nextGateway();
    this.#server?.closeAllConnections();
    // Marked at once, before the old bus can answer any of their requests.
    for (const {participant} of this.#parts.values()) if (this.transport === 'in-process' && participant !== undefined) this.#crashed.add(participant);
    this.#track((async () => {
      if (this.transport === 'in-process') for (const part of this.#parts.values()) await this.#retire(part, true);
      // Nothing of the old runtime is used again. Its gateway closes first, as the process's end would close its
      // launcher's socket and its connections; its host is stopped only to release what it holds.
      await old.gateway.close();
      this.#client.forget();
      this.#release(old.watcher.close(), old.host.stop());
      await this.#boot();
      if (this.transport === 'in-process') for (const part of this.#parts.values()) await this.#connect(part);
    })());
    throw new Error('the runtime crashed');
  }

  /** A request to the gateway waits while the runtime restarts, as a remote part's connection would wait for the port. */
  #serve(request: IncomingMessage, response: ServerResponse): void {
    void this.#gateway.then(gateway => { gateway.handle(request, response); });
  }

  #nextGateway(): Promise<Gateway> {
    return new Promise(resolve => { this.#gatewayReady = resolve; });
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
  #follow(participant: Participant): Promise<void> {
    return follow(participant, this.reader, this.#seed.follows, {check: (message, where) => { this.#check(message, where); }, problem: text => { this.#problem(text); }});
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
