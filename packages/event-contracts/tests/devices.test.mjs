// The 2.0 device families (Hub #918): the device record, the general commands, the capability rule and the Hub-mode
// table, against the shared fixtures.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {MessageValidator, errorCodes} from '../dist/v2/index.js';
import {registerCoreFamilies} from '../dist/v2/families.js';
import {HUB_MODE_TABLE, commandSupported, deviceFamilies, nativeMode, registerDeviceFamilies} from '../dist/v2/devices.js';
import {familyOf} from './consumer.mjs';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/v2/devices.json', import.meta.url), 'utf8'));
const core = JSON.parse(readFileSync(new URL('../fixtures/v2/families.json', import.meta.url), 'utf8'));
const validator = () => {
  const v = new MessageValidator();
  registerCoreFamilies(v);
  registerDeviceFamilies(v);
  return v;
};
// Sets each JSON pointer on a copy of a valid message; null removes the member.
function patched(base, set) {
  const value = structuredClone(fixtures.valid[base]);
  for (const [pointer, change] of Object.entries(set)) {
    const path = pointer.slice(1).split('/');
    const last = path.pop();
    const parent = path.reduce((node, part) => node[part], value);
    if (change === null) delete parent[last];
    else parent[last] = change;
  }
  return value;
}
const devices = () => Object.values(fixtures.valid).filter(message => familyOf(message) === 'device').map(message => message.data);
const device = id => devices().find(record => record.id === id);
const commands = () => Object.values(fixtures.valid).filter(message => message.kind === 'command');

test('every valid fixture passes, and every device family has one, with a reply and an outcome for each command family', () => {
  const v = validator();
  const families = new Set(), kinds = new Set();
  for (const [name, message] of Object.entries(fixtures.valid)) {
    const result = v.validate(message, {nowMs: Date.parse(message.time)});
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.error)}`);
    families.add(familyOf(message));
    kinds.add(message.kind);
  }
  assert.deepEqual(deviceFamilies.map(({family}) => family).filter(family => !families.has(family)), []);
  assert.deepEqual([...kinds].sort(), ['command', 'outcome', 'removal', 'reply', 'state']);
  for (const {family, kind, type} of deviceFamilies.filter(each => each.kind === 'command')) {
    const verb = type.replace(/\.requested$/, '');
    for (const answer of ['replied', 'completed']) {
      assert.ok(Object.values(fixtures.valid).some(message => message.type === `${verb}.${answer}`), `${family}: ${kind} ${answer}`);
    }
  }
});

test('every invalid fixture fails where it says, with its registry code', () => {
  const v = validator();
  for (const {name, base, set, expect, detail} of fixtures.invalid) {
    const message = patched(base, set);
    const result = v.validate(message, {nowMs: Date.parse(message.time)});
    assert.equal(result.ok, false, name);
    assert.deepEqual([result.error.code, result.error.detail], [expect, detail], name);
    assert.equal(result.error.retryable, errorCodes[expect].retryable);
  }
});

test('each device family has one kind and one type, named after the family, and its schema is built from the shared blocks', () => {
  const v = validator();
  const refs = schema => [...JSON.stringify(schema).matchAll(/"\$ref":"(https:[^"#]+)/g)].map(match => match[1]);
  const profile = uri => uri.endsWith('/blocks/2.0') || uri.endsWith('/kinds/2.0');
  const known = uri => deviceFamilies.some(family => family.dataschema === uri) || uri.endsWith('/session/2.0');
  const usesBlocks = schema => refs(schema).some(uri => uri.endsWith('/blocks/2.0') ||
    usesBlocks(deviceFamilies.find(family => family.dataschema === uri)?.schema ?? {}));
  const types = new Set();
  for (const {family, kind, type, dataschema, schema} of deviceFamilies) {
    assert.equal(schema.$id, dataschema, family);
    assert.equal(dataschema, `https://bunny.invalid/events/${family}/2.0`);
    assert.ok(usesBlocks(schema), `${family} uses the blocks`);
    for (const uri of refs(schema)) assert.ok(profile(uri) || known(uri), `${family}: ${uri}`);
    // org.bunny.<entity>.<verb>.requested: the family's last hyphenated word is the verb, as for mode-set and moment-play.
    const expected = kind === 'state' ? `org.bunny.${family}.updated` : `org.bunny.${family.replace(/-([a-z]+)$/, '.$1')}.requested`;
    assert.equal(type, expected, family);
    assert.ok(!types.has(type), `${type} belongs to one family`);
    types.add(type);
  }
  assert.deepEqual(deviceFamilies.map(({family}) => family),
    ['device', 'power-set', 'brightness-set', 'scene-activate', 'zone-power-set', 'media-start', 'media-control', 'device-mode-set']);
  assert.throws(() => registerDeviceFamilies(v), /already registered/);
  assert.throws(() => registerDeviceFamilies(new MessageValidator()), /session\/2\.0/, 'the device label uses the session display text');
});

test('each command is supported by its target device, and the capability rule refuses the rest', () => {
  for (const message of commands()) {
    const target = device(message.subject);
    assert.ok(target, `${message.id} targets a device fixture`);
    assert.equal(commandSupported(target.capabilities, {family: familyOf(message), data: message.data}), true, message.id);
  }
  const wall = device('wall'), pixoo = device('pixoo-desk'), beam = device('beam-1');
  const refused = [
    [beam.capabilities, 'scene-activate', {sceneId: 'scene-sunrise'}, 'no scenes'],
    [wall.capabilities, 'scene-activate', {sceneId: 'scene-ocean'}, 'a scene the device does not list'],
    [wall.capabilities, 'zone-power-set', {zoneId: 'zone-1', on: true}, 'no zones'],
    [beam.capabilities, 'zone-power-set', {zoneId: 'zone-3', on: true}, 'a zone the device does not list'],
    [wall.capabilities, 'media-start', {playlistId: 'playlist-1'}, 'no media'],
    [pixoo.capabilities, 'media-start', {playlistId: 'playlist-2'}, 'a playlist the device does not list'],
    [{...pixoo.capabilities, media: {...pixoo.capabilities.media, actions: ['pause']}}, 'media-control', {action: 'clear'}, 'an action the device does not list'],
    [beam.capabilities, 'device-mode-set', {mode: 'work'}, 'no native modes'],
    [pixoo.capabilities, 'device-mode-set', {mode: 'work'}, 'the Hub mode name, which Pixoo does not advertise'],
    [{...wall.capabilities, power: {supported: false}}, 'power-set', {on: true}, 'no power control'],
    [{...wall.capabilities, brightness: {supported: false}}, 'brightness-set', {percent: 10}, 'no brightness control'],
  ];
  for (const [capabilities, family, data, why] of refused) {
    assert.equal(commandSupported(capabilities, {family, data: {requestId: 'req-1', ...data}}), false, `${family}: ${why}`);
  }
  const moment = core.valid['moment-play'].data;
  assert.equal(commandSupported(pixoo.capabilities, {family: 'moment-play', data: {...moment, mood: 'celebrate', durationMs: 60000}}), true);
  assert.equal(commandSupported(pixoo.capabilities, {family: 'moment-play', data: {...moment, mood: 'party', durationMs: 20000}}), false, 'an undeclared mood');
  assert.equal(commandSupported(pixoo.capabilities, {family: 'moment-play', data: {...moment, mood: 'celebrate', durationMs: 60001}}), false, 'over the device limit');
  assert.equal(commandSupported(wall.capabilities, {family: 'moment-play', data: {...moment, mood: 'celebrate', durationMs: 20000}}), false, 'no moments');
});

// The table in README.md "Hub-mode table" (Hub #695's settled decisions, applied by #918).
function readmeTable() {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const section = readme.split(/^#+ /m).find(part => part.startsWith('Hub-mode table'));
  assert.ok(section, 'README.md has a Hub-mode table section');
  const rows = section.split('\n').filter(line => line.startsWith('| `')).map(line => line.split('|').slice(1, -1).map(cell => cell.trim().replace(/`/g, '')));
  const kinds = section.split('\n').find(line => line.startsWith('| Hub mode')).split('|').slice(2, -1).map(cell => cell.trim().toLowerCase());
  return Object.fromEntries(kinds.map((kind, column) => [kind, Object.fromEntries(rows.map(row => [row[0], row[column + 1]]))]));
}

test('the README Hub-mode table is the one the code applies', () => {
  assert.deepEqual(readmeTable(), HUB_MODE_TABLE);
  assert.deepEqual(Object.keys(HUB_MODE_TABLE).sort(), ['nanoleaf', 'pixoo'], 'only Nanoleaf and Pixoo participate');
});

test('Nanoleaf maps the Hub modes one to one, and the wall advertises each of them', () => {
  const wall = device('wall');
  assert.equal(wall.kind, 'nanoleaf');
  assert.deepEqual(['work', 'free', 'quiet'].map(mode => nativeMode('nanoleaf', mode)), ['work', 'free', 'quiet']);
  for (const mode of ['work', 'free', 'quiet']) {
    assert.equal(commandSupported(wall.capabilities, {family: 'device-mode-set', data: {requestId: 'req-1', mode: nativeMode('nanoleaf', mode)}}), true, mode);
  }
});

test('Pixoo maps Work and Quiet to Monitor and Free to Media, and advertises only its own modes', () => {
  const pixoo = device('pixoo-desk');
  assert.equal(pixoo.kind, 'pixoo');
  assert.deepEqual(['work', 'free', 'quiet'].map(mode => nativeMode('pixoo', mode)), ['monitor', 'media', 'monitor']);
  for (const mode of ['work', 'free', 'quiet']) {
    assert.equal(commandSupported(pixoo.capabilities, {family: 'device-mode-set', data: {requestId: 'req-1', mode: nativeMode('pixoo', mode)}}), true, mode);
    assert.equal(commandSupported(pixoo.capabilities, {family: 'device-mode-set', data: {requestId: 'req-1', mode}}), false,
      `the Hub's ${mode} is not a Pixoo mode`);
  }
});

test('LIFX, Tidbyt and playback do not take part in the Hub mode', () => {
  for (const kind of ['lifx', 'tidbyt', 'playback', 'unknown-kind']) {
    for (const mode of ['work', 'free', 'quiet']) assert.equal(nativeMode(kind, mode), undefined, `${kind} ${mode}`);
  }
});

test('a device mode is never stored as the Hub mode', () => {
  // Pixoo's Monitor serves both Work and Quiet, so a Monitor observation cannot say which Hub mode was chosen.
  assert.equal(nativeMode('pixoo', 'work'), nativeMode('pixoo', 'quiet'));
  const v = validator();
  for (const native of ['monitor', 'media']) {
    const record = structuredClone(core.valid.mode);
    record.data.mode = native;
    const stored = v.validate(record);
    assert.deepEqual([stored.ok, stored.error?.detail], [false, 'payload /mode enum'], native);
  }
  // The device record keeps its own desired mode; the Hub's selection lives only in mode/2.0.
  assert.equal(Object.hasOwn(device('pixoo-desk'), 'hubMode'), false);
});

test('every one of the eight capabilities is required, so none can go missing', () => {
  const v = validator();
  const {schema} = deviceFamilies.find(({family}) => family === 'device');
  const required = schema.$defs.capabilities.required;
  assert.deepEqual([...required].sort(), ['brightness', 'media', 'moments', 'modes', 'power', 'preview', 'scenes', 'zones']);
  for (const capability of required) {
    const message = patched('device-nanoleaf', {[`/data/capabilities/${capability}`]: null});
    assert.deepEqual(v.validate(message).error, {code: 'invalid-message', retryable: false, detail: `payload /capabilities required ${capability}`}, capability);
  }
});

// A device or playback ID is also the last token of its SDK routing keys: lowercase letters and digits, single hyphens.
const UNROUTABLE = {'a dot': 'office.wall', 'an uppercase letter': 'Wall', 'an underscore': 'office_wall', '129 characters': 'a'.repeat(129)};

test('every command family refuses a subject that is not a routing-key token', () => {
  const v = validator();
  const bases = [
    ...deviceFamilies.filter(({kind}) => kind === 'command').map(({family}) => [family, fixtures.valid[family], 'device']),
    ['moment-play', core.valid['moment-play'], 'device'],
    ['playback-control', core.valid['playback-control'], 'routing'],
  ];
  assert.equal(bases.length, 9);
  for (const [family, base, what] of bases) {
    assert.equal(v.validate(base).ok, true, family);
    for (const [why, subject] of Object.entries(UNROUTABLE)) {
      const result = v.validate({...structuredClone(base), subject});
      assert.deepEqual(result.error, {code: 'invalid-message', retryable: false, detail: `envelope /subject not a ${what} id`}, `${family}: ${why}`);
    }
  }
});

test('a device ID with any other character, or over 128 characters, is refused', () => {
  const v = validator();
  for (const [why, id] of Object.entries(UNROUTABLE)) {
    const result = v.validate(patched('device-nanoleaf', {'/data/id': id, '/subject': id}));
    assert.equal(result.error?.detail, id.length > 128 ? 'payload /id maxLength' : 'payload /id pattern', why);
  }
  assert.equal(v.validate(patched('device-nanoleaf', {'/data/id': 'a'.repeat(128), '/subject': 'a'.repeat(128)})).ok, true, '128 characters');
});

test('the last transmission and the pending kinds stay apart from observations and outcomes', () => {
  const wall = device('wall'), beam = device('beam-1'), pixoo = device('pixoo-desk');
  // A command's send carries its request ID; a module-internal paint, which the tracker never sees, carries none.
  assert.equal(wall.lastTransmission.requestId, wall.lastOutcome.outcome.requestId);
  assert.equal(Object.hasOwn(beam.lastTransmission, 'requestId'), false);
  assert.ok(beam.lastTransmission.transmittedAtMs > beam.observed.observedAtMs, 'a send after the last reading is no observation');
  assert.equal(pixoo.lastTransmission.status, 'unknown');
  for (const record of devices()) {
    assert.equal(record.pendingKinds.length > 0, record.pending > 0, record.id);
    assert.ok(record.pendingKinds.length <= record.pending, record.id);
  }
});
