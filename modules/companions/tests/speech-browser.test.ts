import assert from 'node:assert/strict';
import {test} from 'node:test';
import {qualifiedChrome} from '../src/frontend/speech-browser.js';
void test('Chrome on macOS passes the local browser check across version changes', async () => {
  const browser = (platform: string, brand: string, version: string) => ({userAgentData: {platform, getHighEntropyValues: () => Promise.resolve({fullVersionList: [{brand, version}]})}});
  assert.equal(await qualifiedChrome(browser('macOS', 'Google Chrome', '150.0.0.1')), true);
  assert.equal(await qualifiedChrome(browser('macOS', 'Google Chrome', '151.0.0.1')), true);
  for (const candidate of [{}, {userAgentData: null}, browser('Windows', 'Google Chrome', '150.0.0.1'), browser('macOS', 'Chromium', '150.0.0.1'),
    {userAgentData: {platform: 'macOS', getHighEntropyValues: () => Promise.resolve({})}},
    {userAgentData: {platform: 'macOS', getHighEntropyValues: () => Promise.reject(new Error('denied'))}}]) assert.equal(await qualifiedChrome(candidate), false);
});
void test('a browser hint lookup that never answers cannot leave qualification pending', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const result = qualifiedChrome({userAgentData: {platform: 'macOS', getHighEntropyValues: () => new Promise(() => {})}});
  t.mock.timers.tick(5000); assert.equal(await result, false);
});
