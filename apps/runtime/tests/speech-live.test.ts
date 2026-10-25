import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {createCompanionsModule} from '@jimmie-potts/companions';
import type {SpeechOutput} from '@jimmie-potts/event-contracts/v2/companions';
import {connectRemote, type Command, type RemoteEndpoint} from '@jimmie-potts/sdk';
import {createCoreModule, type CoreHandle} from '../src/core/core.js';
import {observation, sessionStarted, turnStarted} from './fixtures/agents.js';
import {contextOf, edgeConfig, fixture, flush, it, manualClock, run, waitFor} from './support.js';

it('live companion admissions use one real gateway endpoint and preserve visual attention in Quiet and mute', async t => {
  const clock = manualClock(Date.now()), companions = createCompanionsModule();
  const start = companions.start.bind(companions);
  companions.start = context => {
    writeFileSync(join(context.files(), 'speech-qualification.json'), JSON.stringify({schema: 'browser-speech-qualification/1.0', browserVersion: '150.0.0.1', platform: 'macos',
      qualifiedAt: '2026-10-24T12:00:00.000Z', voice: {name: 'Synthetic local English', lang: 'en-US', voiceURI: 'synthetic-local'}}), {mode: 0o600});
    return start(context);
  };
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: given => {handle = given; return Promise.resolve();}}]});
  const producer = fixture('speech-lifecycle');
  const config = await edgeConfig(t, [], {browserAccess: 'trusted-loopback'});
  const {runtime} = await run(t, {modules: [core, companions, producer], configFile: config.config,
    edge: {schemas: {}}, clock: {now: clock.now}, scheduler: clock.scheduler});
  const signin = await fetch(`${runtime.url}/api/v2/browser/session`, {method: 'POST', headers: {origin: runtime.url, 'bunny-request': '1', 'content-type': 'application/json'}, body: '{}'});
  assert.equal(signin.status, 200);
  const cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const headers = new Headers(init?.headers); headers.set('cookie', cookie); headers.set('origin', runtime.url);
    return nativeFetch(input, {...init, headers});
  });
  const first = await connectRemote({url: runtime.url, source: 'bunny/parts/dashboard', browser: true, now: clock.now});
  const second = await connectRemote({url: runtime.url, source: 'bunny/parts/dashboard', browser: true, now: clock.now});
  t.after(async () => {await Promise.all([first.close(), second.close()]);});
  const spoken: Command<SpeechOutput>[] = [], other: Command<SpeechOutput>[] = [];
  const endpoint = await first.openEndpoint<SpeechOutput>({family: 'companion-speech-output', respond: command => {spoken.push(command); return {status: 'accepted'};}});
  const alternate = await second.openEndpoint<SpeechOutput>({family: 'companion-speech-output', respond: command => {other.push(command); return {status: 'accepted'};}});
  let count = 0, sequence = 0;
  const control = (action: 'enable' | 'mute' | 'stop', selected: RemoteEndpoint = endpoint) => selected.request('companion-speech-endpoint', {
    type: 'org.bunny.companion-speech.endpoint.requested', dataschema: 'https://bunny.invalid/events/companion-speech-endpoint/2.0',
    data: {requestId: `speech-control-${++count}`, action, ...(action === 'enable' ? {available: true} : {})}}, {timeoutMs: 2000});
  const advance = async () => {for (let turn = 0; turn < 3; turn++) {clock.advance(26); for (let i = 0; i < 8; i++) await flush();}};
  const observe = async (event: Parameters<typeof observation>[0], turn = 'turn-1') => {
    const value = observation(event, clock.now(), {sequence: ++sequence, turn, nativeEventId: `speech-native-${sequence}`});
    await contextOf(producer).sdk.publish(value.key, value.draft); await flush(); await flush();
  };
  const question = async (id: string) => {await observe(turnStarted, id); await observe({kind: 'question-continuing', attention: {status: 'known', id}}, id); await advance();};
  const mode = (value: 'work' | 'quiet') => core.actions.dispatch({key: 'bunny.cmd.mode-set.hub', requestedBy: 'bunny/parts/operator', requestId: `mode-${++count}`,
    draft: {type: 'org.bunny.mode.set.requested', subject: 'hub', dataschema: 'https://bunny.invalid/events/mode-set/2.0', data: {mode: value}}});
  await core.actions.dispatch({key: 'bunny.cmd.companion-settings-set.reachy', requestedBy: 'bunny/parts/operator', requestId: 'speech-text-enable',
    draft: {type: 'org.bunny.companion-settings.set.requested', subject: 'reachy', dataschema: 'https://bunny.invalid/events/companion-settings-set/2.0',
      data: {enabled: true, muted: [], snooze: 'keep', expectedRevision: companions.inspect()?.revision}}});
  await observe(sessionStarted); await question('before-enable'); assert.equal(spoken.length, 0);
  assert.equal(companions.inspect()?.presentation?.opportunity.cue, 'question');
  assert.equal((await control('enable')).status, 'accepted');
  assert.equal((await control('enable', alternate)).status, 'rejected');
  await advance(); assert.equal(spoken.length, 0, 'enablement never speaks the previous visual card');
  for (const family of ['companion-speech-play', 'companion-speech-dispatch', 'companion-speech-endpoint', 'companion-speech-output']) {
    const bypass = await fetch(`${runtime.url}/api/v2/commands/${family}`, {method: 'POST', headers: {'bunny-request': '1', 'content-type': 'application/json'}, body: JSON.stringify({target: 'reachy', data: {}})});
    assert.equal(bypass.status, 403, `${family} cannot use the ordinary action route`);
  }
  await mode('quiet'); await question('quiet-question'); assert.equal(spoken.length, 0);
  assert.equal(companions.inspect()?.presentation?.opportunity.cue, 'question', 'Quiet retains visual attention');
  await mode('work'); await question('spoken-question'); await waitFor(() => spoken.length === 1);
  assert.equal(other.length, 0); const output = spoken[0]; assert.ok(output?.data.action === 'speak');
  const operationId = output.data.operationId;
  for (const status of ['started', 'completed'] as const) await endpoint.publish('companion-speech-playback', {
    kind: 'occurrence', type: 'org.bunny.companion-speech.playback.observed', dataschema: 'https://bunny.invalid/events/companion-speech-playback/2.0', data: {operationId, status, started: true}}, {parent: output});
  await waitFor(() => handle?.operation(operationId)?.result === 'succeeded');
  assert.equal((await control('mute')).status, 'accepted'); await question('muted-question'); assert.equal(spoken.length, 1);
  assert.equal((await control('enable')).status, 'accepted'); await advance(); assert.equal(spoken.length, 1);
  await endpoint.close(); await waitFor(() => companions.inspectSpeech()?.availability === 'unavailable');
  assert.equal((await control('enable', alternate)).status, 'accepted');
  await advance(); assert.equal(other.length, 0, 'explicit replacement after a clean close does not catch up');
});
