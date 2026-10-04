import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { createNodeHidTransport } from '../dist/node-hid-transport.js';
import { CONTROLLER } from './helpers.mjs';

/** A stand-in for the node-hid module; the real native module is exercised only by tests/native.mjs on Windows. */
function fakeNodeHid() {
  const handles = [];
  const module = {
    loads: 0,
    devicesAsync: async () => [{ ...CONTROLLER, interface: 0, release: 256 }],
    HIDAsync: {
      open: async path => {
        const handle = Object.assign(new EventEmitter(), { path, written: [], closed: 0, write: async b => { handle.written.push(Buffer.from(b)); return b.length; }, close: async () => { handle.closed++; } });
        handles.push(handle);
        return handle;
      },
    },
  };
  return { module, handles, load: async () => { module.loads++; return module; } };
}

test('the node-hid module is loaded lazily, once', async () => {
  const fake = fakeNodeHid();
  const transport = createNodeHidTransport(fake.load);
  assert.equal(fake.module.loads, 0);
  const devices = await transport.list();
  await transport.list();
  assert.equal(fake.module.loads, 1);
  assert.deepEqual(devices, [{ ...CONTROLLER }], 'only the known descriptor fields are kept');
});

test('writes gain the zero report ID and reads pass through unchanged', async () => {
  const fake = fakeNodeHid();
  const reports = [], closes = [];
  const connection = await createNodeHidTransport(fake.load).open(CONTROLLER, { report: r => reports.push(r), closed: e => closes.push(e) });
  const [handle] = fake.handles;
  assert.equal(handle.path, CONTROLLER.path);
  const report = new Uint8Array(64).fill(7);
  await connection.write(report);
  assert.equal(handle.written[0].length, 65);
  assert.equal(handle.written[0][0], 0);
  assert.deepEqual([...handle.written[0].subarray(1)], [...report]);
  handle.emit('data', Buffer.alloc(64, 3));
  assert.deepEqual([...reports[0]], Array(64).fill(3));
  const failure = new Error('read failed');
  handle.emit('error', failure);
  handle.emit('error', failure);
  handle.emit('data', Buffer.alloc(64, 4));
  assert.deepEqual(closes, [failure]);
  assert.equal(reports.length, 1);
  assert.equal(handle.closed, 1);
  await assert.rejects(connection.write(report), /device-closed/);
  await connection.close();
  assert.equal(handle.closed, 1);
});

test('a device without a path is never opened', async () => {
  const fake = fakeNodeHid();
  await assert.rejects(createNodeHidTransport(fake.load).open({ ...CONTROLLER, path: undefined }, { report() {}, closed() {} }), /device-path-missing/);
  assert.equal(fake.handles.length, 0);
});
