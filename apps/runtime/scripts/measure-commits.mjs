#!/usr/bin/env node
// Measures the SQLite commits the runtime makes on its event loop, for Hub #972 and #123: how many commits each
// lifecycle observation or command costs, how long the loop is blocked in SQLite, and the event-loop delay meanwhile.
//   node apps/runtime/scripts/measure-commits.mjs [--scenario intake|lifx|outbox|all] [--seconds 30] [--rate 20] [--commands 20] [--runs 3]
// - `intake` starts a runtime with the shipped core alone and publishes hooks' lifecycle observations at `--rate` a second
//   for `--seconds`, cycling four sessions through a turn start, an approval prompt, its resolution and a turn end, so
//   each observation changes a session.
// - `lifx` starts a runtime with the core and the shipped LIFX module on its simulated bulbs, and sends `--commands`
//   power-set commands one after another, each waiting for its outcome.
// - `outbox` runs the SDK's outbox alone on a module database, as a module that stores a pending state when it accepts
//   a command and then its state, outcome and pending count when it completes it, with a stand-in core acknowledging
//   each outcome; `--commands` commands.
// Run `npm run build` first, with TMPDIR outside every Git checkout; each run uses a temporary state directory there.
// The probe wraps node:sqlite's `exec`, `prepare` and statement calls in its own process only. A commit is a `COMMIT`
// that ends a transaction, or a write outside a transaction that changed a row (SQLite's autocommit); a synced commit is
// one that waits for the disk: any commit in rollback journal mode, and one at `synchronous = FULL` or above in WAL mode.
// The blocked time is every SQLite call's duration on a module database. The event-loop delay is `monitorEventLoopDelay` at 1 ms resolution
// over the measured window. Output is one JSON line per run, then a summary.
import {mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {cpus, release, tmpdir} from 'node:os';
import {basename, join} from 'node:path';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {DatabaseSync, StatementSync} from 'node:sqlite';
import {parseArgs} from 'node:util';

const {values} = parseArgs({options: {
  scenario: {type: 'string', default: 'all'}, seconds: {type: 'string', default: '30'}, rate: {type: 'string', default: '20'},
  commands: {type: 'string', default: '20'}, runs: {type: 'string', default: '3'},
}});
const SCENARIOS = ['intake', 'lifx', 'outbox'];
const scenarios = values.scenario === 'all' ? SCENARIOS : [values.scenario];
const seconds = Number(values.seconds), rate = Number(values.rate), commands = Number(values.commands), runs = Number(values.runs);
if (scenarios.some(name => !SCENARIOS.includes(name)) || !(seconds > 0) || !(rate > 0) || !(commands >= 1) || !(runs >= 1)) {
  process.stderr.write('usage: measure-commits.mjs [--scenario intake|lifx|outbox|all] [--seconds 30] [--rate 20] [--commands 20] [--runs 3]\n');
  process.exit(2);
}

const runtimeDist = new URL('../dist/src/', import.meta.url);
const {createCoreModule, startRuntime, CONFIG_SCHEMA} = await import(new URL('index.js', runtimeDist).href);
const {openModuleDatabase} = await import(new URL('state.js', runtimeDist).href);
const {InProcessBus, Outbox} = await import('@jimmie-potts/sdk');
const {LIFX_SIMULATED_SECTION, lifxModuleFactory} = await import('@jimmie-potts/lifx');
const {sessionEntityId} = await import('@jimmie-potts/event-contracts/v2/families');

// Counting. Only module databases count: the core's lock database (`core.sqlite-owner`) holds one open transaction.
const round = value => Math.round(value * 10) / 10;
const percentile = (sorted, p) => sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.ceil(p / 100 * sorted.length) - 1)];
const WRITE = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i;
let window;
const owners = new WeakMap();
const nameOf = database => {
  try {
    const location = database.location();
    return location === null || location === '' || location.endsWith('-owner') ? undefined : basename(location);
  } catch {
    return undefined;
  }
};
const pragmas = new WeakMap();
/** Whether a commit on this connection now waits for the disk, read before the call so its time is not counted. */
function syncing(database) {
  let read = pragmas.get(database);
  if (read === undefined) {
    read = {mode: prepare.call(database, 'PRAGMA journal_mode'), level: prepare.call(database, 'PRAGMA synchronous')};
    pragmas.set(database, read);
  }
  return get.call(read.mode).journal_mode !== 'wal' || get.call(read.level).synchronous >= 2;
}
function note(name, ms, committed, synced) {
  const entry = window.databases[name] ??= {commits: 0, synced: 0, commitMs: [], sqliteMs: 0};
  entry.sqliteMs += ms;
  if (committed) {
    entry.commits += 1;
    if (synced) entry.synced += 1;
    entry.commitMs.push(ms);
  }
}
const exec = DatabaseSync.prototype.exec;
const prepare = DatabaseSync.prototype.prepare;
const get = StatementSync.prototype.get;
DatabaseSync.prototype.exec = function (sql) {
  const name = window === undefined ? undefined : nameOf(this);
  if (name === undefined) return exec.call(this, sql);
  const before = this.isTransaction;
  const synced = syncing(this);
  const began = performance.now();
  try {
    return exec.call(this, sql);
  } finally {
    const after = this.isOpen && this.isTransaction;
    const ended = before && !after && /\b(COMMIT|END)\b/i.test(sql);
    note(name, performance.now() - began, ended || (!before && !after && WRITE.test(sql)), synced);
  }
};
DatabaseSync.prototype.prepare = function (sql) {
  const statement = prepare.call(this, sql);
  owners.set(statement, this);
  return statement;
};
for (const method of ['run', 'get', 'all']) {
  const original = StatementSync.prototype[method];
  StatementSync.prototype[method] = function (...args) {
    const database = owners.get(this);
    const name = window === undefined || database === undefined ? undefined : nameOf(database);
    if (name === undefined) return original.apply(this, args);
    const before = database.isTransaction;
    const synced = !before && method === 'run' && syncing(database);
    const began = performance.now();
    let result;
    try {
      result = original.apply(this, args);
      return result;
    } finally {
      note(name, performance.now() - began, method === 'run' && !before && Number(result?.changes ?? 0) > 0, synced);
    }
  };
}

/** Starts a measured window: commits, SQLite time and the event-loop delay until `end`. */
function measure() {
  window = {databases: {}};
  const delay = monitorEventLoopDelay({resolution: 1});
  delay.enable();
  const began = performance.now();
  return () => {
    delay.disable();
    const {databases} = window;
    window = undefined;
    const elapsedMs = performance.now() - began;
    const all = Object.values(databases);
    const commitMs = all.flatMap(entry => entry.commitMs).sort((a, b) => a - b);
    const commits = all.reduce((sum, entry) => sum + entry.commits, 0);
    const synced = all.reduce((sum, entry) => sum + entry.synced, 0);
    const sqliteMs = all.reduce((sum, entry) => sum + entry.sqliteMs, 0);
    return {
      elapsedMs: round(elapsedMs), commits, synced, commitsPerMinute: round(commits / elapsedMs * 60_000), syncedPerMinute: round(synced / elapsedMs * 60_000),
      commitMs: {p50: round(percentile(commitMs, 50)), p90: round(percentile(commitMs, 90)), max: round(commitMs.at(-1) ?? 0), total: round(commitMs.reduce((a, b) => a + b, 0))},
      blockedMs: round(sqliteMs), blockedMsPerMinute: round(sqliteMs / elapsedMs * 60_000),
      eventLoopDelayMs: {p50: round(delay.percentile(50) / 1e6), p99: round(delay.percentile(99) / 1e6), max: round(delay.max / 1e6)},
      byDatabase: Object.fromEntries(Object.entries(databases).map(([name, entry]) => [name, {commits: entry.commits, synced: entry.synced, blockedMs: round(entry.sqliteMs)}])),
    };
  };
}

const wait = ms => new Promise(resolve => { setTimeout(resolve, ms); });
async function stateDirectory() {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'bunny-commits-'));
  return {dir, state: join(dir, 'state'), remove: () => rm(dir, {recursive: true, force: true})};
}
/** A module that only lends its participant to the probe. */
function participant(name) {
  const lent = {sdk: undefined};
  return {lent, module: {manifest: {name, apiVersion: '1.0'}, start: context => { lent.sdk = context.sdk; }, stop: () => {}}};
}

const LIFECYCLE_SCHEMA = 'https://bunny.invalid/events/lifecycle/2.0';
const STEPS = [
  turn => ({kind: 'turn-started', turn}),
  turn => ({kind: 'attention-approval', turn, attention: {status: 'known', id: `approval-${turn}`}}),
  turn => ({kind: 'attention-resolved', turn, attention: {status: 'known', id: `approval-${turn}`}}),
  turn => ({kind: 'turn-ended', turn}),
];
/** The n-th observation of the load: four synthetic sessions in turn, each cycling through the steps. */
function observation(n) {
  const identity = {provider: 'claude', client: 'code', hostId: 'host-sim', sourceId: 'claude-code', sessionId: `session-load-${n % 4}`};
  const cycle = Math.floor(n / 4);
  const turn = `turn-${Math.floor(cycle / STEPS.length)}`;
  const {kind, attention} = STEPS[cycle % STEPS.length](turn);
  const subject = sessionEntityId(identity);
  const data = {identity, turn: {status: 'known', id: turn}, parent: {status: 'top-level'}, event: attention === undefined ? {kind} : {kind, attention},
    observedAtMs: Date.now(), ordering: {status: 'unknown'}};
  return {key: `bunny.event.lifecycle.${subject}`, draft: {kind: 'occurrence', type: 'org.bunny.lifecycle.observed', subject, dataschema: LIFECYCLE_SCHEMA, data}};
}

async function intake() {
  const directory = await stateDirectory();
  const received = {};
  const hook = participant('hook');
  const runtime = await startRuntime({modules: [createCoreModule(), hook.module], port: 0, stateDir: directory.state, log: record => {
    if (record.attributes['bunny.module'] === 'core' && record.event_name === 'message.received') {
      const outcome = String(record.attributes['bunny.outcome']);
      received[outcome] = (received[outcome] ?? 0) + 1;
    }
  }});
  try {
    await wait(500);
    const end = measure();
    const total = Math.round(seconds * rate);
    const began = performance.now();
    for (let n = 0; n < total; n += 1) {
      const {key, draft} = observation(n);
      await hook.lent.sdk.publish(key, draft);
      await wait(Math.max(0, began + (n + 1) * 1000 / rate - performance.now()));
    }
    // Let the last observations commit and publish.
    await wait(500);
    const result = end();
    return {scenario: 'intake', rate, seconds, observations: total, received, ...result, commitsPerObservation: round(result.commits / total * 100) / 100,
      syncedPerObservation: round(result.synced / total * 100) / 100, blockedMsPerObservation: round(result.blockedMs / total)};
  } finally {
    await runtime.stop();
    await directory.remove();
  }
}

async function lifx() {
  const directory = await stateDirectory();
  const configFile = join(directory.dir, 'config.json');
  await writeFile(configFile, JSON.stringify({schema: CONFIG_SCHEMA, modules: {lifx: LIFX_SIMULATED_SECTION}}), {mode: 0o600});
  const driver = participant('driver');
  const runtime = await startRuntime({modules: [createCoreModule(), lifxModuleFactory.simulate(), driver.module], port: 0, stateDir: directory.state, configFile, log: () => {}});
  try {
    const {sdk} = driver.lent;
    const outcomes = new Map();
    await sdk.subscribe('bunny.event.power-set.*', message => {
      if (message.kind === 'outcome') outcomes.get(message.data.requestId)?.(message);
    });
    await wait(1000);
    const end = measure();
    const replyMs = [], outcomeMs = [];
    const results = {};
    for (let n = 0; n < commands; n += 1) {
      const requestId = `req-commits-${n}`;
      const outcome = new Promise(resolve => { outcomes.set(requestId, resolve); });
      const began = performance.now();
      const reply = await sdk.request('bunny.cmd.power-set.pendant-1', {
        type: 'org.bunny.power.set.requested', subject: 'pendant-1', dataschema: 'https://bunny.invalid/events/power-set/2.0', data: {on: n % 2 === 0},
      }, {timeoutMs: 5000, requestId});
      replyMs.push(performance.now() - began);
      if (reply.status !== 'accepted') throw new Error(`the command was not accepted: ${JSON.stringify(reply)}`);
      const message = await outcome;
      outcomeMs.push(performance.now() - began);
      results[message.data.result] = (results[message.data.result] ?? 0) + 1;
    }
    await wait(250);
    const result = end();
    const sorted = list => list.sort((a, b) => a - b);
    return {scenario: 'lifx', commands, results, ...result, commitsPerCommand: round(result.commits / commands * 100) / 100,
      syncedPerCommand: round(result.synced / commands * 100) / 100,
      blockedMsPerCommand: round(result.blockedMs / commands),
      replyMs: {p50: round(percentile(sorted(replyMs), 50)), max: round(replyMs.at(-1))}, outcomeMs: {p50: round(percentile(sorted(outcomeMs), 50)), max: round(outcomeMs.at(-1))}};
  } finally {
    await runtime.stop();
    await directory.remove();
  }
}

const OUTCOME_SCHEMA = 'https://bunny.invalid/events/power-set-outcome/2.0';
const stateOf = (id, revision, data) => ({kind: 'state', type: 'org.bunny.lamp.updated', subject: id, dataschema: 'https://bunny.invalid/events/lamp/2.0', data: {id, revision, ...data}});

async function outbox() {
  const directory = await stateDirectory();
  const database = openModuleDatabase(directory.state, 'lamp');
  try {
    database.exec('CREATE TABLE IF NOT EXISTS lamp (id TEXT PRIMARY KEY, power TEXT NOT NULL, pending INTEGER NOT NULL) STRICT');
    const bus = new InProcessBus();
    const module = bus.connect('bunny/modules/lamp');
    const box = new Outbox({sdk: module, database, clock: {now: () => Date.now()}});
    const acknowledged = new Map();
    // The stand-in core: it acknowledges each outcome once it has it, as the core will (Hub #782).
    await bus.connect('bunny/core').subscribe('bunny.event.power-set.*', message => {
      if (message.kind !== 'outcome') return;
      box.acknowledge(message.id);
      acknowledged.get(message.data.requestId)?.();
    });
    const write = database.prepare('INSERT INTO lamp VALUES (\'lamp-1\', ?, ?) ON CONFLICT (id) DO UPDATE SET power = excluded.power, pending = excluded.pending');
    const end = measure();
    let revision = 0;
    for (let n = 0; n < commands; n += 1) {
      const requestId = `req-commits-${n}`;
      const power = n % 2 === 0 ? 'on' : 'off';
      const done = new Promise(resolve => { acknowledged.set(requestId, resolve); });
      // Accepted: the pending command and the state that shows it.
      await box.transaction(add => {
        write.run(power, 1);
        add('bunny.state.lamp.lamp-1', stateOf('lamp-1', ++revision, {power, pending: 1}));
      });
      // Completed: the state, the outcome and the pending count, in one transaction.
      await box.transaction(add => {
        write.run(power, 0);
        add('bunny.state.lamp.lamp-1', stateOf('lamp-1', ++revision, {power, pending: 0}));
        add('bunny.event.power-set.lamp-1', {kind: 'outcome', type: 'org.bunny.power.set.completed', subject: 'lamp-1', dataschema: OUTCOME_SCHEMA,
          data: {requestId, result: 'succeeded', evidence: 'transmitted'}});
        add('bunny.state.lamp-queue.lamp-1', stateOf('lamp-1', revision, {waiting: 0}));
      });
      await done;
    }
    await wait(100);
    const result = end();
    await module.close();
    return {scenario: 'outbox', commands, ...result, commitsPerCommand: round(result.commits / commands * 100) / 100,
      syncedPerCommand: round(result.synced / commands * 100) / 100, blockedMsPerCommand: round(result.blockedMs / commands)};
  } finally {
    database.close();
    await directory.remove();
  }
}

const RUN = {intake, lifx, outbox};
const summary = {};
for (const name of scenarios) {
  const results = [];
  for (let n = 0; n < runs; n += 1) {
    const result = await RUN[name]();
    results.push(result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
  const span = pick => {
    const list = results.map(pick);
    return [Math.min(...list), Math.max(...list)];
  };
  const unit = name === 'intake' ? 'Observation' : 'Command';
  const [per, synced, blocked] = [`commitsPer${unit}`, `syncedPer${unit}`, `blockedMsPer${unit}`];
  summary[name] = {runs, [per]: span(result => result[per]), [synced]: span(result => result[synced]), [blocked]: span(result => result[blocked]),
    commitsPerMinute: span(result => result.commitsPerMinute), syncedPerMinute: span(result => result.syncedPerMinute),
    blockedMsPerMinute: span(result => result.blockedMsPerMinute), commitMsP50: span(result => result.commitMs.p50), commitMsP90: span(result => result.commitMs.p90),
    eventLoopDelayP99Ms: span(result => result.eventLoopDelayMs.p99)};
}
process.stdout.write(`${JSON.stringify({summary, host: {node: process.version, kernel: release(), cpu: cpus()[0]?.model, cpus: cpus().length}})}\n`);
