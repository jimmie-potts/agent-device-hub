import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import type {CompanionCard, SpeechOutput, SpeechPlayback} from '@jimmie-potts/event-contracts/v2/companions';
import type {FrontendApi, FrontendSpeechEndpoint} from '@jimmie-potts/sdk/frontend';
import type {RemoteEndpointOptions} from '@jimmie-potts/sdk/remote';
import type {Message} from '@jimmie-potts/event-contracts/v2';
function buildMessage<T extends object>(source: string, kind: Message['kind'], draft: Pick<Message<T>, 'type' | 'subject' | 'dataschema' | 'data'>, parent: {traceparent: string}, now: number, expiry?: number): Message<T> {
  return {specversion: '1.0', bunnyprofile: '2.0', id: 'synthetic-message', source, kind, time: new Date(now).toISOString(),
    datacontenttype: 'application/json', ...draft, ...parent, ...(expiry === undefined ? {} : {expiresat: new Date(expiry).toISOString()})};
}
import {SpeechDriver, type SpeechCallbacks, type SpeechPort} from '../src/frontend/speech-driver.js';
import {SpeechSession} from '../src/frontend/speech-session.js';
const trace = {traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'};
const voice: SpeechSynthesisVoice = {name: 'Synthetic local', lang: 'en-US', voiceURI: 'synthetic-local', localService: true, default: false};
const flush = async (): Promise<void> => {for (let i = 0; i < 20; i++) await Promise.resolve();};
function setup(t: TestContext) {
  t.mock.timers.enable({apis: ['Date', 'setTimeout'], now: 100_000});
  let options: Omit<RemoteEndpointOptions<SpeechOutput>, 'family'> | undefined, usable = true, eligible = true, opened = 0, closed = 0, spoken = 0, cancels = 0;
  let callbacks: SpeechCallbacks | undefined;
  const receipts: SpeechPlayback[] = [], controls: string[] = [];
  const port: Omit<SpeechPort, 'speaking' | 'pending'> & {speaking: boolean; pending: boolean} = {speaking: false, pending: false, getVoices: () => [voice], voicesChanged: () => () => {},
    speak: (_input, handlers) => {spoken++; callbacks = handlers; port.pending = true;},
    cancel: () => {cancels++; port.speaking = false; port.pending = false; callbacks?.error('interrupted');},
  };
  const handle: FrontendSpeechEndpoint = {id: 'endpoint-test', close: () => {closed++; options?.onClosed?.(); return Promise.resolve();},
    control: command => {
      controls.push(command.action);
      return Promise.resolve({status: 'accepted', requestId: command.requestId, reply: buildMessage('bunny/modules/companions', 'reply', {
        type: 'org.bunny.companion-speech.endpoint.replied', subject: 'endpoint-test', dataschema: 'https://bunny.invalid/events/reply/2.0', data: {requestId: command.requestId, status: 'accepted'},
      }, trace, Date.now())});
    }, observe: playback => {receipts.push(playback); return Promise.resolve();},
  };
  const api: NonNullable<FrontendApi['speech']> = {open: given => {opened++; options = given; return Promise.resolve(handle);}};
  const session = new SpeechSession({api, createDriver: () => new SpeechDriver({port, voice}), usable: () => usable, eligible: () => eligible, changed: () => {}});
  const card: CompanionCard = {opportunity: {origin: {id: 'question-test', source: 'bunny/core', type: 'org.bunny.attention.raised'}, sourceKind: 'coding', context: 'live',
    category: 'coding-attention', cue: 'question', revision: 1, generation: 1, session: 'session-test', identity: null, turn: {status: 'unknown'},
    attention: {id: {status: 'unknown'}, kind: 'question', turn: {status: 'unknown'}}, noticeId: null, evidence: 'lifecycle-metadata', occurredAtMs: Date.now(), observedAtMs: Date.now(),
    validUntilMs: Date.now() + 30_000, busy: null, media: null, visitor: null, location: null}, text: 'Synthetic question.', phrase: 0, presentedAtMs: Date.now(), history: false, content: 'unavailable'};
  const output = (action: 'speak' | 'stop', operationId = 'operation-test') => {
    assert.ok(options);
    const data: SpeechOutput = action === 'speak' ? {requestId: 'request-test', operationId, action, card} : {requestId: 'request-test', operationId, action};
    return options.respond(buildMessage<SpeechOutput>('bunny/modules/companions', 'command', {
      type: 'org.bunny.companion-speech.output.requested', subject: 'endpoint-test', dataschema: 'https://bunny.invalid/events/companion-speech-output/2.0',
      data,
    }, trace, Date.now(), Date.now() + 5000));
  };
  return {session, receipts, controls, api, handle, output, port,
    counts: () => ({opened, closed, spoken, cancels}), usable: (value: boolean) => {usable = value;}, eligible: (value: boolean) => {eligible = value;},
    lost: () => {options?.onClosed?.();}, start: () => {port.pending = false; port.speaking = true; callbacks?.start();},
    end: () => {port.pending = false; port.speaking = false; callbacks?.end();},
  };
}

void test('the speech session opens only on enable, reports start then completion, and does not repeat an operation', async t => {
  const w = setup(t); assert.equal(w.counts().opened, 0); assert.equal(w.session.inspect().availability, 'off');
  await w.session.enable(); assert.equal(w.session.inspect().availability, 'available');
  assert.deepEqual(w.controls, ['enable']); assert.equal(w.counts().spoken, 0);
  assert.deepEqual(await w.output('speak'), {status: 'accepted'}); await flush(); assert.equal(w.counts().spoken, 1);
  w.start(); w.end(); await flush();
  assert.deepEqual(w.receipts.map(value => value.status), ['started', 'completed']);
  await w.output('speak'); await flush(); assert.equal(w.counts().spoken, 1);
  await w.session.close();
});

void test('Stop and mute cancel locally before their server control answers, and mute ends availability', async t => {
  const w = setup(t); await w.session.enable(); await w.output('speak'); await flush(); w.start();
  let answer: (() => void) | undefined;
  t.mock.method(w.handle, 'control', () => new Promise(resolve => {answer = () => {resolve({status: 'accepted'});};}));
  const stopped = w.session.stop(); assert.equal(w.counts().cancels, 1); assert.ok(answer); answer(); await stopped; await flush();
  assert.equal(w.receipts.at(-1)?.status, 'stopped');
  await w.output('speak', 'operation-two'); await flush(); w.start();
  const muted = w.session.mute(); assert.equal(w.counts().cancels, 2); answer(); await muted; await flush();
  assert.equal(w.session.inspect().availability, 'off'); assert.equal(w.counts().closed, 1);
});

void test('endpoint loss cancels immediately and reconnect never reopens or replays', async t => {
  const w = setup(t); await w.session.enable(); await w.output('speak'); await flush(); w.start();
  w.lost(); assert.equal(w.counts().cancels, 1); assert.equal(w.session.inspect().availability, 'unavailable');
  w.session.update(); await flush(); assert.equal(w.counts().opened, 1); assert.equal(w.counts().spoken, 1);
});

void test('current policy is checked at output and again after asynchronous voice preparation', async t => {
  const w = setup(t); await w.session.enable(); w.eligible(false);
  const refused = await w.output('speak'); assert.ok('error' in refused); assert.equal(w.counts().spoken, 0);
  let available = false, changed: () => void = () => {};
  t.mock.method(w.port, 'getVoices', () => available ? [voice] : []);
  t.mock.method(w.port, 'voicesChanged', (notify: () => void) => {changed = notify; return () => {};});
  w.eligible(true); assert.deepEqual(await w.output('speak'), {status: 'accepted'});
  w.eligible(false); available = true; changed(); await flush();
  assert.equal(w.counts().spoken, 0); assert.equal(w.receipts.at(-1)?.status, 'not-started');
  await w.session.close();
});

void test('command admission expiry does not shorten the qualified utterance playback bound', async t => {
  const w = setup(t); await w.session.enable(); await w.output('speak'); await flush(); w.start();
  t.mock.timers.tick(6000); await flush(); assert.equal(w.counts().cancels, 0);
  w.end(); await flush(); assert.equal(w.receipts.at(-1)?.status, 'completed');
  await w.session.close();
});

void test('mute while endpoint registration is pending closes the late handle and keeps speech off', async t => {
  const w = setup(t), open = w.api.open.bind(w.api);
  let finish: (() => void) | undefined;
  t.mock.method(w.api, 'open', (options: Parameters<typeof open>[0]) => new Promise<FrontendSpeechEndpoint>(resolve => {finish = () => {void open(options).then(resolve);};}));
  const enabling = w.session.enable(); await flush(); assert.ok(finish);
  await w.session.mute(); finish(); await enabling;
  assert.equal(w.session.inspect().availability, 'off'); assert.equal(w.counts().closed, 1); assert.equal(w.controls.length, 0);
});

void test('a failed start receipt cancels local playback and closes the endpoint without replay', async t => {
  const w = setup(t); await w.session.enable();
  t.mock.method(w.handle, 'observe', () => Promise.reject(new Error('synthetic lost receipt')));
  await w.output('speak'); await flush(); w.start(); await flush();
  assert.equal(w.counts().cancels, 1); assert.equal(w.counts().closed, 1); assert.equal(w.counts().spoken, 1);
  assert.equal(w.session.inspect().availability, 'unavailable'); w.session.update(); await flush(); assert.equal(w.counts().opened, 1);
});

void test('completion cannot overtake a pending start receipt', async t => {
  const w = setup(t); await w.session.enable();
  const observe = w.handle.observe.bind(w.handle);
  let acknowledge: (() => void) | undefined;
  t.mock.method(w.handle, 'observe', (playback: SpeechPlayback, parent: {traceparent: string}) => {
    if (playback.status === 'started') return new Promise<void>(resolve => {acknowledge = () => {void observe(playback, parent).then(resolve);};});
    return observe(playback, parent);
  });
  await w.output('speak'); await flush(); w.start(); w.end(); await flush();
  assert.equal(w.receipts.length, 0); assert.ok(acknowledge); acknowledge(); await flush();
  assert.deepEqual(w.receipts.map(value => value.status), ['started', 'completed']); await w.session.close();
});

void test('loss of live state cancels immediately and never restores availability by itself', async t => {
  const w = setup(t); await w.session.enable(); await w.output('speak'); await flush(); w.start();
  w.usable(false); w.session.update(); assert.equal(w.counts().cancels, 1); await flush();
  w.usable(true); w.session.update(); assert.equal(w.session.inspect().availability, 'unavailable'); assert.equal(w.counts().opened, 1);
});
