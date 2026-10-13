// A disposable process fixture: exits deliberately at durable boundaries, without orderly module shutdown.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {InProcessBus} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCompanionsModule} from '../src/module.js';
import type {AssistantState} from '@jimmie-potts/event-contracts/v2/assistant';
const [stateDir, mode] = process.argv.slice(2); assert.ok(stateDir !== undefined);
let calls = 0;
const bus = new InProcessBus(), core = bus.connect('bunny/core');
await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
const module = createCompanionsModule({model: (_step, text) => {
  calls += 1;
  if (mode === 'lost-call') process.exit(19);
  return Promise.resolve({text: `Synthetic ${text}`, units: 10});
}});
const host = new ModuleHarness({...module, start: context => module.start({...context, sdk: {...context.sdk, publishMessage: (key, message) => {
  if (mode === 'answer-crash' && key === 'bunny.state.assistant-state.assistant' && (message.data as AssistantState).tasks.some(task => task.hasAnswer && task.status === 'running')) process.exit(18);
  return context.sdk.publishMessage(key, message);
}}})}, {bus, stateDir});
await host.start();
const state = () => module.inspectAssistant() ?? assert.fail('assistant state');
const control = async (action: string, taskId?: string) => {
  const requestId = randomUUID();
  return core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-control/2.0', data: {requestId, expectedRevision: state().revision, action, ...(taskId === undefined ? {} : {taskId})}}, {requestId, timeoutMs: 5000});
};
const input = async (answer: boolean) => {
  const requestId = randomUUID(), task = state().tasks[0];
  const staged = await module.manifest.upload?.stage({requestId, target: 'assistant', name: 'input.json', signal: new AbortController().signal,
    bytes: Buffer.from(JSON.stringify({action: answer ? 'answer' : 'start', profile: 'bunny', text: answer ? 'Synthetic saved answer' : 'Synthetic process prompt',
      expectedRevision: state().revision, ...(answer ? {taskId: task?.taskId, questionId: task?.questionId} : {})}))});
  assert.ok(staged !== undefined && !('error' in staged));
  return core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
};
async function wait(status: string): Promise<void> {
  for (let n = 0; n < 200; n += 1) {if (state().tasks[0]?.status === status) return; await new Promise(resolve => setTimeout(resolve, 10));}
  assert.fail(`task did not reach ${status}`);
}
if (mode === 'start' || mode === 'lost-call') {
  assert.equal((await control('enable')).status, 'accepted'); assert.equal((await input(false)).status, 'accepted'); await wait('waiting');
  process.stdout.write(JSON.stringify({state: state(), calls})); process.exit(17);
}
if (mode === 'answer-crash') {assert.equal((await input(true)).status, 'accepted'); assert.fail('expected crash at committed answer');}
let refused: string | undefined;
if (mode === 'resume') {assert.equal((await control('resume', state().tasks[0]?.taskId)).status, 'accepted'); await wait('succeeded');}
if (mode === 'refuse') refused = (await control('resume', state().tasks[0]?.taskId)).status;
process.stdout.write(JSON.stringify({state: state(), calls, refused}));
await host.stop(); await core.close();
