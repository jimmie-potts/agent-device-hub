// The process a disposable runtime run serves (Hub #920): `node supervisor.js --data <dir> --port <port> --harness-port
// <port>`. It holds the run's simulated devices, which outlive the runtime as real ones would, and runs the runtime as a
// child: its own shipped entry point, or child.js with the fixture modules, both with `--simulate`, `--edge` and the
// run's own state directory, and with a network guard (guard.ts) that refuses every outbound connection and datagram.
// A child that dies on its own is started again on the same port and state directory, as the service manager would
// restart the runtime, within a burst limit. Starts and restarts run one after another. A loopback harness API lets a
// run adapter drive the devices and the run's controls and read what the run did. Its ready line names the runtime's
// health page, which the preview card links, and the harness as an extra endpoint.
import {fork, type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {existsSync, readFileSync, readdirSync, readlinkSync, statSync} from 'node:fs';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {join, resolve} from 'node:path';
import type {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {SimulatedLifx} from '@jimmie-potts/lifx';
import {SimulatedCloud} from '@jimmie-potts/tidbyt';
import {SimulatedPixoo, type SimulatedPixooState} from '@jimmie-potts/pixoo';
import {SimulatedSpeakers} from '@jimmie-potts/playback';
import {HEALTH_PATH, readSpanFile, type LogRecord} from '../src/index.js';
import {SimulatedChime} from '../tests/fixtures/chime.js';
import {SimulatedLamps} from '../tests/fixtures/lamp.js';
import {SimulatedSigns} from '../tests/fixtures/sign.js';
import type {Generational} from '../tests/scenarios/catalog.js';
import {simulatePlayback} from '../tests/scenarios/parts.js';
import {DRAIN_MS, drained} from './drain.js';
import {guardEnvironment} from './environment.js';
import {FollowRefusal, follow, queryOf, type Evidence, type SpanEvidence} from './follow.js';
import {Journal} from './journal.js';
import {
  HARNESS_PATH, type Attempt, type BoundaryReport, type ChildMessage, type Control, type DisconnectRequest, type HarnessState,
  type SimulateRequest, type SupervisorMessage,
} from './protocol.js';
import {BurstLimit} from './restarts.js';
import {RUN_FILE, credentialsOf, homeOf, partTokensOf, stateDirOf, type RunFile} from './seed.js';

const MAIN = fileURLToPath(new URL('../src/main.js', import.meta.url));
const CHILD = fileURLToPath(new URL('./child.js', import.meta.url));
/** How many times within `CRASH_WINDOW_MS` the run starts again a runtime that died on its own before it gives up. */
const MAX_CRASHES = 5;
const CRASH_WINDOW_MS = 60_000;
/** A part's source, the only kind whose stream the harness may drop. */
const PART_SOURCE = /^bunny\/parts\/[a-z0-9][a-z0-9-]*$/;
/** How long a runtime has to stop on SIGTERM before it is killed. */
const STOP_MS = 8000;
/** How long a flush or control waits for the child's answer. */
const ANSWER_MS = 3000;
/** The lowest level the run's runtime writes, which the run states instead of leaving to the runtime's default. */
const LOG_LEVEL = 'info';

const {values} = parseArgs({options: {data: {type: 'string'}, port: {type: 'string'}, 'harness-port': {type: 'string'}}, strict: true});
if (values.data === undefined) throw new Error('usage: supervisor.js --data <dir> --port <port> --harness-port <port>');
const dataDir = resolve(values.data);
const run = JSON.parse(readFileSync(join(dataDir, RUN_FILE), 'utf8')) as RunFile;
const fixtures = run.runtime === 'fixtures';
const lamps = new SimulatedLamps(['lamp-1']);
const chime = new SimulatedChime();
const signs = new SimulatedSigns();
const speakers = new SimulatedSpeakers();
const lifx = new SimulatedLifx();
const cloud = new SimulatedCloud();
/** Each request the Tidbyt cloud still waits on, by the runtime's generation and the child's ID, so the child can abandon it. */
const cloudCalls = new Map<string, AbortController>();
/** Each LIFX packet a bulb still waits on, by the runtime's generation and the child's ID, so the child can abandon it. */
const exchanges = new Map<string, AbortController>();
/** What the child's simulated Pixoo shows, as it last reported, and the mode each new runtime's Pixoo starts in (Hub #843). */
let pixoo: SimulatedPixooState = new SimulatedPixoo().state();
/** Each show an offline sign still waits on, by the runtime's generation and the child's ID, so the child can abandon it. */
const shows = new Map<string, AbortController>();
/** Each call a speaker still waits on, by the runtime's generation and the child's ID, so the child can abandon it. */
const speakerCalls = new Map<string, AbortController>();
const journal = new Journal();
const published: Generational<{message: Message}>[] = [];
/** Where the guard of the runtime, its threads and its child processes writes each refused connection. */
const guardReport = join(dataDir, 'guard-report.jsonl');
const waiting = new Map<number, () => void>();
/** The newest log record of one runtime with this event name. */
const newest = (number: number, event: string): LogRecord | undefined =>
  [...journal.entries].reverse().find(entry => entry.generation === number && entry.record.event_name === event)?.record;
let runtimePort = Number(values.port ?? '0');
let generation = 0;
const crashes = new BurstLimit(MAX_CRASHES, CRASH_WINDOW_MS);
let current: ChildProcess | undefined;
/** The home the current runtime has, read from its environment once it was ready. */
let observedHome = '';
let runtimeUrl = '';
let stopping = false;
let restarting = false;
let next = 0;
/** Starts and restarts run one after another, so two never race for the runtime's port. */
let lifecycle: Promise<void> = Promise.resolve();
function queue(task: () => Promise<void>): Promise<void> {
  const done = lifecycle.then(task);
  lifecycle = done.catch(() => {});
  return done;
}

/**
 * The runtime's arguments, with the run's configuration file, its modules' sections and its edge's (Hub #919, #835). A
 * boundary negative control leaves out what keeps its run inside its boundary.
 */
function runtimeArgs(): string[] {
  return [
    // A disposable run's records are a test environment's (Hub #903).
    '--port', String(runtimePort), '--environment', 'test', '--log-level', LOG_LEVEL, ...(run.fault === 'real-transports' ? [] : ['--simulate']),
    ...(run.fault === 'default-state' ? [] : ['--state-dir', stateDirOf(dataDir), '--edge']),
    '--config', run.config,
    // Its spans go to a bounded private file in the state directory, which outlives a crash and which the follow query reads (Hub #950).
    '--record-spans',
  ];
}

/** Calls `take` with each complete line of `stream`. */
function lines(stream: Readable | null, take: (line: string) => void): void {
  let text = '';
  stream?.setEncoding('utf8').on('data', (chunk: string) => {
    text += chunk;
    for (let end = text.indexOf('\n'); end >= 0; end = text.indexOf('\n')) {
      take(text.slice(0, end));
      text = text.slice(end + 1);
    }
  });
}

const tell = (child: ChildProcess, message: SupervisorMessage): void => {
  if (child.connected) child.send(message);
};

function heard(child: ChildProcess, number: number, message: ChildMessage): void {
  switch (message.type) {
    case 'lamp.switch':
      lamps.switch(message.lamp, message.power).then(
        power => { tell(child, {type: 'lamp.switched', id: message.id, power}); },
        (error: unknown) => { tell(child, {type: 'lamp.failed', id: message.id, detail: error instanceof Error ? error.message : 'failed'}); },
      );
      return;
    case 'lamp.show':
      lamps.show(message.indicator);
      return;
    case 'chime.ring':
      chime.ring(message.ring);
      return;
    case 'sign.show': {
      const key = `${number} ${message.id}`;
      const controller = new AbortController();
      shows.set(key, controller);
      signs.show(message.address, message.token, message.frame, controller.signal).then(
        () => { shows.delete(key); tell(child, {type: 'sign.shown', id: message.id}); },
        () => { if (shows.delete(key)) tell(child, {type: 'sign.failed', id: message.id}); },
      );
      return;
    }
    case 'sign.abandon': {
      const key = `${number} ${message.id}`;
      const controller = shows.get(key);
      shows.delete(key);
      controller?.abort();
      return;
    }
    case 'speaker.sony':
    case 'speaker.sonos': {
      const key = `${number} ${message.id}`;
      const controller = new AbortController();
      speakerCalls.set(key, controller);
      const call = message.type === 'speaker.sony' ? speakers.sony('', message.method, message.version, controller.signal) :
        speakers.sonos('', message.action, message.args, controller.signal);
      call.then(
        reply => { if (speakerCalls.delete(key)) tell(child, {type: 'speaker.replied', id: message.id, reply}); },
        () => { if (speakerCalls.delete(key)) tell(child, {type: 'speaker.failed', id: message.id}); },
      );
      return;
    }
    case 'speaker.abandon': {
      const key = `${number} ${message.id}`;
      const controller = speakerCalls.get(key);
      speakerCalls.delete(key);
      controller?.abort();
      return;
    }
    case 'lifx.exchange': {
      const key = `${number} ${message.id}`;
      const controller = new AbortController();
      exchanges.set(key, controller);
      lifx.exchange(message.address, message.packet, Buffer.from(message.payload, 'base64'), message.expected, controller.signal).then(
        payload => { exchanges.delete(key); tell(child, {type: 'lifx.answered', id: message.id, payload: payload.toString('base64')}); },
        () => { if (exchanges.delete(key)) tell(child, {type: 'lifx.failed', id: message.id}); },
      );
      return;
    }
    case 'lifx.abandon': {
      const key = `${number} ${message.id}`;
      const controller = exchanges.get(key);
      exchanges.delete(key);
      controller?.abort();
      return;
    }
    case 'cloud.call': {
      const key = `${number} ${message.id}`;
      const controller = new AbortController();
      cloudCalls.set(key, controller);
      const headers: Record<string, string> = {authorization: message.authorization, ...(message.body === undefined ? {} : {'content-type': 'application/json'})};
      cloud.fetch(message.url, {method: message.method, redirect: 'error', signal: controller.signal, headers, ...(message.body === undefined ? {} : {body: message.body})})
        .then(async answer => {
          const body = await answer.text();
          if (cloudCalls.delete(key)) tell(child, {type: 'cloud.answered', id: message.id, status: answer.status, headers: Object.fromEntries(answer.headers), body});
        }, (error: unknown) => { if (cloudCalls.delete(key)) tell(child, {type: 'cloud.failed', id: message.id, refused: error instanceof TypeError}); });
      return;
    }
    case 'cloud.abandon': {
      const key = `${number} ${message.id}`;
      const controller = cloudCalls.get(key);
      cloudCalls.delete(key);
      controller?.abort();
      return;
    }
    case 'published':
      published.push({generation: number, message: message.message});
      return;
    case 'pixoo.state':
      if (number === generation) pixoo = message.state;
      return;
    case 'applied':
    case 'flushed':
      waiting.get(message.id)?.();
      waiting.delete(message.id);
      return;
  }
}

/** Starts the next runtime and resolves with its URL once it is ready. */
function spawnRuntime(): Promise<string> {
  generation += 1;
  const number = generation;
  // The new runtime's simulated Pixoo starts with the mode and the panel the last one had.
  const panel = Buffer.from(JSON.stringify(pixoo)).toString('base64url');
  const args = fixtures ? [run.modules.length === 0 ? '-' : run.modules.join(','), run.fault ?? 'none', panel, '--', ...runtimeArgs()] : runtimeArgs();
  const child = fork(fixtures ? CHILD : MAIN, args, {
    execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: {...process.env, HOME: homeOf(dataDir), ...guardEnvironment(guardReport)},
  });
  current = child;
  lines(child.stderr, line => {
    process.stderr.write(`${line}\n`);
    journal.take(number, line);
  });
  child.on('message', message => { heard(child, number, message as ChildMessage); });
  child.once('exit', () => {
    // A runtime that ended no longer waits on its shows, its speakers' calls, its bulbs' answers or its cloud's.
    for (const waiting of [shows, speakerCalls, exchanges, cloudCalls]) {
      for (const [key, controller] of waiting) {
        if (!key.startsWith(`${number} `)) continue;
        waiting.delete(key);
        controller.abort();
      }
    }
    died(number);
  });
  return new Promise((ready, failed) => {
    lines(child.stdout, line => {
      try {
        const parsed = JSON.parse(line) as {event?: unknown; url?: unknown};
        if (parsed.event === 'runtime.ready' && typeof parsed.url === 'string') ready(parsed.url);
      } catch {
        // Not the ready line.
      }
    });
    child.once('exit', (code, signal) => {
      const reason = newest(number, 'runtime.failed')?.attributes['error.code'];
      failed(new Error(typeof reason === 'string' ? reason : `exited-${String(code ?? signal)}`));
    });
  });
}

/** The value of one variable in a process's environment, from /proc, or '' when it cannot be read. */
function environmentOf(pid: number | undefined, name: string): string {
  try {
    const entry = readFileSync(`/proc/${String(pid)}/environ`, 'utf8').split('\0').find(line => line.startsWith(`${name}=`));
    return entry?.slice(name.length + 1) ?? '';
  } catch {
    return '';
  }
}

async function start(): Promise<void> {
  runtimeUrl = await spawnRuntime();
  runtimePort = Number(new URL(runtimeUrl).port);
  observedHome = environmentOf(current?.pid, 'HOME');
}

const startFailed = (error: unknown): void => {
  process.stderr.write(`runtime-start-failed: ${error instanceof Error ? error.message : 'unknown'}\n`);
  void shutdown(1);
};

/**
 * A runtime that died on its own, such as an armed crash, is started again on the same port and state directory. Only
 * the current runtime counts: one that a restart or the run's stop ended, or an earlier generation, does not.
 */
function died(number: number): void {
  if (stopping || restarting || number !== generation || runtimeUrl === '') return;
  if (!crashes.allow()) {
    process.stderr.write('runtime-start-failed: crash-loop\n');
    void shutdown(1);
    return;
  }
  queue(start).catch(startFailed);
}

async function stopRuntime(): Promise<void> {
  const child = current;
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  // Its stderr may hold records still to be read, `runtime.stopped` the last: wait for them before anything starts again,
  // so the journal shows a clean stop as one.
  const flushed = drained(child, DRAIN_MS);
  child.kill('SIGTERM');
  const timer = setTimeout(() => { child.kill('SIGKILL'); }, STOP_MS);
  await exited;
  clearTimeout(timer);
  await flushed;
}

/** Stops the runtime and starts it again, after any start or restart before it. A runtime that cannot start ends the run. */
function restart(): Promise<void> {
  return queue(async () => {
    restarting = true;
    try {
      await stopRuntime();
      await start();
    } catch (error) {
      startFailed(error);
      throw error;
    } finally {
      restarting = false;
    }
  });
}

/** Sends the child a control or a flush and waits for its answer. A run of the shipped runtime has neither. */
function ask(build: (id: number) => SupervisorMessage): Promise<void> {
  const child = current;
  if (!fixtures || child?.connected !== true) return Promise.resolve();
  next += 1;
  const id = next;
  return new Promise(done => {
    const timer = setTimeout(() => { waiting.delete(id); done(); }, ANSWER_MS);
    waiting.set(id, () => { clearTimeout(timer); done(); });
    tell(child, build(id));
  });
}
const control = (name: Control): Promise<void> => ask(id => ({type: 'control', id, control: name}));
const flush = (): Promise<void> => ask(id => ({type: 'flush', id}));

/** The SQLite files a process has open, from its file descriptors in /proc. */
function openStateFiles(pid: number | undefined): string[] {
  const dir = `/proc/${String(pid)}/fd`;
  const files = new Set<string>();
  try {
    for (const fd of readdirSync(dir)) {
      try {
        const target = readlinkSync(join(dir, fd));
        if (target.endsWith('.sqlite')) files.add(target);
      } catch {
        // Closed while it was read.
      }
    }
  } catch {
    // No such process.
  }
  return [...files].sort();
}

/** Every attempt the guard refused, from its report file. */
function refusedAttempts(): Attempt[] {
  let text: string;
  try {
    text = readFileSync(guardReport, 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').filter(line => line !== '').map(line => JSON.parse(line) as Attempt);
}

/** What the boundary checks judge, observed from the running runtime and the run's directory, not from its arguments. */
function report(): BoundaryReport {
  const started = newest(generation, 'runtime.started')?.attributes['bunny.simulate'];
  let grantsMode: number | null = null;
  try {
    // The edge's credentials file and the parts' token file must both be owner-only; the wider mode is reported.
    grantsMode = [credentialsOf(dataDir), partTokensOf(dataDir)].map(file => statSync(file).mode & 0o777).reduce((a, b) => a | b, 0);
  } catch {
    // No credentials or token file.
  }
  return {
    runtime: fixtures ? 'fixtures' : 'shipped', simulate: typeof started === 'boolean' ? started : null, dataDir, home: observedHome,
    defaultState: observedHome !== '' && existsSync(join(observedHome, '.local/state')), stateFiles: openStateFiles(current?.pid), grantsMode,
    outbound: refusedAttempts(),
  };
}

/** What the follow query reads: the journal's records, with the runtime that wrote each, and the span file. */
function evidence(): Evidence {
  let spans: SpanEvidence;
  try {
    const read = readSpanFile(stateDirOf(dataDir));
    spans = read.present
      ? {recorded: true, lines: read.lines, evicted: read.evicted, unreadable: read.unreadable, truncated: read.truncated}
      : {recorded: false, reason: 'not-recorded'};
  } catch {
    spans = {recorded: false, reason: 'unreadable'};
  }
  return {generation, minimumLevel: LOG_LEVEL, journal: journal.entries.map(entry => ({generation: entry.generation, record: entry.record})), skippedLines: journal.skipped, spans};
}

const answer = (response: ServerResponse, status: number, body: object): void => {
  response.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store'}).end(JSON.stringify(body));
};
const refusal = (code: string, detail: string): object => ({error: {code, detail}});

async function body(request: IncomingMessage): Promise<unknown> {
  let text = '';
  for await (const chunk of request) {
    text += String(chunk);
    if (text.length > 4096) throw new Error('the body is too large');
  }
  return text === '' ? {} : JSON.parse(text);
}

/** The actions the harness accepts for each device: every action a `SimulateRequest` names, as `Unlisted` checks. */
const ACTIONS = {
  lamp: ['hold', 'release', 'fail-next'], chime: ['fault-next'], sign: ['online', 'offline'],
  playback: ['play', 'pause', 'stop', 'other-input', 'silent', 'slow', 'answer', 'refuse-next', 'hang-next'], lifx: ['online', 'offline'],
  tidbyt: ['online', 'offline'], pixoo: ['online', 'offline', 'silent'],
} as const satisfies {readonly [D in SimulateRequest['device']]: readonly Extract<SimulateRequest, {device: D}>['action'][]};
/** An action a `SimulateRequest` names that `ACTIONS` leaves out, which the harness would refuse: none, or the build fails. */
type Unlisted = {[D in SimulateRequest['device']]: Exclude<Extract<SimulateRequest, {device: D}>['action'], (typeof ACTIONS)[D][number]>}[SimulateRequest['device']];
export const EVERY_ACTION_LISTED: [Unlisted] extends [never] ? true : never = true;
const SPEAKERS: readonly string[] = ['sony', 'sonos'];
/** The simulation a request names, or undefined when its device, action or other field is unknown, so a typo changes nothing. */
function simulationOf(value: unknown): SimulateRequest | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const {device, action, speaker, title, address, ...rest} = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0 || typeof device !== 'string' || !Object.hasOwn(ACTIONS, device) || typeof action !== 'string') return undefined;
  if (!(ACTIONS[device as SimulateRequest['device']] as readonly string[]).includes(action)) return undefined;
  if (device === 'playback') {
    if (typeof speaker !== 'string' || !SPEAKERS.includes(speaker) || address !== undefined) return undefined;
    if (title !== undefined && (typeof title !== 'string' || title.length > 200)) return undefined;
  } else if (speaker !== undefined || title !== undefined) return undefined;
  if (device === 'lifx' ? typeof address !== 'string' || address.length > 64 : address !== undefined) return undefined;
  return value as SimulateRequest;
}

async function simulate(request: SimulateRequest): Promise<boolean> {
  switch (request.device) {
    case 'pixoo':
      await ask(id => ({type: 'simulate', id, simulation: request}));
      pixoo = {...pixoo, mode: request.action};
      return true;
    case 'chime':
      await control('chime-fault');
      return true;
    case 'sign':
      if (request.action === 'online') signs.online();
      else signs.offline();
      return true;
    case 'playback':
      simulatePlayback(speakers, request);
      return true;
    case 'lifx':
      if (request.action === 'online') lifx.online(request.address);
      else lifx.offline(request.address);
      return true;
    case 'tidbyt':
      if (request.action === 'online') cloud.online();
      else cloud.offline();
      return true;
    case 'lamp':
      break;
  }
  switch (request.action) {
    case 'hold':
      lamps.hold();
      return true;
    case 'release':
      lamps.release();
      return true;
    case 'fail-next':
      lamps.failNext();
      return true;
  }
}

let harnessPort = Number(values['harness-port'] ?? '0');
/** Answers only local JSON requests that name the harness's own listener, as the runtime's health does. */
async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const host = (request.headers.host ?? '').toLowerCase();
  const site = request.headers['sec-fetch-site'];
  const local = [`127.0.0.1:${harnessPort}`, `localhost:${harnessPort}`].includes(host) && request.headers.origin === undefined && (site === undefined || site === 'none');
  if (!local) return answer(response, 403, refusal('forbidden', 'the harness answers only local requests that name its listener'));
  const url = new URL(request.url ?? '/', 'http://harness');
  const route = `${request.method ?? 'GET'} ${url.pathname.slice(HARNESS_PATH.length)}`;
  if (!url.pathname.startsWith(`${HARNESS_PATH}/`)) return answer(response, 404, refusal('not-found', 'no such route'));
  if (request.method === 'POST' && request.headers['content-type'] !== 'application/json') return answer(response, 415, refusal('invalid-request', 'send JSON'));
  switch (route) {
    case 'GET /state': {
      await flush();
      const state: HarnessState = {
        generation, devices: {
          lamp: lamps.state(), chime: chime.state(), sign: signs.state(), playback: speakers.state(), lifx: lifx.state(), tidbyt: cloud.state(), pixoo,
        },
        logs: journal.entries.slice(Number(url.searchParams.get('logs') ?? '0')), published: published.slice(Number(url.searchParams.get('published') ?? '0')),
      };
      return answer(response, 200, state);
    }
    case 'GET /boundaries':
      return answer(response, 200, report());
    case 'GET /follow': {
      let query;
      try {
        query = queryOf(url.searchParams);
      } catch (error) {
        if (error instanceof FollowRefusal) return answer(response, 400, refusal('invalid-request', error.message));
        throw error;
      }
      // The runtime has written every record and span it finished before it answers its flush.
      await flush();
      return answer(response, 200, follow(evidence(), query.selector, query.limits));
    }
    case 'POST /simulate': {
      if (!fixtures) return answer(response, 409, refusal('invalid-state', 'this run\'s devices are simulated inside the modules and cannot be driven from the harness'));
      const simulation = simulationOf(await body(request));
      if (simulation === undefined) return answer(response, 400, refusal('invalid-request', 'the simulation names an unknown device, action or field'));
      await simulate(simulation);
      return answer(response, 200, {status: 'applied'});
    }
    case 'POST /arm-crash':
    case 'POST /lose-acknowledgment':
      if (!fixtures) return answer(response, 409, refusal('invalid-state', 'this run has no fixture modules'));
      await control(route === 'POST /arm-crash' ? 'arm-crash' : 'lose-acknowledgment');
      return answer(response, 200, {status: 'applied'});
    case 'POST /disconnect': {
      if (!fixtures) return answer(response, 409, refusal('invalid-state', 'this run has no fixture modules'));
      const {source} = await body(request) as Partial<DisconnectRequest>;
      if (typeof source !== 'string' || !PART_SOURCE.test(source)) {
        return answer(response, 400, refusal('invalid-request', 'only a part\'s stream, bunny/parts/<role>, can be dropped'));
      }
      await ask(id => ({type: 'disconnect', id, source}));
      return answer(response, 200, {status: 'applied'});
    }
    case 'POST /restart':
      await restart();
      return answer(response, 200, {status: 'restarted', generation});
    default:
      return answer(response, 404, refusal('not-found', 'no such route'));
  }
}

const server = createServer((request, response) => {
  handle(request, response).catch((error: unknown) => { answer(response, 500, refusal('internal', error instanceof Error ? error.message : 'failed')); });
});

async function shutdown(code: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  await stopRuntime();
  server.closeAllConnections();
  server.close();
  process.exit(code);
}
process.on('SIGTERM', () => { void shutdown(0); });
process.on('SIGINT', () => { void shutdown(0); });

try {
  await queue(start);
} catch (error) {
  process.stderr.write(`runtime-start-failed: ${error instanceof Error ? error.message : 'unknown'}\n`);
  process.exit(1);
}
await new Promise<void>((listening, failed) => {
  server.once('error', failed);
  server.listen({host: '127.0.0.1', port: harnessPort}, () => { listening(); });
});
harnessPort = (server.address() as AddressInfo).port;
process.stdout.write(`${JSON.stringify({event: 'runtime.ready', url: `${runtimeUrl}${HEALTH_PATH}`, endpoints: {harness: `http://127.0.0.1:${harnessPort}/`}})}\n`);
