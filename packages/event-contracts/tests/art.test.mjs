// The exact-artwork handoff (Hub #679): the art families, moment-play/2.1, device/2.2 and the private-copy rule, against
// the real validators and fake device consumers. No device, model or runtime takes part. The runtime's own refusals are
// in apps/runtime/tests/art-handoff.test.ts.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {MessageValidator} from '../dist/v2/index.js';
import {artStageSupported, commandSupported, deviceFamilies, registerDeviceFamilies} from '../dist/v2/devices.js';
import {coreFamilies, registerCoreFamilies} from '../dist/v2/families.js';
import {
  ART_MODULE_SOURCE, ART_SUBJECT, MAX_ART_BYTES, artFamilies, artReferenceRefusal, artSchemas, artStageDecision, registerArtFamilies,
} from '../dist/v2/art.js';

const families = JSON.parse(readFileSync(new URL('../fixtures/v2/families.json', import.meta.url), 'utf8'));
const devices = JSON.parse(readFileSync(new URL('../fixtures/v2/devices.json', import.meta.url), 'utf8'));
const validator = new MessageValidator();
registerCoreFamilies(validator);
registerDeviceFamilies(validator);
const family = name => structuredClone(families.valid[name]);
const withData = (name, data) => ({...family(name), data});
const atTime = message => ({nowMs: Date.parse(message.time)});
const valid = message => {
  const result = validator.validate(message, atTime(message));
  assert.equal(result.ok, true, JSON.stringify(result.error));
};
const invalid = (message, detail) => {
  const result = validator.validate(message, atTime(message));
  assert.equal(result.ok, false, `refused: ${detail ?? JSON.stringify(message.data).slice(0, 200)}`);
  if (detail !== undefined) assert.match(result.error.detail, detail);
};
const stageBody = () => family('art-stage').data;
const withoutRequestId = ({requestId: _requestId, ...content}) => content;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
/** A stage of `bytes`, its hash and encoding right, in place of the fixture's. */
const stageOf = (bytes, changed = {}) => ({...stageBody(), sha256: sha256(bytes), base64: bytes.toString('base64'), ...changed});
const fixtureBytes = () => Buffer.from(stageBody().base64, 'base64');
/** A header-valid PNG of exactly `size` bytes. */
const pngOf = size => Buffer.concat([fixtureBytes(), Buffer.alloc(size - fixtureBytes().length)]);
/** A header-valid GIF of 64 by 64. */
const gif = (version = 'GIF89a', width = 64, height = 64) => {
  const screen = Buffer.alloc(7); screen.writeUInt16LE(width, 0); screen.writeUInt16LE(height, 2);
  return Buffer.concat([Buffer.from(version, 'ascii'), screen, Buffer.from([0x3b])]);
};
const device = id => Object.values(devices.valid).find(message => message.kind === 'state' && message.data.id === id && message.dataschema.endsWith('/2.2'))?.data;
const momentOf = art => ({...family('moment-play').data, ...(art === undefined ? {} : {art})});
const COMPOSITION = 'a'.repeat(64);
const MINUTE = 60_000;

test('each art family keeps one kind and the type the gateway derives from its name', () => {
  assert.deepEqual(artFamilies.map(({family: name, kind, type, dataschema}) => [name, kind, type, dataschema.replace('https://bunny.invalid/events/', '')]), [
    ['art-request', 'command', 'org.bunny.art.request.requested', 'art-request/2.0'],
    ['art-auto', 'command', 'org.bunny.art.auto.requested', 'art-auto/2.0'],
    ['art-stage', 'command', 'org.bunny.art.stage.requested', 'art-stage/2.0'],
    ['art-ambient-set', 'command', 'org.bunny.art-ambient.set.requested', 'art-ambient-set/2.0'],
    ['art-dispatch', 'command', 'org.bunny.art.dispatch.requested', 'art-dispatch/2.0'],
  ]);
  for (const {family: name, type} of artFamilies) {
    const verb = name.lastIndexOf('-');
    assert.equal(type, `org.bunny.${name.slice(0, verb)}.${name.slice(verb + 1)}.requested`, name);
    assert.ok(coreFamilies.some(each => each.family === name), `${name} is a core family, so the core's validator knows it`);
    valid(family(name));
    invalid({...family(name), type: 'org.bunny.other.thing.requested'}, /uses/);
  }
  assert.deepEqual(Object.keys(artSchemas).sort(), artFamilies.map(({dataschema}) => dataschema).sort());
  assert.equal(ART_MODULE_SOURCE, 'bunny/modules/art');
  assert.equal(ART_SUBJECT, 'art');
  const own = new MessageValidator();
  registerArtFamilies(own);
  assert.equal(own.validate(family('art-stage'), atTime(family('art-stage'))).ok, true, 'the art families register on their own');
});

test('art families carry no location, path or credential: every payload is closed', () => {
  for (const name of artFamilies.map(each => each.family)) {
    const base = family(name);
    for (const member of ['location', 'path', 'token', 'url']) invalid({...base, data: {...base.data, [member]: 'private'}}, /additionalProperties|oneOf|unevaluated/);
  }
  const start = family('art-request').data;
  for (const context of [{location: 'home'}, {weather: 'rain in /home/owner'}, {weather: 'x'.repeat(65)}, {time: 'lunchtime'}, {season: 'monsoon'}]) {
    invalid(withData('art-request', {...start, context}), undefined);
  }
  invalid(withData('art-request', {...start, origin: {kind: 'owner', reference: '/private/path'}}));
  invalid(withData('art-request', {...start, origin: {kind: 'owner', address: 'x'}}));
});

test('art-request starts a bounded job or cancels one, and a cancel carries nothing else', () => {
  const start = family('art-request').data;
  for (const changed of [{purpose: 'ambient'}, {purpose: 'appearance'}, {text: 'x'.repeat(2000)}, {context: {}}, {context: {time: 'evening', season: 'autumn', weather: 'cold rain'}}]) {
    valid(withData('art-request', {...start, ...changed}));
  }
  const {text: _text, context: _context, ...untyped} = start;
  valid(withData('art-request', untyped));
  for (const changed of [{text: ''}, {text: '   '}, {text: 'x'.repeat(2001)}, {text: '\ud83d'}, {targets: []}, {targets: ['ui', 'ui']}, {targets: ['lamp']},
    {purpose: 'surprise'}, {origin: {kind: 'stranger'}}, {variationOf: 'art-1'}, {purpose: 'variation'}]) {
    invalid(withData('art-request', {...start, ...changed}));
  }
  valid(withData('art-request', {...start, purpose: 'variation', variationOf: 'art-1'}));
  valid(withData('art-request', {requestId: 'cancel-1', action: 'cancel', jobRequestId: 'req-art-1'}));
  invalid(withData('art-request', {requestId: 'cancel-1', action: 'cancel'}));
  invalid(withData('art-request', {requestId: 'cancel-1', action: 'cancel', jobRequestId: 'req-art-1', text: 'more work'}));
  invalid({...family('art-request'), subject: 'tidbyt'}, /subject/);
});

test('art-auto starts or cancels an automatic job; an owner label still validates, because the family decides, and it has no typed text', () => {
  const start = family('art-auto').data;
  valid(withData('art-auto', {...start, origin: {kind: 'owner'}, purpose: 'request'}));
  invalid(withData('art-auto', {...start, text: 'typed by no one'}));
  valid(withData('art-auto', {requestId: 'cancel-2', action: 'cancel', jobRequestId: 'req-auto-1'}));
  invalid(withData('art-auto', {requestId: 'cancel-2', action: 'cancel'}));
  invalid({...family('art-auto'), subject: 'tidbyt'}, /subject/);
});

test('a stage admits PNG and GIF up to 160 KiB decoded, inside the message cap, and its bytes must be what it says', () => {
  assert.equal(MAX_ART_BYTES, 160 * 1024);
  const largest = withData('art-stage', stageOf(pngOf(MAX_ART_BYTES)));
  valid(largest);
  assert.ok(Buffer.byteLength(JSON.stringify(largest)) < 256 * 1024, 'the largest stage fits the 256 KiB message cap');
  const dispatched = {...family('art-dispatch'), data: {requestId: 'req-big', family: 'art-stage', target: 'pixoo-desk', data: withoutRequestId(stageOf(pngOf(MAX_ART_BYTES)))}};
  valid(dispatched);
  assert.ok(Buffer.byteLength(JSON.stringify(dispatched)) < 256 * 1024, 'and so does its dispatch');
  invalid(withData('art-stage', stageOf(pngOf(MAX_ART_BYTES + 1))));

  const animated = stageOf(gif(), {format: 'gif', width: 64, height: 64, frames: 6, durationMs: 1200});
  valid(withData('art-stage', animated));
  valid(withData('art-stage', stageOf(gif('GIF87a'), {format: 'gif', width: 64, height: 64, frames: 1, durationMs: 0})));

  const bytes = stageBody();
  for (const [changed, why] of [
    [{sha256: 'b'.repeat(64)}, /sha256/],
    [{base64: `${bytes.base64}=`}, /base64/],
    [{base64: `${bytes.base64.slice(0, -1)}@`}, /base64/],
    [{width: bytes.width + 1}, /dimensions/],
    [{height: bytes.height + 1}, /dimensions/],
    [{format: 'gif'}, /format|dimensions/],
    [stageOf(gif(), {format: 'png'}), /format/],
    [stageOf(gif('GIF89a', 32, 64), {format: 'gif', frames: 2, durationMs: 200}), /dimensions/],
    [stageOf(Buffer.from('not an image at all, only text.........')), /format/],
    [stageOf(gif(), {format: 'gif', width: 64, height: 64, frames: 2, durationMs: 0}), /durationMs/],
  ]) invalid(withData('art-stage', {...bytes, ...changed}), why);
  for (const changed of [{format: 'webp'}, {frames: 2}, {durationMs: 100}, {frames: 0}, {width: 0}, {height: 513}, {lifetimeMs: 59_999}, {lifetimeMs: 2_592_000_001},
    {compositionId: 'art-1'}, {compositionId: 'A'.repeat(64)}, {sha256: 'abc'}]) {
    invalid(withData('art-stage', {...bytes, ...changed}));
  }
  for (const required of ['compositionId', 'format', 'width', 'height', 'frames', 'durationMs', 'sha256', 'base64', 'lifetimeMs']) {
    const {[required]: _gone, ...rest} = bytes;
    invalid(withData('art-stage', rest), new RegExp(required));
  }
  invalid({...family('art-stage'), subject: 'Not A Device'}, /subject/);
});

test('an ambient set names a composition or clears it, for one device', () => {
  const base = family('art-ambient-set').data;
  valid(withData('art-ambient-set', {...base, compositionId: COMPOSITION}));
  valid(withData('art-ambient-set', {...base, compositionId: null}));
  invalid(withData('art-ambient-set', {requestId: base.requestId}), /compositionId/);
  invalid(withData('art-ambient-set', {...base, compositionId: 'short'}));
  invalid({...family('art-ambient-set'), subject: 'Bad Subject'}, /subject/);
});

test('a dispatch forwards only art-stage and art-ambient-set, to one device: never a moment', () => {
  const base = family('art-dispatch').data;
  valid(withData('art-dispatch', {requestId: 'req-ambient', family: 'art-ambient-set', target: 'tidbyt', data: {compositionId: COMPOSITION}}));
  valid(withData('art-dispatch', {requestId: 'req-ambient', family: 'art-ambient-set', target: 'tidbyt', data: {compositionId: null}}));
  const moment = momentOf({compositionId: COMPOSITION});
  invalid(withData('art-dispatch', {...base, family: 'moment-play', data: moment}));
  invalid(withData('art-dispatch', {...base, family: 'art-auto'}));
  invalid(withData('art-dispatch', {...base, family: 'art-ambient-set'}), undefined);
  invalid(withData('art-dispatch', {...base, target: 'Not A Device'}));
  invalid(withData('art-dispatch', {...base, data: {...base.data, requestId: 'inner'}}));
  invalid(withData('art-dispatch', {...base, data: {...base.data, sha256: 'b'.repeat(64)}}), /sha256/);
  invalid({...family('art-dispatch'), subject: 'tidbyt'}, /subject/);
});

test('moment-play/2.1 adds an optional exact reference, and moment-play/2.0 keeps refusing one', () => {
  const v21 = 'https://bunny.invalid/events/moment-play/2.1', moment = family('moment-play');
  assert.equal(moment.dataschema, 'https://bunny.invalid/events/moment-play/2.0');
  valid(moment);
  invalid({...moment, data: momentOf({compositionId: COMPOSITION})}, /additionalProperties art/);
  valid({...moment, dataschema: v21});
  valid({...moment, dataschema: v21, data: momentOf({compositionId: COMPOSITION})});
  for (const art of [{}, {compositionId: 'x'}, {compositionId: COMPOSITION, url: 'https://example.invalid/a.png'}, {compositionId: COMPOSITION, renditionId: 'native'}]) {
    invalid({...moment, dataschema: v21, data: momentOf(art)});
  }
  invalid({...moment, dataschema: v21, subject: 'Not A Device'}, /subject/);
  invalid({...moment, dataschema: v21, data: {...moment.data, startAtMs: Date.parse(moment.time) + 60_001}}, /startAtMs/);
  const {schema: older} = coreFamilies.find(({dataschema}) => dataschema.endsWith('/moment-play/2.0'));
  const {schema: newer} = coreFamilies.find(({dataschema}) => dataschema === v21);
  const without = schema => ({...schema, $id: undefined, description: undefined});
  const {art, ...properties} = newer.properties;
  assert.ok(art);
  assert.deepEqual(without({...newer, properties}), without(older), '2.1 is 2.0 plus art');
});

test('device/2.2 is device/2.1 plus optional moments.art, and earlier versions refuse it', () => {
  const schemaOf = version => deviceFamilies.find(({dataschema}) => dataschema.endsWith(`/device/${version}`))?.schema;
  const [older, newer] = [schemaOf('2.1'), schemaOf('2.2')];
  assert.ok(older && newer);
  const copy = structuredClone(newer), branch = copy.$defs.capabilities.properties.moments.oneOf[1];
  assert.ok(branch.properties.art);
  assert.equal(branch.required.includes('art'), false);
  delete branch.properties.art;
  const without = schema => ({...schema, $id: undefined, description: undefined});
  assert.deepEqual(without(copy), without(older));

  const message = structuredClone(Object.values(devices.valid).find(each => each.dataschema.endsWith('/device/2.2')));
  assert.ok(message, 'a device/2.2 fixture exists');
  valid(message);
  for (const earlier of ['2.0', '2.1']) invalid({...message, dataschema: `https://bunny.invalid/events/device/${earlier}`});
  const {art} = message.data.capabilities.moments;
  for (const changed of [{formats: []}, {formats: ['webp']}, {formats: ['png', 'png']}, {maxBytes: 0}, {maxBytes: MAX_ART_BYTES + 1}, {formats: ['png']}]) {
    const bad = structuredClone(message);
    bad.data.capabilities.moments.art = changed.formats?.length === 1 && changed.formats[0] === 'png' ? {formats: ['png']} : {...art, ...changed};
    invalid(bad);
  }
  for (const earlier of Object.values(devices.valid).filter(each => /\/device\/2\.[01]$/.test(each.dataschema))) {
    valid({...structuredClone(earlier), dataschema: 'https://bunny.invalid/events/device/2.2'});
  }
});

test('commandSupported refuses a moment with art for a device that does not declare it, so the mood never plays instead', () => {
  const declared = device('pixoo-art'), {capabilities} = declared;
  const {art: _art, ...moments} = capabilities.moments, without = {...capabilities, moments};
  const moment = {family: 'moment-play', data: {...momentOf(), mood: 'celebrate', durationMs: 8000}};
  const withArt = {...moment, data: {...moment.data, art: {compositionId: COMPOSITION}}};
  assert.equal(commandSupported(without, moment), true, 'a moment without art is unchanged');
  assert.equal(commandSupported(capabilities, moment), true);
  assert.equal(commandSupported(without, withArt), false, 'no moments.art');
  assert.equal(commandSupported(capabilities, withArt), true);
  assert.equal(commandSupported({...capabilities, moments: {supported: false}}, withArt), false);
  assert.equal(commandSupported(devices.valid['device-pixoo'].data.capabilities, withArt), false, 'a released device/2.0 record has no moments.art');
});

test('artStageSupported holds a stage to the format and size the device declares', () => {
  const {capabilities} = device('pixoo-art');
  const stage = stageBody();
  assert.equal(artStageSupported(capabilities, stage), true);
  const narrow = extra => ({...capabilities, moments: {...capabilities.moments, art: {...capabilities.moments.art, ...extra}}});
  assert.equal(artStageSupported(narrow({formats: ['gif']}), stage), false, 'an undeclared format');
  const size = Buffer.from(stageBody().base64, 'base64').length;
  assert.equal(artStageSupported(narrow({maxBytes: size}), stage), true, 'exactly the maximum');
  assert.equal(artStageSupported(narrow({maxBytes: size - 1}), stage), false, 'over the maximum');
  assert.equal(artStageSupported(devices.valid['device-nanoleaf'].data.capabilities, stage), false, 'no moments.art');
});

// A fake device: the real validator, the real capability rule and the real copy rules, with a counted transport. It
// keeps its copy for a moment under way, so neither deletion nor expiry can take media from an in-flight moment.
function fakeDevice(capabilities, clock) {
  const copies = new Map(), transport = [], playing = new Map(), v = new MessageValidator();
  registerCoreFamilies(v); registerDeviceFamilies(v);
  const admit = message => {
    const checked = v.validate(message, {nowMs: Date.parse(message.time)});
    if (!checked.ok) return {error: checked.error};
    const supported = message.type === 'org.bunny.art.stage.requested' ? artStageSupported(capabilities, message.data)
      : commandSupported(capabilities, {family: 'moment-play', data: message.data});
    return supported ? undefined : {error: {code: 'unsupported-capability'}};
  };
  return {
    copies, transport, playing,
    stage(message) {
      const refused = admit(message);
      if (refused !== undefined) return refused;
      const decision = artStageDecision(copies.get(message.data.compositionId), message.data, clock());
      if ('error' in decision) return decision;
      copies.set(message.data.compositionId, decision.copy);
      return decision;
    },
    play(message) {
      const refused = admit(message);
      if (refused !== undefined) return refused;
      const {compositionId} = message.data.art;
      const reference = artReferenceRefusal(copies.get(compositionId), clock());
      if (reference !== undefined) return reference;
      playing.set(message.data.momentId, copies.get(compositionId));
      transport.push(['show', compositionId]);
      return {status: 'accepted'};
    },
    expire() {
      for (const [id, copy] of copies) if (copy.expiresAtMs <= clock()) copies.delete(id);
    },
  };
}
const worldOf = () => {
  let now = Date.parse(family('art-stage').time);
  return {clock: () => now, advance: ms => { now += ms; }, at: () => new Date(now).toISOString()};
};
const stageMessage = (world, data = stageBody()) => ({...family('art-stage'), time: world.at(), expiresat: new Date(world.clock() + 5000).toISOString(), data});
const playMessage = (world, compositionId) => ({...family('moment-play'), dataschema: 'https://bunny.invalid/events/moment-play/2.1', subject: 'pixoo-art', time: world.at(),
  expiresat: new Date(world.clock() + 5000).toISOString(),
  data: {...family('moment-play').data, mood: 'celebrate', durationMs: 8000, startAtMs: world.clock(), art: {compositionId}}});

test('a consumer refuses an unknown, expired or incompatible reference before its transport', () => {
  const world = worldOf(), fake = fakeDevice(device('pixoo-art').capabilities, world.clock), stage = stageBody();
  assert.equal(fake.play(playMessage(world, COMPOSITION)).error.code, 'not-found', 'unknown');
  assert.deepEqual(fake.transport, []);

  assert.equal('copy' in fake.stage(stageMessage(world)), true);
  assert.deepEqual(fake.play(playMessage(world, stage.compositionId)), {status: 'accepted'});
  assert.equal(fake.transport.length, 1);

  world.advance(stage.lifetimeMs);
  assert.equal(fake.play(playMessage(world, stage.compositionId)).error.code, 'expired', 'expired');
  assert.equal(fake.transport.length, 1, 'an expired reference reaches no transport');

  // A device with moments and no moments.art, as Nanoleaf's record is, plays neither a stage nor its mood in place of art.
  const moodOnly = fakeDevice(devices.valid['device-pixoo'].data.capabilities, world.clock);
  assert.equal(moodOnly.stage(stageMessage(world)).error.code, 'unsupported-capability', 'incompatible stage');
  assert.equal(moodOnly.play(playMessage(world, stage.compositionId)).error.code, 'unsupported-capability', 'incompatible moment');
  assert.deepEqual(moodOnly.transport, []);

  const before = fake.transport.length;
  const fresh = fakeDevice(device('pixoo-art').capabilities, world.clock);
  fresh.stage(stageMessage(world));
  const late = playMessage(world, stage.compositionId);
  assert.equal(fresh.play({...late, expiresat: late.time}).error.code, 'expired', 'an expired command');
  assert.deepEqual(fresh.transport, []);
  assert.equal(fake.transport.length, before);
});

test('staging the same ID and hash reuses the copy and renews its lifetime; the same ID with another hash is refused', () => {
  const world = worldOf(), fake = fakeDevice(device('pixoo-art').capabilities, world.clock), stage = stageBody();
  const first = fake.stage(stageMessage(world));
  assert.equal(first.action, 'store');
  assert.equal(first.copy.expiresAtMs, world.clock() + stage.lifetimeMs);
  world.advance(MINUTE);
  const again = fake.stage(stageMessage(world));
  assert.equal(again.action, 'reuse');
  assert.equal(again.copy.expiresAtMs, world.clock() + stage.lifetimeMs, 'renewed from now');

  const other = gif();
  const conflict = fake.stage(stageMessage(world, stageOf(other, {format: 'gif', width: 64, height: 64, frames: 1, durationMs: 0})));
  assert.equal(conflict.error.code, 'duplicate-conflict');
  assert.equal(fake.copies.get(stage.compositionId).sha256, stage.sha256, 'the held copy is unchanged');

  world.advance(stage.lifetimeMs);
  const replaced = fake.stage(stageMessage(world, stageOf(other, {format: 'gif', width: 64, height: 64, frames: 1, durationMs: 0})));
  assert.equal(replaced.action, 'store', 'an expired copy is no copy');
});

test('expiry cannot remove media from a moment under way, and a lost answer sends nothing again', () => {
  const world = worldOf(), fake = fakeDevice(device('pixoo-art').capabilities, world.clock), stage = stageBody();
  fake.stage(stageMessage(world));
  const message = playMessage(world, stage.compositionId);
  assert.deepEqual(fake.play(message), {status: 'accepted'});
  world.advance(stage.lifetimeMs);
  fake.expire();
  assert.equal(fake.copies.has(stage.compositionId), false, 'the store dropped the expired copy');
  assert.equal(fake.playing.get(message.data.momentId).sha256, stage.sha256, 'the moment keeps its own copy');
  assert.equal(fake.play(playMessage(world, stage.compositionId)).error.code, 'not-found', 'a later moment is refused truthfully');
  assert.equal(fake.transport.length, 1, 'no consumer step replays the first show');
});
