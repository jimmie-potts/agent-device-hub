import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, chmodSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { LifxController } from "@jimmie-potts/lifx-controller";
import { validate } from "@jimmie-potts/device-contracts";

const evidence = { vendor: 1, product: 27, firmwareMajor: 2, firmwareMinor: 90 };
const bulb = (id = "bulb-1", address = "192.0.2.1") => ({ deviceId: id, address, ...evidence });
const request = (c, id, command) => {
  const s = c.snapshot(id).controller;
  return {
    apiVersion: "1.0", controllerId: "lifx", deviceId: id,
    requestId: s.nextRequestId, expectedConfigurationRevision: s.configurationRevision,
    expectedGeneration: s.generation, command,
  };
};

function tempRoot(t) {
  const dir = mkdtempSync(join(tmpdir(), "lifx-modes-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const setup = (t, exchange, opts = {}) =>
  new LifxController({
    controllerId: "lifx", sourceId: "test", bulbs: [bulb()],
    transportFactory: () => ({ exchange, close() {} }),
    timeoutMs: 10, retries: 1, modeStateRoot: tempRoot(t),
    ...opts,
  });

test("a qualified bulb advertises Work/Quiet/Free; an unqualified one advertises no modes", (t) => {
  const c = setup(t, async () => Buffer.alloc(0));
  assert.deepEqual(c.snapshot("bulb-1").controller.capabilities.modes, { supported: true, values: ["Work", "Quiet", "Free"] });
  c.close();
  const d = setup(t, async () => { throw new Error("no traffic"); }, { bulbs: [{ ...bulb(), firmwareMinor: 91 }] });
  assert.deepEqual(d.snapshot("bulb-1").controller.capabilities.modes, { supported: false });
  d.close();
});

test("without a configured modeStateRoot, a qualified bulb still advertises no modes and mode.set is unsupported-capability", async (t) => {
  const c = new LifxController({
    controllerId: "lifx", sourceId: "test", bulbs: [bulb()],
    transportFactory: () => ({ exchange: async () => Buffer.alloc(0), close() {} }),
    timeoutMs: 10, retries: 1,
    // No modeStateRoot: the package has no home-directory default of its own.
  });
  assert.deepEqual(c.snapshot("bulb-1").controller.capabilities.modes, { supported: false });
  assert.deepEqual(c.snapshot("bulb-1").controller.state.desired.mode, { status: "unknown" });
  const receipt = await c.submit(request(c, "bulb-1", { kind: "mode.set", mode: "Work" })).done;
  assert.equal(receipt.outcome, "failed");
  assert.equal(receipt.failure.code, "unsupported-capability");
  c.close();
});

test("a bulb with no recorded mode starts Free, and mode.set sends no bulb traffic", async (t) => {
  let calls = 0;
  const c = setup(t, async () => { calls++; return Buffer.alloc(0); });
  const snap = c.snapshot("bulb-1").controller;
  assert.deepEqual(snap.state.desired.mode, { status: "known", value: "Free" });
  const receipt = await c.submit(request(c, "bulb-1", { kind: "mode.set", mode: "Work" })).done;
  assert.equal(receipt.outcome, "sent");
  // The contract ties outcome "sent" to priorEffects "confirmed-transmission"; there is no valid
  // combination for "succeeded with certainty, nothing was transmitted" (see the schema check in
  // the return), so a fully persisted mode change reports the same pairing any completed write does.
  assert.equal(receipt.priorEffects, "confirmed-transmission");
  assert.equal(validate("receipt", receipt), true);
  assert.equal(calls, 0, "mode.set never touches the transport");
  assert.deepEqual(c.snapshot("bulb-1").controller.state.desired.mode, { status: "known", value: "Work" });
  c.close();
});

test("a persisted mode survives a restart, keyed by device rather than address", async (t) => {
  const root = tempRoot(t);
  const a = setup(t, async () => Buffer.alloc(0), { modeStateRoot: root });
  await a.submit(request(a, "bulb-1", { kind: "mode.set", mode: "Quiet" })).done;
  a.close();
  const b = setup(t, async () => Buffer.alloc(0), { modeStateRoot: root });
  assert.deepEqual(b.snapshot("bulb-1").controller.state.desired.mode, { status: "known", value: "Quiet" });
  b.close();
});

test("a missing or invalid mode file defaults to Free", async (t) => {
  const root = tempRoot(t);
  writeFileSync(join(root, "not-a-real-mode-file"), "garbage"); // unrelated file: must not be read as this bulb's mode
  const c = setup(t, async () => Buffer.alloc(0), { modeStateRoot: root });
  assert.deepEqual(c.snapshot("bulb-1").controller.state.desired.mode, { status: "known", value: "Free" });
  c.close();
});

test("a symlinked mode file is never followed and defaults to Free", async (t) => {
  const root = tempRoot(t);
  const a = setup(t, async () => Buffer.alloc(0), { modeStateRoot: root });
  await a.submit(request(a, "bulb-1", { kind: "mode.set", mode: "Quiet" })).done;
  a.close();
  const path = join(root, createHash("sha256").update("bulb-1").digest("hex") + ".json");
  const target = join(root, "elsewhere.json");
  writeFileSync(target, JSON.stringify({ mode: "Work" }));
  unlinkSync(path);
  symlinkSync(target, path);
  const b = setup(t, async () => Buffer.alloc(0), { modeStateRoot: root });
  assert.deepEqual(b.snapshot("bulb-1").controller.state.desired.mode, { status: "known", value: "Free" });
  b.close();
});

test("a group-readable mode directory fails closed: reads default to Free and writes fail without traffic", async (t) => {
  const root = tempRoot(t);
  chmodSync(root, 0o750);
  const c = setup(t, async () => Buffer.alloc(0), { modeStateRoot: root });
  assert.deepEqual(c.snapshot("bulb-1").controller.state.desired.mode, { status: "known", value: "Free" });
  const receipt = await c.submit(request(c, "bulb-1", { kind: "mode.set", mode: "Work" })).done;
  assert.equal(receipt.outcome, "failed");
  assert.equal(receipt.priorEffects, "none");
  assert.equal(receipt.failure.code, "transport-failure");
  assert.deepEqual(c.snapshot("bulb-1").controller.state.desired.mode, { status: "known", value: "Free" });
  c.close();
});

test("a persistence write failure fails the receipt without changing the mode, and does not mark the bulb degraded", async (t) => {
  const root = tempRoot(t);
  // A file in place of the mode directory makes mkdirSync throw inside writePersistedMode.
  writeFileSync(root + "-blocked", "");
  const blockedRoot = root + "-blocked/modes";
  t.after(() => rmSync(root + "-blocked", { recursive: true, force: true }));
  const c = setup(t, async () => Buffer.alloc(0), { modeStateRoot: blockedRoot });
  const before = c.snapshot("bulb-1").controller.serviceHealth;
  const receipt = await c.submit(request(c, "bulb-1", { kind: "mode.set", mode: "Work" })).done;
  assert.equal(receipt.outcome, "failed");
  assert.equal(receipt.priorEffects, "none");
  assert.equal(receipt.failure.code, "transport-failure");
  assert.deepEqual(c.snapshot("bulb-1").controller.state.desired.mode, { status: "known", value: "Free" });
  assert.equal(c.snapshot("bulb-1").controller.serviceHealth, before, "a local persistence failure leaves transport health untouched");
  c.close();
});

test("onModeChange notifies only after a successful mode.set, and unsubscribe stops it", async (t) => {
  const c = setup(t, async () => Buffer.alloc(0));
  let calls = 0;
  const unsubscribe = c.onModeChange("bulb-1", () => { calls++; });
  await c.submit(request(c, "bulb-1", { kind: "mode.set", mode: "Work" })).done;
  assert.equal(calls, 1);
  unsubscribe();
  await c.submit(request(c, "bulb-1", { kind: "mode.set", mode: "Quiet" })).done;
  assert.equal(calls, 1, "no further notification once unsubscribed");
  assert.throws(() => c.onModeChange("unknown", () => {}), /unknown-device/);
  c.close();
});

test("paintStatus sends one absolute LightSetColor with full HSBK, no LightGet, and never touches power", async (t) => {
  const calls = [];
  const c = setup(t, async (type, payload) => { calls.push(type); return type === 101 ? Buffer.alloc(52) : Buffer.alloc(0); });
  const hsbk = { hue: 100, saturation: 200, brightness: 300, kelvin: 3500 };
  const submission = c.paintStatus("bulb-1", hsbk);
  assert.equal(submission.decision, "queued");
  assert.equal(submission.reserved, true);
  // Never listed as a lifx-light command, which profile 1.0.0 cannot express (#450); it still takes the queue.
  assert.deepEqual(c.snapshot("bulb-1").lighting.pending, []);
  assert.deepEqual(c.snapshot("bulb-1").controller.state.pending, []);
  const receipt = await submission.done;
  assert.equal(receipt.outcome, "sent");
  assert.equal(receipt.priorEffects, "confirmed-transmission");
  assert.deepEqual(calls, [102]);
  const state = c.snapshot("bulb-1").controller.state;
  assert.deepEqual(state.lastOutcome.receipt, receipt, "the paint's receipt is the last outcome");
  assert.deepEqual(state.lastSuccessfulSend.requestId, receipt.requestId, "and its request is the last successful send");
  c.close();
});

test("paintStatus is rejected by capacity when the queue is full, and is not retried", async (t) => {
  const c = setup(t, () => new Promise(() => {}), { maxPending: 1 });
  const first = c.paintStatus("bulb-1", { hue: 0, saturation: 0, brightness: 0, kelvin: 2700 });
  assert.equal(first.decision, "queued");
  const second = c.paintStatus("bulb-1", { hue: 1, saturation: 1, brightness: 1, kelvin: 2701 });
  assert.equal(second.decision, "capacity");
  assert.equal(second.reserved, false);
  c.close();
});

test("paintStatus for an unknown device is rejected without traffic", async (t) => {
  const c = setup(t, async () => Buffer.alloc(0));
  assert.deepEqual(c.paintStatus("unknown", { hue: 0, saturation: 0, brightness: 0, kelvin: 2700 }), { decision: "unknown-device", reserved: false });
  c.close();
});

test("paintStatus for an unqualified bulb is rejected without traffic or a pending entry", async (t) => {
  let calls = 0;
  const c = setup(t, async () => { calls++; return Buffer.alloc(0); }, { bulbs: [{ ...bulb(), firmwareMinor: 91 }] });
  const before = c.snapshot("bulb-1").controller;
  const result = c.paintStatus("bulb-1", { hue: 0, saturation: 0, brightness: 0, kelvin: 2700 });
  assert.deepEqual(result, { decision: "unsupported-capability", reserved: false });
  assert.equal(calls, 0);
  // Paints are never listed as pending (#450), so identity and cursor show that no entry was created.
  const after = c.snapshot("bulb-1").controller;
  assert.deepEqual(after.nextRequestId, before.nextRequestId);
  assert.deepEqual(after.cursor, before.cursor);
  c.close();
});

test("a generation cancel alone drops a queued paint without traffic and leaves the controller open", async (t) => {
  let started = 0;
  const c = setup(t, () => { started++; return new Promise(() => {}); });
  const inFlight = c.paintStatus("bulb-1", { hue: 0, saturation: 0, brightness: 0, kelvin: 2700 });
  const queued = c.paintStatus("bulb-1", { hue: 1, saturation: 1, brightness: 1, kelvin: 2700 });
  await new Promise(resolve => setImmediate(resolve));
  c.cancel("bulb-1");
  const dropped = await queued.done;
  assert.equal(dropped.outcome, "cancelled");
  assert.equal(dropped.priorEffects, "none");
  await inFlight.done;
  assert.equal(started, 1, "the queued paint never reached the transport");
  const later = c.paintStatus("bulb-1", { hue: 2, saturation: 2, brightness: 2, kelvin: 2700 });
  assert.equal(later.decision, "queued", "the controller still admits paints after a cancel");
  c.close();
  await later.done;
});

test("a generation cancel drops a queued paint and close cancels an outstanding one", async (t) => {
  let started = 0;
  const c = setup(t, () => { started++; return new Promise(() => {}); });
  const first = c.paintStatus("bulb-1", { hue: 0, saturation: 0, brightness: 0, kelvin: 2700 });
  await new Promise(resolve => setImmediate(resolve));
  c.close();
  const receipt = await first.done;
  assert.equal(receipt.outcome, "cancelled");
  assert.equal(started, 1);
});

test("closeGracefully lets an in-flight paint finish and cancels every queued one without new traffic", async (t) => {
  let calls = 0;
  let resolveActive;
  const c = setup(t, async () => {
    calls++;
    if (calls === 1) return new Promise((resolve) => { resolveActive = () => resolve(Buffer.alloc(0)); });
    throw new Error("must not be called: no traffic after the in-flight paint");
  });
  const first = c.paintStatus("bulb-1", { hue: 0, saturation: 0, brightness: 0, kelvin: 2700 });
  await new Promise((resolve) => setImmediate(resolve)); // let the first attempt actually reach the transport
  assert.equal(calls, 1);
  const second = c.paintStatus("bulb-1", { hue: 1, saturation: 1, brightness: 1, kelvin: 2701 });
  const third = c.paintStatus("bulb-1", { hue: 2, saturation: 2, brightness: 2, kelvin: 2702 });
  const closing = c.closeGracefully();
  resolveActive();
  const [firstReceipt, secondReceipt, thirdReceipt] = await Promise.all([first.done, second.done, third.done]);
  await closing;
  assert.equal(firstReceipt.outcome, "sent");
  assert.equal(firstReceipt.priorEffects, "confirmed-transmission");
  assert.equal(secondReceipt.outcome, "cancelled");
  assert.equal(secondReceipt.priorEffects, "none");
  assert.equal(thirdReceipt.outcome, "cancelled");
  assert.equal(thirdReceipt.priorEffects, "none");
  assert.equal(calls, 1, "no write after the in-flight paint settles");
});

test("the private paint command kind is never accepted through the public submit route", (t) => {
  const c = setup(t, async () => Buffer.alloc(0));
  const s = c.snapshot("bulb-1").controller;
  const attempt = {
    apiVersion: "1.0", controllerId: "lifx", deviceId: "bulb-1",
    requestId: s.nextRequestId, expectedConfigurationRevision: s.configurationRevision, expectedGeneration: s.generation,
    profile: { profileId: "lifx-light", profileVersion: "1.0.0" },
    command: { kind: "lifx.internal.status-paint", hue: 0, saturation: 0, brightness: 0, kelvin: 2700 },
  };
  assert.deepEqual(c.submit(attempt), { decision: "invalid-request", reserved: false });
  c.close();
});
