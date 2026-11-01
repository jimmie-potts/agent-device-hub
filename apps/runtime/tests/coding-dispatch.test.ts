// The core forwards the companions module's approved delegation through its tracked dispatcher (Hub #502): one operation
// requested by the module, answered by the module's own coding-run responder, and only from that module.
import assert from 'node:assert/strict';
import {DEFAULT_CODING_BOUNDS, type CodingDispatch, type CodingRun} from '@jimmie-potts/event-contracts/v2/coding';
import {createCoreModule, type CoreHandle} from '../src/core/core.js';
import {contextOf, fixture, it, run, waitFor} from './support.js';

const draft = (data: CodingDispatch) => ({type: 'org.bunny.coding.dispatch.requested', subject: 'assistant', dataschema: 'https://bunny.invalid/events/coding-dispatch/2.0', data});

it('only companions can dispatch a delegation, tracked as its own operation that the module settles when the worker starts', async context => {
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: given => {handle = given; return Promise.resolve();}}]});
  const companions = fixture('companions'), other = fixture('assistant-other');
  await run(context, {modules: [core, companions, other]});
  const runs: CodingRun[] = [];
  await contextOf(companions).sdk.respond<CodingRun>('bunny.cmd.coding-run.assistant', async command => {
    runs.push(command.data);
    await contextOf(companions).sdk.publish('bunny.event.coding-run.assistant', {kind: 'outcome', type: 'org.bunny.coding.run.completed', subject: 'assistant',
      dataschema: 'https://bunny.invalid/events/outcome/2.0', data: {requestId: command.data.requestId, result: 'succeeded', evidence: 'observed'}}, {parent: command});
    return {status: 'accepted'};
  });
  const data: CodingDispatch = {requestId: 'coding-dispatch-test', endpointId: 'worker-endpoint-1', taskId: 'task-1', repository: 'agent-device-hub', brief: 'Add a test.', bounds: DEFAULT_CODING_BOUNDS};
  const refused = await contextOf(other).sdk.request('bunny.cmd.coding-dispatch.assistant', draft(data), {timeoutMs: 2000, requestId: 'coding-other-test'});
  assert.equal(refused.status === 'rejected' && refused.error.error.code, 'forbidden');
  assert.equal(handle?.operation('coding-other-test'), undefined);
  const invalid = await contextOf(companions).sdk.request('bunny.cmd.coding-dispatch.assistant', draft({...data, requestId: 'coding-invalid-test', brief: ''}), {timeoutMs: 2000, requestId: 'coding-invalid-test'});
  assert.equal(invalid.status === 'rejected' && invalid.error.error.code, 'invalid-message');
  assert.equal((await contextOf(companions).sdk.request('bunny.cmd.coding-dispatch.assistant', draft(data), {timeoutMs: 2000, requestId: data.requestId})).status, 'accepted');
  await waitFor(() => handle?.operation(data.requestId)?.status === 'completed');
  const operation = handle?.operation(data.requestId);
  assert.equal(operation?.requestedBy, 'bunny/modules/companions'); assert.equal(operation?.family, 'coding-run'); assert.equal(operation?.result, 'succeeded');
  assert.deepEqual(runs, [data]);
});
