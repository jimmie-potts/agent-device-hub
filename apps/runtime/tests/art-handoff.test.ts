// The exact-artwork handoff in the running core (Hub #679): the art part's forwarding, the tracker's and gateway's
// refusals, the omitted payload and the inbox exemption, with a fake art module and a fake display on real validators.
import assert from 'node:assert/strict';
import {createHash, createHmac} from 'node:crypto';
import {chmodSync, mkdtempSync, readFileSync, rmSync, unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {PrivateRequestDigest, type BunnyModule, type Command, type Sdk} from '@jimmie-potts/sdk';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {ART_FORWARDED, ART_MODULE_SOURCE, MAX_ART_BYTES, artReferenceRefusal, type ArtStageContent} from '@jimmie-potts/event-contracts/v2/art';
import {operationEntityId, type InboxItem, type OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {createCoreModule, type CoreHandle} from '../src/index.js';
import {deviceRecord, deviceState} from './fixtures/device.js';
import {contextOf, edgeConfig, fixture, flush, it, run, stateDir, waitFor} from './support.js';

const COMPOSITION = 'c'.repeat(64);
const MARKER = 'SYNTHETIC-ART-BYTES-679';
/** A header-valid PNG of 64 by 32 whose payload holds a marker a scan can look for, at `size` bytes. */
function stage(size = 256, marker = MARKER): ArtStageContent {
  const header = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
  header.writeUInt32BE(13, 8); header.write('IHDR', 12, 'latin1'); header.writeUInt32BE(64, 16); header.writeUInt32BE(32, 20);
  const padding = Buffer.alloc(size - header.length);
  padding.fill(marker);
  const bytes = Buffer.concat([header, padding]);
  return {compositionId: COMPOSITION, format: 'png', width: 64, height: 32, frames: 1, durationMs: 0,
    sha256: createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64'), lifetimeMs: 86_400_000};
}
const dispatchDraft = (data: object) => ({type: 'org.bunny.art.dispatch.requested', subject: 'art', dataschema: 'https://bunny.invalid/events/art-dispatch/2.0', data});
const stageDispatch = (content = stage()) => dispatchDraft({family: 'art-stage', target: 'panel', data: content});
const ambientDispatch = (compositionId: string | null = COMPOSITION) => dispatchDraft({family: 'art-ambient-set', target: 'panel', data: {compositionId}});
const START = {action: 'start', purpose: 'ambient', origin: {kind: 'schedule'}, targets: ['ui']};
const DASHBOARD = 'bunny/parts/dashboard', CORE = 'bunny/core';
const artAction = (family: 'art-request' | 'art-auto', requestedBy: string, requestId: string) => ({
  key: `bunny.cmd.${family}.art`, requestId, requestedBy,
  draft: {type: `org.bunny.art.${family.slice(4)}.requested`, subject: 'art', dataschema: `https://bunny.invalid/events/${family}/2.0`, data: START},
});
const forwarded = (family: 'art-stage' | 'art-ambient-set', requestedBy: string, requestId: string) => ({
  key: `bunny.cmd.${family}.panel`, requestId, requestedBy,
  draft: {type: ART_FORWARDED[family].type, subject: 'panel', dataschema: ART_FORWARDED[family].dataschema, data: family === 'art-stage' ? stage() : {compositionId: COMPOSITION}},
});
type Answer = {status: 'accepted'} | ReturnType<typeof errorBody> | undefined | Promise<never>;
/** A fake display and art owner: it answers each family with `answer`, and records what reached it. */
function responder(seen: Command<Record<string, unknown>>[], answer: (command: Command<Record<string, unknown>>) => Answer = () => ({status: 'accepted'})): BunnyModule {
  return {manifest: {name: 'display', apiVersion: '1.3'}, async start({sdk}) {
    for (const key of ['bunny.cmd.art-stage.panel', 'bunny.cmd.art-ambient-set.panel', 'bunny.cmd.moment-play.panel', 'bunny.cmd.art-request.art', 'bunny.cmd.art-auto.art']) {
      await sdk.respond<Record<string, unknown>>(key, async command => { seen.push(command); return (await answer(command)) ?? {status: 'accepted'}; });
    }
    outcomes.set(seen, sdk);
  }, stop() {}};
}
const outcomes = new WeakMap<object, Sdk>();
const accepted = (requestId: string) => ({status: 'accepted', requestId});
const codeOf = (answer: object): string | undefined => 'error' in answer ? (answer as ReturnType<typeof errorBody>).error.code : undefined;

async function world(context: TestContext, answer?: (command: Command<Record<string, unknown>>) => Answer, dir?: string) {
  const seen: Command<Record<string, unknown>>[] = [];
  let handle: CoreHandle | undefined, database: DatabaseSync | undefined;
  const core = createCoreModule({parts: [{open: db => { database = db; }, start: given => { handle = given; return Promise.resolve(); }}]});
  const art = fixture('art'), other = fixture('other');
  const {runtime} = await run(context, {modules: [core, responder(seen, answer), art, other], ...(dir === undefined ? {} : {stateDir: dir})});
  assert.ok(handle); assert.ok(database);
  return {runtime, core, seen, handle, database, art: contextOf(art).sdk, other: contextOf(other).sdk};
}

it('only the art module can dispatch, and the core forwards a tracked stage or ambient set it requested', async context => {
  const w = await world(context);
  assert.equal(w.art.source, ART_MODULE_SOURCE);
  const denied = await w.other.request('bunny.cmd.art-dispatch.art', stageDispatch(), {requestId: 'other-module', timeoutMs: 3000});
  assert.equal('error' in denied && denied.error.error.code, 'forbidden');
  assert.equal(w.handle.operation('other-module'), undefined);
  assert.equal(w.seen.length, 0, 'refused before transport');

  const staged = await w.art.request('bunny.cmd.art-dispatch.art', stageDispatch(), {requestId: 'stage-1', timeoutMs: 8000});
  assert.equal(staged.status, 'accepted');
  const operation = w.handle.operation('stage-1');
  assert.equal(operation?.requestedBy, ART_MODULE_SOURCE);
  assert.equal(operation?.family, 'art-stage');
  assert.equal(operation?.command, 'org.bunny.art.stage.requested');
  assert.equal(operation?.target, 'panel');
  assert.equal(w.seen.length, 1);
  assert.equal(w.seen[0]?.source, CORE, 'the core is the command\'s sender, and requestedBy names the module');
  assert.deepEqual(w.seen[0]?.data, {...stage(), requestId: 'stage-1'}, 'the bytes reach the responder whole');

  const ambient = await w.art.request('bunny.cmd.art-dispatch.art', ambientDispatch(), {requestId: 'ambient-1', timeoutMs: 8000});
  assert.equal(ambient.status, 'accepted');
  assert.equal(w.handle.operation('ambient-1')?.requestedBy, ART_MODULE_SOURCE);
  assert.deepEqual(w.handle.operation('ambient-1')?.data, {compositionId: COMPOSITION});
  assert.equal(w.seen[1]?.type, 'org.bunny.art-ambient.set.requested');
});

it('extended staging requires the current Pixoo owner declaration and keeps a tracked, omitted-payload command', async t => {
  const content = JSON.parse(readFileSync(new URL('../../../../packages/event-contracts/fixtures/v2/art-extended-stage.json', import.meta.url), 'utf8')) as ArtStageContent;
  const record = deviceRecord('desk-art', 1, 'pixoo', 'unknown');
  const artCapability = {formats: ['gif' as const], maxBytes: 100, stageVersion: '2.1' as const};
  record.capabilities.moments = {supported: true, moods: ['celebrate', 'reminder', 'setback'], maxDurationMs: 10_000, coversStatus: true, art: artCapability};
  let version = '2.4', syncs = 0;
  const state = () => ({...deviceState(record), dataschema: `https://bunny.invalid/events/device/${version}`});
  const seen: Command<Record<string, unknown>>[] = [];
  let pixooSdk: Sdk | undefined, handle: CoreHandle | undefined;
  const pixoo: BunnyModule = {manifest: {name: 'pixoo', apiVersion: '1.3', configure: section => ({config: section, devices: [record.id]})}, start: async ({sdk}) => {
    pixooSdk = sdk;
    await sdk.serveSync(['device'], () => {syncs++; return {revision: record.revision, states: [state()]};});
    await sdk.respond<Record<string, unknown>>(`bunny.cmd.art-stage.${record.id}`, command => {seen.push(command); return {status: 'accepted'};});
  }, stop() {}};
  const core = createCoreModule({parts: [{start: given => {handle = given; return Promise.resolve();}}]});
  const art = fixture('art'), other = fixture('other');
  const config = await edgeConfig(t, [], {modules: {pixoo: {}}});
  await run(t, {modules: [core, pixoo, art, other], configFile: config.config});
  await waitFor(() => syncs > 0); await flush();
  assert.ok(handle); assert.ok(pixooSdk);
  const send = (sdk: Sdk, requestId: string, target = record.id) => sdk.request('bunny.cmd.art-dispatch.art',
    {...dispatchDraft({family: 'art-stage', target, data: content}), dataschema: 'https://bunny.invalid/events/art-dispatch/2.2'},
    {requestId, timeoutMs: 8000, parent: {traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'}});
  const owner = contextOf(art).sdk;
  const denied = await send(contextOf(other).sdk, 'foreign'); assert.equal('error' in denied && denied.error.error.code, 'forbidden');
  assert.equal((await send(owner, 'unknown', 'other-panel')).status, 'rejected'); assert.equal(handle.operation('unknown'), undefined);
  assert.equal((await send(owner, 'long-stage')).status, 'accepted');
  assert.equal((await send(owner, 'long-stage')).status, 'accepted');
  assert.equal(seen.length, 1); assert.equal(seen[0]?.source, CORE);
  assert.equal(seen[0]?.dataschema, 'https://bunny.invalid/events/art-stage/2.1');
  assert.equal(seen[0]?.traceparent.split('-')[1], '0af7651916cd43dd8448eb211c80319c');
  const operation = handle.operation('long-stage'); assert.ok(operation);
  assert.equal(operation.requestedBy, ART_MODULE_SOURCE); assert.equal(operation.payload?.status, 'omitted');
  assert.deepEqual(operation.data, {});

  const publish = async () => {
    assert.ok(pixooSdk); record.revision++; await pixooSdk.publish(`bunny.state.device.${record.id}`, {kind: 'state', ...state()}); await flush();
  };
  version = '2.2'; await publish(); // A field smuggled into an older document grants nothing.
  assert.equal((await send(owner, 'unversioned')).status, 'rejected');
  version = '2.4'; artCapability.maxBytes = 1; await publish();
  assert.equal((await send(owner, 'too-big')).status, 'rejected');
  artCapability.maxBytes = 100; record.kind = 'tidbyt'; await publish();
  assert.equal((await send(owner, 'wrong-kind')).status, 'rejected');
  record.kind = 'pixoo';
  let otherSyncs = 0;
  await contextOf(other).sdk.serveSync(['device'], () => {otherSyncs++; return {revision: record.revision, states: [state()]};});
  core.setAutomationDevices([{id: record.id, owner: 'bunny/modules/other'}]);
  await waitFor(() => otherSyncs > 0); await flush();
  assert.equal((await send(owner, 'wrong-owner')).status, 'rejected');
  core.setAutomationDevices([]); await flush();
  assert.equal((await send(owner, 'withdrawn')).status, 'rejected');
  assert.equal((await send(owner, 'long-stage')).status, 'accepted', 'an identical retry returns its prior answer after withdrawal');
  for (const id of ['foreign', 'unversioned', 'too-big', 'wrong-kind', 'wrong-owner', 'withdrawn']) assert.equal(handle.operation(id), undefined);
  assert.equal(seen.length, 1);
});

it('a dispatch is refused before transport when it names a moment, another family or bytes that are not what it says', async context => {
  const w = await world(context);
  const moment = {momentId: 'm', mood: 'celebrate', durationMs: 8000, priorityClass: 'event', coversStatus: false, startAtMs: Date.now(), toleranceMs: 1000, art: {compositionId: COMPOSITION}};
  const cases: [string, object][] = [
    ['a moment', dispatchDraft({family: 'moment-play', target: 'panel', data: moment})],
    ['a job', dispatchDraft({family: 'art-auto', target: 'art', data: START})],
    ['another target form', dispatchDraft({family: 'art-stage', target: 'Not A Device', data: stage()})],
    ['a wrong hash', stageDispatch({...stage(), sha256: 'b'.repeat(64)})],
    ['a wrong format', stageDispatch({...stage(), format: 'gif', frames: 1})],
    ['oversized bytes', stageDispatch(stage(MAX_ART_BYTES + 1))],
    ['a private path', dispatchDraft({family: 'art-stage', target: 'panel', data: {...stage(), path: '/private/image.png'}})],
  ];
  for (const [index, [name, draft]] of cases.entries()) {
    const answer = await w.art.request('bunny.cmd.art-dispatch.art', draft as ReturnType<typeof stageDispatch>, {requestId: `refused-${index}`, timeoutMs: 3000});
    assert.equal(answer.status, 'rejected', name);
    assert.equal(w.handle.operation(`refused-${index}`), undefined, name);
  }
  assert.equal(w.seen.length, 0);
  // Unknown targets: the bus has no responder, so the tracker records the refusal and nothing is delivered.
  const unknown = await w.art.request('bunny.cmd.art-dispatch.art', dispatchDraft({family: 'art-ambient-set', target: 'no-such-device', data: {compositionId: null}}), {requestId: 'unknown-device', timeoutMs: 3000});
  assert.equal(unknown.status, 'rejected');
  assert.equal(w.handle.operation('unknown-device')?.status, 'rejected');
});

it('each art family admits only its one requester, beside the speech check', async context => {
  const w = await world(context);
  const refused: [ReturnType<typeof artAction> | ReturnType<typeof forwarded>, string][] = [];
  let id = 0;
  const others = ['bunny/parts/operator', DASHBOARD, CORE, ART_MODULE_SOURCE, 'bunny/modules/tidbyt'];
  for (const [family, allowed] of [['art-request', DASHBOARD], ['art-auto', CORE]] as const) {
    for (const by of others.filter(source => source !== allowed)) refused.push([artAction(family, by, `no-${++id}`), by]);
    assert.deepEqual(await w.core.actions.dispatch(artAction(family, allowed, `${family}-ok`)), accepted(`${family}-ok`));
    assert.equal(w.handle.operation(`${family}-ok`)?.requestedBy, allowed);
  }
  // The art module's own catalog command has the owner's one requester too.
  for (const by of others.filter(source => source !== DASHBOARD)) {
    refused.push([{key: 'bunny.cmd.art-catalog-edit.art', requestedBy: by, requestId: `no-${++id}`, draft: {type: 'org.bunny.art-catalog.edit.requested', subject: 'art', dataschema: 'https://bunny.invalid/events/art-catalog-edit/2.0', data: {action: 'delete', artworkId: 'art-1'}}} as unknown as ReturnType<typeof artAction>, by]);
  }
  for (const family of ['art-stage', 'art-ambient-set'] as const) {
    for (const by of others.filter(source => source !== ART_MODULE_SOURCE)) refused.push([forwarded(family, by, `no-${++id}`), by]);
    assert.deepEqual(await w.core.actions.dispatch(forwarded(family, ART_MODULE_SOURCE, `${family}-ok`)), accepted(`${family}-ok`));
  }
  const delivered = w.seen.length;
  for (const [action, by] of refused) {
    const answer = await w.core.actions.dispatch(action);
    assert.equal(codeOf(answer), 'forbidden', `${action.key} from ${by}`);
    assert.equal(w.handle.operation(action.requestId), undefined, 'nothing is recorded or admitted');
  }
  assert.equal(w.seen.length, delivered);
});

it('only the core may request an art-bearing moment while ordinary moments keep their requesters', async context => {
  const w = await world(context);
  const data = {momentId: 'saved-art', mood: 'celebrate', durationMs: 8000, priorityClass: 'event', coversStatus: true,
    startAtMs: Date.now(), toleranceMs: 1000, art: {compositionId: COMPOSITION}};
  const draft = {type: 'org.bunny.moment.play.requested', subject: 'panel', dataschema: 'https://bunny.invalid/events/moment-play/2.1', data};
  for (const [index, requestedBy] of [DASHBOARD, 'bunny/parts/operator', ART_MODULE_SOURCE, 'bunny/modules/tidbyt'].entries()) {
    const requestId = `refused-art-moment-${index}`;
    assert.equal(codeOf(await w.core.actions.dispatch({key: 'bunny.cmd.moment-play.panel', requestedBy, requestId, draft})), 'forbidden');
    assert.equal(w.handle.operation(requestId), undefined, 'a refused requester creates no dispatch receipt');
  }
  assert.equal(w.seen.length, 0, 'no art moment reached the display');
  assert.deepEqual(await w.core.actions.dispatch({key: 'bunny.cmd.moment-play.panel', requestedBy: CORE, requestId: 'core-art-moment', draft}), accepted('core-art-moment'));
  assert.equal(w.seen.length, 1);
  const {art: _art, ...ordinary} = data;
  assert.deepEqual(await w.core.actions.dispatch({key: 'bunny.cmd.moment-play.panel', requestedBy: DASHBOARD, requestId: 'ordinary-moment',
    draft: {...draft, dataschema: 'https://bunny.invalid/events/moment-play/2.0', data: ordinary}}), accepted('ordinary-moment'));
  assert.equal(w.seen.length, 2);
});

it('the gateway refuses the core-only families from any client, and only a dashboard session sends art-request', async context => {
  const operator = {id: 'operator', source: 'bunny/parts/operator', token: 'synthetic-art-control', scopes: ['read', 'control'] as const};
  const files = await edgeConfig(context, [operator], {browserAccess: 'trusted-loopback'});
  const seen: Command<Record<string, unknown>>[] = [];
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: given => { handle = given; return Promise.resolve(); }}]});
  const {runtime} = await run(context, {modules: [core, responder(seen)], configFile: files.config, edge: {schemas: {}}});
  const post = async (family: string, body: object, headers: Record<string, string> = {authorization: `Bearer ${operator.token}`}) => {
    const response = await fetch(new URL(`/api/v2/commands/${family}`, runtime.url), {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(body)});
    return {status: response.status, body: await response.json() as {error?: {code: string}; status?: string}};
  };
  const cases: [string, object][] = [
    ['art-auto', {target: 'art', requestId: 'g-auto', data: START}],
    ['art-dispatch', {target: 'art', requestId: 'g-dispatch', data: {family: 'art-stage', target: 'panel', data: stage()}}],
    ['art-stage', {target: 'panel', requestId: 'g-stage', data: stage()}],
    ['art-ambient-set', {target: 'panel', requestId: 'g-ambient', data: {compositionId: COMPOSITION}}],
  ];
  for (const [family, body] of cases) {
    const answer = await post(family, body);
    assert.deepEqual([family, answer.status, answer.body.error?.code], [family, 403, 'forbidden']);
    assert.equal(handle?.operation((body as {requestId: string}).requestId), undefined);
  }
  const credentialed = await post('art-request', {target: 'art', requestId: 'g-client', data: START});
  assert.equal(credentialed.body.error?.code, 'forbidden', 'another client cannot pass as the owner');
  assert.equal(handle?.operation('g-client'), undefined);
  assert.equal(seen.length, 0);
  // A client's moment is the closed moment-play/2.0: it cannot name art.
  const moment = {momentId: 'm', mood: 'celebrate', durationMs: 8000, priorityClass: 'event', coversStatus: false, startAtMs: Date.now(), toleranceMs: 1000};
  const named = await post('moment-play', {target: 'panel', requestId: 'g-moment', data: {...moment, art: {compositionId: COMPOSITION}}});
  assert.equal(named.body.error?.code, 'invalid-request');
  assert.equal(seen.length, 0);

  const browser = {origin: runtime.url, 'bunny-request': '1', 'content-type': 'application/json'};
  const signed = await fetch(new URL('/api/v2/browser/session', runtime.url), {method: 'POST', headers: browser, body: '{}'});
  assert.equal(signed.status, 200);
  const cookie = signed.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie !== undefined);
  const owner = await post('art-request', {target: 'art', requestId: 'g-owner', data: {...START, purpose: 'request', text: 'a moon bakery'}}, {...browser, cookie});
  assert.equal(owner.body.status, 'accepted');
  assert.equal(handle?.operation('g-owner')?.requestedBy, DASHBOARD);
  assert.equal(seen.length, 1);
  const auto = await post('art-auto', {target: 'art', requestId: 'g-owner-auto', data: START}, {...browser, cookie});
  assert.equal(auto.body.error?.code, 'forbidden', 'the dashboard cannot claim automatic work either');
});

it('art bytes reach the responder and stay out of the stored operation, history and logs', async context => {
  const dir = await stateDir(context);
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: given => { handle = given; return Promise.resolve(); }}]});
  const seen: Command<Record<string, unknown>>[] = [];
  const art = fixture('art');
  const {runtime, logs} = await run(context, {stateDir: dir, modules: [core, responder(seen), art]});
  const content = stage(2048);
  const answer = await contextOf(art).sdk.request('bunny.cmd.art-dispatch.art', stageDispatch(content), {requestId: 'stage-private', timeoutMs: 8000});
  assert.equal(answer.status, 'accepted');
  assert.equal(seen[0]?.data.base64, content.base64);
  await outcomes.get(seen)?.publish('bunny.event.art-stage.panel', {kind: 'outcome', type: 'org.bunny.art.stage.completed', subject: 'panel',
    dataschema: 'https://bunny.invalid/events/outcome/2.0', data: {requestId: 'stage-private', result: 'succeeded', evidence: 'observed'}});
  await waitFor(() => handle?.operation('stage-private')?.result === 'succeeded');
  await runtime.stop();
  // A base64 fragment of the marker's run, in every alignment, and the marker itself as raw bytes.
  const fragments = [content.base64.slice(64, 128), content.base64.slice(65, 129), content.base64.slice(66, 130)];
  let scanned = 0;
  for (const suffix of ['', '-wal']) {
    let bytes: Buffer;
    try { bytes = readFileSync(join(dir, `modules/core.sqlite${suffix}`)); } catch (error) {
      if (suffix === '-wal' && typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
    scanned += 1;
    assert.equal(bytes.includes(Buffer.from(MARKER)), false, `raw bytes in core.sqlite${suffix}`);
    for (const fragment of fragments) assert.equal(bytes.includes(Buffer.from(fragment)), false, `base64 in core.sqlite${suffix}`);
  }
  assert.ok(scanned > 0);
  for (const fragment of fragments) assert.equal(JSON.stringify(logs).includes(fragment), false);
});

it('the stored operation marks its payload omitted, and the history row of each step holds no payload', async context => {
  const w = await world(context);
  const content = stage(1024);
  assert.equal((await w.art.request('bunny.cmd.art-dispatch.art', stageDispatch(content), {requestId: 'stage-row', timeoutMs: 8000})).status, 'accepted');
  const operation = w.handle.operation('stage-row');
  assert.equal(operation?.payload?.status, 'omitted');
  assert.deepEqual(operation?.data, {});
  const rows = w.database.prepare("SELECT record FROM core_history WHERE record LIKE '%stage-row%'").all() as {record: string}[];
  assert.ok(rows.length > 0, 'the history kept the operation\'s steps');
  for (const {record} of rows) assert.equal(record.includes(content.base64.slice(64, 128)), false);
  const stored = w.database.prepare('SELECT record FROM core_operations WHERE request_id = ?').get('stage-row') as {record: string};
  assert.equal(stored.record.includes(content.base64.slice(64, 128)), false);
  assert.ok(stored.record.length < 2000, 'the row does not grow with the bytes');
});

it('a repeated stage is detected without its bytes: the same answers again, other bytes conflict, and a restart sends nothing', async context => {
  const dir = await stateDir(context);
  const first = await world(context, undefined, dir);
  const again = (sdk: Sdk, draft = stageDispatch()) => sdk.request('bunny.cmd.art-dispatch.art', draft, {requestId: 'stage-twice', timeoutMs: 8000});
  assert.equal((await again(first.art)).status, 'accepted');
  assert.equal((await again(first.art)).status, 'accepted', 'the same dispatch answers what it got');
  assert.equal(first.seen.length, 1, 'and is not sent again');
  const conflict = await again(first.art, stageDispatch(stage(512)));
  assert.equal('error' in conflict && conflict.error.error.code, 'duplicate-conflict');
  assert.equal(first.seen.length, 1);
  await first.runtime.stop();
  const second = await world(context, undefined, dir);
  assert.equal(second.seen.length, 0, 'startup sends no saved command');
  assert.equal((await again(second.art)).status, 'accepted');
  assert.equal(second.seen.length, 0, 'the retry after a restart sends nothing');
});

it('a lost answer leaves a stage uncertain, with no inbox item, and it is never sent again', async context => {
  const w = await world(context, () => { throw new Error('synthetic lost answer'); });
  const lost = await w.art.request('bunny.cmd.art-dispatch.art', stageDispatch(), {requestId: 'stage-lost', timeoutMs: 8000});
  assert.equal('error' in lost && lost.error.error.code, 'uncertain-result');
  assert.equal(w.handle.operation('stage-lost')?.status, 'uncertain');
  assert.equal(w.seen.length, 1);
  const repeated = await w.art.request('bunny.cmd.art-dispatch.art', stageDispatch(), {requestId: 'stage-lost', timeoutMs: 8000});
  assert.equal('error' in repeated && repeated.error.error.code, 'uncertain-result');
  assert.equal(w.seen.length, 1, 'nothing resends it');
  assert.deepEqual(await inboxOf(w.art), []);
});

it('failed background art raises no inbox item, and a failed owner request still does', async context => {
  const w = await world(context, () => errorBody('unavailable', {detail: 'synthetic refusal'}));
  const background = [artAction('art-auto', CORE, 'bg-auto'), forwarded('art-stage', ART_MODULE_SOURCE, 'bg-stage'), forwarded('art-ambient-set', ART_MODULE_SOURCE, 'bg-ambient')];
  for (const action of background) {
    assert.equal(codeOf(await w.core.actions.dispatch(action)), 'unavailable');
    assert.equal(w.handle.operation(action.requestId)?.status, 'rejected', 'the operation still records the failure');
  }
  assert.deepEqual(await inboxOf(w.art), []);
  assert.equal(codeOf(await w.core.actions.dispatch(artAction('art-request', DASHBOARD, 'owner-failed'))), 'unavailable');
  await waitFor(async () => (await inboxOf(w.art)).length === 1);
  const item = (await inboxOf(w.art))[0];
  assert.ok(item !== undefined);
  assert.equal(item.item.requestId, 'owner-failed');
  // Sending it again is a fresh request by whoever handles the item, so only the dashboard can.
  const before = w.seen.length;
  const resend = await w.other.request(`bunny.cmd.inbox-handle.${item.id}`, {type: 'org.bunny.inbox.handle.requested', subject: item.id,
    dataschema: 'https://bunny.invalid/events/inbox-handle/2.0', data: {action: 'send-again', expectedRevision: item.revision}}, {timeoutMs: 3000, requestId: 'resend-owner'});
  assert.equal('error' in resend && resend.error.error.code, 'forbidden');
  assert.equal(w.seen.length, before);
  assert.equal((await inboxOf(w.art)).length, 1, 'the item stays for a person');
});

it('an inbox resend of an omitted stage is refused truthfully and sends nothing', async context => {
  const w = await world(context);
  assert.equal((await w.art.request('bunny.cmd.art-dispatch.art', stageDispatch(), {requestId: 'stage-resend', timeoutMs: 8000})).status, 'accepted');
  const id = operationEntityId('stage-resend');
  const handle = (verb: string, revision: number) => w.other.request(`bunny.cmd.inbox-handle.${id}`, {
    type: 'org.bunny.inbox.handle.requested', subject: id, dataschema: 'https://bunny.invalid/events/inbox-handle/2.0',
    data: {action: verb, expectedRevision: revision},
  }, {timeoutMs: 3000, requestId: `handle-${verb}-${revision}`});
  // Background art raises no item, so there is nothing to send again.
  const absent = await handle('send-again', 1);
  assert.equal('error' in absent && absent.error.error.code, 'not-found');
  // An item the store already holds, as from a release without the exemption, still cannot resend omitted bytes.
  const record: InboxItem = {id, revision: 1, createdAtMs: Date.now(), dismissedBy: [], item: {kind: 'operation', requestId: 'stage-resend', command: 'org.bunny.art.stage.requested', target: 'panel', result: 'failed'}};
  w.database.prepare('INSERT INTO inbox_records (id, record) VALUES (?, ?)').run(id, JSON.stringify(record));
  const refused = await handle('send-again', 1);
  assert.equal('error' in refused && refused.error.error.code, 'unsupported-capability');
  assert.equal(w.seen.length, 1, 'the stage was not sent again');
  assert.equal(w.handle.operation('stage-resend')?.status, 'accepted');
});

it('a module reads a stage\'s operation record for its request ID by following state, and shows nothing until it succeeded', async context => {
  const w = await world(context);
  const synced = await w.art.sync<OperationRecord>(['operation'], () => {}, {timeoutMs: 5000});
  assert.equal(synced.status, 'synced');
  context.after(() => synced.status === 'synced' ? synced.copy.close() : undefined);
  const read = (): OperationRecord | undefined => synced.status === 'synced' ? synced.copy.states().find(state => state.subject === operationEntityId('stage-read'))?.data : undefined;
  assert.equal(read(), undefined);
  assert.equal((await w.art.request('bunny.cmd.art-dispatch.art', stageDispatch(), {requestId: 'stage-read', timeoutMs: 8000})).status, 'accepted');
  await waitFor(() => read()?.status === 'accepted');
  assert.equal(read()?.result, undefined, 'accepted is not stored: an owner\'s reply proves no effect');
  assert.equal(read()?.requestedBy, ART_MODULE_SOURCE);
  await outcomes.get(w.seen)?.publish('bunny.event.art-stage.panel', {kind: 'outcome', type: 'org.bunny.art.stage.completed', subject: 'panel',
    dataschema: 'https://bunny.invalid/events/outcome/2.0', data: {requestId: 'stage-read', result: 'succeeded', evidence: 'observed'}});
  await waitFor(() => read()?.result === 'succeeded');
  assert.equal(read()?.evidence, 'observed');
  assert.equal(JSON.stringify(read()).includes('base64'), false, 'the record carries no payload');
});

it('moment-play/2.1 is tracked as a moment, its reference reaches the device, and moment-play/2.0 is unchanged', async context => {
  const w = await world(context);
  const moment = {momentId: 'm', mood: 'celebrate', durationMs: 8000, priorityClass: 'event', coversStatus: false, startAtMs: Date.now(), toleranceMs: 1000};
  const send = (version: string, data: object, requestId: string) => w.core.actions.dispatch({key: 'bunny.cmd.moment-play.panel', requestedBy: CORE, requestId,
    draft: {type: 'org.bunny.moment.play.requested', subject: 'panel', dataschema: `https://bunny.invalid/events/moment-play/${version}`, data}});
  assert.deepEqual(await send('2.1', {...moment, art: {compositionId: COMPOSITION}}, 'moment-art'), accepted('moment-art'));
  assert.equal(w.handle.operation('moment-art')?.kind, 'moment');
  assert.deepEqual(w.seen[0]?.data, {...moment, art: {compositionId: COMPOSITION}, requestId: 'moment-art'});
  assert.equal(w.seen[0]?.dataschema, 'https://bunny.invalid/events/moment-play/2.1');
  assert.deepEqual(await send('2.0', moment, 'moment-plain'), accepted('moment-plain'));
  assert.deepEqual(w.seen[1]?.data, {...moment, requestId: 'moment-plain'});
});

const MOMENT = {momentId: 'm', mood: 'celebrate', durationMs: 8000, priorityClass: 'event', coversStatus: false, toleranceMs: 1000};
const momentAction = (requestId: string, art?: {compositionId: string}) => ({key: 'bunny.cmd.moment-play.panel', requestedBy: CORE, requestId,
  draft: {type: 'org.bunny.moment.play.requested', subject: 'panel', dataschema: `https://bunny.invalid/events/moment-play/${art === undefined ? '2.0' : '2.1'}`,
    data: {...MOMENT, startAtMs: Date.now(), ...(art === undefined ? {} : {art})}}});
const sendAgain = (sdk: Sdk, item: InboxItem, requestId: string) => sdk.request(`bunny.cmd.inbox-handle.${item.id}`, {type: 'org.bunny.inbox.handle.requested', subject: item.id,
  dataschema: 'https://bunny.invalid/events/inbox-handle/2.0', data: {action: 'send-again', expectedRevision: item.revision}}, {timeoutMs: 3000, requestId});

it('inbox Send again refuses a moment naming art, because a fresh one must pass arbitration; a plain moment is unchanged', async context => {
  const w = await world(context, () => errorBody('unavailable', {detail: 'synthetic refusal'}));
  assert.equal(codeOf(await w.core.actions.dispatch(momentAction('moment-art', {compositionId: COMPOSITION}))), 'unavailable');
  assert.equal(codeOf(await w.core.actions.dispatch(momentAction('moment-plain'))), 'unavailable');
  const items = await inboxOf(w.art);
  const of = (requestId: string): InboxItem => { const item = items.find(each => each.item.requestId === requestId); assert.ok(item !== undefined); return item; };
  assert.equal(w.seen.length, 2);
  const refused = await sendAgain(w.other, of('moment-art'), 'resend-art');
  assert.equal('error' in refused && refused.error.error.code, 'forbidden');
  assert.equal(w.seen.length, 2, 'nothing was sent');
  assert.ok((await inboxOf(w.art)).some(item => item.item.requestId === 'moment-art'), 'the item stays for a person');
  await sendAgain(w.other, of('moment-plain'), 'resend-plain');
  assert.equal(w.seen.length, 3, 'a moment without art is sent again as before');
  assert.equal((w.seen[2]?.data as {art?: unknown}).art, undefined);
});

it('a device refusing a lapsed copy leaves the operation rejected, never claiming the command failed to reach its owner', async context => {
  const lapsed = artReferenceRefusal({compositionId: COMPOSITION, sha256: 'd'.repeat(64), expiresAtMs: 1000}, 2000);
  assert.ok(lapsed !== undefined);
  const w = await world(context, command => command.type === 'org.bunny.moment.play.requested' ? lapsed : {status: 'accepted'});
  const answer = await w.core.actions.dispatch(momentAction('moment-lapsed', {compositionId: COMPOSITION}));
  assert.equal(codeOf(answer), 'not-found');
  assert.equal(w.seen.length, 1, 'the command reached its owner');
  const operation = w.handle.operation('moment-lapsed');
  assert.equal(operation?.status, 'rejected');
  assert.equal(operation?.reply, 'not-found');
  assert.equal(operation?.result, 'failed');
  assert.equal(operation?.evidence, 'none');
  assert.match(operation?.error?.detail ?? '', /lapsed.*stag/);
});

it('a cancel through the dashboard admits no work and causes no display transport; another client cannot cancel', async context => {
  const operator = {id: 'operator', source: 'bunny/parts/operator', token: 'synthetic-art-cancel', scopes: ['read', 'control'] as const};
  const files = await edgeConfig(context, [operator], {browserAccess: 'trusted-loopback'});
  const seen: Command<Record<string, unknown>>[] = [];
  // A fake art owner: a start adds a job, a cancel takes it away, and finishing stages what remains.
  const jobs = new Map<string, string>(), admitted: string[] = [];
  const answer = (command: Command<Record<string, unknown>>): Answer => {
    if (command.source !== CORE) return errorBody('forbidden');
    const {action, requestId, jobRequestId} = command.data as {action?: string; requestId: string; jobRequestId?: string};
    if (action === 'start') { jobs.set(requestId, command.type); admitted.push(requestId); }
    if (action === 'cancel') jobs.delete(String(jobRequestId));
    return {status: 'accepted'};
  };
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: given => { handle = given; return Promise.resolve(); }}]});
  const art = fixture('art');
  const {runtime} = await run(context, {modules: [core, responder(seen, answer), art], configFile: files.config, edge: {schemas: {}}});
  const post = async (body: object, headers: Record<string, string>) => {
    const response = await fetch(new URL('/api/v2/commands/art-request', runtime.url), {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(body)});
    return await response.json() as {error?: {code: string}; status?: string};
  };
  const browser = {origin: runtime.url, 'bunny-request': '1', 'content-type': 'application/json'};
  const signed = await fetch(new URL('/api/v2/browser/session', runtime.url), {method: 'POST', headers: browser, body: '{}'});
  const cookie = signed.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie !== undefined);
  const dashboard = {...browser, cookie};
  const start = {...START, purpose: 'request'};
  assert.equal((await post({target: 'art', requestId: 'job-cancelled', data: start}, dashboard)).status, 'accepted');
  assert.equal((await post({target: 'art', requestId: 'job-kept', data: start}, dashboard)).status, 'accepted');
  // An automatic job is the owner's to cancel too.
  assert.deepEqual(await core.actions.dispatch(artAction('art-auto', CORE, 'job-auto')), accepted('job-auto'));

  const cancel = (requestId: string, jobRequestId: string) => ({target: 'art', requestId, data: {action: 'cancel', jobRequestId}});
  const stranger = await post(cancel('cancel-stranger', 'job-kept'), {authorization: `Bearer ${operator.token}`});
  assert.equal(stranger.error?.code, 'forbidden');
  assert.equal(handle?.operation('cancel-stranger'), undefined);
  assert.equal(jobs.has('job-kept'), true, 'a refused cancel changes nothing');

  const delivered = seen.length;
  assert.equal((await post(cancel('cancel-1', 'job-cancelled'), dashboard)).status, 'accepted');
  assert.equal((await post(cancel('cancel-2', 'job-auto'), dashboard)).status, 'accepted');
  assert.equal(handle?.operation('cancel-1')?.requestedBy, DASHBOARD);
  assert.equal(seen.length, delivered + 2);
  assert.deepEqual(admitted, ['job-cancelled', 'job-kept', 'job-auto'], 'a cancel admits no work');
  const displayed = (): number => seen.filter(command => !['org.bunny.art.request.requested', 'org.bunny.art.auto.requested'].includes(command.type)).length;
  assert.equal(displayed(), 0, 'and reaches no display');
  // The owner finishes what remains: only that job stages, which shows the empty case above is not an idle fake.
  for (const requestId of jobs.keys()) {
    assert.equal((await contextOf(art).sdk.request('bunny.cmd.art-dispatch.art', stageDispatch(), {requestId: `stage-${requestId}`, timeoutMs: 8000})).status, 'accepted');
  }
  assert.equal(displayed(), 1);
  assert.deepEqual([...jobs.keys()], ['job-kept']);
});

it('an art-only store refuses a replacement key, so a lost key cannot turn a retry into a false conflict', async context => {
  const dir = await stateDir(context);
  const w = await world(context, undefined, dir);
  assert.equal((await w.art.request('bunny.cmd.art-dispatch.art', stageDispatch(), {requestId: 'fenced', timeoutMs: 8000})).status, 'accepted');
  w.database.exec('DELETE FROM bunny_private_request_key');
  unlinkSync(join(dir, 'modules/core/request-digest.key'));
  const before = w.seen.length;
  const answer = await w.art.request('bunny.cmd.art-dispatch.art', stageDispatch(), {requestId: 'after-loss', timeoutMs: 8000});
  assert.equal('error' in answer && answer.error.error.code, 'unavailable');
  assert.equal(w.handle.operation('after-loss'), undefined);
  assert.equal(w.seen.length, before);
});

it('routine digests ask nothing about old fences once a key is pinned', context => {
  const folder = mkdtempSync(join(tmpdir(), 'bunny-digest-'));
  chmodSync(folder, 0o700);
  const database = new DatabaseSync(':memory:');
  context.after(() => { database.close(); rmSync(folder, {recursive: true, force: true}); });
  const digest = new PrivateRequestDigest(database, () => folder);
  let asked = 0;
  const fence = (): boolean => { asked += 1; return true; };
  database.exec('BEGIN');
  const first = digest.digest('domain', 'input', fence);
  assert.equal(asked, 1, 'the first admission proves no old fence exists');
  assert.equal(digest.digest('domain', 'input', fence), first);
  assert.equal(asked, 1, 'a pinned key needs no proof');
  database.exec('COMMIT');
});

it('ONN\'s stored digest keeps its domain and canonical input, so existing fences stay valid', async context => {
  const dir = await stateDir(context);
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: given => { handle = given; return Promise.resolve(); }}]});
  const onn: BunnyModule = {manifest: {name: 'onn', apiVersion: '1.3'}, async start({sdk}) { await sdk.respond('bunny.cmd.onn-text.onn', () => ({status: 'accepted'})); }, stop() {}};
  await run(context, {stateDir: dir, modules: [core, onn]});
  assert.deepEqual(await core.actions.dispatch({key: 'bunny.cmd.onn-text.onn', requestId: 'onn-golden', requestedBy: 'bunny/parts/operator',
    draft: {type: 'org.bunny.onn.text.requested', subject: 'onn', dataschema: 'https://bunny.invalid/events/onn-text/2.0', data: {text: 'golden', expectedConfigurationRevision: 1}}}), accepted('onn-golden'));
  const key = readFileSync(join(dir, 'modules/core/request-digest.key'));
  const expected = createHmac('sha256', key).update('bunny/onn-text-admission/1').update('\0')
    .update('{"data":{"expectedConfigurationRevision":1,"text":"golden"},"key":"bunny.cmd.onn-text.onn","requestId":"onn-golden","requestedBy":"bunny/parts/operator","schema":"https://bunny.invalid/events/onn-text/2.0","target":"onn","type":"org.bunny.onn.text.requested"}')
    .digest('hex');
  assert.equal(handle?.operation('onn-golden')?.payload?.hmac, expected);
});

it('a command that claims only part of the stage identity is refused before anything is stored', async context => {
  const w = await world(context);
  const good = forwarded('art-stage', ART_MODULE_SOURCE, 'identity');
  const type = ART_FORWARDED['art-stage'].type, schema = ART_FORWARDED['art-stage'].dataschema;
  const cases = [
    {...good, requestId: 'wrong-type', draft: {...good.draft, type: 'org.bunny.art.other.requested'}},
    {...good, requestId: 'wrong-schema', draft: {...good.draft, dataschema: 'https://bunny.invalid/events/art-ambient-set/2.0'}},
    {...good, requestId: 'wrong-family-type', key: 'bunny.cmd.art-ambient-set.panel', draft: {...good.draft, type}},
    {...good, requestId: 'wrong-family-schema', key: 'bunny.cmd.art-ambient-set.panel', draft: {...good.draft, type: ART_FORWARDED['art-ambient-set'].type, dataschema: schema}},
    {...good, requestId: 'unrelated-family', key: 'bunny.cmd.power-set.panel', draft: {...good.draft}},
  ];
  for (const action of cases) {
    assert.equal(codeOf(await w.core.actions.dispatch(action)), 'invalid-request', action.requestId);
    assert.equal(w.handle.operation(action.requestId), undefined, action.requestId);
  }
  assert.equal(w.seen.length, 0);
});

/** The shared inbox as a sync reads it. */
async function inboxOf(sdk: Sdk): Promise<InboxItem[]> {
  const synced = await sdk.sync<InboxItem>(['inbox-item'], () => {}, {timeoutMs: 5000});
  assert.equal(synced.status, 'synced');
  if (synced.status !== 'synced') return [];
  const records = synced.copy.states().map(state => state.data);
  await synced.copy.close();
  return records;
}
