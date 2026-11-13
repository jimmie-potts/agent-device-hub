import assert from 'node:assert/strict';
import {stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createCoreModule} from '../src/core/core.js';
import {startRuntime} from '../src/runtime.js';
import {edgeConfig, it, manualClock, run, stateDir} from './support.js';

const reader = {source: 'bunny/parts/standby-reader', token: 'tok_SYNTHETIC835-standby-reader', scopes: ['read']} as const;
const action = {target: 'hub', data: {mode: 'free', expectedRevision: 0}};

it('standby checks inbound credentials before creating state with the edge off', async t => {
  const root = join(await stateDir(t), 'not-created');
  const clock = manualClock();
  const files = await edgeConfig(t, [{...reader, scopes: ['read', 'control']}]);
  await assert.rejects(async () => {
    const runtime = await startRuntime({modules: [createCoreModule({standby: true})], stateDir: root,
      port: 0, configFile: files.config, clock, scheduler: clock.scheduler, log: () => {}});
    await runtime.stop();
  }, {code: 'edge-credentials-invalid'});
  await assert.rejects(stat(root), {code: 'ENOENT'});
});

it('an admitted standby HTTP mutation is refused before ordinary control permission', async t => {
  const files = await edgeConfig(t, [reader]);
  const clock = manualClock();
  const {runtime} = await run(t, {modules: [createCoreModule({standby: true})], clock,
    scheduler: clock.scheduler, configFile: files.config, edge: {schemas: {}}});
  const response = await fetch(new URL('/api/v2/commands/mode-set', runtime.url), {
    method: 'POST', headers: {authorization: 'Bearer ' + reader.token, 'content-type': 'application/json'},
    body: JSON.stringify(action),
  });
  const result = await response.json() as {error: {code: string}};
  assert.deepEqual([response.status, result.error.code], [503, 'unavailable']);
});

it('standby refuses a valid SDK stream before opening a participant', async t => {
  const files = await edgeConfig(t, [reader]);
  const clock = manualClock();
  const {runtime} = await run(t, {modules: [createCoreModule({standby: true})], clock,
    scheduler: clock.scheduler, configFile: files.config, edge: {schemas: {}}});
  const response = await fetch(new URL('/api/sdk/v1/stream', runtime.url), {
    headers: {authorization: 'Bearer ' + reader.token, 'bunny-source': reader.source},
  });
  if (response.status === 200) await response.body?.cancel();
  assert.equal(response.status, 503);
});
