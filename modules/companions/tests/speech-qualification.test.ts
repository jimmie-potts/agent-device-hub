import assert from 'node:assert/strict';
import {test} from 'node:test';
import {speechQualification, type SpeechQualification} from '../src/speech-qualification.js';
const receipt: SpeechQualification = {schema: 'browser-speech-qualification/1.0', browserVersion: '150.0.0.1', platform: 'macos',
  qualifiedAt: '2026-10-24T12:00:00.000Z', voice: {name: 'Synthetic local English', lang: 'en-US', voiceURI: 'synthetic-local'}};
void test('a private qualification receipt supplies only the exact browser and voice identity', () => {
  const checked = speechQualification(receipt); assert.deepEqual(checked, receipt); assert.notEqual(checked, receipt);
  receipt.voice.name = 'Changed after parsing'; assert.equal(checked?.voice.name, 'Synthetic local English'); receipt.voice.name = 'Synthetic local English';
});
void test('missing, extra, unqualified or unbounded receipt data cannot select a voice', () => {
  for (const value of [undefined, null, {}, {...receipt, platform: 'windows'}, {...receipt, browserVersion: 'chrome'}, {...receipt, qualifiedAt: 'yesterday'},
    {...receipt, schema: 'other/1.0'}, {...receipt, extra: 'x'}, {...receipt, voice: {...receipt.voice, localService: false}},
    {...receipt, voice: {...receipt.voice, lang: 'fr-FR'}}, {...receipt, voice: {...receipt.voice, name: ''}}, {...receipt, voice: {...receipt.voice, voiceURI: 'x'.repeat(513)}}]) {
    assert.equal(speechQualification(value), undefined);
  }
});
