import assert from 'node:assert/strict';
import {test} from 'node:test';
import {adaptWisprResponse} from '../src/content.js';

void test('reader refusal becomes the registry ErrorBody, never successful legacy error content', () => {
  const answer = adaptWisprResponse({status: 503, body: '{"error":{"code":"wispr-unavailable"}}'});
  assert.ok('error' in answer, 'unavailable input refuses the runtime read');
  assert.equal(answer.error.code, 'unavailable');
  assert.equal(JSON.stringify(answer).includes('wispr-unavailable'), false);
});
