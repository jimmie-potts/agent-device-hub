import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentState, MemoryStorage } from "@jimmie-potts/agent-state";
import { normalizeHook } from "@jimmie-potts/agent-state/providers";
import { LifxController, LifxStatusPublisher } from "@jimmie-potts/lifx-controller";

const evidence = { vendor: 1, product: 27, firmwareMajor: 2, firmwareMinor: 90 };
const req = (c, id, command) => {
  const s = c.snapshot(id).controller;
  return {
    apiVersion: "1.0", controllerId: "lifx", deviceId: id,
    requestId: s.nextRequestId, expectedConfigurationRevision: s.configurationRevision,
    expectedGeneration: s.generation, command,
  };
};
const setMode = async (c, id, mode) => { await c.submit(req(c, id, { kind: "mode.set", mode })).done; };
/** Lets an already-invoked fake exchange (and its queue continuation) settle. */
const flush = () => new Promise(resolve => setImmediate(resolve));

function tempRoot(t) {
  const dir = mkdtempSync(join(tmpdir(), "lifx-status-publisher-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const source = session => ({ provider: "claude", client: "code", hostId: "host", sourceId: "source", sessionId: session });
const hook = (name, session, turn) => normalizeHook({ session_id: session, turn_id: turn, prompt_id: turn }, { ...source(session), hook: name }, Date.now());
const approval = (session, turn) => ({ ...hook("PermissionRequest", session, turn), event: { kind: "attention.approval", attention: { status: "known", id: `ask-${session}` } } });

/** A real shared agent-state owner, so the publisher's own snapshot validation always accepts it. */
async function owner(t) {
  const o = await createAgentState({ storage: new MemoryStorage(), ownerId: "owner", consumers: [] });
  t.after(() => o.shutdown());
  return o;
}

/** Bulb payload type 102 (LightSetColor) is 13 bytes: a reserved byte, then hue/saturation/brightness/kelvin as little-endian uint16. */
function decodeColor(payload) {
  return { hue: payload.readUInt16LE(1), saturation: payload.readUInt16LE(3), brightness: payload.readUInt16LE(5), kelvin: payload.readUInt16LE(7) };
}

function fakeLifx(bulbs, { modeRoot, failFor = new Set() } = {}) {
  const log = [];
  const controller = new LifxController({
    controllerId: "lifx", sourceId: "test", bulbs,
    transportFactory: bulb => ({
      exchange: async (type, payload) => {
        log.push({ deviceId: bulb.deviceId, type, payload: Buffer.from(payload) });
        if (failFor.has(bulb.deviceId)) throw new Error("offline");
        return Buffer.alloc(type === 101 ? 52 : 0);
      },
      close() {},
    }),
    timeoutMs: 10, retries: 0, modeStateRoot: modeRoot,
  });
  return { controller, log };
}

async function setup(t, { bulbs = [{ deviceId: "desk", address: "192.0.2.10", ...evidence }], failFor, ...rest } = {}) {
  const o = await owner(t);
  const { controller, log } = fakeLifx(bulbs, { modeRoot: tempRoot(t), failFor });
  const publisher = new LifxStatusPublisher({
    feed: { snapshot: () => o.snapshot() }, controller, bulbs: bulbs.map(b => ({ deviceId: b.deviceId })),
    pollMs: 30_000, feedTimeoutMs: 3_000, ...rest,
  });
  t.after(() => publisher.stop());
  const paints = deviceId => log.filter(e => e.deviceId === deviceId && e.type === 102);
  return { owner: o, controller, log, paints, publisher };
}

test("mapping: attention, working and done paint the shared status color at the brightness cap", async t => {
  for (const [make, colorful] of [
    [async o => { await o.ingest(approval("s", "t1")); }, true],
    [async o => { await o.ingest(hook("UserPromptSubmit", "s", "t1")); }, true],
    [async o => { await o.ingest(hook("UserPromptSubmit", "s", "t1")); await o.ingest(hook("Stop", "s", "t1")); }, true],
  ]) {
    const { owner: o, controller, publisher, paints } = await setup(t, { bulbs: [{ deviceId: "desk", address: "192.0.2.10", ...evidence }] });
    await make(o);
    await setMode(controller, "desk", "Work");
    await publisher.whenIdle();
    await flush();
    assert.equal(paints("desk").length, 1);
    const color = decodeColor(paints("desk")[0].payload);
    assert.equal(color.brightness, Math.round(50 * 65535 / 100), "the default 50% brightness cap");
    if (colorful) {
      assert.notEqual(color.saturation, 0, "attention/working/done paint a saturated color, not white");
    }
  }
});

test("idle paints warm white 2700 K at zero saturation, at the brightness cap", async t => {
  const { controller, publisher, paints } = await setup(t);
  await setMode(controller, "desk", "Work");
  await publisher.whenIdle();
  await flush();
  assert.equal(paints("desk").length, 1);
  const color = decodeColor(paints("desk")[0].payload);
  assert.equal(color.saturation, 0);
  assert.equal(color.kelvin, 2700);
  assert.equal(color.brightness, Math.round(50 * 65535 / 100));
});

test("Quiet paints attention at the quiet cap and nothing else; leaving attention writes nothing", async t => {
  const o = await owner(t);
  const { controller, log } = fakeLifx([{ deviceId: "desk", address: "192.0.2.10", ...evidence }], { modeRoot: tempRoot(t) });
  const publisher = new LifxStatusPublisher({
    feed: { snapshot: () => o.snapshot() }, controller,
    bulbs: [{ deviceId: "desk", quietCapPercent: 15 }], pollMs: 30_000, feedTimeoutMs: 3_000,
  });
  t.after(() => publisher.stop());
  const paints = () => log.filter(e => e.deviceId === "desk" && e.type === 102);
  await setMode(controller, "desk", "Quiet");
  await o.ingest(approval("s", "t1"));
  await publisher.update();
  await flush();
  assert.equal(paints().length, 1, "Quiet paints attention");
  assert.equal(decodeColor(paints()[0].payload).brightness, Math.round(15 * 65535 / 100), "at the quiet cap, not the brightness cap");
  await o.ingest(hook("UserPromptSubmit", "s", "t1")); // still has the open approval, so still attention; no new transition
  await publisher.update();
  await flush();
  assert.equal(paints().length, 1);
  await o.ingest(hook("Stop", "w", "t2")); // an unrelated working session: still attention overall, no change
  await publisher.update();
  await flush();
  assert.equal(paints().length, 1);
  controller.close();
});

test("transitions only: a repeated read of the same shown state sends no write", async t => {
  const { owner: o, controller, publisher, paints } = await setup(t);
  await o.ingest(hook("UserPromptSubmit", "s", "t1"));
  await setMode(controller, "desk", "Work");
  await publisher.whenIdle();
  await flush();
  assert.equal(paints("desk").length, 1);
  await publisher.update(); // heartbeat: same session, same state
  await publisher.update();
  await flush();
  assert.equal(paints("desk").length, 1, "no write on a repeated read of the same shown state");
  await o.ingest(hook("Stop", "s", "t1")); // a real transition: working -> done
  await publisher.update();
  await flush();
  assert.equal(paints("desk").length, 2);
  await publisher.update();
  await publisher.update();
  await flush();
  assert.equal(paints("desk").length, 2, "further reads of the same done state send nothing more");
});

test("transitions only: new evidence for the same shown state sends no write", async t => {
  const { owner: o, controller, publisher, paints } = await setup(t);
  await o.ingest(hook("UserPromptSubmit", "s", "t1"));
  await setMode(controller, "desk", "Work");
  await publisher.whenIdle();
  await flush();
  assert.equal(paints("desk").length, 1, "Work-entry paints the current (working) state once");
  // Another hook event for the same session: newer evidence, but the shown state stays working.
  await o.ingest(hook("UserPromptSubmit", "s", "t2"));
  await publisher.update();
  await flush();
  assert.equal(paints("desk").length, 1, "a new-evidence read of the same state sends no write");
});

test("transitions only: a manual app change survives repeated reads and is overwritten only at the next transition", async t => {
  const { owner: o, controller, publisher, paints, log } = await setup(t);
  await setMode(controller, "desk", "Work");
  await publisher.whenIdle();
  await flush();
  assert.equal(paints("desk").length, 1, "Work-entry paints the current (idle) state once");
  const readsBefore = log.filter(e => e.deviceId === "desk" && e.type === 101).length;
  // Simulate detecting a manual app change: a plain read (LightGet) through the bulb's own
  // queue. The publisher never reads the bulb and must not react to this with a write.
  await controller.refresh("desk");
  assert.equal(log.filter(e => e.deviceId === "desk" && e.type === 101).length, readsBefore + 1, "the read happened");
  assert.equal(paints("desk").length, 1, "a read never triggers a write");
  await publisher.update(); // heartbeat: still idle
  await flush();
  assert.equal(paints("desk").length, 1, "a heartbeat after the manual app change still sends no write");
  await o.ingest(hook("UserPromptSubmit", "s", "t1")); // a real transition: idle -> working
  await publisher.update();
  await flush();
  assert.equal(paints("desk").length, 2, "the transition paints, overwriting whatever the app left on the bulb");
});

test("stale input: an unavailable feed sends no write; recovery paints only on a real difference", async t => {
  const o = await owner(t);
  const { controller, log } = fakeLifx([{ deviceId: "desk", address: "192.0.2.10", ...evidence }], { modeRoot: tempRoot(t) });
  let fail = false;
  const publisher = new LifxStatusPublisher({
    feed: { snapshot: () => { if (fail) throw new Error("down"); return o.snapshot(); } },
    controller, bulbs: [{ deviceId: "desk" }], pollMs: 30_000, feedTimeoutMs: 3_000,
  });
  t.after(() => publisher.stop());
  const paints = () => log.filter(e => e.deviceId === "desk" && e.type === 102);
  await setMode(controller, "desk", "Work");
  await publisher.whenIdle();
  await flush();
  assert.equal(paints().length, 1, "Work-entry paints the current (idle) state once");
  fail = true;
  await o.ingest(hook("UserPromptSubmit", "s", "t1"));
  await publisher.update();
  await flush();
  assert.equal(paints().length, 1, "an unavailable feed paints nothing, even though the real state changed");
  fail = false;
  await publisher.update(); // recovery: now reads "working", which differs from the idle key painted before the outage
  await flush();
  assert.equal(paints().length, 2, "recovery paints once the state is known again and differs from the last painted key");
  controller.close();
});

test("uncertain freshness: a finished turn idle past five minutes still paints its reported state (#439)", async t => {
  let offsetMs = 0;
  const o = await createAgentState({ storage: new MemoryStorage(), ownerId: "owner", consumers: [], clock: () => Date.now() + offsetMs });
  t.after(() => o.shutdown());
  const { controller, log } = fakeLifx([{ deviceId: "desk", address: "192.0.2.10", ...evidence }], { modeRoot: tempRoot(t) });
  const publisher = new LifxStatusPublisher({
    feed: { snapshot: () => o.snapshot() }, controller, bulbs: [{ deviceId: "desk" }], pollMs: 30_000, feedTimeoutMs: 3_000,
  });
  t.after(() => publisher.stop());
  const paints = () => log.filter(e => e.deviceId === "desk" && e.type === 102);
  const hueDegrees = paint => Math.round(decodeColor(paint.payload).hue * 360 / 65535);
  await o.ingest(hook("UserPromptSubmit", "s", "t1"));
  await o.ingest(hook("Stop", "s", "t1"));
  offsetMs = 6 * 60_000;
  const aged = await o.snapshot();
  assert.ok(aged.sessions.length > 0 && aged.sessions.every(s => s.freshness === "uncertain"), "the finished turn is idle past five minutes");
  await setMode(controller, "desk", "Work");
  await publisher.whenIdle();
  await flush();
  assert.equal(paints().length, 1, "Work entry paints the unacknowledged done state despite uncertain freshness");
  assert.ok(hueDegrees(paints()[0]) >= 120 && hueDegrees(paints()[0]) <= 150, "done paints green");
  await o.ingest(hook("UserPromptSubmit", "s", "t2"));
  await publisher.update();
  await flush();
  assert.equal(paints().length, 2, "the next transition paints again");
  assert.ok(hueDegrees(paints()[1]) >= 200 && hueDegrees(paints()[1]) <= 230, "working paints blue");
  controller.close();
});

test("offline bulb: one bulb failing never blocks the other, and the failed paint is not replayed on an unchanged state", async t => {
  const bulbs = [{ deviceId: "desk", address: "192.0.2.10", ...evidence }, { deviceId: "lamp", address: "192.0.2.11", ...evidence }];
  const { owner: o, controller, publisher, paints } = await setup(t, { bulbs, failFor: new Set(["lamp"]) });
  await setMode(controller, "desk", "Work");
  await setMode(controller, "lamp", "Work");
  await publisher.whenIdle();
  await flush();
  assert.equal(paints("desk").length, 1);
  assert.equal(paints("lamp").length, 1, "lamp's paint was attempted once despite failing");
  await publisher.update(); // same idle state again
  await flush();
  assert.equal(paints("desk").length, 1);
  assert.equal(paints("lamp").length, 1, "the failed paint is not replayed on an unchanged state");
  await o.ingest(hook("UserPromptSubmit", "s", "t1")); // a real transition repaints both, including the one that failed before
  await publisher.update();
  await flush();
  assert.equal(paints("desk").length, 2);
  assert.equal(paints("lamp").length, 2);
});

test("modes: Free never paints; Work paints the current state once on entry; a bulb with no recorded mode starts Free", async t => {
  const { owner: o, controller, publisher, paints } = await setup(t);
  await o.ingest(approval("s", "t1"));
  await publisher.update();
  await flush();
  assert.equal(paints("desk").length, 0, "no recorded mode means Free, which never paints");
  await setMode(controller, "desk", "Work");
  await publisher.whenIdle();
  await flush();
  assert.equal(paints("desk").length, 1, "entering Work paints the current state once");
  await setMode(controller, "desk", "Free");
  await publisher.whenIdle();
  await flush();
  assert.equal(paints("desk").length, 1, "entering Free paints nothing");
  await o.ingest(hook("Stop", "s", "t1")); // a real transition, but Free never paints
  await publisher.update();
  await flush();
  assert.equal(paints("desk").length, 1);
  await setMode(controller, "desk", "Work");
  await publisher.whenIdle();
  await flush();
  assert.equal(paints("desk").length, 2, "returning to Work paints the current state once more");
});

test("a mode persists across a restart of the controller, through its own state directory", async t => {
  const modeRoot = tempRoot(t);
  const bulbs = [{ deviceId: "desk", address: "192.0.2.10", ...evidence }];
  const a = fakeLifx(bulbs, { modeRoot });
  await setMode(a.controller, "desk", "Quiet");
  a.controller.close();
  const b = fakeLifx(bulbs, { modeRoot });
  assert.deepEqual(b.controller.snapshot("desk").controller.state.desired.mode, { status: "known", value: "Quiet" });
  b.controller.close();
});

test("stop halts scheduling: no further evaluation runs, even if update is called again", async t => {
  const { controller, publisher, paints } = await setup(t);
  await setMode(controller, "desk", "Work");
  await publisher.whenIdle();
  await flush();
  assert.equal(paints("desk").length, 1);
  publisher.stop();
  await publisher.update();
  await flush();
  assert.equal(paints("desk").length, 1, "stop prevents any further evaluation");
});
