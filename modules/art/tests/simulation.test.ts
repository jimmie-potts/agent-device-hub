import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import type {ArtState} from '@jimmie-potts/event-contracts/v2/art-state';
import {InProcessBus} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {registration} from '../src/registration.js';
import {until} from './support.js';

void test('the simulated registration creates billable synthetic art without any key or network', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'art-simulation-'));
  const bus = new InProcessBus(), core = bus.connect('bunny/core');
  const module = registration.simulate();
  const host = new ModuleHarness(module, {bus, stateDir: dir, section: {}});
  let state: ArtState | undefined;
  await core.subscribe<ArtState>('bunny.state.art.art', message => {state = message.data;});
  t.after(async () => {await host.stop(); await core.close(); await rm(dir, {recursive: true, force: true});});
  await host.start();
  const answer = await core.request('bunny.cmd.art-request.art', {
    type: 'org.bunny.art.request.requested', subject: 'art', dataschema: 'https://bunny.invalid/events/art-request/2.0',
    data: {action: 'start', purpose: 'request', origin: {kind: 'owner'}, targets: ['ui', 'tidbyt', 'pixoo']},
  }, {requestId: 'simulated-art', timeoutMs: 2000});
  assert.equal(answer.status, 'accepted');
  await until(() => state?.jobs[0]?.status === 'finished');
  assert.equal(state?.jobs[0]?.outcome, 'succeeded');
  assert.equal(state?.artworks[0]?.compositions.length, 3);
  assert.ok((state?.providers.find(provider => provider.provider === 'openai')?.spentMicros ?? 0) > 0);
  assert.ok((state?.providers.find(provider => provider.provider === 'anthropic')?.spentMicros ?? 0) > 0);
});

void test('simulation does not read configured provider secrets', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'art-simulation-secrets-'));
  let reads = 0;
  const secrets = {
    get 'openai-api-key'() {reads += 1; return 'SYNTHETIC_OPENAI_KEY';},
    get 'anthropic-api-key'() {reads += 1; return 'SYNTHETIC_ANTHROPIC_KEY';},
  };
  const host = new ModuleHarness(registration.simulate(), {bus: new InProcessBus(), stateDir: dir,
    section: {secrets: {'openai-api-key': '/synthetic/openai', 'anthropic-api-key': '/synthetic/anthropic'}}, secrets});
  t.after(async () => {await host.stop(); await rm(dir, {recursive: true, force: true});});
  await host.start();
  assert.equal(reads, 0, 'configured credentials remain unread when simulation supplies both providers');
});
