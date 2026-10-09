// Tier 1 of the runtime's scenario catalog (Hub #846): the in-memory harness. It hosts the scenario's modules in the
// runtime's own module host, in this process, on a manual clock and scheduler, with simulated devices that outlive a
// runtime crash as real ones would. The scenario's parts join the host's bus directly (in process), or reach it through
// the runtime's gateway (#835) on 127.0.0.1, whose SDK edge checks each part's credential and grant (remote). The
// gateway's HTTP routes serve both transports. Each registered module is built on its simulated devices through its
// registration (Hub #999), so this file names only the core and the fixture modules. Its state lives in a private
// temporary directory outside every Git checkout, which `close` removes. Nothing reaches an installed service, port,
// personal state or device.
import {mkdtemp, realpath, rm} from 'node:fs/promises';
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {
  connectRemote, type BunnyModule, type CommandDraft, type DeviceSimulation, type Diagnostic, type ModuleRegistration, type Participant,
} from '@jimmie-potts/sdk';
import {readEdgeCredentials, type EdgeCredential} from '../../src/credentials.js';
import {Gateway, readableFamilies} from '../../src/gateway/gateway.js';
import {ModuleHost} from '../../src/host.js';
import {isCoreModule, registrations as REGISTERED, type LogRecord, type ModuleHealth} from '../../src/index.js';
import {modeParticipants} from '../../src/core/mode-participants.js';
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
  ROLES, StepFailure, failureOf, type DeviceStates, type GatewayAnswer, type GatewayCall, type Generational, type Harness, type HookPayload, type HookRun, type ModuleName, type Role,
  type Seed, type Simulation, type TransportName,
} from './framework.js';
import {
  GatewayClient, Reader, actionAnswerOf, actionCall, admitted, answerOf, follow, partTokens, producerToken, runHookScript, scenarioSchemas, scenarioValidator,
  sourceOf, writeConfiguration, writeProducer,
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
  /** The run-generated tokens, one per part and the agent hooks' producer's, so a test can show they never leak. */
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

/** One runtime's life, with the module databases it opened, which its crash closes at once. */
type Generation = {host: ModuleHost; gateway: Gateway; watcher: Participant; logs: LogWriter; databases: Set<DatabaseSync>};
type Part = {role: Role; source: string; token: string; participant: Participant | undefined; closed: boolean};
/** A registered module's simulation and its simulated device, which outlives the runtime's restarts and crashes. */
type Simulated = {simulation: DeviceSimulation; device: unknown};

/** The module, keeping each database it opens in `databases`, so a crash can close them as a process's end would. */
function holding(module: BunnyModule, databases: Set<DatabaseSync>): BunnyModule {
  return {...module, start: context => module.start({...context, database: () => {
    const database = context.database();
    databases.add(database);
    return database;
  }})};
}

class Memory implements MemoryHarness {
  readonly tier = 'memory';
  readonly transport: TransportName;
  readonly stateDir: string;
  readonly reader: Reader;
  url: string | undefined;
  readonly #seed: Seed;
  readonly #clock = manualClock();
  /** Every registered module, by name: the runtime's, and any a test adds. */
  readonly #registrations: ReadonlyMap<string, ModuleRegistration>;
  readonly #validator: ReturnType<typeof scenarioValidator>;
  readonly #schemas: Readonly<Record<string, object>>;
  readonly #lamps = new SimulatedLamps(['lamp-1']);
  readonly #chime = new SimulatedChime();
  readonly #signs = new SimulatedSigns();
  /** Each registered module's simulated device, on the harness's virtual clock and scheduler. */
  readonly #simulated: ReadonlyMap<string, Simulated>;
  readonly #parts: ReadonlyMap<Role, Part>;
  readonly #tokens = partTokens();
  /** The agent hooks' producer token and file (Hub #926), written once the gateway's port is known. */
  readonly #producer = producerToken();
  #producerFile: string | undefined;
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

  constructor(seed: Seed, transport: TransportName, stateDir: string, registrations: readonly ModuleRegistration[]) {
    this.#seed = seed;
    this.#registrations = new Map(registrations.map(registration => [registration.name, registration]));
    this.#validator = scenarioValidator(registrations);
    this.#schemas = scenarioSchemas(registrations);
    const options = {now: this.#clock.now, scheduler: this.#clock.scheduler};
    this.#simulated = new Map(registrations.flatMap(({name, simulation}) =>
      simulation === undefined ? [] : [[name, {simulation, device: simulation.memory.create(options)}] as const]));
    this.transport = transport;
    this.stateDir = stateDir;
    this.reader = new Reader(seed.follows);
    this.#parts = new Map(ROLES.map(role => [role, {role, source: sourceOf(role), token: this.#tokens[role], participant: undefined, closed: false}]));
    this.#client = new GatewayClient(() => this.url ?? '', this.#tokens, this.#producer);
    this.#gateway = this.#nextGateway();
  }

  async open(): Promise<void> {
    await prepareStateDirectory(this.stateDir);
    // A tracing start that fails is the first generation's record, as the runtime writes it before its modules start.
    const opening = new LogWriter(record => { this.#logs.push({generation: 1, record}); }, 'info', {now: this.#clock.now}).logger(RUNTIME_SCOPE);
    this.#tracing = await startTracing(runtimeResource('development', INSTANCE_ID), span => { this.#spans.push(span); }, opening);
    const {config} = this.#seed;
    this.#config = await readRuntimeConfig(await writeConfiguration(join(this.stateDir, 'config'), {
      ...(config === undefined ? {} : {modules: config}), tokens: this.#tokens, producer: this.#producer,
    }));
    const edge = this.#config.edge;
    if (edge === undefined) throw new Error('the harness wrote no edge section');
    this.#edge = {config: edge, credentials: await readEdgeCredentials(edge.credentials)};
    const server = createServer((request, response) => { this.#serve(request, response); });
    // The edge never closes an idle connection under a remote part that is about to reuse it.
    server.keepAliveTimeout = 0;
    this.#server = server;
    const port = await listenLoopback(server);
    this.url = `http://127.0.0.1:${port}`;
    this.#producerFile = await writeProducer(join(this.stateDir, 'config'), port, this.#producer);
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
    if (participant === undefined) throw new StepFailure(`the ${role} is not connected`);
    return participant;
  }

  send(role: Role, label: string, {key, draft}: {key: string; draft: CommandDraft<object>}, options: {timeoutMs: number; requestId: string}): Promise<string> {
    const start = (): Promise<string> => {
      const participant = this.sdk(role);
      this.#answers.set(label, 'pending');
      return participant.request(key, draft, options).then(answerOf, (error: unknown) => `threw ${failureOf(error)}`).then(answer => {
        const final = this.#crashed.has(participant) ? 'lost' : answer;
        this.#answers.set(label, final);
        return final;
      });
    };
    // A request starts at once, so it keeps its place in the order a scenario sends them.
    return this.#pending.size === 0 ? start() : this.#settled().then(start);
  }

  dispatch(role: Role, label: string, command: {key: string; draft: CommandDraft<object>}, requestId: string): Promise<string> {
    const start = (): Promise<string> => {
      this.#answers.set(label, 'pending');
      // An action's HTTP call whose connection the runtime's crash ended is `lost`: its fate is the tracker's to know.
      return this.#client.call(actionCall(role, command, requestId)).then(actionAnswerOf, () => 'lost').then(answer => {
        this.#answers.set(label, answer);
        return answer;
      });
    };
    return this.#pending.size === 0 ? start() : this.#settled().then(start);
  }

  answer(label: string): string {
    return this.#answers.get(label) ?? 'unsent';
  }

  devices(): DeviceStates {
    return {
      lamp: this.#lamps.state(), chime: this.#chime.state(), sign: this.#signs.state(),
      ...Object.fromEntries([...this.#simulated].map(([name, {simulation, device}]) => [name, simulation.memory.state(device)])),
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
      case 'lamp':
        this.#simulateLamp(simulation.action);
        return;
    }
    // A registered module's device, through its registration (Hub #999).
    const simulated = this.#simulated.get(simulation.device);
    if (simulated === undefined || !admitted(simulated.simulation, simulation)) throw new StepFailure('the simulation names an unknown device, action or field');
    simulated.simulation.memory.act(simulated.device, simulation);
  }

  #simulateLamp(action: string): void {
    switch (action) {
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
    throw new StepFailure('the simulation names an unknown device, action or field');
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
    return [...[...this.#parts.values()].map(part => part.token), this.#producer];
  }

  async hook(payload: HookPayload, {runtime = 'running'}: {runtime?: 'running' | 'stopped'} = {}): Promise<HookRun> {
    await this.#settled();
    const producer = this.#producerFile;
    if (producer === undefined) throw new StepFailure('the harness wrote no producer file');
    if (runtime === 'running') return runHookScript(producer, payload);
    // The runtime stops as a process does: its gateway, its modules, and its listener, so the hook's call is refused.
    const old = this.#current();
    this.#gateway = this.#nextGateway();
    await old.gateway.close();
    this.#client.forget();
    await old.host.stop();
    const server = this.#server;
    if (server === undefined) throw new StepFailure('the harness has no listener');
    const port = Number(new URL(this.url ?? '').port);
    server.closeAllConnections();
    await new Promise<void>(resolve => { server.close(() => { resolve(); }); });
    if (this.transport === 'in-process') for (const part of this.#parts.values()) await this.#retire(part, false);
    this.#release(old.watcher.close());
    try {
      return await runHookScript(producer, payload);
    } finally {
      // The service manager starts it again on the same port and state directory.
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen({host: '127.0.0.1', port}, () => {
          server.off('error', reject);
          resolve();
        });
      });
      await this.#boot();
      if (this.transport === 'in-process') for (const part of this.#parts.values()) await this.#connect(part);
    }
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
    const databases = new Set<DatabaseSync>();
    const modules = this.#seed.modules.map(name => holding(this.#build(name), databases));
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
    if (edge === undefined) throw new StepFailure('the harness has no edge');
    // As the runtime does, the gateway serves once every module has started, and its edge's decisions become records.
    // Its action routes call the core's dispatcher (#782), when the seed has the core.
    const core = modules.find(isCoreModule);
    const hosted = host.modules();
    if (hosted.some(module => module.name === 'core' && module.admitted && module.state === 'running')) core?.setModeParticipants(modeParticipants(hosted));
    const actions = core?.actions, operatorActions = core?.operatorActions;
    const gateway = new Gateway({
      bus: host.bus, host, validator: this.#validator, families: readableFamilies(this.#schemas), edge: edge.config, credentials: edge.credentials,
      log: logs.logger(RUNTIME_SCOPE), redactions: logs.redactions, clock, scheduler: this.#clock.scheduler, stateDir: this.stateDir,
      onDiagnostic: diagnostic => { this.#edgeLog.push(diagnostic); }, ...(actions === undefined ? {} : {actions}),
      ...(operatorActions === undefined ? {} : {operatorActions}), ...(core === undefined ? {} : {history: core.history, automation: core.automation}),
    });
    await gateway.start(this.url ?? '', [new URL(this.url ?? 'http://127.0.0.1').host]);
    this.#generations.push({host, gateway, watcher, logs, databases});
    this.#gatewayReady(gateway);
  }

  /** Each module with its simulated transport: the core and the fixture modules here, every other one through its registration. */
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
    }
    const simulated = this.#simulated.get(name);
    if (simulated === undefined) {
      if (!this.#registrations.has(name)) throw new Error(`no module ${name}`);
      throw new Error(`the module ${name} registers no simulation`);
    }
    return simulated.simulation.memory.build(simulated.device, {now: this.#clock.now, scheduler: this.#clock.scheduler});
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
    // The process's end closes its databases at once. Each module keeps its file to itself while it runs (Hub #972), so
    // the next generation could not open it otherwise.
    for (const database of old.databases) if (database.isOpen) database.close();
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
    throw new StepFailure('the runtime crashed');
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
      onError: (error, scope) => { this.#problem(`${scope.source} on ${scope.pattern}: ${failureOf(error)}`); },
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
    if (part === undefined) throw new StepFailure(`no part ${role}`);
    return part;
  }

  #current(): Generation {
    const generation = this.#generations.at(-1);
    if (generation === undefined) throw new StepFailure('the runtime has not started');
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
    const tracked = work.catch((error: unknown) => { this.#problem(`the harness failed: ${failureOf(error)}`); });
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
 * Git checkout, as the runtime requires. `registrations` are the modules a seed may name beside the core and the
 * fixture modules: by default every module the runtime's build collected.
 */
export async function startMemoryHarness(seed: Seed, transport: TransportName, {root = tmpdir(), registrations = REGISTERED}: {
  root?: string; registrations?: readonly ModuleRegistration[];
} = {}): Promise<MemoryHarness> {
  const harness = new Memory(seed, transport, await realpath(await mkdtemp(join(root, 'bunny-scenario-'))), registrations);
  try {
    await harness.open();
  } catch (error) {
    await harness.close();
    throw error;
  }
  return harness;
}
