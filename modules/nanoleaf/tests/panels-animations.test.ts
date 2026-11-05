import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {LINES_ADDRESS, NANOLEAF_FAMILIES, PANELS_ADDRESS} from '../src/index.js';
import {deviceCommand, ModuleWorld, moduleCommand, SECTION, type WallState} from './module-support.js';
import {test} from './support.js';

async function worldWithPanels(context: TestContext): Promise<ModuleWorld> {
  const world = await ModuleWorld.open(context, {
    section: {...SECTION, devices: [...SECTION.devices, {id: 'nl22', kind: 'panels', address: PANELS_ADDRESS, secret: 'token'}]},
    devices: {[LINES_ADDRESS]: 'lines', [PANELS_ADDRESS]: 'panels'},
  });
  await world.start();
  await world.until(() => world.state<WallState>('nanoleaf-wall', 'nl22')?.layout === 'saved', 5000, 'the Panels layout');
  return world;
}

test('NL22 plays an explicit requested animation through its own worker in Free', async context => {
  const world = await worldWithPanels(context);
  const free = deviceCommand('device-mode-set', {requestId: 'panels-free', mode: 'free'}, 'nl22');
  assert.equal((await world.request(free.key, free.draft)).status, 'accepted');
  await world.advance(3000);
  const linesBefore = world.device.state().devices[LINES_ADDRESS]?.writes;
  const panelsBefore = world.device.state().devices[PANELS_ADDRESS]?.writes ?? 0;
  const play = moduleCommand(NANOLEAF_FAMILIES.animationPlay.family, NANOLEAF_FAMILIES.animationPlay.type,
    {requestId: 'panels-animation', animation: {pattern: 'wave', colors: ['#0044aa', '#00aa66'], direction: 'right'}}, 'nl22');
  const result = await world.request(play.key, play.draft);
  assert.equal(result.status, 'accepted');
  await world.until(() => world.outcomes('panels-animation').length === 1, 5000, 'the Panels animation outcome');
  assert.equal(world.outcomes('panels-animation')[0]?.data.result, 'succeeded');
  assert.equal(world.outcomes('panels-animation')[0]?.data.evidence, 'transmitted');
  assert.equal(world.device.state().devices[PANELS_ADDRESS]?.writes, panelsBefore + 1);
  assert.equal(world.device.state().devices[PANELS_ADDRESS]?.effect, 'custom');
  assert.equal(world.device.state().devices[LINES_ADDRESS]?.writes, linesBefore);
  world.verify();
});

type AnimationOptions = {
  id: string; mode: string; positionsSaved: boolean; rememberedSceneId: string | null;
  queuedAnimation: {requestId: string} | null; favorites: {name: string; animation: object}[];
};

async function mode(world: ModuleWorld, device: string, value: 'work' | 'quiet' | 'free', id = `${device}-${value}`): Promise<void> {
  const request = deviceCommand('device-mode-set', {requestId: id, mode: value}, device);
  assert.equal((await world.request(request.key, request.draft)).status, 'accepted');
  await world.until(() => world.outcomes(id).length === 1, 5000, `the ${id} outcome`);
}

function animation(id: string, recipe: object, device = 'nl22'): ReturnType<typeof moduleCommand> {
  return moduleCommand(NANOLEAF_FAMILIES.animationPlay.family, NANOLEAF_FAMILIES.animationPlay.type,
    {requestId: id, animation: recipe}, device);
}

async function outcome(world: ModuleWorld, id: string): Promise<{requestId: string; result: string; evidence: string; error?: {code: string}}> {
  await world.until(() => world.outcomes(id).length === 1, 5000, `the ${id} outcome`);
  const result = world.outcomes(id)[0]?.data;
  assert.ok(result !== undefined);
  return result;
}

test('both devices offer the shared favorite catalog and play presets or frozen favorites with their own scenes and modes', async context => {
  const world = await worldWithPanels(context);
  await mode(world, 'wall', 'free');
  await mode(world, 'nl22', 'free');
  await world.advance(3000);
  const save = moduleCommand(NANOLEAF_FAMILIES.favoriteEdit.family, NANOLEAF_FAMILIES.favoriteEdit.type,
    {requestId: 'save-triangles', edit: {kind: 'save', name: 'Synthetic twilight', animation: {preset: 'aurora'}}});
  assert.equal((await world.request(save.key, save.draft)).status, 'accepted');
  await outcome(world, 'save-triangles');
  const options = (id: string): AnimationOptions | undefined => world.state<AnimationOptions>('nanoleaf-animations', id);
  await world.until(() => options('nl22')?.favorites.length === 1, 1000, 'the shared favorite on Panels');
  assert.deepEqual(options('nl22')?.favorites, options('wall')?.favorites);
  assert.equal(options('nl22')?.id, 'nl22');
  assert.equal(options('nl22')?.positionsSaved, true);
  assert.ok(options('nl22')?.rememberedSceneId !== null);
  assert.notEqual(options('nl22')?.rememberedSceneId, options('wall')?.rememberedSceneId, 'scene identity belongs to one controller');
  for (const [id, recipe] of [['preset', {preset: 'cozy'}], ['favorite', {favorite: 'Synthetic twilight'}]] as const) {
    const play = animation(id, recipe);
    assert.equal((await world.request(play.key, play.draft)).status, 'accepted');
    assert.deepEqual(await outcome(world, id), {requestId: id, result: 'succeeded', evidence: 'transmitted'});
  }
  await mode(world, 'nl22', 'quiet');
  assert.equal(options('nl22')?.mode, 'quiet');
  assert.equal(options('wall')?.mode, 'free');
  assert.equal(JSON.stringify([world.device_(), world.wall(), world.state('device', 'nl22'), world.state('nanoleaf-wall', 'nl22')])
    .includes('Synthetic twilight'), false, 'favorites stay out of device and wall state');
  world.verify();
});

test('Panels refuse requested animations in Work and Quiet, and before their layout is saved', async context => {
  const world = await worldWithPanels(context);
  for (const value of ['work', 'quiet'] as const) {
    await mode(world, 'nl22', value);
    const play = animation(`refused-${value}`, {preset: 'ocean'});
    const reply = await world.request(play.key, play.draft);
    assert.equal(reply.status === 'rejected' && reply.error.error.code, 'unsupported-capability');
    assert.deepEqual(world.outcomes(`refused-${value}`), []);
    assert.deepEqual(world.query('SELECT id FROM control_journal WHERE device=? AND kind=?', 'nl22', 'animation.play'), []);
  }
  world.verify();
  const unavailable = await ModuleWorld.open(context, {
    online: false,
    section: {...SECTION, devices: [...SECTION.devices, {id: 'nl22', kind: 'panels', address: PANELS_ADDRESS, secret: 'token'}]},
    devices: {[LINES_ADDRESS]: 'lines', [PANELS_ADDRESS]: 'panels'},
  });
  await unavailable.start();
  await mode(unavailable, 'nl22', 'free');
  const play = animation('no-layout', {preset: 'cozy'});
  const reply = await unavailable.request(play.key, play.draft);
  assert.equal(reply.status === 'rejected' && reply.error.error.code, 'invalid-state');
  assert.deepEqual(unavailable.outcomes('no-layout'), []);
  unavailable.verifyMessages();
});

async function lockedPanels(context: TestContext): Promise<{world: ModuleWorld; release: () => void}> {
  const world = await worldWithPanels(context);
  await mode(world, 'wall', 'free');
  await mode(world, 'nl22', 'free');
  await world.advance(3000);
  await world.stopModule();
  const release = world.lockDevice('nl22');
  await world.restart();
  return {world, release};
}

test('the Panels queue and mode cancellation are independent of Lines playback', async context => {
  const {world, release} = await lockedPanels(context);
  const queued = animation('panels-queued', {preset: 'ocean'});
  assert.equal((await world.request(queued.key, queued.draft)).status, 'accepted');
  assert.deepEqual(world.state<AnimationOptions>('nanoleaf-animations', 'nl22')?.queuedAnimation, {requestId: 'panels-queued'});
  assert.equal(world.state<AnimationOptions>('nanoleaf-animations', 'wall')?.queuedAnimation, null);
  const second = animation('panels-second', {preset: 'cozy'});
  const refused = await world.request(second.key, second.draft);
  assert.equal(refused.status === 'rejected' && refused.error.error.code, 'capacity');
  const lines = animation('lines-independent', {preset: 'cozy'}, 'wall');
  assert.equal((await world.request(lines.key, lines.draft)).status, 'accepted');
  assert.equal((await outcome(world, 'lines-independent')).result, 'succeeded');
  const before = world.device.state().devices[PANELS_ADDRESS]?.writes;
  await mode(world, 'nl22', 'quiet', 'cancel-panels');
  const cancelled = await outcome(world, 'panels-queued');
  assert.equal(cancelled.result, 'failed');
  assert.equal(cancelled.error?.code, 'cancelled');
  assert.equal(world.device.state().devices[PANELS_ADDRESS]?.writes, before);
  release();
  world.verifyMessages();
});

test('a Panels request expires without a worker, and a queued request is never replayed after restart', async context => {
  const {world, release} = await lockedPanels(context);
  const before = world.device.state().devices[PANELS_ADDRESS]?.writes;
  const expire = animation('panels-expire', {preset: 'cozy'});
  assert.equal((await world.request(expire.key, expire.draft, 500)).status, 'accepted');
  const expired = await outcome(world, 'panels-expire');
  assert.equal(expired.result, 'failed');
  assert.equal(expired.evidence, 'none');
  assert.equal(expired.error?.code, 'expired');
  const queued = animation('panels-restart', {preset: 'cozy'});
  assert.equal((await world.request(queued.key, queued.draft)).status, 'accepted');
  await world.restart();
  const ended = await outcome(world, 'panels-restart');
  assert.equal(ended.result, 'failed');
  assert.equal(ended.error?.code, 'cancelled');
  release();
  await world.advance(5000);
  assert.equal(world.device.state().devices[PANELS_ADDRESS]?.writes, before);
  world.verifyMessages();
});

test('an uncertain Panels animation is not retried and leaves Lines playback independent', async context => {
  const world = await worldWithPanels(context);
  await mode(world, 'wall', 'free');
  await mode(world, 'nl22', 'free');
  await world.advance(3000);
  const before = world.device.state().devices[PANELS_ADDRESS]?.writes ?? 0;
  world.device.loseNextAnswer('/effects');
  const play = animation('panels-lost', {preset: 'cozy'});
  assert.equal((await world.request(play.key, play.draft)).status, 'accepted');
  const lost = await outcome(world, 'panels-lost');
  assert.equal(lost.result, 'uncertain');
  assert.equal(lost.error?.code, 'uncertain-result');
  assert.equal(world.state<WallState>('nanoleaf-wall', 'nl22')?.held, false, 'requested animations preserve the existing no-hold behavior');
  assert.equal(world.wall()?.held, false);
  const lines = animation('lines-after-loss', {preset: 'cozy'}, 'wall');
  assert.equal((await world.request(lines.key, lines.draft)).status, 'accepted');
  assert.equal((await outcome(world, 'lines-after-loss')).result, 'succeeded');
  await world.advance(5000);
  assert.equal(world.device.state().devices[PANELS_ADDRESS]?.writes, before + 1);
  assert.equal(world.outcomes('panels-lost').length, 1);
  world.verifyMessages();
});

test('an HTTP refusal of a Panels animation ends once with transmitted evidence and no hold', async context => {
  const world = await worldWithPanels(context);
  await mode(world, 'wall', 'free');
  await mode(world, 'nl22', 'free');
  await world.advance(3000);
  world.device.refuseNext('/effects', 503);
  const play = animation('panels-http', {preset: 'cozy'});
  assert.equal((await world.request(play.key, play.draft)).status, 'accepted');
  const failed = await outcome(world, 'panels-http');
  assert.equal(failed.result, 'failed');
  assert.equal(failed.evidence, 'transmitted');
  assert.equal(failed.error?.code, 'unavailable');
  assert.equal(world.state<WallState>('nanoleaf-wall', 'nl22')?.held, false);
  assert.equal(world.wall()?.held, false);
  world.verify();
});

test('a native Panels hold leaves Lines free and a fresh Panels animation releases only that hold', async context => {
  const world = await worldWithPanels(context);
  await mode(world, 'wall', 'free');
  await mode(world, 'nl22', 'free');
  await world.advance(3000);
  world.device.loseNextAnswer('/state');
  const brightness = deviceCommand('brightness-set', {requestId: 'panels-held', percent: 25}, 'nl22');
  assert.equal((await world.request(brightness.key, brightness.draft)).status, 'accepted');
  assert.equal((await outcome(world, 'panels-held')).result, 'uncertain');
  await world.until(() => world.state<WallState>('nanoleaf-wall', 'nl22')?.held === true, 2000, 'the Panels hold');
  const lines = animation('lines-during-hold', {preset: 'cozy'}, 'wall');
  assert.equal((await world.request(lines.key, lines.draft)).status, 'accepted');
  assert.equal((await outcome(world, 'lines-during-hold')).result, 'succeeded');
  assert.equal(world.state<WallState>('nanoleaf-wall', 'nl22')?.held, true);
  const panels = animation('panels-release', {preset: 'cozy'});
  assert.equal((await world.request(panels.key, panels.draft)).status, 'accepted');
  assert.equal((await outcome(world, 'panels-release')).result, 'succeeded');
  assert.equal(world.state<WallState>('nanoleaf-wall', 'nl22')?.held, false);
  world.verify();
});
