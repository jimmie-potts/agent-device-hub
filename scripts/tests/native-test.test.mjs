import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {DEFAULT_WORKERS, boundedCommand, parse} from '../native-test.mjs';

const scripts = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).scripts;

test('a run takes two test files at a time unless --workers names another bound', () => {
  assert.equal(DEFAULT_WORKERS, 2);
  assert.deepEqual(parse(['test:runtime:built']), {name: 'test:runtime:built', workers: 2, extra: []});
  assert.deepEqual(parse(['test:runtime:built', '--workers', '3', '--', '--test-name-pattern=a b']),
    {name: 'test:runtime:built', workers: 3, extra: ['--test-name-pattern=a b']});
  for (const args of [[], ['--workers', '2'], ['test:runtime:built', '--workers', '0'], ['test:runtime:built', '--workers', 'two'],
    ['test:runtime:built', '--workers'], ['test:runtime:built', '--other', '1']]) {
    assert.throws(() => parse(args), undefined, args.join(' '));
  }
});

test('the bound goes before the package script\'s own arguments, which stay as they are', () => {
  for (const name of ['test:runtime:built', 'test:runtime:scenarios:built']) {
    assert.equal(boundedCommand(scripts[name], 2), `node --test --test-concurrency=2 ${scripts[name].slice('node --test '.length)}`);
  }
  assert.equal(boundedCommand('node --test a/*.test.js', 1, ["--test-name-pattern=it's"]),
    "node --test --test-concurrency=1 '--test-name-pattern=it'\\''s' a/*.test.js");
});

test('only one plain, unbounded node --test command is run', () => {
  for (const name of ['test:runtime', 'test:pixoo:built', 'test:runtime:verify:built', 'test:runtime-dashboard:browser']) {
    assert.throws(() => boundedCommand(scripts[name], 2), undefined, name);
  }
  assert.throws(() => boundedCommand(undefined, 2));
});
