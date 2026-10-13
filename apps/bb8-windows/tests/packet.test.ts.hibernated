import assert from 'node:assert/strict';
import {test} from 'node:test';
import {encodeCommand, PacketCollector} from '../src/packet.js';

void test('RGB command is the selected three-byte PacketV1 form with checksum', () => {
  assert.deepEqual([...encodeCommand(2, 0x20, 7, Uint8Array.of(255, 0, 10))], [255, 255, 2, 32, 7, 4, 255, 0, 10, 201]);
});

void test('fragmented notification bytes yield one complete matching response', () => {
  const collector = new PacketCollector();
  assert.deepEqual(collector.feed(Uint8Array.of(255, 255, 0)), []);
  const packets = collector.feed(Uint8Array.of(7, 1, 247));
  assert.equal(packets.length, 1);
  assert.deepEqual(packets[0], {kind: 'reply', code: 0, sequence: 7, data: new Uint8Array()});
});

void test('coalesced replies and async notifications are separated with no invented sequence', () => {
  const c = new PacketCollector();
  const packets = c.feed(Uint8Array.of(255, 255, 0, 1, 1, 253, 255, 254, 3, 0, 2, 1, 249, 255, 255, 0, 2, 1, 252));
  assert.deepEqual(packets.map(p => [p.kind, p.code, p.sequence, [...p.data]]), [['reply', 0, 1, []], ['notification', 3, 0, [1]], ['reply', 0, 2, []]]);
});

void test('corrupt checksum never completes; truncated frame waits and collector remains bounded', () => {
  const c = new PacketCollector();
  assert.deepEqual(c.feed(Uint8Array.of(255, 255, 0, 1, 1, 0)), []);
  c.clear();
  assert.deepEqual(c.feed(Uint8Array.of(255, 255, 0, 1, 3, 2)), []);
  assert.equal(c.buffered, 6);
  assert.throws(() => c.feed(new Uint8Array(1024)), {code: 'capacity'});
  assert.equal(c.buffered, 0);
  assert.throws(() => c.feed(Uint8Array.of(255, 254, 1, 4, 0)), {code: 'capacity'});
});
