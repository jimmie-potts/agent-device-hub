// The exact-artwork handoff in the running core (Hub #679): the art part's forwarding, the tracker's and gateway's
// refusals, the omitted payload and the inbox exemption, with a fake art module and a fake display on real validators.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import type {DatabaseSync} from 'node:sqlite';
import type {BunnyModule, Command, Sdk} from '@jimmie-potts/sdk';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {ART_FORWARDED, ART_MODULE_SOURCE, MAX_ART_BYTES, type ArtStageContent} from '@jimmie-potts/event-contracts/v2/art';
import {operationEntityId, type InboxItem, type OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {createCoreModule, type CoreHandle} from '../src/index.js';
import {contextOf, edgeConfig, fixture, it, run, stateDir, waitFor} from './support.js';

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

/** The shared inbox as a sync reads it. */
async function inboxOf(sdk: Sdk): Promise<InboxItem[]> {
  const synced = await sdk.sync<InboxItem>(['inbox-item'], () => {}, {timeoutMs: 5000});
  assert.equal(synced.status, 'synced');
  if (synced.status !== 'synced') return [];
  const records = synced.copy.states().map(state => state.data);
  await synced.copy.close();
  return records;
}
