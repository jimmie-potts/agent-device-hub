// A disposable process fixture for the message queue (Hub #2030): it exits deliberately right after the commit that ends
// one task and starts the queued message, without orderly module shutdown, and reports what the store holds. It waits by
// yielding event-loop turns, never on a timer.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {InProcessBus} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import type {AssistantState} from '@jimmie-potts/event-contracts/v2/assistant';
import {createCompanionsModule} from '../src/module.js';
import type {TurnReply} from '../src/assistant/provider.js';

const [stateDir, mode] = process.argv.slice(2); assert.ok(stateDir !== undefined && mode !== undefined);
let calls = 0, release: (() => void) | undefined;
const bus = new InProcessBus(), core = bus.connect('bunny/core');
await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
// The first task's call waits until its message is queued behind it; every other call answers at once.
const module = createCompanionsModule({provider: {name: 'synthetic', model: 'synthetic', turn: () => {
  calls += 1;
  const answer: TurnReply = {text: `Synthetic process answer ${String(calls)}`, calls: [], stop: 'end', units: 1};
  return mode === 'crash' && calls === 1 ? new Promise(resolve => {release = () => {resolve(answer);};}) : Promise.resolve(answer);
}}});
let host: ModuleHarness | undefined;
const report = (): string => {
  const database = host?.moduleDatabase(); assert.ok(database !== undefined);
  const prompts = (database.prepare('SELECT record FROM assistant_tasks ORDER BY seq').all() as {record: string}[]).map(row => (JSON.parse(row.record) as {prompt: string}).prompt);
  const queued = (database.prepare('SELECT COUNT(*) AS count FROM assistant_queued_messages').get() as {count: number}).count;
  return JSON.stringify({state: module.inspectAssistant(), calls, queued, prompts});
};
host = new ModuleHarness({...module, start: context => module.start({...context, sdk: {...context.sdk, publishMessage: (key, message) => {
  // The state this commit publishes shows the queued message's task running with nothing left in the queue: the commit
  // that ended the first task and started it is durable, so the process ends here.
  const data = message.data as AssistantState;
  if (mode === 'crash' && key === 'bunny.state.assistant-state.assistant' && data.tasks.some(task => task.status === 'running') && data.queues === undefined && calls === 1 && release === undefined) {
    process.stdout.write(report()); process.exit(23);
  }
  return context.sdk.publishMessage(key, message);
}}})}, {bus, stateDir, section: {}});
await host.start();
const state = () => module.inspectAssistant() ?? assert.fail('assistant state');
const until = async (check: () => boolean): Promise<void> => {
  for (let turn = 0; turn < 20_000; turn += 1) {if (check()) return; await new Promise(resolve => {setImmediate(resolve);});}
  assert.fail('the expected state never arrived');
};
const control = (action: string, extra: Record<string, unknown> = {}) => {
  const requestId = randomUUID();
  return core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-control/2.0', data: {requestId, expectedRevision: state().revision, action, ...extra}}, {requestId, timeoutMs: 5000});
};
const input = async (action: 'start' | 'queue', text: string) => {
  const requestId = randomUUID();
  const staged = await module.manifest.upload?.stage({requestId, target: 'assistant', name: 'input.json', signal: new AbortController().signal,
    bytes: Buffer.from(JSON.stringify({action, profile: 'bunny', text, expectedRevision: state().revision}))});
  assert.ok(staged !== undefined && !('error' in staged));
  return core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
};
if (mode === 'crash') {
  assert.equal((await control('enable')).status, 'accepted');
  assert.equal((await input('start', 'Synthetic process first')).status, 'accepted');
  await until(() => release !== undefined);
  assert.equal((await input('queue', 'Synthetic process queued')).status, 'accepted');
  const answer = release; release = undefined; answer?.();
  await until(() => false);
}
if (mode === 'resume') {
  assert.equal((await control('resume', {taskId: state().tasks[0]?.taskId})).status, 'accepted');
  await until(() => state().tasks[0]?.status === 'succeeded');
}
process.stdout.write(report());
await host.stop(); await core.close();
