// The core forwards the companions module's approved delegation through its tracked dispatcher (Hub #502): one operation
// requested by the module, answered by the module's own coding-run responder, and only from that module.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {DEFAULT_CODING_BOUNDS, type CodingDispatch, type CodingRun, type CodingState} from '@jimmie-potts/event-contracts/v2/coding';
import {createCoreModule, type CoreHandle} from '../src/core/core.js';
import {contextOf, fixture, flush, it, run, waitFor} from './support.js';

const draft = (data: CodingDispatch) => ({type: 'org.bunny.coding.dispatch.requested', subject: 'assistant', dataschema: `https://bunny.invalid/events/coding-dispatch/${data.harness === undefined ? '2.0' : '2.1'}`, data});

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


it('a held uncapped Codex dispatch is rejected after a same-name finite worker takes over', async context => {
  const selection = randomUUID();
  let selected: string | undefined = selection;
  let entered = (): void => {}, release = (): void => {};
  const held = new Promise<void>(resolve => {release = resolve;});
  const preparing = new Promise<void>(resolve => {entered = resolve;});
  const core = createCoreModule({parts: [{start: given => {
    const dispatch = given.dispatch.bind(given);
    given.dispatch = async action => {
      if (action.requestId === 'stale-codex-dispatch') {entered(); await held;}
      return dispatch(action);
    };
    return Promise.resolve();
  }}]});
  let revision = 1, reads = 0;
  const state = () => ({
    kind: 'state' as const, type: 'org.bunny.coding-state.updated', subject: 'coding',
    dataschema: `https://bunny.invalid/events/coding-state/${selected === undefined ? '2.3' : '2.4'}`,
    data: {id: 'coding', revision, endpointId: 'shared-endpoint', availability: 'available', active: null, readiness: null,
      slots: selected === undefined ? 3 : null, runs: [], waiting: [],
      ...(selected === undefined ? {harnesses: null} : {capacity: 'uncapped', counts: {runs: 0, waiting: 0}, selectionId: selected})} satisfies CodingState,
  });
  const companions = fixture('companions', async ({sdk}) => {
    await sdk.serveSync(['coding-state'], () => {reads += 1; return {revision, states: [state()]};});
  });
  await run(context, {modules: [core, companions]});
  await waitFor(() => reads > 0);
  await flush();
  const sdk = contextOf(companions).sdk;
  const forwarded: {data: CodingRun; version: string}[] = [];
  await sdk.respond<CodingRun>('bunny.cmd.coding-run.assistant', command => {
    forwarded.push({data: command.data, version: command.dataschema});
    return command.data.selectionId === selected ? {status: 'accepted'} : errorBody('unavailable');
  });
  const send = (requestId: string) => sdk.request('bunny.cmd.coding-dispatch.assistant',
    draft({requestId, endpointId: 'shared-endpoint', taskId: 'task-codex', repository: 'agent-device-hub',
      brief: 'Synthetic review.', bounds: DEFAULT_CODING_BOUNDS, harness: 'codex'}), {timeoutMs: 5000, requestId});
  try {
    const stale = send('stale-codex-dispatch');
    await preparing;
    selected = undefined;
    revision = 2;
    await sdk.publish('bunny.state.coding-state.coding', {kind: 'state', type: 'org.bunny.coding-state.updated', subject: 'coding',
      dataschema: 'https://bunny.invalid/events/coding-state/2.3', data: {...state().data, endpointId: null, availability: 'off', slots: null}});
    revision = 3;
    await sdk.publish('bunny.state.coding-state.coding', state());
    await flush();
    release();
    assert.equal((await stale).status, 'rejected');
    assert.equal((await send('fresh-codex-dispatch')).status, 'accepted');
    assert.deepEqual(forwarded.map(({data, version}) => [data.harness, data.selectionId, version]), [
      ['codex', selection, 'https://bunny.invalid/events/coding-run/2.2'],
      ['codex', undefined, 'https://bunny.invalid/events/coding-run/2.1'],
    ]);
  } finally {release();}
});
