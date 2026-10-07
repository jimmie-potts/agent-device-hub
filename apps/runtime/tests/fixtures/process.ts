// A runtime process with in-test fixture modules, run as `node process.js <scenario> <runtime arguments>`. It goes
// through the same entry point as the shipped runtime, with these modules instead of the shipped list.
import {EventEmitter} from 'node:events';
import type {BunnyModule} from '@jimmie-potts/sdk';
import {createCoreModule as createRealCore, runMain, type ModuleFactory} from '../../src/index.js';
import {approvalPrompt, observation} from './agents.js';
import {createCoreModule} from './core.js';
import {SimulatedLamps, createLampModule, switchLamp} from './lamp.js';

const module = (name: string, start: BunnyModule['start']): BunnyModule => ({manifest: {name, apiVersion: '1.0'}, start, stop: () => {}});
const steady = module('steady', async ({sdk}) => { await sdk.respond('bunny.cmd.mode.steady', () => ({status: 'accepted'})); });
/** Adds an abort listener that throws, or that leaves a rejected promise unhandled, as a module's own cleanup might. */
const onAbort = (signal: AbortSignal, how: 'throws' | 'rejects'): void => {
  signal.addEventListener('abort', () => {
    if (how === 'throws') throw new Error('the abort listener threw');
    void Promise.reject(new Error('the abort listener rejected'));
  });
};
/** A module with such an abort listener, which fails in a handler, in its start, or not at all. */
const cleanup = (name: string, how: 'throws' | 'rejects', fails: 'handler' | 'start' | 'never'): BunnyModule => module(name, async ({sdk, signal}) => {
  onAbort(signal, how);
  if (fails === 'start') throw new Error('the start failed');
  if (fails === 'handler') await sdk.subscribe('bunny.event.session.*', () => { throw new Error('the handler failed'); });
});
const publisher = module('publisher', ({sdk, scheduler}) => {
  scheduler.after(100, async () => {
    await sdk.publish('bunny.event.session.s1', {
      kind: 'occurrence', type: 'org.bunny.turn.ended', subject: 's1', dataschema: 'https://bunny.invalid/events/test-turn/2.0', data: {sessionId: 's1'},
    });
  });
});

/** Keeps the event loop busy for `ms`, and returns how often it looked at the clock. */
const spin = (ms: number): number => {
  const until = performance.now() + ms;
  let spins = 0;
  while (performance.now() < until) spins += 1;
  return spins;
};

/**
 * An emitter outside every module's async flow, as a client library's shared socket would be. A listener a module adds
 * runs in whatever flow emits, here the scenario's own timer, so an error it throws escapes as the runtime's own.
 */
const outside = new EventEmitter();
/** Reads its token, then throws, from a listener on the outside emitter, an error whose code is that token. */
const leaker = module('leaker', async ({secrets}) => {
  const token = await secrets.read('token');
  outside.once('tick', () => { throw Object.assign(new Error(`the device refused ${token}`), {code: token}); });
});

/** Switches lamp-1 on once, shortly after the modules have started. */
const driver = module('driver', ({sdk, scheduler, log}) => {
  scheduler.after(100, async () => {
    const {key, draft} = switchLamp('lamp-1', 'on');
    const result = await sdk.request(key, draft, {timeoutMs: 5000, requestId: 'req-crash'});
    log.info('command.completed', {'bunny.request.id': 'req-crash', 'bunny.outcome': result.status});
  });
});

/** A hook's observation of an approval prompt, shortly after the modules have started. */
const hook = module('hook', ({sdk, scheduler, clock}) => {
  scheduler.after(100, async () => {
    const {key, draft} = observation(approvalPrompt('approval-1'), clock.now());
    await sdk.publish(key, draft);
  });
});
/** A consumer that hears the core's messages and drops duplicates by (source, id), logging each it takes or drops. */
const listener = module('listener', async ({sdk, log}) => {
  const heard = new Set<string>();
  await sdk.subscribe('bunny.*.*.*', message => {
    if (message.source !== 'bunny/core') return;
    const duplicate = heard.has(message.id);
    heard.add(message.id);
    log.info('message.received', {
      'bunny.participant': message.source, 'bunny.message.id': message.id, 'bunny.message.kind': message.kind, 'bunny.outcome': duplicate ? 'duplicate' : 'accepted',
    });
  });
});

const scenarios: Record<string, readonly BunnyModule[]> = {
  // The process dies between the core's commit and its publish (Hub #831): its outbox holds the session's messages.
  'core-crash': [createRealCore({beforePublish: () => { process.kill(process.pid, 'SIGKILL'); }}), listener, hook],
  // The next start, with no hook: the core sends what it stored, once.
  'core-restart': [createRealCore(), listener],
  // The process dies between the lamp's commit and its publish (Hub #882): its outbox holds the outcome.
  'lamp-crash': [createCoreModule(), createLampModule({transport: new SimulatedLamps(), beforePublish: () => { process.kill(process.pid, 'SIGKILL'); }}), driver],
  // The next start, with no driver: nothing sends the command again.
  'lamp-restart': [createCoreModule(), createLampModule({transport: new SimulatedLamps()})],
  // Errors raised in each module's own flow, outside every SDK handler and runtime timer, reach the process.
  escaping: [
    module('thrower', () => { setTimeout(() => { throw new Error('thrown from a timer'); }, 10); }),
    module('rejecter', () => { setTimeout(() => { void Promise.reject(new Error('rejected and never handled')); }, 10); }),
    steady,
  ],
  'runtime-error': [steady],
  quiet: [steady],
  // Each abort listener's error must stay with its own module: on a handler error, a failed start and the runtime's stop.
  'abort-listeners': [
    publisher, cleanup('handler-throws', 'throws', 'handler'), cleanup('handler-rejects', 'rejects', 'handler'),
    cleanup('start-throws', 'throws', 'start'), cleanup('start-rejects', 'rejects', 'start'),
    cleanup('stop-throws', 'throws', 'never'), cleanup('stop-rejects', 'rejects', 'never'), steady,
  ],
  // A start that takes a second, and a stop that leaves a record, to show a signal during startup stops it cleanly.
  'slow-start': [{
    manifest: {name: 'slow', apiVersion: '1.0'},
    start: () => new Promise(resolve => { setTimeout(resolve, 1000); }),
    stop: () => { process.stderr.write(`${JSON.stringify({event_name: 'fixture.stopped', attributes: {'bunny.module': 'slow'}})}\n`); },
  }],
  // The loop sticks for good shortly after start, as a module stuck in a synchronous loop would.
  stuck: [module('spinner', () => { setTimeout(() => { spin(Number.POSITIVE_INFINITY); }, 200); })],
  // One busy spell of 150 ms.
  busy: [module('spinner', () => { setTimeout(() => { spin(150); }, 100); })],
  // An error carrying a secret a module read escapes every module's flow (Hub #919). Its section names the token's file.
  'secret-escape': [leaker],
};

const [scenario = '', ...args] = process.argv.slice(2);
const modules = scenarios[scenario];
if (modules === undefined) throw new Error(`unknown scenario ${scenario}`);
// Each fixture module is already built with the transport its scenario needs, whether or not the runtime simulates.
await runMain(args, modules.map((module): ModuleFactory => ({name: module.manifest.name, create: () => module, simulate: () => module})));
if (scenario === 'secret-escape') setInterval(() => { outside.emit('tick'); }, 50).unref();
if (scenario === 'runtime-error') {
  setTimeout(() => { throw Object.assign(new RangeError('a bug outside every module, quoting http://device.invalid/?token=secret'), {code: 'EFIXTURE'}); }, 50);
}
