// Safe errors at the runtime's edge (Hub #948, ADR 0012 "Errors, effects and outcomes"): an exception inside the edge
// reaches a remote part, the runtime's log and its health only as a registry code and fixed text. Its message, which
// here carries a synthetic secret, stays in memory.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {chmod, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {connectRemote} from '@jimmie-potts/sdk';
import {EDGE_GRANTS_FILE} from '../src/index.js';
import {entry, fixture, health, it, run, stateDir} from './support.js';

const SECRET = 'tok_SYNTHETIC123';

it('an exception inside the edge reaches the remote part, the log and health only as its code and fixed text', async context => {
  const dir = await stateDir(context);
  const reader = {source: 'bunny/parts/reader', token: randomBytes(32).toString('base64url')};
  const grants = join(dir, EDGE_GRANTS_FILE);
  await writeFile(grants, JSON.stringify({schema: 'edge-grants/1.0', grants: [reader]}), {mode: 0o600});
  await chmod(grants, 0o600);
  // The module's state cannot be serialized: the edge's own size check throws while it encodes the sync answer.
  const vault = fixture('vault', async ({sdk}) => {
    const poisoned = {id: 'v1', revision: 1, toJSON: (): never => { throw new Error(`the vault refused ${SECRET}`); }};
    await sdk.serveSync(['vault'], () => ({
      revision: 1, states: [{type: 'org.bunny.vault.updated', subject: 'v1', dataschema: 'https://bunny.invalid/events/vault/2.0', data: poisoned}],
    }));
  });
  const {runtime, logs} = await run(context, {modules: [vault], stateDir: dir, edge: {schemas: {}}});

  const remote = await connectRemote({url: runtime.url, source: reader.source, token: reader.token});
  context.after(() => remote.close());
  const synced = await remote.sync(['vault'], () => {}, {timeoutMs: 5000});
  assert.equal(synced.status, 'rejected');
  if (synced.status !== 'rejected') return;
  assert.deepEqual(synced.error, errorBody('internal', {detail: 'the edge failed', requestId: synced.requestId, traceId: synced.error.error.traceId ?? ''}));

  const refused = logs.filter(record => record.event_name === 'runtime.edge.refused');
  assert.deepEqual(refused.map(record => [record.attributes['bunny.route'], record.attributes['bunny.code']]), [['sync', 'internal']]);
  const served = await health(runtime.url);
  assert.equal(entry(served.body, 'vault').healthy, true, 'an exception at the edge is no module failure');
  const evidence = JSON.stringify({synced, logs, served, health: runtime.health()});
  assert.equal(evidence.includes(SECRET), false, 'no response, log record or health report carries the exception\'s message');
});
