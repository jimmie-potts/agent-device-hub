// The process a disposable runtime run serves (Hub #920): `node supervisor.js --data <dir> --port <port> --harness-port
// <port>`. It holds the run's simulated devices, which outlive the runtime as real ones would, and runs the runtime as a
// child: its own shipped entry point, or child.js with the fixture modules, both with
// `--simulate`, `--edge` and the run's own state directory, and with a network guard that refuses every outbound
// connection. A child that dies on its own is started again on the same port and state directory, as the service
// manager would restart the runtime. A loopback harness API lets a run adapter drive the devices and the run's controls
// and read what the run did. Its ready line names the runtime's URL and the harness as an extra endpoint.
import {fork, type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {readFileSync, statSync} from 'node:fs';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {join, resolve} from 'node:path';
import type {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {EDGE_GRANTS_FILE, type LogRecord} from '../src/index.js';
import {SimulatedChime} from '../tests/fixtures/chime.js';
import {SimulatedLamps} from '../tests/fixtures/lamp.js';
import type {Generational} from '../tests/scenarios/catalog.js';
import {
  HARNESS_PATH, type BoundaryReport, type ChildMessage, type Control, type HarnessState, type SimulateRequest, type SupervisorMessage,
} from './protocol.js';
import {RUN_FILE, homeOf, stateDirOf, type RunFile} from './seed.js';

const MAIN = fileURLToPath(new URL('../src/main.js', import.meta.url));
const CHILD = fileURLToPath(new URL('./child.js', import.meta.url));
const GUARD = new URL('./guard.js', import.meta.url).href;
/** How often the run starts a runtime that died on its own again before it gives up, as a restart burst limit would. */
const MAX_CRASHES = 5;
/** How long a runtime has to stop on SIGTERM before it is killed. */
const STOP_MS = 8000;
/** How long a flush or control waits for the child's answer. */
const ANSWER_MS = 3000;

const {values} = parseArgs({options: {data: {type: 'string'}, port: {type: 'string'}, 'harness-port': {type: 'string'}}, strict: true});
if (values.data === undefined) throw new Error('usage: supervisor.js --data <dir> --port <port> --harness-port <port>');
const dataDir = resolve(values.data);
const run = JSON.parse(readFileSync(join(dataDir, RUN_FILE), 'utf8')) as RunFile;
const fixtures = run.runtime === 'fixtures';
const lamps = new SimulatedLamps(['lamp-1']);
const chime = new SimulatedChime();
const logs: Generational<{record: LogRecord}>[] = [];
const published: Generational<{message: Message}>[] = [];
const outbound: {host: string; port: number}[] = [];
const waiting = new Map<number, () => void>();
/** The newest log record of one runtime with this event name. */
const newest = (number: number, event: string): LogRecord | undefined =>
  [...logs].reverse().find(entry => entry.generation === number && entry.record.event_name === event)?.record;
let runtimePort = Number(values.port ?? '0');
let generation = 0;
let crashes = 0;
let current: ChildProcess | undefined;
let runtimeUrl = '';
let stopping = false;
let restarting = false;
let next = 0;

/** The runtime's arguments. A boundary negative control leaves out what keeps its run inside its boundary. */
function runtimeArgs(): string[] {
  return [
    '--port', String(runtimePort), ...(run.fault === 'real-transports' ? [] : ['--simulate']),
    ...(run.fault === 'default-state' ? [] : ['--state-dir', stateDirOf(dataDir), '--edge']),
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
    case 'published':
      published.push({generation: number, message: message.message});
      return;
    case 'guard':
      outbound.push({host: message.host, port: message.port});
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
  const args = fixtures ? [run.modules.length === 0 ? '-' : run.modules.join(','), run.fault ?? 'none', '--', ...runtimeArgs()] : runtimeArgs();
  const child = fork(fixtures ? CHILD : MAIN, args, {
    execArgv: ['--import', GUARD], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: {...process.env, HOME: homeOf(dataDir)},
  });
  current = child;
  lines(child.stderr, line => {
    process.stderr.write(`${line}\n`);
    try {
      const record = JSON.parse(line) as LogRecord;
      if (typeof record.event_name === 'string') logs.push({generation: number, record});
    } catch {
      // Not a log record, such as a usage line.
    }
  });
  child.on('message', message => { heard(child, number, message as ChildMessage); });
  child.once('exit', () => { died(number); });
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

async function start(): Promise<void> {
  runtimeUrl = await spawnRuntime();
  runtimePort = Number(new URL(runtimeUrl).port);
}

/** A runtime that died on its own, such as an armed crash, is started again on the same port and state directory. */
function died(number: number): void {
  if (stopping || restarting || number !== generation || runtimeUrl === '') return;
  crashes += 1;
  if (crashes > MAX_CRASHES) {
    process.stderr.write('runtime-start-failed: crash-loop\n');
    void shutdown(1);
    return;
  }
  start().catch((error: unknown) => {
    process.stderr.write(`runtime-start-failed: ${error instanceof Error ? error.message : 'unknown'}\n`);
    void shutdown(1);
  });
}

async function stopRuntime(): Promise<void> {
  const child = current;
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => { child.kill('SIGKILL'); }, STOP_MS);
  await exited;
  clearTimeout(timer);
}

async function restart(): Promise<void> {
  restarting = true;
  try {
    await stopRuntime();
    await start();
  } finally {
    restarting = false;
  }
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

function report(): BoundaryReport {
  const started = newest(generation, 'runtime.started')?.attributes['bunny.simulate'];
  let grantsMode: number | null = null;
  try {
    grantsMode = statSync(join(stateDirOf(dataDir), EDGE_GRANTS_FILE)).mode & 0o777;
  } catch {
    // No grants file.
  }
  return {
    runtime: fixtures ? 'fixtures' : 'shipped', simulate: typeof started === 'boolean' ? started : null,
    stateDir: run.fault === 'default-state' ? null : stateDirOf(dataDir), runStateDir: stateDirOf(dataDir), dataDir, home: homeOf(dataDir), grantsMode,
    outbound: [...outbound],
  };
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

async function simulate(request: SimulateRequest): Promise<boolean> {
  if (request.device === 'chime') {
    await control('chime-fault');
    return true;
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
        generation, devices: {lamp: lamps.state(), chime: chime.state()},
        logs: logs.slice(Number(url.searchParams.get('logs') ?? '0')), published: published.slice(Number(url.searchParams.get('published') ?? '0')),
      };
      return answer(response, 200, state);
    }
    case 'GET /boundaries':
      return answer(response, 200, report());
    case 'POST /simulate':
      if (!fixtures) return answer(response, 409, refusal('invalid-state', 'this run has no simulated devices'));
      await simulate(await body(request) as SimulateRequest);
      return answer(response, 200, {status: 'applied'});
    case 'POST /arm-crash':
    case 'POST /lose-acknowledgment':
      if (!fixtures) return answer(response, 409, refusal('invalid-state', 'this run has no fixture modules'));
      await control(route === 'POST /arm-crash' ? 'arm-crash' : 'lose-acknowledgment');
      return answer(response, 200, {status: 'applied'});
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
  await start();
} catch (error) {
  process.stderr.write(`runtime-start-failed: ${error instanceof Error ? error.message : 'unknown'}\n`);
  process.exit(1);
}
await new Promise<void>((listening, failed) => {
  server.once('error', failed);
  server.listen({host: '127.0.0.1', port: harnessPort}, () => { listening(); });
});
harnessPort = (server.address() as AddressInfo).port;
process.stdout.write(`${JSON.stringify({event: 'runtime.ready', url: runtimeUrl, endpoints: {harness: `http://127.0.0.1:${harnessPort}/`}})}\n`);
