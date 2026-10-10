import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {InProcessBus} from '@jimmie-potts/sdk';
import {HELPER_SOURCE, MODULE_SOURCE} from '@jimmie-potts/bb8/link';
import {startPrivateHelperDiagnostics} from '../src/diagnostic-file.js';
import {executeDraft, HelperOwner} from '../src/owner.js';
import {FakeGatt} from './fake.js';

async function withFile(run: (path: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'bb8-diagnostics-'));
  try {await run(join(directory, 'diagnostics.ndjson'));} finally {await rm(directory, {recursive: true, force: true});}
}
const privateFile = (): Promise<void> => Promise.resolve();
void test('the persisted mixed log/span stream has one complete JSON record per line', async () => {
  await withFile(async path => {
    const diagnostics = await startPrivateHelperDiagnostics(path, {assertPrivate: privateFile});
    assert.ok(diagnostics);
    diagnostics.trace.start('bunny.device.call').end();
    diagnostics.trace.start('bunny.device.call').end();
    diagnostics.log.info('command.admitted', {'bunny.outcome': 'accepted'});
    await diagnostics.shutdown();
    const bytes = await readFile(path, 'utf8');
    assert.ok(bytes.endsWith('\n'), 'the final record is delimited');
    const lines = bytes.trimEnd().split('\n');
    assert.equal(lines.length, 3, 'two spans and one log are separately framed');
    assert.equal(lines.filter(line => JSON.parse(line) !== undefined).length, 3);
  });
});
void test('an ordinary append failure disables telemetry while leaving helper startup available', async () => {
  await withFile(async path => {
    const diagnostic = await startPrivateHelperDiagnostics(path, {assertPrivate: privateFile, open: () => Promise.reject(new Error('synthetic append failure'))});
    assert.equal(diagnostic, undefined);
  });
});
void test('host adapter initialization failure closes its file and disables telemetry', async () => {
  await withFile(async path => {
    const handle = await open(path, 'a');
    const diagnostic = await startPrivateHelperDiagnostics(path, {assertPrivate: privateFile, open: () => Promise.resolve(handle), start: () => Promise.reject(new Error('synthetic adapter failure'))});
    assert.equal(diagnostic, undefined);
    await assert.rejects(handle.stat(), {code: 'EBADF'});
  });
});
void test('unsafe existing diagnostic paths still refuse startup before opening a file', async () => {
  await withFile(async path => {
    const existing = await open(path, 'a'); await existing.close();
    let opened = false;
    await assert.rejects(startPrivateHelperDiagnostics(path, {assertPrivate: () => Promise.reject(new Error('synthetic unsafe path')), open: async () => {opened = true; return await open(path, 'a');}}), /synthetic unsafe path/);
    assert.equal(opened, false);
  });
});
void test('a helper accepts and completes an explicit connect after diagnostic initialization fails', async () => {
  await withFile(async path => {
    const diagnostics = await startPrivateHelperDiagnostics(path, {assertPrivate: privateFile, start: () => Promise.reject(new Error('synthetic adapter failure'))});
    const database = new DatabaseSync(':memory:'), bus = new InProcessBus();
    const sdk = bus.connect(HELPER_SOURCE), module = bus.connect(MODULE_SOURCE), gatt = new FakeGatt();
    const scheduler = {after: (ms: number, callback: () => void) => {const timer = setTimeout(callback, ms); return () => {clearTimeout(timer);};}};
    const owner = new HelperOwner({id: 'bb8', configurationRevision: 0, database, sdk, now: Date.now, scheduler, clockErrorMs: () => 0, adapter: () => ({open: () => Promise.resolve(gatt)}), ...(diagnostics === undefined ? {} : {log: diagnostics.log, trace: diagnostics.trace})});
    try {
      await owner.start(); assert.equal(gatt.writes.length, 0, 'startup remains passive');
      const id = crypto.randomUUID();
      const result = await module.request('bunny.cmd.bb8-link-execute.bb8', executeDraft('bb8', {requestId: id, operationId: id, parentRequestId: 'parent-1', expectedConfigurationRevision: 0, expectedHelperEpoch: owner.state.helperEpoch, expectedConnectionGeneration: owner.state.connectionGeneration, operationExpiresAtMs: Date.now() + 14_000, operation: {kind: 'connect'}}), {requestId: id, timeoutMs: 1000});
      assert.equal(result.status, 'accepted'); await owner.drain();
      assert.equal(owner.results[0]?.result, 'succeeded'); assert.equal(gatt.writes.length, 4);
    } finally {await owner.stop(); await sdk.close(); await module.close(); database.close(); await diagnostics?.shutdown();}
  });
});
