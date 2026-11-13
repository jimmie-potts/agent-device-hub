// The process a disposable runtime run serves (Hub #920): `node supervisor.js --data <dir> --port <port> --harness-port
// <port>`. It holds the run's simulated devices, which outlive the runtime as real ones would, and runs the runtime as a
// child: its own shipped entry point, or child.js with the fixture modules, both with `--simulate`, `--edge` and the
// run's own state directory, and with a network guard (guard.ts) that refuses every outbound connection and datagram.
// A child that dies on its own is started again on the same port and state directory, as the service manager would
// restart the runtime, within a burst limit. Starts and restarts run one after another. A loopback harness API lets a
// run adapter drive the devices and the run's controls and read what the run did. Its ready line names the runtime's
// health page, which the preview card links, and the harness as an extra endpoint. Each registered module's simulated
// device is held and driven through its registration (link.ts), so only the fixture modules' devices are named here
// (Hub #999). A run on virtual time (Hub #1710) is the authority for the run's time: it moves its devices' clock and the
// child's together, only when the harness API's `clock/advance` asks, and a restart's hold moves it too.
import {fork, type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {existsSync, readFileSync, readdirSync, readlinkSync, statSync} from 'node:fs';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {join, resolve} from 'node:path';
import type {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {errorBody, type ErrorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {DeviceAction, Scheduler} from '@jimmie-potts/sdk';
import {HEALTH_PATH, readSpanFile, registrations, type LogRecord} from '../src/index.js';
import {SimulatedChime} from '../tests/fixtures/chime.js';
import {SimulatedLamps} from '../tests/fixtures/lamp.js';
import {SimulatedSigns} from '../tests/fixtures/sign.js';
import {writeCollector, writeProducer} from '../tests/scenarios/parts.js';
import {stepThrough} from '../tests/scenarios/stepping.js';
import {WORKER_WAIT_MS, manualClock} from '../tests/scenarios/virtual-time.js';
import {DRAIN_MS, drained} from './drain.js';
import {guardEnvironment} from './environment.js';
import {ChildHome} from './home.js';
import {FollowRefusal, follow, queryOf, type Evidence, type SpanEvidence} from './follow.js';
import {Journal} from './journal.js';
import {SupervisorDevices} from './link.js';
import {
  HARNESS_PATH, MAX_ADVANCE_MS, type Attempt, type BoundaryReport, type ChildMessage, type Publication, type ClockState, type Control, type DisconnectRequest, type FixtureSimulation,
  type HarnessState, type SimulateRequest, type SupervisorMessage,
} from './protocol.js';
import {BurstLimit} from './restarts.js';
import {RUN_FILE, configDirOf, credentialsOf, homeOf, partTokensOf, stateDirOf, type RunFile} from './seed.js';

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
/** The longest a restart may keep the runtime stopped before it starts it again. */
const MAX_HOLD_MS = 10_000;
/** The lowest level the run's runtime writes, which the run states instead of leaving to the runtime's default. */
const LOG_LEVEL = 'info';
/** How long one advance waits for the child's answer: a held worker call, then a turn of real work. */
const ADVANCE_ANSWER_MS = WORKER_WAIT_MS + ANSWER_MS;

const {values} = parseArgs({options: {data: {type: 'string'}, port: {type: 'string'}, 'harness-port': {type: 'string'}}, strict: true});
if (values.data === undefined) throw new Error('usage: supervisor.js --data <dir> --port <port> --harness-port <port>');
const dataDir = resolve(values.data);
const run = JSON.parse(readFileSync(join(dataDir, RUN_FILE), 'utf8')) as RunFile;
const fixtures = run.runtime === 'fixtures';
/** The run's virtual clock, which only a run of the fixture runtime can have, or undefined on the real clock. */
const virtual = fixtures && run.clock === 'virtual' ? manualClock(Date.now()) : undefined;
const lamps = new SimulatedLamps(['lamp-1']);
const chime = new SimulatedChime();
const signs = new SimulatedSigns();
/** A scheduler on real timers, which the registered modules' simulated devices wait on. */
const timers: Scheduler = {after: (delayMs, callback) => {
  const timer = setTimeout(callback, delayMs);
  return () => { clearTimeout(timer); };
}};
/** Every registered module's simulated device, which outlives the runtime as a real one would (Hub #999), on the run's clock. */
const devices = new SupervisorDevices(registrations, virtual === undefined ? {now: Date.now, scheduler: timers} : {now: virtual.now, scheduler: virtual.scheduler, monotonic: virtual.now});
/** On virtual time, what the current child last said: its earliest pending timer and whether work is in flight. */
let childNext: number | undefined;
let childBusy = false;
/** How many stderr lines each runtime's journal has read, and who waits for more. */
const heardLines = new Map<number, number>();
const lineWaiters = new Set<() => void>();
/** Each show an offline sign still waits on, by the runtime's generation and the child's ID, so the child can abandon it. */
const shows = new Map<string, AbortController>();
const journal = new Journal();
const published: Publication[] = [];
/** Where the guard of the runtime, its threads and its child processes writes each refused connection. */
const guardReport = join(dataDir, 'guard-report.jsonl');
const waiting = new Map<number, (message: ChildMessage) => void>();
/** The newest log record of one runtime with this event name. */
const newest = (number: number, event: string): LogRecord | undefined =>
  [...journal.entries].reverse().find(entry => entry.generation === number && entry.record.event_name === event)?.record;
let runtimePort = Number(values.port ?? '0');
let generation = 0;
const crashes = new BurstLimit(MAX_CRASHES, CRASH_WINDOW_MS);
let current: ChildProcess | undefined;
/** The current child's own bounded HOME observation from the preloaded guard. */
const childHome = new ChildHome();
let runtimeUrl = '';
let stopping = false;
let restarting = false;
let next = 0;
/** Starts and restarts run one after another, so two never race for the runtime's port. */
let lifecycle: Promise<void> = Promise.resolve();
function queue<T>(task: () => Promise<T>): Promise<T> {
  const done = lifecycle.then(task);
  lifecycle = done.then(() => {}, () => {});
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
        () => { tell(child, {type: 'lamp.failed', id: message.id}); },
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
    case 'device.call':
      devices.serve(number, number === generation, message, reply => { tell(child, reply); });
      return;
    case 'device.abandon':
      devices.abandon(number, message.id);
      return;
    case 'published':
      published.push({generation: number, message: message.message,
        ...(message.readerStream === undefined ? {} : {readerStream: message.readerStream})});
      return;
    case 'applied':
    case 'flushed':
    case 'advanced':
      waiting.get(message.id)?.(message);
      waiting.delete(message.id);
      return;
  }
}

/**
 * Why a runtime did not start: the registry code of its `runtime.failed` record, or how it exited. Fixed text from the
 * run, never an exception's message, so the start-failure line can name it.
 */
class StartFailed extends Error {}

/** Starts the next runtime and resolves with its URL once it is ready. */
function spawnRuntime(): Promise<string> {
  generation += 1;
  const number = generation;
  // The new runtime's registered modules start with what the last one left, such as what a device beside its module showed.
  const handovers = Buffer.from(JSON.stringify(devices.handovers())).toString('base64url');
  // A child on virtual time starts at the run's virtual time, so time never runs backwards across a restart.
  const clockArgument = virtual === undefined ? 'real' : String(virtual.now());
  childNext = undefined;
  childBusy = false;
  const args = fixtures ? [run.modules.length === 0 ? '-' : run.modules.join(','), run.fault ?? 'none', handovers, clockArgument, '--', ...runtimeArgs()] : runtimeArgs();
  const child = fork(fixtures ? CHILD : MAIN, args, {
    execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: {...process.env, HOME: homeOf(dataDir), ...guardEnvironment(guardReport)},
  });
  current = child;
  childHome.reset(child, number);
  lines(child.stderr, line => {
    process.stderr.write(`${line}\n`);
    journal.take(number, line);
    heardLines.set(number, (heardLines.get(number) ?? 0) + 1);
    for (const waiter of lineWaiters) waiter();
  });
  child.on('message', message => {
    if (childHome.hear(child, number, message)) return;
    if (typeof message !== 'object' || message === null || Array.isArray(message)) return;
    heard(child, number, message as ChildMessage);
  });
  child.once('exit', () => {
    // A runtime that ended no longer waits on its shows or its registered modules' calls.
    for (const [key, controller] of shows) {
      if (!key.startsWith(`${number} `)) continue;
      shows.delete(key);
      controller.abort();
    }
    devices.ended(number);
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
      failed(new StartFailed(typeof reason === 'string' ? reason : `exited-${String(code ?? signal)}`));
    });
  });
}

async function start(): Promise<void> {
  runtimeUrl = await spawnRuntime();
  // On virtual time the new child says when its first timers are due before the run moves on.
  if (virtual !== undefined) await advanceChild({toMs: virtual.now()}, current).catch(() => {});
  runtimePort = Number(new URL(runtimeUrl).port);
  await childHome.settle();
  // The agent hooks' producer file names the runtime's port, which restarts keep (Hub #926).
  const {producer, collector} = JSON.parse(readFileSync(partTokensOf(dataDir), 'utf8')) as {producer?: unknown; collector?: unknown};
  if (typeof producer === 'string') await writeProducer(configDirOf(dataDir), runtimePort, producer);
  // So does the Desktop metadata collector's, in a run that seeds one (Hub #567).
  if (typeof collector === 'string') await writeCollector(configDirOf(dataDir), runtimePort, collector);
}

/** The start-failure line, which the plug-in's `failureCause` matches: the cause a `StartFailed` names, or `unknown`. */
const startFailureLine = (error: unknown): string => `runtime-start-failed: ${error instanceof StartFailed ? error.message : 'unknown'}\n`;

const startFailed = (error: unknown): void => {
  process.stderr.write(startFailureLine(error));
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

/** A restart that keeps the runtime stopped until the harness API releases it (Hub #1711), or undefined. */
let held: (() => void) | undefined;

/**
 * Stops the runtime and starts it again, after any start or restart before it, `holdMs` after it stopped, so that a
 * hook can meet a stopped runtime (Hub #926). With `untilReleased`, which only a run on virtual time takes, the runtime
 * stays stopped until `POST /release`, or at most `MAX_HOLD_MS` of real time, before the hold begins: on virtual time a
 * hold passes at once, so a hook that runs against the stopped runtime holds it with a release instead (Hub #1711). The
 * release is awaited from before the runtime stops, so a caller that saw it stopped can always release it. A runtime
 * that cannot start ends the run.
 */
function restart(holdMs = 0, untilReleased = false): Promise<void> {
  return queue(async () => {
    restarting = true;
    try {
      const release = untilReleased ? new Promise<void>(released => {
        const timer = setTimeout(() => { held = undefined; released(); }, MAX_HOLD_MS);
        held = () => { clearTimeout(timer); held = undefined; released(); };
      }) : undefined;
      await stopRuntime();
      await release;
      // On virtual time the hold is virtual too: the devices' timers run through it while no runtime does.
      if (holdMs > 0) await (virtual === undefined ? new Promise(resolve => { setTimeout(resolve, holdMs); }) : advanceBy(holdMs));
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
function ask(build: (id: number) => SupervisorMessage): Promise<ChildMessage | undefined> {
  const child = current;
  if (!fixtures || child?.connected !== true) return Promise.resolve(undefined);
  next += 1;
  const id = next;
  return new Promise(done => {
    const timer = setTimeout(() => { waiting.delete(id); done(undefined); }, ANSWER_MS);
    waiting.set(id, answer => { clearTimeout(timer); done(answer); });
    tell(child, build(id));
  });
}

/** The child did not answer an advance: it ended, or it did not settle within its bound. */
class Unsettled extends Error {}

/** Whether `child` is still the running runtime. */
const live = (child: ChildProcess | undefined): child is ChildProcess =>
  child !== undefined && child === current && child.exitCode === null && child.signalCode === null && child.connected;

/**
 * Moves the clock of `child`, the runtime the advance started with, to `toMs` and waits for its answer, then until the
 * journal has read every line it wrote. An advance that started with no runtime steps the devices alone while a
 * restart holds the runtime stopped. Otherwise a runtime that has ended or been replaced, or that does not answer in
 * time, is `Unsettled`, which ends the advance, so the runtime's restart need not wait behind it.
 */
async function advanceChild(move: {toMs: number} | {observe: true}, child: ChildProcess | undefined): Promise<void> {
  if (child === undefined) {
    if (restarting) return;
    throw new Unsettled();
  }
  if (!live(child)) throw new Unsettled();
  const observing = 'observe' in move;
  const number = generation;
  next += 1;
  const id = next;
  const answer = await new Promise<ChildMessage | undefined>(done => {
    const end = (message: ChildMessage | undefined): void => {
      clearTimeout(timer);
      child.off('exit', exited);
      waiting.delete(id);
      done(message);
    };
    const exited = (): void => { end(undefined); };
    const timer = setTimeout(exited, observing ? ANSWER_MS : ADVANCE_ANSWER_MS);
    child.once('exit', exited);
    waiting.set(id, end);
    tell(child, {type: 'advance', id, ...move});
  });
  if (answer?.type !== 'advanced' || (observing && !live(child))) throw new Unsettled();
  if (observing) {
    await linesRead(child, number, answer.lines);
    if (!live(child) || (heardLines.get(number) ?? 0) < answer.lines) throw new Unsettled();
  }
  childNext = answer.nextDueMs ?? undefined;
  childBusy = answer.busy;
  if (!observing) await linesRead(child, number, answer.lines);
}

/** Reads fresh work evidence without moving time. An absent child has no pending work or timers. */
async function observeClock(clock: ReturnType<typeof manualClock>): Promise<ClockState | undefined> {
  const child = current;
  if (live(child)) {
    try {
      await advanceChild({observe: true}, child);
      return clockState(clock);
    } catch (error) {
      if (!(error instanceof Unsettled)) throw error;
      if (live(child)) return undefined;
    }
  }
  childNext = undefined;
  childBusy = false;
  return clockState(clock);
}

/** Resolves once the journal has read `count` stderr lines of the runtime `number`, it ended, or `ANSWER_MS` passed. */
function linesRead(child: ChildProcess, number: number, count: number): Promise<void> {
  if ((heardLines.get(number) ?? 0) >= count) return Promise.resolve();
  return new Promise(done => {
    const end = (): void => {
      clearTimeout(timer);
      lineWaiters.delete(check);
      child.off('exit', end);
      done();
    };
    const check = (): void => { if ((heardLines.get(number) ?? 0) >= count) end(); };
    const timer = setTimeout(end, ANSWER_MS);
    child.once('exit', end);
    lineWaiters.add(check);
  });
}

/** The earliest timer due in the devices or the current child, or undefined with none. */
function nextDue(clock: ReturnType<typeof manualClock>): number | undefined {
  const own = clock.next();
  if (own === undefined) return childNext;
  return childNext === undefined ? own : Math.min(own, childNext);
}

/**
 * Moves the run's virtual time on by `ms` (Hub #1710), in the in-memory harness's steps: each step moves the devices'
 * clock, which fires their timers due by then, and then the child's, which answers once real work had its turn. A long
 * advance stops at the earliest timer due in either. It ends early when the child ends or stops answering, so the run
 * can start its next runtime before time moves on; the caller sees the time reached. Callers run it on the lifecycle queue.
 */
async function advanceBy(ms: number): Promise<void> {
  const clock = virtual;
  if (clock === undefined) return;
  const stepped = {now: clock.now, next: () => nextDue(clock), advance: (step: number) => { clock.advance(step); }};
  // The runtime the advance starts with, or none while a restart holds it stopped.
  const child = live(current) ? current : undefined;
  try {
    // A runtime that already ended when the advance begins ends it before any step, so its restart is next.
    if (child === undefined && !restarting) throw new Unsettled();
    await stepThrough(stepped, ms, () => Promise.resolve(), () => advanceChild({toMs: clock.now()}, child));
  } catch (error) {
    if (!(error instanceof Unsettled)) throw error;
  }
}

/** The run's virtual time, when its next timer is due and whether work is in flight. */
function clockState(clock: ReturnType<typeof manualClock>): ClockState {
  const due = nextDue(clock);
  return {clock: 'virtual', nowMs: clock.now(), nextDueMs: due === undefined ? null : Number.isFinite(due) ? due : clock.now(), busy: childBusy || devices.serving > 0};
}

/** How far an advance moves virtual time: a whole number of milliseconds from 0 to `MAX_ADVANCE_MS`, and no other field. */
function advanceOf(value: unknown): number | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const {ms, ...rest} = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0 || typeof ms !== 'number' || !Number.isSafeInteger(ms) || ms < 0 || ms > MAX_ADVANCE_MS) return undefined;
  return ms;
}
async function control(name: Control): Promise<void> {
  await ask(id => ({type: 'control', id, control: name}));
}
async function flush(): Promise<number | undefined> {
  const child = current;
  const answer = await ask(id => ({type: 'flush', id}));
  return child === current && answer?.type === 'flushed' ? answer.readerStream : undefined;
}

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
    runtime: fixtures ? 'fixtures' : 'shipped', simulate: typeof started === 'boolean' ? started : null, dataDir, home: childHome.value,
    defaultState: childHome.value !== '' && existsSync(join(childHome.value, '.local/state')), stateFiles: openStateFiles(current?.pid), grantsMode,
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
/** The harness's refusals, in the shared error body from the registry, with fixed text (ADR 0012, "Safe errors"). */
const refusal = (code: ErrorCode, detail: string): ErrorBody => errorBody(code, {detail});

/**
 * A request body the harness refuses before it acts, with its status and registry code: over 4096 characters (413,
 * `too-large`), or not JSON (400, `invalid-request`).
 */
class BodyRefusal extends Error {
  constructor(readonly status: 400 | 413, readonly code: ErrorCode, detail: string) {
    super(detail);
  }
}

async function body(request: IncomingMessage): Promise<unknown> {
  let text = '';
  for await (const chunk of request) {
    text += String(chunk);
    if (text.length > 4096) throw new BodyRefusal(413, 'too-large', 'the body is over 4096 characters');
  }
  if (text === '') return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BodyRefusal(400, 'invalid-request', 'the body is not JSON');
  }
}

/**
 * How long a restart request holds the runtime stopped, 0 without `holdMs`, and whether it waits for a release first
 * (`untilReleased`, false without it), or undefined for any other field or value.
 */
function holdOf(value: unknown): {holdMs: number; untilReleased: boolean} | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const {holdMs = 0, untilReleased = false, ...rest} = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0 || typeof holdMs !== 'number' || !Number.isSafeInteger(holdMs) || holdMs < 0 || holdMs > MAX_HOLD_MS) return undefined;
  if (typeof untilReleased !== 'boolean') return undefined;
  return {holdMs, untilReleased};
}

/** The actions the harness accepts for each fixture module's device: every action a `FixtureSimulation` names, as `Unlisted` checks. */
const ACTIONS = {lamp: ['hold', 'release', 'fail-next'], chime: ['fault-next'], sign: ['online', 'offline']} as const satisfies {
  readonly [D in FixtureSimulation['device']]: readonly Extract<FixtureSimulation, {device: D}>['action'][]
};
/** An action a `FixtureSimulation` names that `ACTIONS` leaves out, which the harness would refuse: none, or the build fails. */
type Unlisted = {[D in FixtureSimulation['device']]: Exclude<Extract<FixtureSimulation, {device: D}>['action'], (typeof ACTIONS)[D][number]>}[FixtureSimulation['device']];
export const EVERY_ACTION_LISTED: [Unlisted] extends [never] ? true : never = true;
/**
 * The simulation a request names, or undefined when its device, action or another field is unknown, so a typo changes
 * nothing: a fixture module's action takes no other field, and a registered module's device admits what its
 * registration says (Hub #999).
 */
function simulationOf(value: unknown): SimulateRequest | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const request = value as Record<string, unknown>;
  const {device, action, ...rest} = request;
  if (typeof device === 'string' && Object.hasOwn(ACTIONS, device)) {
    const listed = ACTIONS[device as FixtureSimulation['device']] as readonly string[];
    return typeof action === 'string' && listed.includes(action) && Object.keys(rest).length === 0 ? request as FixtureSimulation : undefined;
  }
  return devices.admits(request) ? request : undefined;
}

/** Hands a registered module's simulation to the current runtime's links, and waits for them to hear it. */
const push = (device: string) => async (simulation: DeviceAction): Promise<void> => {
  await ask(id => ({type: 'device.push', id, device, simulation}));
};

async function simulate(request: SimulateRequest): Promise<void> {
  switch (request.device) {
    case 'chime':
      await control('chime-fault');
      return;
    case 'sign':
      if (request.action === 'online') signs.online();
      else signs.offline();
      return;
    case 'lamp':
      simulateLamp(request.action);
      return;
  }
  await devices.act(request, push(request.device));
}

function simulateLamp(action: string): void {
  switch (action) {
    case 'hold':
      lamps.hold();
      return;
    case 'release':
      lamps.release();
      return;
    case 'fail-next':
      lamps.failNext();
      return;
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
      const readerStream = await flush();
      const state: HarnessState = {
        ...(readerStream === undefined ? {} : {readerStream}),
        generation, devices: {lamp: lamps.state(), chime: chime.state(), sign: signs.state(), ...devices.states()},
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
      const asked = await body(request);
      const source = asked !== null && typeof asked === 'object' ? (asked as Partial<DisconnectRequest>).source : undefined;
      if (typeof source !== 'string' || !PART_SOURCE.test(source)) {
        return answer(response, 400, refusal('invalid-request', 'only a part\'s stream, bunny/parts/<role>, can be dropped'));
      }
      await ask(id => ({type: 'disconnect', id, source}));
      return answer(response, 200, {status: 'applied'});
    }
    case 'GET /clock':
      if (virtual === undefined) return answer(response, 409, refusal('invalid-state', 'this run is on the real clock'));
      return answer(response, 200, clockState(virtual));
    case 'POST /clock/advance': {
      if (virtual === undefined) return answer(response, 409, refusal('invalid-state', 'this run is on the real clock'));
      const ms = advanceOf(await body(request));
      if (ms === undefined) return answer(response, 400, refusal('invalid-request', `an advance takes only ms, a whole number of milliseconds from 0 to ${MAX_ADVANCE_MS}`));
      const clock = virtual;
      if (ms === 0) {
        const observed = await queue(() => observeClock(clock));
        if (observed === undefined) return answer(response, 503, refusal('unavailable', 'the runtime did not settle its clock'));
        return answer(response, 200, observed);
      }
      await queue(() => advanceBy(ms));
      return answer(response, 200, clockState(clock));
    }
    case 'POST /restart': {
      const hold = holdOf(await body(request));
      if (hold === undefined) {
        return answer(response, 400, refusal('invalid-request', `a restart takes only holdMs, a whole number of milliseconds from 0 to ${MAX_HOLD_MS}, and untilReleased, true or false`));
      }
      // Only a run on virtual time needs a release: a real hold is one the hook can meet (Hub #1711).
      if (hold.untilReleased && virtual === undefined) return answer(response, 409, refusal('invalid-state', 'this run is on the real clock'));
      await restart(hold.holdMs, hold.untilReleased);
      return answer(response, 200, {status: 'restarted', generation});
    }
    case 'POST /release': {
      if (virtual === undefined) return answer(response, 409, refusal('invalid-state', 'this run is on the real clock'));
      const asked = await body(request);
      if (asked === null || typeof asked !== 'object' || Array.isArray(asked) || Object.keys(asked).length > 0) {
        return answer(response, 400, refusal('invalid-request', 'a release takes no field'));
      }
      if (held === undefined) return answer(response, 409, refusal('invalid-state', 'no restart waits for a release'));
      held();
      return answer(response, 200, {status: 'released'});
    }
    default:
      return answer(response, 404, refusal('not-found', 'no such route'));
  }
}

const server = createServer((request, response) => {
  // A caller's body the harness refuses is its refusal. Any other failure is the registry's `internal` with fixed text,
  // and the error is never quoted.
  handle(request, response).catch((error: unknown) => {
    if (error instanceof BodyRefusal) answer(response, error.status, refusal(error.code, error.message));
    else answer(response, 500, refusal('internal', 'the harness failed'));
  });
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
  process.stderr.write(startFailureLine(error));
  process.exit(1);
}
await new Promise<void>((listening, failed) => {
  server.once('error', failed);
  server.listen({host: '127.0.0.1', port: harnessPort}, () => { listening(); });
});
harnessPort = (server.address() as AddressInfo).port;
process.stdout.write(`${JSON.stringify({event: 'runtime.ready', url: `${runtimeUrl}${HEALTH_PATH}`, endpoints: {harness: `http://127.0.0.1:${harnessPort}/`}})}\n`);
