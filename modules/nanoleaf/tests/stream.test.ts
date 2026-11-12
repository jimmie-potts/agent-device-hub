// External-control streaming (#1598, #1272): the version 2 datagram layout the Lines take and the version 1 layout the
// NL22 Light Panels take, the UDP sender on the loopback interface, and the simulated controllers' streaming modes. No
// light is contacted.
import assert from 'node:assert/strict';
import {createSocket} from 'node:dgram';
import {DeviceLink, type LinkOptions} from '../src/module/link.js';
import {nanoleafSimulation} from '../src/module/registration.js';
import {LINES_ADDRESS, PANELS_ADDRESS, SimulatedNanoleaf, SYNTHETIC_TOKEN} from '../src/module/simulated.js';
import {ENTER_STREAMING, ENTER_STREAMING_V1, lightDatagram, STREAM_PORT, STREAMING, STREAMING_V1, streamPacket, streamPacketV1, streamPortV1,
  streamProtocol, V1_MAX_ID} from '../src/stream.js';
import {test} from './support.js';

test('a datagram is a big-endian zone count, then each zone\'s ID, color, white 0 and a 100 ms transition', () => {
  const packet = Buffer.from(streamPacket([[1, [[255, 0, 16, 1]]], [258, [[1, 2, 3, 1], [9, 9, 9, 1]]]]));
  assert.deepEqual([...packet], [0, 2, 0, 1, 255, 0, 16, 0, 0, 1, 1, 2, 1, 2, 3, 0, 0, 1]);
  assert.equal(streamPacket([]).length, 2);
  assert.equal(STREAM_PORT, 60222);
  assert.deepEqual(ENTER_STREAMING, {write: {command: 'display', animType: 'extControl', extControlVersion: 'v2', logicalPanelsEnabled: true}});
});

test('a version 1 datagram is a one-byte panel count, then each panel\'s one-byte ID, one frame, color, white 0 and a 100 ms transition', () => {
  const packet = Buffer.from(streamPacketV1([[1, [[255, 0, 16, 1]]], [200, [[1, 2, 3, 1], [9, 9, 9, 1]]]]));
  assert.deepEqual([...packet], [2, 1, 1, 255, 0, 16, 0, 1, 200, 1, 1, 2, 3, 0, 1]);
  assert.equal(streamPacketV1([]).length, 1);
  assert.equal(V1_MAX_ID, 255);
  assert.throws(() => streamPacketV1([[256, [[1, 2, 3, 1]]]]), RangeError, 'a panel ID wider than one byte');
  assert.throws(() => streamPacketV1(Array.from({length: 256}, (_, index) => [index % 256, [[0, 0, 0, 1]]] as const)), RangeError, 'more panels than one byte counts');
  assert.deepEqual(ENTER_STREAMING_V1, {write: {command: 'display', animType: 'extControl', extControlVersion: 'v1'}});
});

test('the version 1 entry\'s answer names the streaming port; anything else names none', () => {
  assert.equal(streamPortV1({streamControlIpAddr: '192.0.2.11', streamControlPort: 60221, streamControlProtocol: 'udp'}), 60221);
  assert.equal(streamPortV1({streamControlPort: 60221}), 60221, 'a reply without a protocol is taken as UDP');
  for (const answer of [null, {}, {streamControlPort: 0}, {streamControlPort: 65536}, {streamControlPort: 1.5}, {streamControlPort: '60221'},
    {streamControlPort: 60221, streamControlProtocol: 'tcp'}, [60221]]) {
    assert.equal(streamPortV1(answer), undefined, JSON.stringify(answer));
  }
});

test('the answered streaming port must be unprivileged: 1024 to 65535, never a well-known port', () => {
  for (const port of [1024, 60221, 65535]) assert.equal(streamPortV1({streamControlPort: port, streamControlProtocol: 'udp'}), port, String(port));
  for (const port of [0, 1, 53, 123, 1023, 65536]) {
    assert.equal(streamPortV1({streamControlPort: port, streamControlProtocol: 'udp'}), undefined, `port ${port} names no usable port`);
  }
});

test('the device link sends a frame to the configured address on an unprivileged port only', async () => {
  const sent: {ip: string; port: number}[] = [];
  // Only `stream` is exercised: it reads the address, the datagram transport and the stop signal.
  const link = new DeviceLink({device: 'nl22', address: PANELS_ADDRESS, token: SYNTHETIC_TOKEN, transport: () => Promise.reject(new Error('no request')),
    datagram: (address: {ip: string; port: number}) => { sent.push(address); return Promise.resolve(); }, signal: new AbortController().signal} as unknown as LinkOptions);
  const packet = streamPacketV1([[200, [[1, 2, 3, 1]]]]);
  await link.stream(packet, 60221);
  await link.stream(packet, STREAM_PORT);
  for (const port of [0, 53, 1023, 65536, 1.5]) await assert.rejects(link.stream(packet, port), RangeError, `port ${port}`);
  assert.deepEqual(sent, [{ip: PANELS_ADDRESS, port: 60221}, {ip: PANELS_ADDRESS, port: STREAM_PORT}], 'nothing goes to a well-known port');
});

test('each kind streams its own version: the Lines version 2 on the fixed port, the Panels version 1 on the port their answer names', () => {
  const lines = streamProtocol('lines'), panels = streamProtocol('panels');
  assert.equal(lines.entry, ENTER_STREAMING);
  assert.equal(lines.port(null), STREAM_PORT, 'the Lines answer with no body');
  assert.deepEqual([...lines.packet([[300, [[1, 2, 3, 1]]]])], [...streamPacket([[300, [[1, 2, 3, 1]]]])]);
  assert.equal(lines.addresses([1, 300, 65535]), true);
  assert.equal(panels.entry, ENTER_STREAMING_V1);
  assert.equal(panels.port({streamControlIpAddr: '192.0.2.11', streamControlPort: 60221, streamControlProtocol: 'udp'}), 60221);
  assert.equal(panels.port(null), undefined, 'a Panels answer without a port names none');
  assert.deepEqual([...panels.packet([[7, [[1, 2, 3, 1]]]])], [1, 7, 1, 1, 2, 3, 0, 1]);
  assert.equal(panels.addresses([0, 7, 255]), true);
  assert.equal(panels.addresses([7, 256]), false, 'a panel ID wider than one byte');
  assert.equal(panels.addresses(Array.from({length: 256}, (_, index) => index % 200)), false, 'more panels than one byte counts');
});

test('each kind names the selection its light reports while it streams: *ExtControl* on the Lines, *Dynamic* on the NL22 (#1777)', () => {
  assert.equal(STREAMING, '*ExtControl*');
  assert.equal(STREAMING_V1, '*Dynamic*');
  assert.equal(streamProtocol('lines').streaming, STREAMING, 'as #1598 observed on the installed Lines');
  assert.equal(streamProtocol('panels').streaming, STREAMING_V1, 'as #1777 observed on the installed NL22');
});

test('the UDP sender delivers one datagram to the address and port, and a failed send rejects', async () => {
  const server = createSocket('udp4');
  try {
    const received = new Promise<Buffer>(resolve => { server.once('message', message => { resolve(message); }); });
    await new Promise<void>(resolve => { server.bind(0, '127.0.0.1', resolve); });
    const {port} = server.address();
    const packet = streamPacket([[7, [[10, 20, 30, 1]]]]);
    await lightDatagram({ip: '127.0.0.1', port}, packet);
    assert.deepEqual([...await received], [...packet]);
    // Port 0 is refused before anything is sent or looked up, and the socket is still closed.
    await assert.rejects(lightDatagram({ip: '127.0.0.1', port: 0}, packet));
  } finally {
    server.close();
  }
});

test('the simulated Lines apply datagrams only while streaming, and a scene chosen in the app leaves streaming', async () => {
  const nanoleaf = new SimulatedNanoleaf({now: () => 1000});
  const address = {ip: LINES_ADDRESS, token: SYNTHETIC_TOKEN};
  const stream = {ip: LINES_ADDRESS, port: STREAM_PORT};
  const lines = () => nanoleaf.state().devices[LINES_ADDRESS];
  await nanoleaf.datagram(stream, streamPacket([[100, [[1, 2, 3, 1]]]]));
  assert.deepEqual({streamed: lines()?.streamed, ignored: lines()?.ignored}, {streamed: 0, ignored: 1}, 'a light not streaming ignores it');
  assert.equal(await nanoleaf.request(address, 'PUT', '/effects', ENTER_STREAMING), null, 'the Lines answer the entry with no body');
  assert.equal(await nanoleaf.request(address, 'GET', '/effects/select'), STREAMING);
  await nanoleaf.datagram(stream, streamPacket([[100, [[1, 2, 3, 1]]], [101, [[4, 5, 6, 1]]]]));
  assert.deepEqual(lines()?.frame, {100: [1, 2, 3], 101: [4, 5, 6]});
  nanoleaf.chooseScene(LINES_ADDRESS, 'Northern Lights');
  assert.equal(lines()?.manualAtMs, 1000, 'the app\'s choice is kept with its time');
  await nanoleaf.datagram(stream, streamPacket([[100, [[9, 9, 9, 1]]]]));
  assert.equal(lines()?.select, 'Northern Lights');
  assert.deepEqual(lines()?.frame, {100: [1, 2, 3], 101: [4, 5, 6]}, 'the app\'s scene is not painted over');
  assert.deepEqual(lines()?.streams, [{atMs: 1000, applied: false}, {atMs: 1000, applied: true}, {atMs: 1000, applied: false}]);
  await nanoleaf.request(address, 'PUT', '/effects', ENTER_STREAMING);
  await assert.rejects(nanoleaf.datagram(stream, Buffer.from([0, 2, 0, 1])), 'a streaming light refuses a malformed datagram');
  await assert.rejects(nanoleaf.datagram(stream, streamPacket([[1000, [[1, 2, 3, 1]]]])), 'a connector or unknown zone is no light zone');
  await assert.rejects(nanoleaf.datagram(stream, Buffer.from([0, 1, 0, 100, 1, 2, 3, 7, 0, 1])), 'a white byte other than 0');
  await assert.rejects(nanoleaf.datagram(stream, Buffer.from([0, 1, 0, 100, 1, 2, 3, 0, 0, 2])), 'a transition other than 100 ms');
  await assert.rejects(nanoleaf.datagram({ip: LINES_ADDRESS, port: 60221}, streamPacket([[100, [[1, 2, 3, 1]]]])), 'nothing streams on another port');
  await assert.rejects(nanoleaf.request(address, 'PUT', '/effects', ENTER_STREAMING_V1), 'the simulated Lines take version 2 only');
});

test('a disposable run\'s link carries each datagram\'s port to the simulated controller', async () => {
  const held = nanoleafSimulation.run.create({now: () => 1000, scheduler: {after: () => () => {}}});
  const call = (method: string, args: unknown) => nanoleafSimulation.run.serve(held, {method, args, signal: new AbortController().signal, current: true});
  assert.deepEqual(await call('request', {address: LINES_ADDRESS, token: SYNTHETIC_TOKEN, method: 'PUT', endpoint: '/effects', payload: ENTER_STREAMING}), {reply: null});
  const packet = Buffer.from(streamPacket([[100, [[1, 2, 3, 1]]]])).toString('base64');
  assert.equal(await call('datagram', {address: LINES_ADDRESS, port: STREAM_PORT, packet}), null);
  assert.equal(held.state().devices[LINES_ADDRESS]?.streamed, 1);
  await assert.rejects(Promise.resolve(call('datagram', {address: LINES_ADDRESS, port: 60221, packet})), 'a datagram to another port is not applied');
});

test('the simulated Panels enter version 1, answer with their streaming port and apply only version 1 datagrams of their own panels', async () => {
  let now = 5000;
  const nanoleaf = new SimulatedNanoleaf({devices: {[PANELS_ADDRESS]: 'panels'}, now: () => now});
  const address = {ip: PANELS_ADDRESS, token: SYNTHETIC_TOKEN};
  const panels = () => nanoleaf.state().devices[PANELS_ADDRESS];
  await assert.rejects(nanoleaf.request(address, 'PUT', '/effects', ENTER_STREAMING), 'the Lines\' version 2 entry, with logical panels, is refused');
  assert.equal(panels()?.select, 'Beach Waves', 'a refused entry changes nothing');
  const answer = await nanoleaf.request(address, 'PUT', '/effects', ENTER_STREAMING_V1);
  assert.deepEqual(answer, {streamControlIpAddr: PANELS_ADDRESS, streamControlPort: 60221, streamControlProtocol: 'udp'});
  assert.equal(panels()?.select, STREAMING_V1, 'the NL22 reports *Dynamic* while it streams (#1777)');
  const port = streamPortV1(answer) ?? 0;
  await nanoleaf.datagram({ip: PANELS_ADDRESS, port}, streamPacketV1([[200, [[1, 2, 3, 1]]], [203, [[4, 5, 6, 1]]]]));
  assert.deepEqual(panels()?.frame, {200: [1, 2, 3], 203: [4, 5, 6]});
  now += 40;
  await nanoleaf.datagram({ip: PANELS_ADDRESS, port}, streamPacketV1([[201, [[7, 8, 9, 1]]]]));
  now += 100;
  await nanoleaf.datagram({ip: PANELS_ADDRESS, port}, streamPacketV1([[202, [[7, 8, 9, 1]]]]));
  assert.equal(panels()?.streamed, 3);
  assert.equal(panels()?.tooSoon, 1, 'a datagram less than 100 ms after the last applied one is counted');
  await assert.rejects(nanoleaf.datagram({ip: PANELS_ADDRESS, port}, streamPacket([[200, [[1, 2, 3, 1]]]])), 'a version 2 datagram is malformed here');
  await assert.rejects(nanoleaf.datagram({ip: PANELS_ADDRESS, port}, streamPacketV1([[100, [[1, 2, 3, 1]]]])), 'a Lines zone is no panel here');
  await assert.rejects(nanoleaf.datagram({ip: PANELS_ADDRESS, port: STREAM_PORT}, streamPacketV1([[200, [[1, 2, 3, 1]]]])), 'nothing streams on the version 2 port');
  await assert.rejects(nanoleaf.datagram({ip: PANELS_ADDRESS, port}, Buffer.from([1, 200, 2, 1, 2, 3, 0, 1])), 'one frame per panel only');
  await assert.rejects(nanoleaf.datagram({ip: PANELS_ADDRESS, port}, Buffer.from([1, 200, 1, 1, 2, 3, 5, 1])), 'a white byte other than 0');
  await assert.rejects(nanoleaf.datagram({ip: PANELS_ADDRESS, port}, Buffer.from([1, 200, 1, 1, 2, 3, 0, 0])), 'a transition other than 100 ms');
  assert.equal(panels()?.streamed, 3, 'no rejected datagram is applied');
  nanoleaf.chooseScene(PANELS_ADDRESS, 'Northern Lights');
  await nanoleaf.datagram({ip: PANELS_ADDRESS, port}, streamPacketV1([[200, [[9, 9, 9, 1]]]]));
  assert.equal(panels()?.ignored, 1, 'a scene chosen in the app leaves streaming');
  assert.deepEqual(panels()?.frame, {200: [1, 2, 3], 203: [4, 5, 6], 201: [7, 8, 9], 202: [7, 8, 9]});
});

test('the simulated Panels report a saved scene, *Static* and *Dynamic* before streaming, and every app choice leaves streaming (#1777)', async () => {
  let now = 7000;
  const nanoleaf = new SimulatedNanoleaf({devices: {[PANELS_ADDRESS]: 'panels'}, now: () => now});
  const address = {ip: PANELS_ADDRESS, token: SYNTHETIC_TOKEN};
  const panels = () => nanoleaf.state().devices[PANELS_ADDRESS];
  const select = (): Promise<unknown> => nanoleaf.request(address, 'GET', '/effects/select');
  assert.equal(await select(), 'Beach Waves', 'a saved scene by its name');
  nanoleaf.chooseEffect(PANELS_ADDRESS, 'static');
  assert.equal(await select(), '*Static*', 'an unsaved static selection');
  nanoleaf.chooseEffect(PANELS_ADDRESS, 'dynamic');
  assert.equal(await select(), '*Dynamic*', 'an unsaved dynamic effect, the same name the NL22 reports while streaming');
  nanoleaf.chooseColor(PANELS_ADDRESS, {hue: 30, sat: 70});
  assert.deepEqual([await select(), panels()?.colorMode, panels()?.hue, panels()?.sat], ['*Solid*', 'hs', 30, 70]);
  const port = streamPortV1(await nanoleaf.request(address, 'PUT', '/effects', ENTER_STREAMING_V1)) ?? 0;
  for (const choice of ['scene', 'colour', 'static', 'dynamic'] as const) {
    await nanoleaf.request(address, 'PUT', '/effects', ENTER_STREAMING_V1);
    assert.equal(await select(), STREAMING_V1);
    now += 200;
    if (choice === 'scene') nanoleaf.chooseScene(PANELS_ADDRESS, 'Northern Lights');
    else if (choice === 'colour') nanoleaf.chooseColor(PANELS_ADDRESS, {ct: 2700});
    else nanoleaf.chooseEffect(PANELS_ADDRESS, choice);
    assert.equal(panels()?.manualAtMs, now, `the app's ${choice} is kept with its time`);
    assert.equal(panels()?.streaming, null, `the app's ${choice} leaves streaming`);
    const ignored = panels()?.ignored ?? 0;
    await nanoleaf.datagram({ip: PANELS_ADDRESS, port}, streamPacketV1([[200, [[9, 9, 9, 1]]]]));
    assert.equal(panels()?.ignored, ignored + 1, `a datagram after the app's ${choice} is ignored`);
  }
  // The one choice the selection cannot show: the app's dynamic effect reads exactly as streaming did.
  assert.equal(await select(), STREAMING_V1);
});

test('the simulated Lines keep reporting *ExtControl* while streaming, and an app effect or colour leaves it', async () => {
  const nanoleaf = new SimulatedNanoleaf({now: () => 3000});
  const address = {ip: LINES_ADDRESS, token: SYNTHETIC_TOKEN};
  for (const leave of ['dynamic', 'colour'] as const) {
    await nanoleaf.request(address, 'PUT', '/effects', ENTER_STREAMING);
    assert.equal(await nanoleaf.request(address, 'GET', '/effects/select'), STREAMING);
    if (leave === 'dynamic') nanoleaf.chooseEffect(LINES_ADDRESS, 'dynamic');
    else nanoleaf.chooseColor(LINES_ADDRESS, {hue: 10, sat: 20});
    assert.equal(await nanoleaf.request(address, 'GET', '/effects/select'), leave === 'dynamic' ? '*Dynamic*' : '*Solid*');
    assert.equal(nanoleaf.state().devices[LINES_ADDRESS]?.streaming, null);
  }
});
