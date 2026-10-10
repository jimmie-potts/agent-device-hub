import assert from 'node:assert/strict';
import {connectRemote} from '@jimmie-potts/sdk';
import type {PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import {SIMULATED_SECTION, SimulatedSpeakers, createPlaybackModule} from '@jimmie-potts/playback';
import {edgeConfig, it, manualClock, run, waitFor, type EdgePart} from './support.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQsUn5DwAC0AG0vqck9wAAAABJRU5ErkJggg==', 'base64');
it('artwork content requires read authority and remains passive through the real playback owner', async context => {
  // The remote SDK uses wall time for its signed request deadline; keep this disposable runtime on the same day.
  const clock = manualClock(Date.now());
  const readerPart: EdgePart = {id: 'art-reader', source: 'bunny/parts/art-reader', token: 'tok_SYNTHETIC835_art_reader', scopes: ['read']};
  const hookPart: EdgePart = {id: 'art-hook', source: 'bunny/parts/art-hook', token: 'tok_SYNTHETIC835_art_hook', scopes: ['ingest']};
  const files = await edgeConfig(context, [readerPart, hookPart], {modules: {playback: SIMULATED_SECTION}});
  const speakers = new SimulatedSpeakers({sony: {input: 'airplay', status: 'playing', title: 'Synthetic song'}});
  speakers.artwork();
  let fetches = 0, decodes = 0, publications = 0;
  const module = createPlaybackModule({transport: speakers, monotonic: clock.now, artwork: {
    fetch: () => {fetches++; return Promise.resolve({ok: true, value: PNG});},
    decode: () => {decodes++; return Promise.resolve({ok: true, value: {mediaType: 'image/png', width: 1, height: 1, base64: PNG.toString('base64')}});},
  }});
  const {runtime, logs} = await run(context, {modules: [module], configFile: files.config, clock, scheduler: clock.scheduler, edge: {schemas: {}}});
  const reader = await connectRemote({url: runtime.url, source: readerPart.source, token: readerPart.token});
  context.after(() => reader.close());
  await reader.subscribe('bunny.state.playback.*', () => {publications++;});
  const current = async (): Promise<PlaybackState> => {
    const result = await reader.sync<PlaybackState>(['playback'], () => {}, {owner: 'bunny/modules/playback', timeoutMs: 5000});
    assert.equal(result.status, 'synced', JSON.stringify(result));
    if (result.status !== 'synced') throw new Error('fixture sync failed');
    try {const state = result.copy.states()[0]?.data; assert.ok(state); return state;}
    finally {await result.copy.close();}
  };
  await waitFor(async () => (await current()).artwork?.status === 'ready', 5000, 'real owner ready fixture');
  const before = await current();
  assert.equal(before.artwork?.status, 'ready');
  const path = `/modules/playback/content/artwork.${before.artwork?.generation}.${before.revision}`;
  const get = (pathname: string, token?: string): Promise<Response> => fetch(new URL(pathname, runtime.url),
    {headers: token === undefined ? {} : {authorization: `Bearer ${token}`}});
  assert.equal((await get(path)).status, 401);
  assert.equal((await get(path, hookPart.token)).status, 403);
  // Authentication/input refusals intentionally schedule diagnostic rate-limit windows in the gateway.
  // Measure passive successful content reads separately from those existing refusal timers.
  const counts = [fetches, decodes, publications, speakers.state().sony.calls, clock.pending()];
  for (let n = 0; n < 3; n++) {
    const response = await get(path, readerPart.token);
    assert.equal(response.status, 200, 'current valid owner thumbnail is served, not missing');
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array(PNG));
    for (const [name, value] of [['cache-control', 'no-store'], ['x-content-type-options', 'nosniff'],
      ['referrer-policy', 'no-referrer'], ['x-frame-options', 'DENY']] as const) assert.equal(response.headers.get(name), value);
    assert.ok(response.headers.get('content-security-policy')?.includes("img-src 'self'") === true);
    assert.ok(!response.headers.has('location'));
  }
  assert.deepEqual([fetches, decodes, publications, speakers.state().sony.calls, clock.pending()], counts);
  for (const [pathname, status] of [[`${path}?q=private`, 400], ['/modules/playback/content/artwork.invalid.1', 404],
    [`/modules/playback/content/artwork.${before.artwork?.generation}.${before.revision + 1}`, 404]] as const) {
    const response = await get(pathname, readerPart.token); assert.equal(response.status, status);
    const body = await response.text(); assert.ok(!body.includes('private')); assert.ok(!body.includes('Synthetic song'));
  }
  assert.deepEqual(await current(), before);
  assert.deepEqual([fetches, decodes, publications, speakers.state().sony.calls], counts.slice(0, 4));
  assert.deepEqual(speakers.state().sony.commands, []);
  const diagnostics = JSON.stringify([logs, runtime.health()]);
  for (const privateText of ['tok_SYNTHETIC835', 'Synthetic song', PNG.toString('base64'), '/synthetic/playback-artwork.png']) assert.ok(!diagnostics.includes(privateText));
});
