import assert from 'node:assert/strict';
import {chmodSync, readFileSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import type {BunnyModule} from '@jimmie-potts/sdk';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {operationEntityId, type InboxItem} from '@jimmie-potts/event-contracts/v2/families';
import {createCoreModule, type CoreHandle} from '../src/index.js';
import {edgeConfig, it, run, stateDir, waitFor} from './support.js';

const input = 'SYNTHETIC_ONN_PRIVATE_TEXT_1039';
const action = (text = input) => ({key: 'bunny.cmd.onn-text.onn', requestId: 'onn-text-1', requestedBy: 'bunny/parts/operator',
  draft: {type: 'org.bunny.onn.text.requested', subject: 'onn', dataschema: 'https://bunny.invalid/events/onn-text/2.0',
    data: {text, expectedConfigurationRevision: 1}}});

const responder = (seen: unknown[], refuse = false): BunnyModule => ({manifest: {name: 'onn', apiVersion: '1.3'},
  async start({sdk}) {await sdk.respond('bunny.cmd.onn-text.onn', command => {
    seen.push(command.data); return refuse ? errorBody('unavailable', {detail: 'synthetic refusal'}) : {status: 'accepted'};
  });}, stop() {}});

it('ordinary core startup needs no sensitive identity table before any ONN text admission', async context => {
  const dir = await stateDir(context);
  const {runtime} = await run(context, {stateDir: dir, modules: [createCoreModule()]});
  await runtime.stop();
  // Open only after the writer closes; another descriptor must not disturb SQLite's live ownership lock.
  const database = new DatabaseSync(join(dir, 'modules/core.sqlite'), {readOnly: true});
  try {assert.equal(database.prepare("SELECT 1 FROM sqlite_master WHERE name = 'bunny_private_request_key'").get(), undefined);}
  finally {database.close();}
});

it('ONN focused text reaches its owner once without entering durable core records', async context => {
  const dir = await stateDir(context);
  const core = createCoreModule();
  const seen: unknown[] = [];
  const {logs} = await run(context, {stateDir: dir, modules: [core, responder(seen)]});
  assert.deepEqual(await core.actions.dispatch(action()), {status: 'accepted', requestId: 'onn-text-1'});
  assert.equal(seen.length, 1);
  assert.equal((seen[0] as {text: string}).text, input);
  let scanned = 0;
  for (const suffix of ['', '-wal']) {
    let bytes: Buffer;
    try {bytes = readFileSync(join(dir, 'modules/core.sqlite' + suffix));} catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT' && suffix === '-wal') continue;
      throw error;
    }
    scanned += 1;
    assert.equal(bytes.includes(Buffer.from(input)), false, `plaintext leaked into core.sqlite${suffix}`);
  }
  assert.ok(scanned > 0, 'the actual core database was inspected');
  assert.equal(JSON.stringify(logs).includes(input), false);
  assert.deepEqual(await core.actions.dispatch(action()), {status: 'accepted', requestId: 'onn-text-1'});
  const conflict = await core.actions.dispatch(action('changed'));
  assert.equal('error' in conflict && conflict.error.code, 'duplicate-conflict');
  assert.equal(seen.length, 1);
});

it('text retries compare semantic guards/caller/target while excluding trace and survive restart without sending', async context => {
  const dir = await stateDir(context), seen: unknown[] = [];
  const core = createCoreModule();
  const first = await run(context, {stateDir: dir, modules: [core, responder(seen)]});
  assert.deepEqual(await core.actions.dispatch(action()), {status: 'accepted', requestId: 'onn-text-1'});
  const changedGuard = {...action(), draft: {...action().draft, data: {...action().draft.data, expectedConfigurationRevision: 2}}};
  const changedTarget = {...action(), key: 'bunny.cmd.onn-text.another', draft: {...action().draft, subject: 'another'}};
  for (const changed of [changedGuard, changedTarget, {...action(), requestedBy: 'bunny/parts/other'}]) {
    const reply = await core.actions.dispatch(changed);
    assert.equal('error' in reply && reply.error.code, 'duplicate-conflict');
  }
  await first.runtime.stop();
  const secondCore = createCoreModule();
  await run(context, {stateDir: dir, modules: [secondCore, responder(seen)]});
  assert.equal(seen.length, 1, 'startup sends no saved command');
  assert.deepEqual(await secondCore.actions.dispatch({...action(), parent: {traceparent: '00-11111111111111111111111111111111-1111111111111111-01'}}), {status: 'accepted', requestId: 'onn-text-1'});
  assert.equal(seen.length, 1, 'same semantic retry sends nothing after restart');
});

for (const damage of ['missing', 'replaced', 'permissions'] as const) it(`a ${damage} private identity refuses text without erasing its fence`, async context => {
  const dir = await stateDir(context), seen: unknown[] = [];
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: given => {handle = given; return Promise.resolve();}}]});
  await run(context, {stateDir: dir, modules: [core, responder(seen)]});
  await core.actions.dispatch(action());
  assert.ok(handle);
  const key = join(dir, 'modules/core/request-digest.key');
  if (damage === 'missing') unlinkSync(key);
  if (damage === 'replaced') writeFileSync(key, Buffer.alloc(32, 7));
  if (damage === 'permissions') chmodSync(key, 0o644);
  for (const request of [action(), {...action(), requestId: 'new-text'}]) {
    const refused = await core.actions.dispatch(request);
    assert.equal('error' in refused && refused.error.code, 'unavailable');
  }
  assert.equal(seen.length, 1);
  assert.equal(handle.operation('onn-text-1')?.payload?.status, 'omitted');
  assert.deepEqual(handle.operation('onn-text-1')?.data, {});
  assert.equal(handle.operation('new-text'), undefined, 'refusal commits no new fence');
});

it('inbox Send again refuses omitted text without handling the old item; Dismiss still works', async context => {
  const core = createCoreModule(), seen: unknown[] = [];
  let sdk: Parameters<BunnyModule['start']>[0]['sdk'] | undefined;
  const operator: BunnyModule = {manifest: {name: 'operator', apiVersion: '1.3'}, start: given => {sdk = given.sdk;}, stop() {}};
  const auth = {source: 'bunny/parts/operator', token: 'synthetic-text-inbox', scopes: ['read', 'control'] as const};
  const files = await edgeConfig(context, [auth]);
  const {runtime} = await run(context, {modules: [core, responder(seen, true), operator], configFile: files.config, edge: {schemas: {}}});
  const items = async (): Promise<InboxItem[]> => {
    const response = await fetch(new URL('/api/v2/families/inbox-item', runtime.url), {headers: {authorization: `Bearer ${auth.token}`}});
    assert.equal(response.status, 200);
    return (await response.json() as {records: InboxItem[]}).records;
  };
  const initial = await core.actions.dispatch(action());
  assert.equal('error' in initial && initial.error.code, 'unavailable');
  await waitFor(async () => (await items()).length === 1);
  const before = await items();
  const item = before[0]; assert.ok(item); assert.ok(sdk);
  assert.equal(item.id, operationEntityId('onn-text-1'));
  const client = sdk;
  const request = (verb: 'send-again' | 'dismiss') => client.request(`bunny.cmd.inbox-handle.${item.id}`, {
    type: 'org.bunny.inbox.handle.requested', subject: item.id, dataschema: 'https://bunny.invalid/events/inbox-handle/2.0',
    data: {action: verb, expectedRevision: item.revision},
  }, {timeoutMs: 1000, requestId: `inbox-${verb}`});
  const refused = await request('send-again');
  assert.equal(refused.status, 'rejected');
  assert.equal('error' in refused && refused.error.error.code, 'unsupported-capability');
  assert.deepEqual(await items(), before, 'the old item remains unhandled');
  assert.equal(seen.length, 1);
  assert.equal((await request('dismiss')).status, 'accepted');
  assert.equal((await items()).length, 0);
});
