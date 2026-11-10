// External-control streaming (#1598): the version 2 datagram layout, the UDP sender on the loopback interface, and the
// simulated controller's streaming mode. No light is contacted.
import assert from 'node:assert/strict';
import {createSocket} from 'node:dgram';
import {LINES_ADDRESS, SimulatedNanoleaf, SYNTHETIC_TOKEN} from '../src/module/simulated.js';
import {datagramTo, ENTER_STREAMING, STREAM_PORT, STREAMING, streamPacket} from '../src/stream.js';
import {test} from './support.js';

test('a datagram is a big-endian zone count, then each zone\'s ID, color, white 0 and a 100 ms transition', () => {
  const packet = Buffer.from(streamPacket([[1, [[255, 0, 16, 1]]], [258, [[1, 2, 3, 1], [9, 9, 9, 1]]]]));
  assert.deepEqual([...packet], [0, 2, 0, 1, 255, 0, 16, 0, 0, 1, 1, 2, 1, 2, 3, 0, 0, 1]);
  assert.equal(streamPacket([]).length, 2);
  assert.equal(STREAM_PORT, 60222);
  assert.deepEqual(ENTER_STREAMING, {write: {command: 'display', animType: 'extControl', extControlVersion: 'v2'}});
});

test('the UDP sender delivers one datagram to the address and port, and a failed send rejects', async () => {
  const server = createSocket('udp4');
  try {
    const received = new Promise<Buffer>(resolve => { server.once('message', message => { resolve(message); }); });
    await new Promise<void>(resolve => { server.bind(0, '127.0.0.1', resolve); });
    const {port} = server.address();
    const packet = streamPacket([[7, [[10, 20, 30, 1]]]]);
    await datagramTo(port)({ip: '127.0.0.1'}, packet);
    assert.deepEqual([...await received], [...packet]);
    await assert.rejects(datagramTo(port)({ip: 'not-an-address.invalid'}, packet));
  } finally {
    server.close();
  }
});

test('the simulated Lines apply datagrams only while streaming, and a scene chosen in the app leaves streaming', async () => {
  const nanoleaf = new SimulatedNanoleaf({now: () => 1000});
  const address = {ip: LINES_ADDRESS, token: SYNTHETIC_TOKEN};
  const lines = () => nanoleaf.state().devices[LINES_ADDRESS];
  await nanoleaf.datagram(address, streamPacket([[100, [[1, 2, 3, 1]]]]));
  assert.deepEqual({streamed: lines()?.streamed, ignored: lines()?.ignored}, {streamed: 0, ignored: 1}, 'a light not streaming ignores it');
  await nanoleaf.request(address, 'PUT', '/effects', ENTER_STREAMING);
  assert.equal(await nanoleaf.request(address, 'GET', '/effects/select'), STREAMING);
  await nanoleaf.datagram(address, streamPacket([[100, [[1, 2, 3, 1]]], [101, [[4, 5, 6, 1]]]]));
  assert.deepEqual(lines()?.frame, {100: [1, 2, 3], 101: [4, 5, 6]});
  nanoleaf.chooseScene(LINES_ADDRESS, 'Northern Lights');
  await nanoleaf.datagram(address, streamPacket([[100, [[9, 9, 9, 1]]]]));
  assert.equal(lines()?.select, 'Northern Lights');
  assert.deepEqual(lines()?.frame, {100: [1, 2, 3], 101: [4, 5, 6]}, 'the app\'s scene is not painted over');
  assert.deepEqual(lines()?.streams, [{atMs: 1000, applied: false}, {atMs: 1000, applied: true}, {atMs: 1000, applied: false}]);
  await nanoleaf.request(address, 'PUT', '/effects', ENTER_STREAMING);
  await assert.rejects(nanoleaf.datagram(address, Buffer.from([0, 2, 0, 1])), 'a streaming light refuses a malformed datagram');
});
