// Real core store, dispatcher, native responders and operation projection, on one owned port-0 runtime at a time.
import assert from 'node:assert/strict';
import type {InboxItem, Mode, ModeState} from '@jimmie-potts/event-contracts/v2/families';
import {createCoreModule, type CoreHandle} from '../src/core/core.js';
import type {Action} from '../src/core/tracker.js';
import {modeChildRequestId} from '../src/core/mode-participants.js';
import {ModeDevice} from './fixtures/mode-devices.js';
import {contextOf, edgeConfig, fixture, it, run, waitFor, manualClock, stateDir} from './support.js';

const action = (mode: Mode, requestId: string, expectedRevision?: number): Action => ({key: 'bunny.cmd.mode-set.hub', requestedBy: 'bunny/parts/operator', requestId,
  draft: {type: 'org.bunny.mode.set.requested', subject: 'hub', dataschema: 'https://bunny.invalid/events/mode-set/2.0', data: {mode, ...(expectedRevision === undefined ? {} : {expectedRevision})}}});

it('browser mode selection carries its authenticated trace through the tracker and native commands', async context => {
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: given => {handle = given; return Promise.resolve();}}]});
  const nano = new ModeDevice('nanoleaf', 'wall'), pixoo = new ModeDevice('pixoo', 'pixoo-1');
  const files = await edgeConfig(context, [], {modules: {nanoleaf: {}, pixoo: {}}, browserAccess: 'trusted-loopback'});
  const lines: string[] = [];
  const {runtime} = await run(context, {modules: [core, nano.module(), pixoo.module()], configFile: files.config,
    edge: {schemas: {}}, spans: line => {lines.push(line);}});
  const headers = {origin: runtime.url, 'bunny-request': '1', 'content-type': 'application/json'};
  const signed = await fetch(new URL('/api/v2/browser/session', runtime.url), {method: 'POST', headers, body: '{}'});
  assert.equal(signed.status, 200);
  const cookie = signed.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie !== undefined && cookie !== '');
  const traceId = '0af7651916cd43dd8448eb211c80319c', parentSpanId = 'b7ad6b7169203331';
  const traceparent = `00-${traceId}-${parentSpanId}-01`;
  const submit = (requestId: string, parent: string, authenticated = true, mode = 'work') => fetch(new URL('/api/v2/commands/mode-set', runtime.url), {
    method: 'POST', headers: {...headers, traceparent: parent, ...(authenticated ? {cookie} : {})},
    body: JSON.stringify({target: 'hub', requestId, data: {mode}}),
  });
  assert.equal((await submit('mode-trace-untrusted', traceparent, false)).status, 401);
  assert.equal((await submit('mode-trace-invalid', traceparent, true, 'invalid')).status, 400);
  assert.equal(handle?.operation('mode-trace-untrusted'), undefined);
  assert.equal(handle?.operation('mode-trace-invalid'), undefined);
  assert.equal(nano.commands.length + pixoo.commands.length, 0);
  assert.equal((await submit('mode-trace-browser', traceparent)).status, 200);
  await waitFor(() => nano.commands.length === 1 && pixoo.commands.length === 1);
  assert.equal(handle?.operation('mode-trace-browser')?.traceparent.slice(3, 35), traceId, 'the tracked mode selection continues the browser trace');
  assert.equal(nano.commands[0]?.traceparent.slice(3, 35), traceId);
  assert.equal(pixoo.commands[0]?.traceparent.slice(3, 35), traceId);
  assert.equal((await submit('mode-trace-malformed', 'not-a-trace')).status, 200);
  await waitFor(() => nano.commands.length === 2 && pixoo.commands.length === 2);
  const malformed = handle?.operation('mode-trace-malformed'); assert.ok(malformed);
  assert.match(malformed.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  assert.notEqual(malformed.traceparent.slice(3, 35), traceId, 'invalid context starts a new trace without refusing the mode');
  await runtime.stop();
  const spans = lines.flatMap(line => (JSON.parse(line) as {resourceSpans: {scopeSpans: {spans: {name: string; traceId: string; parentSpanId?: string; kind: number}[]}[]}[]}).resourceSpans.flatMap(group => group.scopeSpans.flatMap(scope => scope.spans)));
  assert.equal(spans.filter(span => span.name === 'bunny.command.request' && span.kind === 2 && span.traceId === traceId && span.parentSpanId === parentSpanId).length, 1,
    'only the authenticated, valid selection adopts the browser parent');
});

it('real mode admission saves once, maps independent outcomes and never replays on sync or restart', async context => {
  let failSave = false;
  const core = createCoreModule({parts: [{tracked: ({operation, outcome}) => {
    if (failSave && operation.family === 'mode-set' && outcome !== undefined) throw new Error('synthetic save refused');
  }}]});
  const nano = new ModeDevice('nanoleaf', 'wall'); nano.result = 'failed';
  const pixoo = new ModeDevice('pixoo', 'pixoo-1');
  const watcher = fixture('watcher');
  const files = await edgeConfig(context, [], {modules: {nanoleaf: {}, pixoo: {}}});
  const dir = await stateDir(context);
  const {runtime} = await run(context, {modules: [core, nano.module(), pixoo.module(), watcher], configFile: files.config, stateDir: dir});
  const states = async (): Promise<ModeState[]> => {
    const result = await contextOf(watcher).sdk.sync<ModeState>(['mode'], () => {}, {timeoutMs: 2000});
    assert.equal(result.status, 'synced'); if (result.status !== 'synced') return [];
    const records = result.copy.states().map(message => message.data); await result.copy.close(); return records;
  };
  const initial = (await states())[0]; assert.equal(initial?.mode, 'free'); assert.equal(nano.commands.length + pixoo.commands.length, 0);
  const raw = await contextOf(watcher).sdk.request('bunny.cmd.mode-set.hub', action('quiet', 'raw').draft, {timeoutMs: 2000});
  assert.equal(raw.status === 'rejected' && raw.error.error.code, 'forbidden');
  assert.deepEqual(await core.actions.dispatch(action('work', 'req-work', initial?.revision)), {status: 'accepted', requestId: 'req-work'});
  const nanoId = await modeChildRequestId('req-work', 'wall'), pixooId = await modeChildRequestId('req-work', 'pixoo-1');
  const records = async () => {
    const result = await contextOf(watcher).sdk.sync<{id: string; requestId: string; result?: string}>(['operation'], () => {}, {timeoutMs: 2000});
    assert.equal(result.status, 'synced'); if (result.status !== 'synced') return [];
    const records = result.copy.states().map(message => message.data); await result.copy.close(); return records;
  };
  await waitFor(async () => (await records()).filter(record => [nanoId, pixooId].includes(record.requestId)).every(record => record.result !== undefined) && nano.commands.length === 1 && pixoo.commands.length === 1, 5000, 'both independent outcomes');
  const outcomes = await records();
  assert.equal(outcomes.find(record => record.requestId === nanoId)?.result, 'failed');
  assert.equal(outcomes.find(record => record.requestId === pixooId)?.result, 'succeeded');
  const inbox = await contextOf(watcher).sdk.sync<InboxItem>(['inbox-item'], () => {}, {timeoutMs: 2000});
  assert.equal(inbox.status, 'synced');
  if (inbox.status === 'synced') {
    assert.deepEqual(inbox.copy.states().map(message => [message.data.item.requestId, message.data.item.result]), [[nanoId, 'failed']], 'only the failed participant enters the real inbox');
    await inbox.copy.close();
  }
  assert.deepEqual([nano.commands[0]?.data.mode, pixoo.commands[0]?.data.mode], ['work', 'monitor']);
  assert.equal((await states())[0]?.mode, 'work');
  await core.actions.dispatch(action('work', 'req-work', initial?.revision)); await states();
  assert.equal(nano.commands.length + pixoo.commands.length, 2, 'duplicate and refresh send nothing');
  await nano.observe(); await states(); assert.equal((await states())[0]?.mode, 'work'); assert.equal(nano.commands.length + pixoo.commands.length, 2);
  failSave = true;
  const refused = await core.actions.dispatch(action('quiet', 'req-unsaved'));
  assert.ok('error' in refused); assert.equal((await states())[0]?.mode, 'work'); assert.equal(nano.commands.length + pixoo.commands.length, 2);
  failSave = false;
  await core.actions.dispatch(action('work', 'req-reapply')); await waitFor(() => nano.commands.length + pixoo.commands.length === 4, 5000, 'explicit reapplication');
  await runtime.stop();
  const restartedCore = createCoreModule(); const reader = fixture('reader');
  const restarted = await run(context, {modules: [restartedCore, nano.module(), pixoo.module(), reader], configFile: files.config, stateDir: dir});
  const restored = await contextOf(reader).sdk.sync<ModeState>(['mode'], () => {}, {timeoutMs: 2000});
  assert.equal(restored.status, 'synced');
  if (restored.status === 'synced') {assert.equal(restored.copy.states()[0]?.data.mode, 'work'); await restored.copy.close();}
  assert.equal(nano.commands.length + pixoo.commands.length, 4, 'restart preserves the selection without sending');
  await restarted.runtime.stop();
});

it('qualified failed modules remain targets; refused modules are excluded and pending actions turn uncertain without resend', async context => {
  const nano = new ModeDevice('nanoleaf', 'wall'); nano.failStart = true;
  const pixoo = new ModeDevice('pixoo', 'pixoo-1'); pixoo.result = 'none';
  let coreHandle: import('../src/core/core.js').CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: handle => {coreHandle = handle; return Promise.resolve();}}]});
  const clock = manualClock(Date.now());
  const files = await edgeConfig(context, [], {modules: {nanoleaf: {}, pixoo: {}}});
  const dir = await stateDir(context);
  const first = await run(context, {modules: [core, nano.module(), pixoo.module()], configFile: files.config, stateDir: dir, clock: {now: clock.now}, scheduler: clock.scheduler});
  await core.actions.dispatch(action('quiet', 'req-stopped'));
  const nanoId = await modeChildRequestId('req-stopped', 'wall'), pixooId = await modeChildRequestId('req-stopped', 'pixoo-1');
  await waitFor(() => coreHandle?.operation(nanoId)?.status === 'rejected' && coreHandle?.operation(pixooId)?.status === 'accepted', 5000, 'failed target and pending target');
  assert.equal(coreHandle?.operation(nanoId)?.error?.code, 'unavailable');
  await first.runtime.stop(); clock.advance(120_000);
  const restored = createCoreModule({parts: [{start: handle => {coreHandle = handle; return Promise.resolve();}}]});
  const second = await run(context, {modules: [restored, nano.module(), pixoo.module()], configFile: files.config, stateDir: dir, clock: {now: clock.now}, scheduler: clock.scheduler});
  clock.advance(0);
  await waitFor(() => coreHandle?.operation(pixooId)?.status === 'uncertain', 5000, 'restart deadline uncertainty');
  assert.equal(pixoo.commands.length, 1);
  const inbox = await coreHandle.sdk.sync<InboxItem>(['inbox-item'], () => {}, {timeoutMs: 2000});
  assert.equal(inbox.status, 'synced');
  if (inbox.status === 'synced') {
    const items = inbox.copy.states().map(message => message.data.item);
    assert.equal(items.find(item => item.requestId === nanoId)?.result, 'failed');
    assert.equal(items.find(item => item.requestId === pixooId)?.result, 'uncertain', 'restart uncertainty enters the real inbox without resend');
    await inbox.copy.close();
  }
  await second.runtime.stop();
  nano.failStart = false; nano.refuse = true; const thirdCore = createCoreModule({parts: [{start: handle => {coreHandle = handle; return Promise.resolve();}}]});
  const third = await run(context, {modules: [thirdCore, nano.module(), pixoo.module()], configFile: files.config, clock: {now: clock.now}, scheduler: clock.scheduler});
  await thirdCore.actions.dispatch(action('free', 'req-refused'));
  assert.equal(coreHandle?.operation(await modeChildRequestId('req-refused', 'wall')), undefined, 'refused module is not a target');
  await waitFor(() => pixoo.commands.length === 2, 5000, 'the admitted target'); await third.runtime.stop();
});

it('resending a stale mode request accepts committed inbox handling and records the fresh refusal separately', async context => {
  const operator = {source: 'bunny/parts/operator', token: 'synthetic-mode-inbox', scopes: ['read', 'control'] as const};
  const core = createCoreModule();
  const nano = new ModeDevice('nanoleaf', 'wall');
  const pixoo = new ModeDevice('pixoo', 'pixoo-1');
  const files = await edgeConfig(context, [operator], {modules: {nanoleaf: {}, pixoo: {}}});
  const {runtime} = await run(context, {modules: [core, nano.module(), pixoo.module()], configFile: files.config, edge: {schemas: {}}});
  const read = async <T>(family: string): Promise<T[]> => {
    const response = await fetch(new URL(`/api/v2/families/${family}`, runtime.url), {headers: {authorization: `Bearer ${operator.token}`}});
    assert.equal(response.status, 200);
    return (await response.json() as {records: T[]}).records;
  };
  const initial = (await read<ModeState>('mode'))[0]; assert.ok(initial);
  assert.deepEqual(await core.actions.dispatch(action('work', 'mode-before-resend', initial.revision)), {status: 'accepted', requestId: 'mode-before-resend'});
  await waitFor(() => nano.commands.length + pixoo.commands.length === 2);
  const saved = (await read<ModeState>('mode'))[0]; assert.ok(saved);
  const stale = await core.actions.dispatch(action('quiet', 'stale-mode-original', initial.revision));
  assert.ok('error' in stale && stale.error.code === 'revision-conflict');
  await waitFor(async () => (await read<InboxItem>('inbox-item')).length === 1);
  const original = (await read<InboxItem>('inbox-item'))[0]; assert.ok(original);
  const response = await fetch(new URL('/api/v2/commands/inbox-handle', runtime.url), {
    method: 'POST', headers: {authorization: `Bearer ${operator.token}`, 'content-type': 'application/json'},
    body: JSON.stringify({target: original.id, requestId: 'handle-stale-mode', data: {action: 'send-again', expectedRevision: original.revision}}),
  });
  assert.equal(response.status, 200, 'the sent operation and original handling committed before the fresh mode refusal');
  assert.equal((await response.json() as {status: string}).status, 'accepted');
  const current = await read<InboxItem>('inbox-item');
  assert.equal(current.length, 1);
  assert.notEqual(current[0]?.id, original.id, 'the original item is handled');
  assert.notEqual(current[0]?.item.requestId, original.item.requestId, 'the new request has its own identity');
  assert.equal(current[0]?.item.result, 'failed');
  assert.equal(current[0]?.item.error?.code, 'revision-conflict');
  assert.deepEqual((await read<ModeState>('mode'))[0], saved, 'refused selections leave the saved choice unchanged');
  assert.equal(nano.commands.length + pixoo.commands.length, 2, 'refused original and explicit resend send no native command');
});
