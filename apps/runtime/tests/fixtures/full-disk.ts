// The core on a real full disk (Hub #972), run by full-disk.test.ts inside a user and mount namespace whose small tmpfs
// is mounted at the given directory, so SQLite meets ENOSPC as on a full disk. It starts a runtime with the core on one
// state directory and stops it cleanly, fills the disk, then starts the core again on that directory and for the first
// time on another, sends each an observation, frees the disk and sends each another. It prints one JSON line per step:
// the core's state in health, how the core took each observation, and how it answered a sync.
//   node full-disk.js <tmpfs mount>
import {closeSync, mkdirSync, openSync, rmSync, writeSync} from 'node:fs';
import {join} from 'node:path';
import type {Sdk} from '@jimmie-potts/sdk';
import {createCoreModule, startRuntime, type LogRecord, type Runtime} from '../../src/index.js';
import {IDENTITY, observation, sessionStarted} from './agents.js';

const mount = process.argv[2] ?? '';
if (mount === '') throw new Error('usage: full-disk.js <tmpfs mount>');
const print = (line: object): void => { process.stdout.write(`${JSON.stringify(line)}\n`); };
const wait = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });

type Hosted = {runtime: Runtime; hook: Sdk; records: LogRecord[]};
async function host(stateDir: string): Promise<Hosted> {
  const records: LogRecord[] = [];
  const lent: {sdk?: Sdk} = {};
  const hook = {manifest: {name: 'hook', apiVersion: '1.0'}, start: (context: {sdk: Sdk}) => { lent.sdk = context.sdk; }, stop: () => {}};
  const runtime = await startRuntime({modules: [createCoreModule(), hook], port: 0, stateDir, log: record => { records.push(record); }});
  if (lent.sdk === undefined) throw new Error('the hook did not start');
  return {runtime, hook: lent.sdk, records};
}
const coreState = (hosted: Hosted): string | undefined => hosted.runtime.health().modules.find(module => module.name === 'core')?.state;
/** How the core answers a sync now: `synced`, or the refusal's code. */
async function synced(hosted: Hosted): Promise<string> {
  const result = await hosted.hook.sync(['session'], () => {}, {timeoutMs: 2000});
  if (result.status !== 'synced') return result.error.error.code;
  await result.copy.close();
  return 'synced';
}
/** How the core took each observation so far, in order: `accepted`, or `rejected/<code>`. */
const taken = (hosted: Hosted): string[] => hosted.records
  .filter(record => record.attributes['bunny.module'] === 'core' && record.event_name === 'message.received')
  .map(record => [record.attributes['bunny.outcome'], record.attributes['bunny.code']].filter(part => part !== undefined).map(String).join('/'));
let sessions = 0;
/** Sends one new session's observation and waits up to 5 s for the core to take it or refuse it; a failed core never does. */
async function observe(hosted: Hosted): Promise<void> {
  sessions += 1;
  const before = taken(hosted).length;
  const {key, draft} = observation(sessionStarted, Date.now(), {identity: {...IDENTITY, sessionId: `session-full-${String(sessions)}`}});
  await hosted.hook.publish(key, draft);
  for (let waited = 0; taken(hosted).length === before && waited < 5000; waited += 20) await wait(20);
}
function fill(): void {
  const descriptor = openSync(join(mount, 'filler'), 'w');
  const chunk = Buffer.alloc(4096, 1);
  try {
    for (;;) writeSync(descriptor, chunk);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOSPC')) throw error;
  } finally {
    closeSync(descriptor);
  }
}

const kept = join(mount, 'kept');
const fresh = join(mount, 'fresh');
const first = await host(kept);
await observe(first);
print({step: 'empty-disk', core: coreState(first), taken: taken(first), sync: await synced(first)});
await first.runtime.stop();
mkdirSync(fresh, {mode: 0o700});
fill();
const restarted = await host(kept);
await observe(restarted);
print({step: 'restart-full-disk', core: coreState(restarted), taken: taken(restarted), sync: await synced(restarted)});
const started = await host(fresh);
await observe(started);
print({step: 'first-start-full-disk', core: coreState(started), taken: taken(started), sync: await synced(started)});
rmSync(join(mount, 'filler'));
// Past the core's first backoff of 1 s, the next observation opens its owner again.
await wait(1200);
for (const hosted of [restarted, started]) await observe(hosted);
const after = async (hosted: Hosted): Promise<object> => ({core: coreState(hosted), taken: taken(hosted), sync: await synced(hosted)});
print({step: 'room-again', restarted: await after(restarted), started: await after(started)});
await restarted.runtime.stop();
await started.runtime.stop();
