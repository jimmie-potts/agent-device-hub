import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import {
  UdpTransport,
  encodeColor,
  encodePower,
  decodeState,
} from "../dist/protocol.js";
class Socket extends EventEmitter {
  sent = [];
  closed = false;
  send(packet, port, address, cb) {
    this.sent.push({ packet, port, address });
    cb?.();
  }
  close() {
    this.closed = true;
  }
}
const peer = { address: "192.0.2.44", port: 56700 };
function response(request, type = 107, payload = Buffer.alloc(52)) {
  const b = Buffer.alloc(36 + payload.length);
  b.writeUInt16LE(b.length);
  b.writeUInt16LE(0x1400, 2);
  b.writeUInt32LE(request.readUInt32LE(4), 4);
  Buffer.from("0102030405060000", "hex").copy(b, 8);
  b[23] = request[23];
  b.writeUInt16LE(type, 32);
  payload.copy(b, 36);
  return b;
}
test("golden packet payloads encode little endian zero-duration absolute state", () => {
  assert.equal(encodePower(true).toString("hex"), "ffff");
  assert.equal(encodePower(false).toString("hex"), "0000");
  assert.equal(
    encodeColor({
      hue: 1,
      saturation: 0x1234,
      brightness: 0xabcd,
      kelvin: 3500,
    }).toString("hex"),
    "0001003412cdabac0d00000000",
  );
  assert.throws(() => encodeColor({ hue: 1, saturation: 2, brightness: 3 }));
  assert.throws(() => decodeState(Buffer.alloc(51)));
  const b = Buffer.alloc(52);
  [100, 200, 300, 3500].forEach((v, i) => b.writeUInt16LE(v, i * 2));
  b.writeUInt16LE(65535, 10);
  assert.deepEqual(decodeState(b), {
    color: { hue: 100, saturation: 200, brightness: 300, kelvin: 3500 },
    power: true,
  });
});
test("configured address is immutable, packets correlate and target is learned", async () => {
  const sockets = [];
  const options = {
    address: peer.address,
    socketFactory: () => {
      const s = new Socket();
      sockets.push(s);
      return s;
    },
  };
  const t = new UdpTransport(options);
  options.address = "192.0.2.55";
  const p = t.exchange(101, Buffer.alloc(0), 107, new AbortController().signal);
  const s = sockets[0],
    packet = s.sent[0].packet;
  assert.equal(s.sent[0].address, peer.address);
  assert.equal(s.sent[0].port, 56700);
  assert.equal(packet.length, 36);
  assert.equal(packet[22], 0);
  assert.equal(packet.readUInt16LE(2), 0x1400);
  assert.ok(packet.readUInt32LE(4) > 1);
  for (const [offset, val] of [
    [2, 1],
    [3, 0],
    [4, packet[4] ^ 255],
    [23, packet[23] ^ 255],
    [32, 33],
    [8, 0],
  ]) {
    const bad = response(packet);
    bad[offset] = val;
    if (offset === 8) bad.fill(0, 8, 16);
    s.emit("message", bad, peer);
    assert.equal(s.closed, false);
  }
  s.emit("message", Buffer.alloc(4), peer);
  s.emit("message", response(packet), { ...peer, port: 1 });
  s.emit("message", response(packet), { ...peer, address: "192.0.2.45" });
  assert.equal(s.closed, false);
  s.emit("message", response(packet), peer);
  await p;
  assert.equal(s.closed, true);
  const q = t.exchange(
    102,
    encodeColor({ hue: 1, saturation: 2, brightness: 3, kelvin: 3500 }),
    45,
    new AbortController().signal,
  );
  const next = sockets[1],
    sent = next.sent[0].packet;
  assert.equal(sent.length, 49);
  assert.equal(sent[22], 2);
  assert.equal(sent.subarray(8, 16).toString("hex"), "0102030405060000");
  const wrong = response(sent, 45, Buffer.alloc(0));
  wrong[8] = 7;
  next.emit("message", wrong, peer);
  assert.equal(next.closed, false);
  next.emit("message", response(sent, 45, Buffer.alloc(0)), peer);
  await q;
  t.close();
});
test("abort, close, synchronous and asynchronous send errors settle and redact", async () => {
  for (const mode of ["abort", "close", "sync", "async"]) {
    const socket = new Socket();
    if (mode === "sync")
      socket.send = () => {
        throw new Error("private-address");
      };
    if (mode === "async")
      socket.send = (p, port, addr, cb) => cb(new Error("private-address"));
    const t = new UdpTransport({
      address: peer.address,
      socketFactory: () => socket,
    });
    const a = new AbortController();
    const p = t.exchange(101, Buffer.alloc(0), 107, a.signal);
    if (mode === "abort") a.abort();
    if (mode === "close") t.close();
    await assert.rejects(p, (e) => !e.message.includes("private-address"));
    assert.equal(socket.closed, true);
    t.close();
  }
});
test("invalid transport requests and targets open no sockets", async () => {
  for (const address of [
    "not-ip",
    "0.0.0.0",
    "224.1.1.1",
    "255.255.255.255",
    "192.0.2.255",
  ])
    assert.throws(() => new UdpTransport({ address }));
  let sockets = 0;
  const t = new UdpTransport({
    address: peer.address,
    socketFactory: () => {
      sockets++;
      return new Socket();
    },
  });
  for (const args of [
    [101, Buffer.alloc(0), 45],
    [102, Buffer.alloc(12), 45],
    [999, Buffer.alloc(0), 45],
  ])
    await assert.rejects(t.exchange(...args, new AbortController().signal));
  assert.equal(sockets, 0);
  t.close();
});
test("controller drives the UDP adapter through fake sockets without native traffic", async () => {
  const { LifxController } = await import("@jimmie-potts/lifx-controller");
  const sockets = [];
  const c = new LifxController({
    controllerId: "lifx",
    sourceId: "test",
    bulbs: [
      {
        deviceId: "bulb",
        address: peer.address,
        vendor: 1,
        product: 27,
        firmwareMajor: 2,
        firmwareMinor: 90,
      },
    ],
    transportFactory: () =>
      new UdpTransport({
        address: peer.address,
        socketFactory: () => {
          const s = new Socket();
          const send = s.send.bind(s);
          s.send = (packet, port, address, cb) => {
            send(packet, port, address, cb);
            const type = packet.readUInt16LE(32);
            queueMicrotask(() =>
              s.emit(
                "message",
                response(
                  packet,
                  type === 101 ? 107 : 45,
                  type === 101 ? Buffer.alloc(52) : Buffer.alloc(0),
                ),
                peer,
              ),
            );
          };
          sockets.push(s);
          return s;
        },
      }),
  });
  const snap = c.snapshot("bulb").controller;
  const result = c.submit({
    apiVersion: "1.0",
    controllerId: "lifx",
    deviceId: "bulb",
    requestId: snap.nextRequestId,
    expectedConfigurationRevision: snap.configurationRevision,
    expectedGeneration: snap.generation,
    command: { kind: "brightness.set", percent: 50 },
  });
  assert.equal((await result.done).outcome, "sent");
  assert.deepEqual(
    sockets.map((s) => s.sent[0].packet.readUInt16LE(32)),
    [101, 102],
  );
  assert.ok(sockets.every((s) => s.closed));
  c.close();
});
