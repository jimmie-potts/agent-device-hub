// The Sony and Sonos sources over HTTP, against the old Hub's fake speakers on the loopback interface. Copied from
// `apps/hub/tests/playback.test.mjs` at main 483d3a93 (Hub #175, #233; copied for Hub #929). The Hub's sources polled on
// their own interval and reported into the shared module; here a source makes one read or one command, so each test reads
// explicitly. The Hub's "reads poll on a timer without overlapping" tests moved to module.test.ts with the polling. Each
// call has the module's own 1.5 s deadline rather than the Hub tests' 200 ms, which a loaded host can miss for a read
// that does answer.
import assert from 'node:assert/strict';
import {CALL_TIMEOUT_MS} from '../src/module.js';
import {Presentation} from '../src/playback.js';
import {sonosSource} from '../src/sonos.js';
import {sonySource} from '../src/sony.js';
import type {SpeakerSource} from '../src/sources.js';
import {httpSpeakers} from '../src/transport.js';
import {DIDL, airplay, deadlineOf, envelope, fakeSonos, fakeSony, playingInfo, soapFault, test, type SonosCall} from './support.js';

const http = httpSpeakers();
/** One read reported into a one-source presentation, as the Hub's source did: a failed read reports nothing. */
const reporter = (source: SpeakerSource, presentation: Presentation) => async (): Promise<void> => {
  try {
    presentation.report(0, await source.read());
  } catch {
    // A failed read reports nothing, so the observation ages.
  }
};

test('Sony AirPlay observations normalize metadata, status and controls', async () => {
  const sony = await fakeSony();
  const source = sonySource({kind: 'sony', endpoint: sony.endpoint}, http, deadlineOf(CALL_TIMEOUT_MS));
  try {
    assert.deepEqual(await source.read(), {status: 'playing', title: 'Song', artist: 'Artist', album: 'Album', controls: ['pause', 'next', 'previous']});
    assert.deepEqual(sony.calls[0], {path: '/sony/avContent', method: 'getPlayingContentInfo', id: sony.calls[0]?.id, params: [{output: ''}], version: '1.2'});
    sony.set(() => playingInfo([airplay({stateInfo: {state: 'PAUSED'}, albumName: '', title: '  Padded  '})]));
    assert.deepEqual(await source.read(), {status: 'paused', title: 'Padded', artist: 'Artist', controls: ['next', 'previous']},
      'the owner live check of 2026-09-25 qualified next and previous while paused');
    sony.set(() => playingInfo([airplay({stateInfo: {state: 'STOPPED'}, title: undefined, artist: undefined, albumName: undefined, content: undefined})]));
    assert.deepEqual(await source.read(), {status: 'stopped', controls: []});
    sony.set(() => ({result: [airplay({stateInfo: {state: 'BUFFERING'}, title: 'x'.repeat(300)})]}));
    assert.deepEqual(await source.read(), {status: 'unknown', title: 'x'.repeat(256), artist: 'Artist', album: 'Album', controls: []});
    sony.set(() => playingInfo([{source: 'extInput:tv', uri: 'extInput:tv', stateInfo: {state: 'PLAYING'}, title: 'TV'}]));
    assert.deepEqual(await source.read(), {status: 'inactive', controls: []});
  } finally {
    await sony.close();
  }
});

test('only successful Sony reads refresh freshness, which ages through stale to unavailable', async () => {
  const sony = await fakeSony();
  let clock = 1000;
  sony.set(() => ({error: [7, 'Illegal State']}));
  const source = sonySource({kind: 'sony', endpoint: sony.endpoint}, http, deadlineOf(CALL_TIMEOUT_MS));
  const presentation = new Presentation(1, () => clock);
  const refresh = reporter(source, presentation);
  try {
    await refresh();
    assert.deepEqual(presentation.view(), {availability: 'unavailable', index: 0});
    sony.set(() => playingInfo([airplay()]));
    await refresh();
    const first = presentation.view();
    assert.deepEqual([first.availability, first.observedAtMs], ['available', 1000]);
    clock += 4000;
    await refresh();
    assert.deepEqual([presentation.view().observedAtMs, presentation.view().ageMs], [5000, 0], 'an unchanged read refreshes the observation time');
    const failures = [
      () => ({error: [7, 'Illegal State']}), () => ({status: 500, result: [[airplay()]]}), () => 'not json', () => ({result: 'wrong'}), () => 'drop' as const,
      () => 'hang' as const, () => ({id: 'other', result: [[airplay()]]}),
    ];
    for (const failure of failures) {
      sony.set(failure);
      clock += 100;
      await refresh();
    }
    assert.equal(presentation.view().observedAtMs, 5000, 'failed reads do not refresh the observation time');
    clock = 5000 + 4999;
    assert.equal(presentation.view().availability, 'available');
    clock = 5000 + 5000;
    assert.deepEqual([presentation.view().availability, presentation.view().observation], ['stale', first.observation], 'a stale view keeps the last playback');
    clock = 5000 + 29_999;
    assert.equal(presentation.view().availability, 'stale');
    clock = 5000 + 30_000;
    assert.deepEqual(presentation.view(), {availability: 'unavailable', index: 0, observedAtMs: 5000, ageMs: 30_000});
    sony.set(() => playingInfo([airplay({title: 'Next song'})]));
    await refresh();
    assert.deepEqual([presentation.view().availability, presentation.view().observation?.title], ['available', 'Next song'], 'the next successful read recovers');
  } finally {
    await sony.close();
  }
});

test('Sony commands call the qualified method once and report sent, refused, unsent or uncertain', async () => {
  const sony = await fakeSony();
  const source = sonySource({kind: 'sony', endpoint: sony.endpoint}, http, deadlineOf(CALL_TIMEOUT_MS));
  const commands = () => sony.calls.filter(call => call.method !== 'getPlayingContentInfo').map(call => [call.method, call.version, call.params]);
  try {
    assert.equal(await source.command('next'), 'sent');
    assert.equal(await source.command('play'), 'unsent', 'the HT-A9 cannot resume, so play never reaches it');
    sony.set(call => call.method === 'getPlayingContentInfo' ? playingInfo([airplay()]) : {error: [40000, 'refused']});
    assert.equal(await source.command('previous'), 'refused', 'a JSON-RPC error is the receiver refusing a command it heard');
    sony.set(call => call.method === 'getPlayingContentInfo' ? playingInfo([airplay()]) : 'hang');
    await assert.rejects(source.command('pause'), 'an unanswered command is uncertain');
    assert.deepEqual(commands(), [['setPlayNextContent', '1.0', [{output: ''}]], ['setPlayPreviousContent', '1.0', [{output: ''}]], ['pausePlayingContent', '1.1', [{output: ''}]]]);
  } finally {
    await sony.close();
  }
});

const sonosCommands = (calls: readonly SonosCall[]): SonosCall[] => calls.filter(call => call.action?.startsWith('Get') !== true);

test('Sonos AirPlay observations normalize metadata, status, session and controls', async () => {
  const sonos = await fakeSonos();
  const source = sonosSource({kind: 'sonos', endpoint: sonos.endpoint}, http, deadlineOf(CALL_TIMEOUT_MS));
  const view = () => source.read();
  try {
    assert.deepEqual(await view(), {status: 'playing', title: 'Move Song', artist: 'Move Artist', album: 'Move Album', controls: ['pause', 'next', 'previous']});
    assert.deepEqual(sonos.calls.map(call => call.action), ['GetTransportInfo', 'GetPositionInfo', 'GetCurrentTransportActions'], 'one read is three sequential calls');
    for (const call of sonos.calls) {
      assert.equal(call.path, '/MediaRenderer/AVTransport/Control');
      assert.equal(call.soapaction, `"urn:schemas-upnp-org:service:AVTransport:1#${call.action ?? ''}"`);
      assert.match(call.contentType ?? '', /^text\/xml; charset="utf-8"$/);
      const action = call.action ?? '';
      assert.ok(call.body.includes(`<u:${action} xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID></u:${action}>`), call.body);
    }
    sonos.state.transport = 'PAUSED_PLAYBACK';
    sonos.state.metadata = DIDL({title: '  Song &amp; Co  ', album: null});
    assert.deepEqual(await view(), {status: 'paused', title: 'Song & Co', artist: 'Move Artist', controls: ['play', 'next', 'previous']},
      'entities are decoded once per layer and a missing album stays absent');
    sonos.state.actions = 'Set, Stop, Pause, Next, Previous';
    assert.deepEqual((await view()).controls, ['next', 'previous'], 'a control is declared only while the Move advertises its action');
    sonos.state.actions = 'Set, Stop, Pause, Play';
    assert.deepEqual((await view()).controls, ['play']);
    sonos.state.transport = 'PLAYING';
    assert.deepEqual((await view()).controls, ['pause'], 'next and previous follow the advertised actions while playing too');
    sonos.state.actions = 'Set, Stop, Pause, Play, Next, Previous';
    sonos.state.transport = 'STOPPED';
    assert.deepEqual(await view(), {status: 'stopped', title: 'Song & Co', artist: 'Move Artist', controls: []});
    sonos.state.transport = 'TRANSITIONING';
    const transitioning = await view();
    assert.deepEqual([transitioning.status, transitioning.controls], ['unknown', []]);
    sonos.state.transport = 'PLAYING';
    sonos.state.metadata = DIDL({title: 'x'.repeat(300), artist: '', album: 'Album'});
    assert.deepEqual(await view(), {status: 'playing', title: 'x'.repeat(256), album: 'Album', controls: ['pause', 'next', 'previous']},
      'text is limited to 256 characters and empty text is absent');
    sonos.state.metadata = 'NOT_IMPLEMENTED';
    assert.deepEqual(await view(), {status: 'playing', controls: ['pause', 'next', 'previous']});
    sonos.state.metadata = DIDL();
    sonos.state.uri = 'x-rincon-queue:RINCON_000E58FFFFFF01400#0';
    const queue = await view();
    assert.deepEqual(queue, {status: 'inactive', controls: []}, 'a track that is not the AirPlay session is another input');
    sonos.state.uri = '';
    assert.deepEqual(await view(), {status: 'inactive', controls: []});
    const text = JSON.stringify(queue);
    assert.ok(!text.includes('getaa') && !text.includes('0:03'), 'no artwork URL, position or duration');
  } finally {
    await sonos.close();
  }
});

test('only complete Sonos reads refresh freshness', async () => {
  const sonos = await fakeSonos();
  let clock = 1000;
  sonos.set(() => ({status: 500, body: soapFault(701)}));
  const source = sonosSource({kind: 'sonos', endpoint: sonos.endpoint}, http, deadlineOf(CALL_TIMEOUT_MS));
  const presentation = new Presentation(1, () => clock);
  const refresh = reporter(source, presentation);
  try {
    await refresh();
    assert.deepEqual(presentation.view(), {availability: 'unavailable', index: 0});
    sonos.set(undefined);
    await refresh();
    assert.deepEqual([presentation.view().availability, presentation.view().observedAtMs], ['available', 1000]);
    const failures: ((call: SonosCall) => unknown)[] = [
      () => ({status: 500, body: soapFault(701)}), () => ({status: 404, body: 'missing'}), () => 'not xml at all',
      () => envelope('<u:GetTransportInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"></u:GetTransportInfoResponse>'),
      call => call.action === 'GetCurrentTransportActions' ? 'hang' : undefined, call => call.action === 'GetPositionInfo' ? 'drop' : undefined,
      () => ({status: 200, body: '<'.repeat(70_000)}),
    ];
    for (const failure of failures) {
      sonos.set(failure as (call: SonosCall) => undefined);
      clock += 100;
      await refresh();
    }
    assert.equal(presentation.view().observedAtMs, 1000, 'a read with any failed call reports nothing');
    sonos.set(undefined);
    await refresh();
    assert.equal(presentation.view().observedAtMs, 1700, 'the next complete read recovers');
  } finally {
    await sonos.close();
  }
});

test('Sonos commands post one SOAP action and report sent, refused or uncertain', async () => {
  const sonos = await fakeSonos();
  const source = sonosSource({kind: 'sonos', endpoint: sonos.endpoint}, http, deadlineOf(CALL_TIMEOUT_MS));
  try {
    assert.equal(await source.command('play'), 'sent');
    assert.equal(sonosCommands(sonos.calls).length, 1);
    assert.equal(sonosCommands(sonos.calls)[0]?.body.includes('<u:Play xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID><Speed>1</Speed></u:Play>'),
      true, 'Play carries speed 1');
    sonos.set(call => call.action === 'Next' ? {status: 500, body: soapFault(701)} : undefined);
    assert.equal(await source.command('next'), 'refused', 'a SOAP fault is the Move refusing a command it heard');
    sonos.set(call => call.action === 'Previous' ? 'hang' : undefined);
    await assert.rejects(source.command('previous'), 'an unanswered command is uncertain');
    sonos.set(call => call.action === 'Previous' ? {status: 500, body: '<broken'} : undefined);
    await assert.rejects(source.command('previous'), 'a 500 without a SOAP fault is uncertain');
    sonos.set(undefined);
    assert.equal(await source.command('pause'), 'sent');
    assert.deepEqual(sonosCommands(sonos.calls).map(call => call.action), ['Play', 'Next', 'Previous', 'Previous', 'Pause']);
    assert.ok(sonosCommands(sonos.calls).every(call => !call.body.includes('<Speed>') || call.action === 'Play'));
  } finally {
    await sonos.close();
  }
});
