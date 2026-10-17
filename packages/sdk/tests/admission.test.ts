// Serialized admission (Hub #1142): admission state read inside the key's turn is fresh; a read before the await is not.
import assert from 'node:assert/strict';
import {serializedAdmission, type Fresh} from '../src/index.js';
import {it} from './support.js';

const started = (): Promise<void> => new Promise(resolve => { setImmediate(resolve); });

it('work for one key runs in order, and a turn reads admission after the work ahead of it', async () => {
  const admission = serializedAdmission();
  let eligible = true, release = (): void => {};
  const held = admission('device', () => new Promise<void>(resolve => { release = () => { eligible = false; resolve(); }; }));
  const effects: string[] = [];
  const queued = admission('device', fresh => { if (fresh(() => eligible)) effects.push('upload'); });
  await started();
  release();
  await Promise.all([held, queued]);
  assert.deepEqual(effects, [], 'the queued upload saw the eligibility the held write changed');
});

it('a check made before the await is the stale shape the helper replaces', async () => {
  const admission = serializedAdmission();
  let eligible = true, release = (): void => {};
  const held = admission('device', () => new Promise<void>(resolve => { release = () => { eligible = false; resolve(); }; }));
  const effects: string[] = [];
  const checked = eligible;
  const queued = admission('device', () => { if (checked) effects.push('upload'); });
  await started();
  release();
  await Promise.all([held, queued]);
  assert.deepEqual(effects, ['upload']);
});

it('different keys do not wait for each other, a failed turn releases the key, and fresh refuses a read after its turn', async () => {
  const admission = serializedAdmission();
  let release = (): void => {};
  const held = admission('a', () => new Promise<void>(resolve => { release = resolve; }));
  assert.equal(await admission('b', () => 'b'), 'b');
  await started();
  release(); await held;
  await assert.rejects(admission('a', () => { throw new Error('boom'); }), /boom/);
  let kept: Fresh | undefined;
  assert.equal(await admission('a', fresh => { kept = fresh; return 1; }), 1);
  assert.throws(() => kept?.(() => true), /after its turn ended/);
});
