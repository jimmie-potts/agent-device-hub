import assert from 'node:assert/strict';
import {test} from 'node:test';
import {qualifiedChrome} from '../src/frontend/speech-browser.js';
import type {SpeechQualification} from '../src/speech-qualification.js';
const receipt: SpeechQualification = {schema: 'browser-speech-qualification/1.0', browserVersion: '150.0.0.1', platform: 'macos',
  qualifiedAt: '2026-10-24T12:00:00.000Z', voice: {name: 'Synthetic local English', lang: 'en-US', voiceURI: 'synthetic-local'}};
void test('only the qualified Chrome version on macOS passes the local browser check', async () => {
  const browser = (platform: string, brand: string, version: string) => ({userAgentData: {platform, getHighEntropyValues: () => Promise.resolve({fullVersionList: [{brand, version}]})}});
  assert.equal(await qualifiedChrome(receipt, browser('macOS', 'Google Chrome', receipt.browserVersion)), true);
  for (const candidate of [{}, {userAgentData: null}, browser('Windows', 'Google Chrome', receipt.browserVersion), browser('macOS', 'Chromium', receipt.browserVersion),
    browser('macOS', 'Google Chrome', '151.0.0.1'), {userAgentData: {platform: 'macOS', getHighEntropyValues: () => Promise.resolve({})}},
    {userAgentData: {platform: 'macOS', getHighEntropyValues: () => Promise.reject(new Error('denied'))}}]) assert.equal(await qualifiedChrome(receipt, candidate), false);
});
void test('a browser hint lookup that never answers cannot leave qualification pending', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const result = qualifiedChrome(receipt, {userAgentData: {platform: 'macOS', getHighEntropyValues: () => new Promise(() => {})}});
  t.mock.timers.tick(5000); assert.equal(await result, false);
});
