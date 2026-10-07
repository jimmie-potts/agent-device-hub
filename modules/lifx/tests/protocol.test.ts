// The LIFX LAN protocol (Hub #928). Copied from controllers/lifx/tests/protocol.test.mjs at main 483d3a93 and converted
// to TypeScript under the strict profile; the cases and their assertions are unchanged. The last case drives the copied
// queue, instead of the old controller, through the UDP transport over fake sockets. No test opens a native socket.
import assert from 'node:assert/strict';
import type {Socket} from 'node:dgram';
import {EventEmitter} from 'node:events';
import {decodeState, encodeColor, encodePower, UdpTransport, type Hsbk} from '../src/protocol.js';
import {BulbQueue} from '../src/queue.js';
import {it, manualClock} from './support.js';

type Sent = {packet: Buffer; port: number; address: string};
type Remote = {address: string; port: number};
class FakeSocket extends EventEmitter {
  sent: Sent[] = [];
  closed = false;
  send(packet: Buffer, port: number, address: string, callback?: (error: Error | null) => void): void {
    this.sent.push({packet, port, address});
    callback?.(null);
  }
  close(): void {
    this.closed = true;
  }
}
const asSocket = (socket: FakeSocket): Socket => socket as unknown as Socket;
const peer: Remote = {address: '192.0.2.44', port: 56700};
const firstPacket = (socket: FakeSocket | undefined): Buffer => {
  const packet = socket?.sent[0]?.packet;
  assert.ok(packet, 'a packet was sent');
  return packet;
};
function response(request: Buffer, type = 107, payload: Buffer = Buffer.alloc(52)): Buffer {
  const buffer = Buffer.alloc(36 + payload.length);
  buffer.writeUInt16LE(buffer.length);
  buffer.writeUInt16LE(0x1400, 2);
  buffer.writeUInt32LE(request.readUInt32LE(4), 4);
  Buffer.from('0102030405060000', 'hex').copy(buffer, 8);
  buffer.writeUInt8(request.readUInt8(23), 23);
  buffer.writeUInt16LE(type, 32);
  payload.copy(buffer, 36);
  return buffer;
}

it('golden packet payloads encode little endian zero-duration absolute state', () => {
  assert.equal(encodePower(true).toString('hex'), 'ffff');
  assert.equal(encodePower(false).toString('hex'), '0000');
  assert.equal(encodeColor({hue: 1, saturation: 0x1234, brightness: 0xabcd, kelvin: 3500}).toString('hex'), '0001003412cdabac0d00000000');
  assert.throws(() => encodeColor({hue: 1, saturation: 2, brightness: 3} as Hsbk));
  assert.throws(() => decodeState(Buffer.alloc(51)));
  const state = Buffer.alloc(52);
  [100, 200, 300, 3500].forEach((value, index) => state.writeUInt16LE(value, index * 2));
  state.writeUInt16LE(65535, 10);
  assert.deepEqual(decodeState(state), {color: {hue: 100, saturation: 200, brightness: 300, kelvin: 3500}, power: true});
});

it('configured address is immutable, packets correlate and target is learned', async () => {
  const sockets: FakeSocket[] = [];
  const options = {address: peer.address, socketFactory: () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return asSocket(socket);
  }};
  const transport = new UdpTransport(options);
  options.address = '192.0.2.55';
  const read = transport.exchange(101, Buffer.alloc(0), 107, new AbortController().signal);
  const socket = sockets[0];
  assert.ok(socket);
  const packet = firstPacket(socket);
  assert.equal(socket.sent[0]?.address, peer.address);
  assert.equal(socket.sent[0]?.port, 56700);
  assert.equal(packet.length, 36);
  assert.equal(packet.readUInt8(22), 0);
  assert.equal(packet.readUInt16LE(2), 0x1400);
  assert.ok(packet.readUInt32LE(4) > 1);
  for (const [offset, value] of [[2, 1], [3, 0], [4, packet.readUInt8(4) ^ 255], [23, packet.readUInt8(23) ^ 255], [32, 33], [8, 0]] as const) {
    const bad = response(packet);
    bad.writeUInt8(value, offset);
    if (offset === 8) bad.fill(0, 8, 16);
    socket.emit('message', bad, peer);
    assert.equal(socket.closed, false);
  }
  socket.emit('message', Buffer.alloc(4), peer);
  socket.emit('message', response(packet), {...peer, port: 1});
  socket.emit('message', response(packet), {...peer, address: '192.0.2.45'});
  assert.equal(socket.closed, false);
  socket.emit('message', response(packet), peer);
  await read;
  assert.equal(socket.closed, true);
  const write = transport.exchange(102, encodeColor({hue: 1, saturation: 2, brightness: 3, kelvin: 3500}), 45, new AbortController().signal);
  const next = sockets[1];
  assert.ok(next);
  const sent = firstPacket(next);
  assert.equal(sent.length, 49);
  assert.equal(sent.readUInt8(22), 2);
  assert.equal(sent.subarray(8, 16).toString('hex'), '0102030405060000');
  const wrong = response(sent, 45, Buffer.alloc(0));
  wrong.writeUInt8(7, 8);
  next.emit('message', wrong, peer);
  assert.equal(next.closed, false);
  next.emit('message', response(sent, 45, Buffer.alloc(0)), peer);
  await write;
  transport.close();
});

it('abort, close, synchronous and asynchronous send errors settle and redact', async () => {
  for (const mode of ['abort', 'close', 'sync', 'async'] as const) {
    const socket = new FakeSocket();
    if (mode === 'sync') socket.send = () => { throw new Error('private-address'); };
    if (mode === 'async') socket.send = (_packet, _port, _address, callback) => { callback?.(new Error('private-address')); };
    const transport = new UdpTransport({address: peer.address, socketFactory: () => asSocket(socket)});
    const abort = new AbortController();
    const exchange = transport.exchange(101, Buffer.alloc(0), 107, abort.signal);
    if (mode === 'abort') abort.abort();
    if (mode === 'close') transport.close();
    await assert.rejects(exchange, (error: Error) => !error.message.includes('private-address'));
    assert.equal(socket.closed, true);
    transport.close();
  }
});

it('invalid transport requests and targets open no sockets', async () => {
  for (const address of ['not-ip', '0.0.0.0', '224.1.1.1', '255.255.255.255', '192.0.2.255']) assert.throws(() => new UdpTransport({address}));
  let sockets = 0;
  const transport = new UdpTransport({address: peer.address, socketFactory: () => {
    sockets += 1;
    return asSocket(new FakeSocket());
  }});
  for (const [type, payload, expected] of [[101, Buffer.alloc(0), 45], [102, Buffer.alloc(12), 45], [999, Buffer.alloc(0), 45]] as const) {
    await assert.rejects(transport.exchange(type, payload, expected, new AbortController().signal));
  }
  assert.equal(sockets, 0);
  transport.close();
});

it('the queue drives the UDP adapter through fake sockets without native traffic', async () => {
  const sockets: FakeSocket[] = [];
  const clock = manualClock();
  const queue = new BulbQueue({
    now: clock.now, scheduler: clock.scheduler,
    transport: new UdpTransport({address: peer.address, socketFactory: () => {
      const socket = new FakeSocket();
      const send = socket.send.bind(socket);
      socket.send = (packet, port, address, callback) => {
        send(packet, port, address, callback);
        const type = packet.readUInt16LE(32);
        queueMicrotask(() => { socket.emit('message', response(packet, type === 101 ? 107 : 45, type === 101 ? Buffer.alloc(52) : Buffer.alloc(0)), peer); });
      };
      sockets.push(socket);
      return asSocket(socket);
    }}),
  });
  const attempt = await queue.run({kind: 'brightness', percent: 50});
  assert.equal(attempt?.effect, 'sent');
  assert.deepEqual(sockets.map(socket => firstPacket(socket).readUInt16LE(32)), [101, 102]);
  assert.ok(sockets.every(socket => socket.closed));
  await queue.close();
});
