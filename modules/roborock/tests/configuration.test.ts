import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configureRoborock } from '../src/configuration.js';
void test('real configuration requires named secrets without publishing their paths', () => {
    assert.deepEqual(configureRoborock({ id: 'vacuum', secrets: { target: '/private/target.json', session: '/private/session.json' } }), { config: { id: 'vacuum' }, devices: ['vacuum'] });
    for (const v of [{ id: 'vacuum' }, { id: 'BAD_ID', secrets: { target: '/a', session: '/b' } }, { id: 'vacuum', secrets: { target: '/a', session: '/b', other: '/c' } }, { id: 'vacuum', address: '127.0.0.1' }])
        assert.ok('error' in configureRoborock(v));
    assert.deepEqual(configureRoborock({ id: 'vacuum' }, true), { config: { id: 'vacuum' }, devices: ['vacuum'] });
    assert.ok('error' in configureRoborock({ id: 'vacuum', secrets: {} }, true));
});
