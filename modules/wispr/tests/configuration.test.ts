import assert from 'node:assert/strict';
import {test} from 'node:test';
import {configureWispr, showWisprSettings} from '../src/configuration.js';

const selected = {sourceId: 'dictation', aggregatePath: '/synthetic-private/aggregate.json', diagnosticsPath: '/synthetic-private/status.json'};

void test('fresh manually selected configuration defaults both sharing controls off', () => {
  const answer = configureWispr(selected);
  assert.ok(!('error' in answer), 'valid selected files are accepted');
  assert.deepEqual(answer.config, {...selected, freshnessMs: 600000, exposeToDashboard: false, shareTextAggregates: false});
  assert.deepEqual(showWisprSettings(answer.config), {sourceId: 'dictation', freshnessMs: 600000, exposeToDashboard: false, shareTextAggregates: false});
  assert.equal(JSON.stringify(showWisprSettings(answer.config)).includes('/synthetic-private'), false);
});

void test('invalid private paths and flags refuse without echoing caller content', () => {
  for (const patch of [{aggregatePath: 'PRIVATE_PATH_CANARY.json'}, {aggregatePath: '/a/../PRIVATE_PATH_CANARY.json'},
    {aggregatePath: selected.diagnosticsPath}, {aggregatePath: '/a/.git/PRIVATE_PATH_CANARY.json'},
    {diagnosticsPath: '/OneDrive/PRIVATE_PATH_CANARY.json'}, {sourceId: 'hub-service'}, {sourceId: '127.0.0.1'},
    {sourceId: 'dictation\n'}, {sourceId: 'x'.repeat(129)}, {aggregatePath: '/private/control\n.json'},
    {exposeToDashboard: 'PRIVATE_VALUE_CANARY'}, {shareTextAggregates: 1}, {freshnessMs: 999}, {freshnessMs: 86400001}, {extra: 'PRIVATE_VALUE_CANARY'}]) {
    const answer = configureWispr({...selected, ...patch});
    assert.ok('error' in answer);
    assert.equal(answer.error.code, 'invalid-request');
    assert.equal(JSON.stringify(answer).includes('CANARY'), false);
  }
});
