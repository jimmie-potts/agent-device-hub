// The module's section and the conversion of the old Hub's `host.json` `playback` block. The endpoint cases are copied
// from `apps/hub/tests/playback.test.mjs` at main 483d3a93 ("playback configuration needs one ID and one or two sources of
// distinct kinds at private addresses"). The Hub's start refused a bad block; here `configure` refuses the section, so
// the runtime refuses the module and runs the others.
import assert from 'node:assert/strict';
import {checkConfiguration} from '@jimmie-potts/sdk';
import {configurePlayback, convertHostPlayback, routingIdOf} from '../src/configuration.js';
import {createPlaybackModule} from '../src/module.js';
import {SimulatedSpeakers} from '../src/simulated.js';
import {test} from './support.js';

const sony = {kind: 'sony', endpoint: 'http://192.168.1.20:10000/sony'};
const sonos = {kind: 'sonos', endpoint: 'http://192.168.1.30:1400/MediaRenderer/AVTransport/Control'};
const accepted = (section: unknown): boolean => !('error' in configurePlayback(section));

/** The endpoint shapes both the Hub and the module refuse, for each kind. */
const BAD_SONY = [
  'https://192.168.1.20:10000/sony', 'http://8.8.8.8:10000/sony', 'http://172.32.0.1:10000/sony', 'http://soundbar.local:10000/sony',
  'http://192.168.1.20/sony', 'http://192.168.1.20:10000/sony/', 'http://192.168.1.20:10000/other', 'http://user:pw@192.168.1.20:10000/sony',
  'http://192.168.1.20:10000/sony?x=1', 'http://192.168.1.20:10000/sony#x', 'http://[::1]:10000/sony', 'not a url',
];
const BAD_SONOS = [
  'https://192.168.1.30:1400/MediaRenderer/AVTransport/Control', 'http://8.8.8.8:1400/MediaRenderer/AVTransport/Control',
  'http://move.local:1400/MediaRenderer/AVTransport/Control', 'http://192.168.1.30/MediaRenderer/AVTransport/Control', 'http://192.168.1.30:1400/',
  'http://192.168.1.30:1400/MediaRenderer/AVTransport/Event', 'http://192.168.1.30:1400/MediaRenderer/AVTransport/Control/',
  'http://user:pw@192.168.1.30:1400/MediaRenderer/AVTransport/Control', 'http://192.168.1.30:1400/MediaRenderer/AVTransport/Control?x=1',
  'http://192.168.1.30:1400/MediaRenderer/AVTransport/Control#x', 'not a url',
];

test('the section needs a routing ID and one or two speakers of distinct kinds at private addresses', () => {
  for (const endpoint of ['http://10.0.0.5:10000/sony', 'http://172.31.2.3:10000/sony', 'http://127.0.0.1:10000/sony']) {
    assert.equal(accepted({id: 'living-room', sources: [{...sony, endpoint}]}), true, endpoint);
  }
  for (const endpoint of ['http://10.0.0.5:1400/MediaRenderer/AVTransport/Control', 'http://127.0.0.1:1400/MediaRenderer/AVTransport/Control']) {
    assert.equal(accepted({id: 'living-room', sources: [{...sonos, endpoint}]}), true, endpoint);
  }
  for (const sources of [[sony], [sonos], [sonos, sony], [sony, sonos]]) {
    assert.deepEqual(configurePlayback({id: 'living-room', sources}), {config: {id: 'living-room', sources}, devices: ['living-room']}, JSON.stringify(sources));
  }
  assert.equal(accepted({id: 'living-room', sources: [sony], secrets: {token: '/nowhere/token'}}), true, 'a secrets member, which the runtime checks, is allowed');
  const invalid: unknown[] = [
    null, [], {id: 'living-room', sources: []}, {id: 'living-room', sources: [sony, sonos, sony]},
    {id: 'living-room', sources: [sony, {...sony, endpoint: 'http://192.168.1.21:10000/sony'}]},
    {id: 'living-room', sources: [sonos, {...sonos, endpoint: 'http://192.168.1.31:1400/MediaRenderer/AVTransport/Control'}]},
    {id: 'living-room', sources: [sony], extra: true}, {id: 'living-room', sources: [{...sony, kind: 'airplay'}]}, {id: 'living-room', sources: [{...sony, extra: true}]},
    {id: 'living-room', sources: [{...sony, id: 'living-room'}]}, {selected: 'living-room', sources: [{id: 'living-room', kind: 'sony', endpoint: sony.endpoint}]},
    {selected: 'living-room', sources: [sony]}, {id: 'bad id', sources: [sony]}, {id: '192.168.1.20', sources: [sony]}, {id: '10.0.0.9', sources: [sony]},
    {id: 'sony-192.168.1.20', sources: [sony]}, {id: 'move-192.168.1.30', sources: [sonos, sony]}, {id: 'living-room', sources: 'sony'},
    // 2.0 narrows the 1.x ID to a routing ID (Hub #918).
    {id: 'Living-Room', sources: [sony]}, {id: 'living_room', sources: [sony]}, {id: 'living--room', sources: [sony]}, {id: '-room', sources: [sony]},
    {id: 'x'.repeat(129), sources: [sony]}, {id: 7, sources: [sony]}, {sources: [sony]},
    ...BAD_SONY.map(endpoint => ({id: 'living-room', sources: [{...sony, endpoint}]})),
    ...BAD_SONOS.map(endpoint => ({id: 'living-room', sources: [{...sonos, endpoint}]})),
  ];
  for (const section of invalid) {
    const refused = configurePlayback(section);
    assert.ok('error' in refused && refused.error.code === 'invalid-request', JSON.stringify(section));
    // A refusal's detail is fixed text that health shows: it never repeats an address from the section.
    assert.ok(!(refused.error.detail ?? '').includes('192.168.1.'), 'the detail repeats no address');
  }
  assert.equal(accepted({id: 'x'.repeat(128), sources: [sony]}), true, '128 characters is the longest routing ID');
});

test('the runtime refuses the module without its section, and accepts it with one', () => {
  const {manifest} = createPlaybackModule({transport: new SimulatedSpeakers()});
  const none = checkConfiguration(manifest, undefined);
  assert.ok(none.status === 'refused' && none.problem.code === 'not-found');
  const bad = checkConfiguration(manifest, {id: 'living-room', sources: []});
  assert.ok(bad.status === 'refused' && bad.problem.code === 'invalid-request');
  const good = checkConfiguration(manifest, {id: 'living-room', sources: [sonos, sony]});
  assert.ok(good.status === 'accepted');
  assert.deepEqual(good.devices, ['living-room'], 'the module controls one device: the playback record');
});

test('the conversion keeps both speaker addresses in their configured order and carries no saved preference', () => {
  const block = {id: 'living-room', sources: [sonos, sony]};
  const converted = convertHostPlayback(block);
  assert.deepEqual(converted, {section: {id: 'living-room', sources: [sonos, sony]}}, 'both addresses, in order, and nothing else');
  assert.ok(!('error' in converted));
  assert.deepEqual(Object.keys(converted.section), ['id', 'sources'], 'no preference or other state is carried: the configured order applies');
  assert.equal(accepted(converted.section), true, 'the runtime accepts what the conversion writes');
  const single = convertHostPlayback({id: 'living-room', sources: [sony]});
  assert.deepEqual(single, {section: {id: 'living-room', sources: [sony]}});
});

test('the conversion renames a 1.x ID outside the routing-ID form and says so', () => {
  const cases: [string, string][] = [
    ['HT-A9', 'ht-a9'], ['living_room.1', 'living-room-1'], ['Kitchen', 'kitchen'], ['--music--', 'music'], ['_', 'playback'], ['a__b', 'a-b'],
    ['x'.repeat(128), 'x'.repeat(128)],
  ];
  for (const [from, to] of cases) {
    assert.equal(routingIdOf(from), to, from);
    const converted = convertHostPlayback({id: from, sources: [sony]});
    assert.ok(!('error' in converted), from);
    assert.deepEqual(converted, from === to ? {section: {id: to, sources: [sony]}} : {section: {id: to, sources: [sony]}, renamedFrom: from}, from);
    assert.equal(accepted(converted.section), true, `${from} converts to an accepted routing ID`);
  }
});

test('the conversion refuses a block the Hub would have refused, without quoting it', () => {
  const invalid: unknown[] = [
    undefined, null, {id: 'living-room'}, {id: 'living-room', sources: [sony], selected: 'living-room'}, {selected: 'living-room', sources: [sony]},
    {id: 'bad id', sources: [sony]}, {id: '192.168.1.20', sources: [sony]}, {id: 'sony-192.168.1.20', sources: [sony]},
    {id: 'move-192.168.1.30', sources: [sonos, sony]}, {id: 'living-room', sources: [sony, sony]}, {id: 'x'.repeat(129), sources: [sony]},
    ...BAD_SONY.map(endpoint => ({id: 'living-room', sources: [{...sony, endpoint}]})),
  ];
  for (const block of invalid) {
    const refused = convertHostPlayback(block);
    assert.ok('error' in refused && refused.error.code === 'invalid-request', JSON.stringify(block));
    assert.ok(!(refused.error.detail ?? '').includes('192.168.1.'), 'the detail repeats no address');
  }
});
