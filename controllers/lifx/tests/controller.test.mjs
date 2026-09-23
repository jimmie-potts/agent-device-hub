import test from "node:test";
import assert from "node:assert/strict";
import { LifxController } from "@jimmie-potts/lifx-controller";
import { validate } from "@jimmie-potts/device-contracts";
const evidence = {
  vendor: 1,
  product: 27,
  firmwareMajor: 2,
  firmwareMinor: 90,
};
const bulb = (id = "bulb-1", address = "192.0.2.1") => ({
  deviceId: id,
  address,
  ...evidence,
});
const state = () => {
  const b = Buffer.alloc(52);
  [12000, 32000, 50000, 3500].forEach((v, i) => b.writeUInt16LE(v, i * 2));
  b.writeUInt16LE(65535, 10);
  return b;
};
const request = (c, id, command, profile = false) => {
  const s = c.snapshot(id).controller;
  return {
    apiVersion: "1.0",
    controllerId: "lifx",
    deviceId: id,
    requestId: s.nextRequestId,
    expectedConfigurationRevision: s.configurationRevision,
    expectedGeneration: s.generation,
    command,
    ...(profile
      ? { profile: { profileId: "lifx-light", profileVersion: "1.0.0" } }
      : {}),
  };
};
const setup = (exchange, opts = {}) =>
  new LifxController({
    controllerId: "lifx",
    sourceId: "test",
    bulbs: [bulb()],
    transportFactory: () => ({ exchange, close() {} }),
    timeoutMs: 10,
    retries: 1,
    ...opts,
  });
test("lost reply retries within a bound and returns a valid sent receipt", async () => {
  let calls = 0;
  const c = setup(async () => {
    if (++calls === 1) return new Promise(() => {});
    return Buffer.alloc(0);
  });
  const sub = c.submit(request(c, "bulb-1", { kind: "power.set", on: true }));
  assert.equal(sub.decision, "queued");
  const done = await sub.done;
  assert.equal(done.outcome, "sent");
  assert.equal(calls, 2);
  assert.equal(validate("receipt", done), true);
  assert.equal(validate("snapshot", c.snapshot("bulb-1").controller), true);
  c.close();
});
test("exhausted writes are uncertain, replay never resends, changed body conflicts", async () => {
  let calls = 0;
  const c = setup(() => {
    calls++;
    return new Promise(() => {});
  });
  const r = request(c, "bulb-1", { kind: "power.set", on: true });
  const a = c.submit(r);
  const joined = c.submit(structuredClone(r));
  assert.equal(joined.decision, "join");
  const done = await a.done;
  assert.equal(done.outcome, "uncertain");
  assert.equal(done.priorEffects, "possible");
  assert.equal(calls, 2);
  assert.deepEqual(await joined.done, done);
  assert.deepEqual(await c.submit(r).done, done);
  assert.equal(calls, 2);
  assert.equal(
    c.submit({ ...r, command: { kind: "power.set", on: false } }).decision,
    "request-conflict",
  );
  c.close();
});
test("unsupported models, effects and raw targets never touch transport", async () => {
  let calls = 0;
  const c = setup(
    async () => {
      calls++;
      return Buffer.alloc(0);
    },
    { bulbs: [{ deviceId: "bulb-1", address: "192.0.2.1" }] },
  );
  const sub = c.submit(request(c, "bulb-1", { kind: "power.set", on: true }));
  assert.equal((await sub.done).failure.code, "unsupported-capability");
  for (const command of [
    { kind: "lifx.effect.set", effect: "pulse" },
    { kind: "power.set", on: true, address: "192.0.2.2" },
    { kind: "lifx.color.set", hue: 90, saturation: 90, raw: [1] },
  ])
    assert.equal(
      c.submit(request(c, "bulb-1", command, true)).decision,
      "invalid-request",
    );
  assert.equal(calls, 0);
  c.close();
});
test("serial read-modify-write preserves HSBK and reports read age independently of ACK", async () => {
  let now = 100,
    active = 0,
    maximum = 0;
  const calls = [];
  const c = setup(
    async (type, payload) => {
      active++;
      maximum = Math.max(active, maximum);
      calls.push({ type, payload: Buffer.from(payload) });
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      return type === 101 ? state() : Buffer.alloc(0);
    },
    { now: () => now },
  );
  const first = c.submit(
    request(c, "bulb-1", { kind: "brightness.set", percent: 25 }),
  );
  const second = c.submit(
    request(
      c,
      "bulb-1",
      { kind: "lifx.color.set", hue: 180, saturation: 50 },
      true,
    ),
  );
  await Promise.all([first.done, second.done]);
  assert.equal(maximum, 1);
  assert.deepEqual(
    calls.map((x) => x.type),
    [101, 102, 101, 102],
  );
  assert.deepEqual(
    [1, 3, 5, 7].map((i) => calls[1].payload.readUInt16LE(i)),
    [12000, 32000, 16384, 3500],
  );
  assert.deepEqual(
    [1, 3, 5, 7].map((i) => calls[3].payload.readUInt16LE(i)),
    [32768, 32768, 50000, 3500],
  );
  now = 300;
  await c.submit(request(c, "bulb-1", { kind: "power.set", on: false })).done;
  const s = c.snapshot("bulb-1");
  assert.equal(s.controller.state.observation.clock.sampledAtMs, 100);
  assert.equal(s.controller.state.observation.evidenceAgeMs, 200);
  assert.equal(s.lighting.visible.status, "unknown");
  assert.equal(validate("snapshot", s.controller), true);
  c.close();
});
test("temperature preserves brightness and hue and validates profile version/range", async () => {
  const calls = [];
  const c = setup(async (type, payload) => {
    calls.push({ type, payload: Buffer.from(payload) });
    return type === 101 ? state() : Buffer.alloc(0);
  });
  const r = request(
    c,
    "bulb-1",
    { kind: "lifx.temperature.set", kelvin: 1500 },
    true,
  );
  assert.equal((await c.submit(r).done).outcome, "sent");
  assert.deepEqual(
    [1, 3, 5, 7].map((i) => calls[1].payload.readUInt16LE(i)),
    [12000, 32000, 50000, 1500],
  );
  assert.equal(
    c.submit({ ...r, profile: { ...r.profile, profileVersion: "2.0.0" } })
      .decision,
    "invalid-request",
  );
  assert.equal(
    c.submit({ ...r, command: { kind: "lifx.temperature.set", kelvin: 1499 } })
      .decision,
    "invalid-request",
  );
  c.close();
});
test("partial batch retains independent per-bulb receipts", async () => {
  const c = setup(async () => Buffer.alloc(0), {
    bulbs: [bulb(), bulb("bulb-2", "192.0.2.2")],
    transportFactory: (b) => ({
      exchange: () =>
        b.deviceId === "bulb-1"
          ? Promise.resolve(Buffer.alloc(0))
          : new Promise(() => {}),
      close() {},
    }),
  });
  const results = await c.submitMany(
    ["bulb-1", "bulb-2"].map((id) =>
      request(c, id, { kind: "power.set", on: true }),
    ),
  );
  assert.deepEqual(
    results.map((x) => x.result.outcome),
    ["sent", "uncertain"],
  );
  for (const r of results) assert.equal(validate("receipt", r.result), true);
  c.close();
});
test("cancellation aborts an active write and prevents queued side effects and retries", async () => {
  let calls = 0,
    started;
  const sent = new Promise((r) => (started = r));
  const c = setup(() => {
    calls++;
    started();
    return new Promise(() => {});
  });
  const a = c.submit(request(c, "bulb-1", { kind: "power.set", on: true }));
  const b = c.submit(request(c, "bulb-1", { kind: "power.set", on: false }));
  await sent;
  c.cancel("bulb-1");
  const [x, y] = await Promise.all([a.done, b.done]);
  assert.equal(calls, 1);
  assert.equal(x.outcome, "cancelled");
  assert.equal(x.priorEffects, "possible");
  assert.equal(y.outcome, "cancelled");
  assert.equal(y.priorEffects, "none");
  for (const r of [x, y]) assert.equal(validate("receipt", r), true);
  c.close();
});
test("read timeout before a color write has no effects; refresh failure retains observation", async () => {
  let okay = true,
    calls = 0;
  const c = setup((type) => {
    calls++;
    return okay ? Promise.resolve(state()) : new Promise(() => {});
  });
  assert.equal((await c.refresh("bulb-1")).ok, true);
  const before = c.snapshot("bulb-1").controller.state.observation.clock;
  okay = false;
  const r = await c.submit(
    request(c, "bulb-1", { kind: "brightness.set", percent: 10 }),
  ).done;
  assert.equal(r.outcome, "failed");
  assert.equal(r.priorEffects, "none");
  assert.equal(calls, 3);
  assert.deepEqual(
    c.snapshot("bulb-1").controller.state.observation.clock,
    before,
  );
  c.close();
});
test("bounded admission, revision and ordering reject without new traffic; close drains", async () => {
  let calls = 0;
  const c = setup(
    () => {
      calls++;
      return new Promise(() => {});
    },
    { maxPending: 1 },
  );
  const a = c.submit(request(c, "bulb-1", { kind: "power.set", on: true }));
  assert.equal(
    c.submit(request(c, "bulb-1", { kind: "power.set", on: false })).decision,
    "capacity",
  );
  c.close();
  assert.equal((await a.done).outcome, "cancelled");
  assert.equal((await c.refresh("bulb-1")).failure, "capacity");
  assert.equal(calls, 0);
  const d = setup(async () => Buffer.alloc(0));
  const r = request(d, "bulb-1", { kind: "power.set", on: true });
  assert.equal(
    d.submit({ ...r, requestId: { ...r.requestId, sequence: 1 } }).decision,
    "request-order",
  );
  const rejected = await d.submit({ ...r, expectedConfigurationRevision: 3 })
    .done;
  assert.equal(rejected.failure.code, "revision-conflict");
  assert.equal(d.snapshot("bulb-1").controller.nextRequestId.sequence, 1);
  d.close();
});
test("read and write share a queue; snapshot is detached and contains no target", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const types = [];
  const c = setup(
    async (type) => {
      types.push(type);
      if (types.length === 1) await gate;
      return type === 101 ? state() : Buffer.alloc(0);
    },
    { timeoutMs: 500 },
  );
  const read = c.refresh("bulb-1");
  const write = c.submit(request(c, "bulb-1", { kind: "power.set", on: true }));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(types, [101]);
  release();
  await Promise.all([read, write.done]);
  assert.deepEqual(types, [101, 21]);
  const snapshot = c.snapshot("bulb-1");
  snapshot.controller.state.observation.power.value = false;
  assert.equal(
    c.snapshot("bulb-1").controller.state.observation.power.value,
    true,
  );
  assert.ok(!JSON.stringify(snapshot).includes("192.0.2.1"));
  c.close();
});
test("configuration rejects duplicate ownership and invalid retry bounds without traffic", () => {
  for (const bulbs of [
    [bulb(), bulb("bulb-2")],
    [bulb(), bulb("bulb-1", "192.0.2.2")],
  ])
    assert.throws(() => setup(async () => {}, { bulbs }));
  for (const options of [{ retries: 4 }, { timeoutMs: 0 }, { maxPending: 33 }])
    assert.throws(() => setup(async () => {}, options));
});
test("profile request joins/replays full typed body and unknown firmware remains off", async () => {
  let calls = 0;
  const c = setup(async (type) => {
    calls++;
    return type === 101 ? state() : Buffer.alloc(0);
  });
  const r = request(
    c,
    "bulb-1",
    { kind: "lifx.color.set", hue: 0, saturation: 0 },
    true,
  );
  const one = c.submit(r),
    two = c.submit(structuredClone(r));
  assert.equal(two.decision, "join");
  await one.done;
  assert.equal(c.submit(r).decision, "replay");
  assert.equal(
    c.submit({ ...r, command: { ...r.command, hue: 1 } }).decision,
    "request-conflict",
  );
  assert.equal(calls, 2);
  c.close();
  const d = setup(
    async () => {
      throw Error("no traffic");
    },
    { bulbs: [{ ...bulb(), firmwareMinor: 91 }] },
  );
  assert.equal(d.snapshot("bulb-1").lighting.capabilities.color, false);
  assert.equal(
    (
      await d.submit(
        request(
          d,
          "bulb-1",
          { kind: "lifx.temperature.set", kelvin: 5000 },
          true,
        ),
      ).done
    ).failure.code,
    "unsupported-capability",
  );
  d.close();
});
test("receipt eviction expires old identities rather than re-executing", async () => {
  let calls = 0;
  const c = setup(async () => {
    calls++;
    return Buffer.alloc(0);
  });
  const first = request(c, "bulb-1", { kind: "power.set", on: true });
  await c.submit(first).done;
  for (let i = 0; i < 256; i++)
    await c.submit(request(c, "bulb-1", { kind: "power.set", on: !!(i % 2) }))
      .done;
  assert.equal(calls, 257);
  assert.equal(c.submit(first).decision, "request-expired");
  assert.equal(calls, 257);
  c.close();
});
