import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chmod, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readSpeechQualification, SPEECH_QUALIFICATION_FILE} from '../src/speech/qualification.js';
const receipt = {schema: 'browser-speech-qualification/1.0', browserVersion: '150.0.0.1', platform: 'macos',
  qualifiedAt: '2026-10-24T12:00:00.000Z', voice: {name: 'Synthetic local English', lang: 'en-US', voiceURI: 'synthetic-local'}};
void test('only a bounded private regular qualification receipt is read; missing or unsafe files leave speech unqualified', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'speech-qualification-')); t.after(() => rm(directory, {recursive: true, force: true}));
  const file = join(directory, SPEECH_QUALIFICATION_FILE);
  assert.equal(readSpeechQualification(directory), undefined);
  await writeFile(file, JSON.stringify(receipt), {mode: 0o600}); assert.deepEqual(readSpeechQualification(directory), receipt);
  await chmod(file, 0o644); assert.equal(readSpeechQualification(directory), undefined); await chmod(file, 0o600);
  await writeFile(file, '{'); assert.equal(readSpeechQualification(directory), undefined);
  await writeFile(file, ' '.repeat(4097)); assert.equal(readSpeechQualification(directory), undefined);
  await rm(file); const other = join(directory, 'other.json'); await writeFile(other, JSON.stringify(receipt), {mode: 0o600});
  await symlink(other, file); assert.equal(readSpeechQualification(directory), undefined);
});

void test('the module refuses speech without its private qualification receipt while retaining text availability', async t => {
  const {InProcessBus} = await import('@jimmie-potts/sdk');
  const {ModuleHarness} = await import('@jimmie-potts/sdk/testing');
  const {createCompanionsModule} = await import('../src/module.js');
  const directory = await mkdtemp(join(tmpdir(), 'speech-qualified-module-'));
  const bus = new InProcessBus(), core = bus.connect('bunny/core'), browser = bus.connect('bunny/parts/dashboard');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  let module = createCompanionsModule(), privateFolder = '';
  const makeHost = () => {const current = module; return new ModuleHarness({...current, start: context => {privateFolder = context.files(); return current.start(context);}}, {bus, stateDir: directory, section: {}});};
  let host = makeHost();
  t.after(async () => {await host.stop(); await Promise.all([core.close(), browser.close()]); await rm(directory, {recursive: true, force: true});});
  await host.start();
  const enable = () => browser.request('bunny.cmd.companion-speech-endpoint.endpoint-test', {type: 'org.bunny.companion-speech.endpoint.requested', subject: 'endpoint-test',
    dataschema: 'https://bunny.invalid/events/companion-speech-endpoint/2.0', data: {requestId: 'enable-qualification', action: 'enable', available: true}}, {timeoutMs: 2000});
  const missing = await enable(); assert.equal(missing.status === 'rejected' && missing.error.error.code, 'unavailable');
  assert.equal(module.inspect()?.availability, 'available');
  const content = await module.manifest.content?.('speech-qualification'); assert.ok(content !== undefined && 'error' in content);
  await host.stop(); await writeFile(join(privateFolder, SPEECH_QUALIFICATION_FILE), JSON.stringify(receipt), {mode: 0o600});
  module = createCompanionsModule(); host = makeHost(); await host.start();
  assert.equal((await enable()).status, 'accepted');
  const selected = await module.manifest.content?.('speech-qualification'); assert.ok(selected !== undefined && !('error' in selected));
  assert.deepEqual(JSON.parse(Buffer.from(selected.bytes).toString()), receipt);
});
