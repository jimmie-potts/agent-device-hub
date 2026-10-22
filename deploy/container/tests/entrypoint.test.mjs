import assert from 'node:assert/strict';
import {test} from 'node:test';
import {containerOptions} from '../entrypoint.mjs';

test('device control defaults off while the core remains selected', () => {
  assert.equal(containerOptions({}).control, 'disabled');
  assert.equal(containerOptions({BUNNY_CONTROL: 'enabled'}).control, 'enabled');
  for (const control of ['', 'true', 'yes', 'ENABLED']) {
    assert.throws(() => containerOptions({BUNNY_CONTROL: control}));
  }
});

test('container locations and listener have explicit safe defaults', () => {
  assert.deepEqual(containerOptions({}), {
    control: 'disabled', stateDir: '/var/lib/bunny', config: '/etc/bunny/runtime.json', port: 8788,
  });
  assert.throws(() => containerOptions({BUNNY_PORT: '0'}));
  assert.throws(() => containerOptions({BUNNY_PORT: '65536'}));
  assert.throws(() => containerOptions({BUNNY_STATE_DIR: 'relative'}));
  assert.throws(() => containerOptions({BUNNY_CONFIG: 'relative'}));
});
