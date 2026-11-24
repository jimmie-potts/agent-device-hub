// A disposable process fixture for steering (Hub #2031): it exits deliberately during the model call that read a steer,
// after that call's admission took the steer into the task's transcript, without orderly module shutdown, and reports
// what the store holds. A second run cancels the task. It waits by yielding event-loop turns, never on a timer.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {InProcessBus} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCompanionsModule} from '../src/module.js';
import type {TurnReply} from '../src/assistant/provider.js';

const STEER = 'Synthetic process steer';
const [stateDir, mode] = process.argv.slice(2); assert.ok(stateDir !== undefined && mode !== undefined);
let calls = 0, release: (() => void) | undefined, report: () => string = () => '';
const bus = new InProcessBus(), core = bus.connect('bunny/core');
await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
// The first call waits until the task is steered and then ends; the call that reads the steer never answers: the
// process exits inside it.
const module = createCompanionsModule({provider: {name: 'synthetic', model: 'synthetic', turn: () => {
  calls += 1;
  if (calls === 2) {process.stdout.write(report()); process.exit(23);}
  const answer: TurnReply = {text: 'Synthetic process early answer', calls: [], stop: 'end', units: 1};
  return new Promise(resolve => {release = () => {resolve(answer);};});
}}});
const host = new ModuleHarness(module, {bus, stateDir, section: {}});
await host.start();
report = () => {
  const database = host.moduleDatabase(); assert.ok(database !== undefined);
  const task = JSON.parse((database.prepare('SELECT record FROM assistant_tasks ORDER BY seq LIMIT 1').get() as {record: string}).record) as {status: string; transcript: {role: string; text?: string}[]};
  const count = (sql: string): number => (database.prepare(sql).get(STEER) as {count: number}).count;
  return JSON.stringify({...(mode === 'crash' ? {} : {status: task.status}), steers: count('SELECT COUNT(*) AS count FROM assistant_steers WHERE text=?'),
    transcriptSteers: task.transcript.filter(item => item.role === 'owner' && item.text === STEER).length,
    messages: count("SELECT COUNT(*) AS count FROM assistant_messages WHERE text=? AND role='owner'"),
    ...(mode === 'crash' ? {} : {queued: count('SELECT COUNT(*) AS count FROM assistant_queued_messages WHERE text=?'), calls})});
};
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
const input = async (data: Record<string, unknown>) => {
  const requestId = randomUUID();
  const staged = await module.manifest.upload?.stage({requestId, target: 'assistant', name: 'input.json', signal: new AbortController().signal,
    bytes: Buffer.from(JSON.stringify({profile: 'bunny', expectedRevision: state().revision, ...data}))});
  assert.ok(staged !== undefined && !('error' in staged));
  return core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
};
if (mode === 'crash') {
  assert.equal((await control('enable')).status, 'accepted');
  assert.equal((await input({action: 'start', text: 'Synthetic process request'})).status, 'accepted');
  await until(() => release !== undefined);
  assert.equal((await input({action: 'steer', text: STEER, taskId: state().tasks[0]?.taskId})).status, 'accepted');
  release?.();
  await until(() => false);
}
if (mode === 'cancel') {
  assert.equal(state().tasks[0]?.status, 'uncertain', 'the call that read the steer has an unknown fate');
  assert.equal((await control('cancel', {taskId: state().tasks[0]?.taskId})).status, 'accepted');
  await until(() => state().tasks[0]?.status === 'cancelled');
}
process.stdout.write(report());
await host.stop(); await core.close();
