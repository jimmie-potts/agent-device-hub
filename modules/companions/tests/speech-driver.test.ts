import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {SpeechDriver, type SpeechCallbacks, type SpeechInput, type SpeechPort} from '../src/frontend/speech-driver.js';

const voice: SpeechSynthesisVoice = {name: 'Synthetic local English', lang: 'en-US', voiceURI: 'synthetic-local', localService: true, default: false};
class FakeSpeech implements SpeechPort {
  voices: SpeechSynthesisVoice[] = [voice];
  readonly listeners = new Set<() => void>();
  readonly submissions: {input: SpeechInput; callbacks: SpeechCallbacks}[] = [];
  speaking = false;
  pending = false;
  cancels = 0;
  cancelCallback = true;
  throwsAfterSubmission = false;
  getVoices(): readonly SpeechSynthesisVoice[] {return this.voices;}
  voicesChanged(callback: () => void): () => void {this.listeners.add(callback); return () => {this.listeners.delete(callback);};}
  speak(input: SpeechInput, callbacks: SpeechCallbacks): void {
    this.submissions.push({input, callbacks}); this.pending = true;
    if (this.throwsAfterSubmission) throw new Error('private browser failure');
  }
  cancel(): void {
    this.cancels += 1; this.speaking = false; this.pending = false;
    if (this.cancelCallback) this.last().callbacks.error('interrupted');
  }
  last(): {input: SpeechInput; callbacks: SpeechCallbacks} {
    const last = this.submissions.at(-1); assert.ok(last); return last;
  }
  start(): void {this.pending = false; this.speaking = true; this.last().callbacks.start();}
  end(): void {this.speaking = false; this.pending = false; this.last().callbacks.end();}
  error(code: string): void {this.speaking = false; this.pending = false; this.last().callbacks.error(code);}
  changed(): void {for (const listener of this.listeners) listener();}
}
const flush = async (): Promise<void> => {for (let i = 0; i < 8; i += 1) await Promise.resolve();};
function setup(t: TestContext): {port: FakeSpeech; driver: SpeechDriver; request: {text: string; expiresAtMs: number; eligible: () => boolean}} {
  t.mock.timers.enable({apis: ['Date', 'setTimeout'], now: 100_000});
  const port = new FakeSpeech(), driver = new SpeechDriver({port, voice});
  return {port, driver, request: {text: 'Synthetic coding question.', expiresAtMs: Date.now() + 30_000, eligible: () => true}};
}

void test('speech defaults off and never chooses a default voice implicitly', async t => {
  const {driver, port, request} = setup(t);
  assert.deepEqual(await driver.play(request), {kind: 'not-started', reason: 'disabled'});
  assert.equal(port.submissions.length, 0);
  assert.equal(await driver.enable(), true);
  const done = driver.play(request); await flush();
  assert.equal(port.last().input.voice, voice);
  assert.equal(port.last().input.voice.default, false);
  assert.equal(port.last().input.volume, 0.65);
  port.start(); port.end();
  assert.deepEqual(await done, {kind: 'completed', started: true});
});

void test('voice enumeration waits for voiceschanged for at most five seconds and cleans up', async t => {
  const {driver, port} = setup(t); port.voices = [];
  const enabled = driver.enable();
  t.mock.timers.tick(4_999); await flush(); assert.equal(driver.enabled, false);
  port.voices = [voice]; port.changed();
  assert.equal(await enabled, true); assert.equal(port.listeners.size, 0);
  await driver.mute(); port.voices = [];
  const absent = driver.enable(); t.mock.timers.tick(5_000);
  assert.equal(await absent, false); assert.equal(port.listeners.size, 0);
  port.voices = [voice]; port.changed(); assert.equal(driver.enabled, false);
});

void test('a changed, remote, non-English or ambiguous voice cannot qualify', async t => {
  const {port} = setup(t);
  for (const voices of [[{...voice, localService: false}], [{...voice, voiceURI: 'other'}], [{...voice, name: 'Changed'}], [{...voice, lang: 'fr-FR'}], [voice, {...voice}]]) {
    port.voices = voices;
    const driver = new SpeechDriver({port, voice}); const enabled = driver.enable();
    t.mock.timers.tick(5_000); assert.equal(await enabled, false);
    assert.equal(port.submissions.length, 0); assert.equal(port.listeners.size, 0);
  }
});

void test('mute cancels qualification and later voices cannot enable speech', async t => {
  const {driver, port} = setup(t); port.voices = [];
  const enabled = driver.enable(); await driver.mute();
  port.voices = [voice]; port.changed();
  assert.equal(await enabled, false); assert.equal(driver.enabled, false);
  assert.equal(port.listeners.size, 0); assert.equal(port.submissions.length, 0);
});

void test('final permission and expiry are rechecked after asynchronous voice discovery', async t => {
  const {driver, port, request} = setup(t); assert.equal(await driver.enable(), true);
  let allowed = true; port.voices = [];
  const done = driver.play({...request, eligible: () => allowed});
  allowed = false; port.voices = [voice]; port.changed();
  assert.deepEqual(await done, {kind: 'not-started', reason: 'policy'});
  port.voices = [];
  const expired = driver.play({...request, expiresAtMs: Date.now() + 100});
  t.mock.timers.tick(100);
  assert.deepEqual(await expired, {kind: 'not-started', reason: 'expired'});
  assert.equal(port.submissions.length, 0);
});

void test('Stop during voice discovery prevents any later submission', async t => {
  const {driver, port, request} = setup(t); await driver.enable(); port.voices = [];
  const done = driver.play(request); await driver.stop(); port.voices = [voice]; port.changed();
  assert.deepEqual(await done, {kind: 'not-started', reason: 'stopped'});
  assert.equal(port.submissions.length, 0); assert.equal(port.listeners.size, 0);
});

void test('an end without a start is uncertain and a new request cannot replay or overlap', async t => {
  const {driver, port, request} = setup(t); await driver.enable();
  const done = driver.play(request); await flush(); port.end();
  assert.deepEqual(await done, {kind: 'uncertain', started: false});
  assert.equal(await driver.enable(), false);
  assert.deepEqual(await driver.play(request), {kind: 'not-started', reason: 'unavailable'});
  assert.equal(port.submissions.length, 1);
});

void test('one active request refuses another without building a browser queue', async t => {
  const {driver, port, request} = setup(t); await driver.enable();
  const done = driver.play(request);
  assert.deepEqual(await driver.play(request), {kind: 'not-started', reason: 'busy'});
  await flush(); port.start();
  assert.deepEqual(await driver.play(request), {kind: 'not-started', reason: 'busy'});
  port.end(); await done; assert.equal(port.submissions.length, 1);
});

void test('Stop confirms interruption, retains the start and permits a separately submitted request', async t => {
  const {driver, port, request} = setup(t); await driver.enable();
  const done = driver.play(request); await flush(); port.start();
  const old = port.last().callbacks;
  assert.deepEqual(await driver.stop(), {kind: 'stopped', started: true});
  assert.deepEqual(await done, {kind: 'stopped', started: true});
  assert.equal(port.cancels, 1);
  const next = driver.play(request); await flush(); old.end();
  assert.equal(driver.active, true);
  port.start(); port.end(); assert.deepEqual(await next, {kind: 'completed', started: true});
  assert.equal(port.submissions.length, 2);
});

void test('mute stops active output and suppresses subsequent requests until explicit enablement', async t => {
  const {driver, port, request} = setup(t); await driver.enable();
  const done = driver.play(request); await flush(); port.start();
  assert.deepEqual(await driver.mute(), {kind: 'stopped', started: true}); await done;
  assert.deepEqual(await driver.play(request), {kind: 'not-started', reason: 'disabled'});
  assert.equal(port.submissions.length, 1); assert.equal(await driver.enable(), true);
});

void test('missing cancellation callbacks cannot establish stopped or allow a replacement', async t => {
  const {driver, port, request} = setup(t); await driver.enable(); port.cancelCallback = false;
  const done = driver.play(request); await flush(); port.start();
  const stopped = driver.stop(); t.mock.timers.tick(500);
  assert.deepEqual(await stopped, {kind: 'uncertain', started: true}); await done;
  assert.equal(await driver.enable(), false); assert.equal(port.submissions.length, 1);
});

void test('playback deadline cancels once and remains uncertain even with a cancellation callback', async t => {
  const {driver, port, request} = setup(t); await driver.enable();
  const done = driver.play(request); await flush(); port.start();
  t.mock.timers.tick(15_000);
  assert.deepEqual(await done, {kind: 'uncertain', started: true});
  assert.equal(port.cancels, 1); assert.equal(driver.enabled, false);
  t.mock.timers.tick(60_000); assert.equal(port.submissions.length, 1);
});

void test('known refusal before start differs from errors after a partial effect', async t => {
  const {driver, port, request} = setup(t); await driver.enable();
  const refused = driver.play(request); await flush(); port.error('voice-unavailable');
  assert.deepEqual(await refused, {kind: 'failed', started: false});
  assert.equal(driver.enabled, false); await driver.enable();
  const partial = driver.play(request); await flush(); port.start(); port.error('synthesis-failed');
  assert.deepEqual(await partial, {kind: 'uncertain', started: true});
  assert.equal(await driver.enable(), false);
});

void test('an exception after handing audio to the browser is uncertain, cancels and never retries', async t => {
  const {driver, port, request} = setup(t); await driver.enable(); port.throwsAfterSubmission = true;
  const done = driver.play(request); await flush();
  assert.deepEqual(await done, {kind: 'uncertain', started: false});
  assert.equal(port.cancels, 1); assert.equal(port.submissions.length, 1);
});

void test('lost connection closes the local driver and late callbacks cannot restore availability', async t => {
  const {driver, port, request} = setup(t); await driver.enable();
  const done = driver.play(request); await flush(); port.start();
  await driver.close(); await done; port.end();
  assert.equal(driver.enabled, false); assert.equal(await driver.enable(), false);
  assert.deepEqual(await driver.play(request), {kind: 'not-started', reason: 'unavailable'});
  assert.equal(port.cancels, 1);
});

void test('the voice is checked again for each utterance and never falls back to another default', async t => {
  const {driver, port, request} = setup(t); await driver.enable();
  port.voices = [{...voice, localService: false}, {...voice, name: 'Other local voice', default: true}];
  const done = driver.play(request); t.mock.timers.tick(5_000);
  assert.deepEqual(await done, {kind: 'not-started', reason: 'unavailable'});
  assert.equal(driver.enabled, false); assert.equal(port.submissions.length, 0);
});

void test('voice identity can come from native accessor properties', async t => {
  const {port} = setup(t);
  class NativeIdentity {
    get name(): string {return voice.name;}
    get lang(): string {return voice.lang;}
    get voiceURI(): string {return voice.voiceURI;}
  }
  const driver = new SpeechDriver({port, voice: new NativeIdentity()});
  assert.equal(await driver.enable(), true);
});

void test('a busy synthesizer is refused without cancelling audio this driver did not submit', async t => {
  const {driver, port, request} = setup(t); await driver.enable(); port.speaking = true;
  assert.deepEqual(await driver.play(request), {kind: 'not-started', reason: 'busy'});
  await driver.stop(); await driver.close(); assert.equal(port.cancels, 0); assert.equal(port.submissions.length, 0);
});

void test('expired and malformed requests cannot submit speech', async t => {
  const {driver, port, request} = setup(t); await driver.enable();
  assert.deepEqual(await driver.play({...request, expiresAtMs: Date.now()}), {kind: 'not-started', reason: 'expired'});
  for (const bad of [{...request, expiresAtMs: NaN}, {...request, text: ' '}, {...request, text: 'a'.repeat(513)}]) {
    assert.deepEqual(await driver.play(bad), {kind: 'not-started', reason: 'invalid-input'});
  }
  assert.equal(port.submissions.length, 0);
});

void test('a terminal callback while synthesis still reports active is uncertain', async t => {
  const {driver, port, request} = setup(t); await driver.enable();
  const done = driver.play(request); await flush(); port.start(); port.last().callbacks.end();
  assert.deepEqual(await done, {kind: 'uncertain', started: true});
  assert.equal(port.cancels, 1); assert.equal(await driver.enable(), false);
});

void test('start observation occurs once before completion and ignores duplicate or late callbacks', async t => {
  const {driver, port, request} = setup(t); await driver.enable();
  let starts = 0;
  const input = {...request, onStarted: () => {starts += 1;}};
  const done = driver.play(input); await flush();
  assert.equal(starts, 0); port.start(); port.start(); assert.equal(starts, 1);
  port.end(); assert.deepEqual(await done, {kind: 'completed', started: true});
  port.last().callbacks.start(); assert.equal(starts, 1);
});

void test('a failed start observer cancels output and settles uncertain without escaping the speech callback', async t => {
  const {driver, port, request} = setup(t); await driver.enable();
  const input = {...request, onStarted: () => {throw new Error('synthetic receipt callback failure');}};
  const done = driver.play(input); await flush();
  assert.doesNotThrow(() => {port.start();});
  assert.equal(driver.enabled, false);
  t.mock.timers.tick(15_000);
  assert.deepEqual(await done, {kind: 'uncertain', started: true});
  assert.equal(port.cancels, 1); assert.equal(driver.enabled, false);
});
