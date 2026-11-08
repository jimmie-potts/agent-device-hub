import assert from 'node:assert/strict';
import test from 'node:test';
import type {ModeState} from '@jimmie-potts/event-contracts/v2/families';
import {deviceRecord} from '../../tests/fixtures/device.ts';
import {modeExceptions} from '../src/mode-exceptions.ts';

const mode: ModeState = {id: 'hub', revision: 4, mode: 'work', selectedAtMs: 1, overrides: []};
const device = (kind: 'nanoleaf' | 'pixoo', value: string) => {
  const record = deviceRecord(kind, 1, kind, 'available');
  record.desired.mode = {status: 'known' as const, value};
  return {record, owner: `bunny/modules/${kind}`, live: true};
};
void test('the Pixoo reports the Hub mode itself, so a difference shows without any Monitor/Media mapping (ADR 0014)', () => {
  for (const value of ['work', 'free', 'quiet'] as const) assert.deepEqual(modeExceptions({...mode, mode: value}, [device('pixoo', value)], [], true), [], value);
  const quiet = modeExceptions(mode, [device('pixoo', 'quiet')], [], true);
  assert.equal(quiet.length, 1); assert.equal(quiet[0]?.override, false);
  assert.match(quiet[0]?.choice ?? '', /Following Hub Work/);
  assert.match(quiet[0]?.evidence ?? '', /Requested native mode: quiet\. Physical mode is not confirmed/);
  const explicit = {...mode, overrides: [{target: 'pixoo', mode: 'quiet' as const, selectedAtMs: 2}]};
  const rows = modeExceptions(explicit, [device('pixoo', 'quiet')], [], true);
  assert.equal(rows.length, 1); assert.equal(rows[0]?.choice, 'Quiet · saved exception');
});
void test('fresh native differences stay separate from saved choice and unknown devices keep dormant choices', () => {
  const nano = device('nanoleaf', 'free');
  const rows = modeExceptions(mode, [nano], [], true);
  assert.equal(rows.length, 1); assert.equal(rows[0]?.override, false);
  assert.match(rows[0]?.choice ?? '', /Following Hub Work/);
  assert.deepEqual(mode.overrides, []);
  for (const changed of [{...nano, live: false}, {...nano, owner: 'bunny/modules/other'}]) assert.deepEqual(modeExceptions(mode, [changed], [], true), []);
  assert.deepEqual(modeExceptions(mode, [nano], [], false), []);
  const missing = modeExceptions({...mode, overrides: [{target: 'removed', mode: 'free', selectedAtMs: 2}]}, [], [], false);
  assert.equal(missing[0]?.linked, false); assert.equal(missing[0]?.override, true);
  assert.match(missing[0]?.evidence ?? '', /stale or unavailable/);
});
