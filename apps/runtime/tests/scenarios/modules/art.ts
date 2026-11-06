import type {ArtJobSummary, ArtState, ArtworkSummary} from '@jimmie-potts/event-contracts/v2/art-state';
import {StepFailure, act, answers, bodyOf, deviceState, expect, holds, recorded, refusedWith, running, type Harness, type Scenario} from '../framework.js';

const OWNER = 'bunny/modules/art';
const state = (h: Harness): ArtState | undefined => h.reader.states<ArtState>('art', OWNER)[0]?.data;
const job = (h: Harness, id: string): ArtJobSummary | undefined => state(h)?.jobs.find(value => value.requestId === id);
const calls = (h: Harness) => deviceState<{imageCalls: number; ideaCalls: number; pending: number}>(h, 'art');
const artwork = (h: Harness, id: string): ArtworkSummary | undefined => state(h)?.artworks.find(value => value.artworkId === job(h, id)?.artworkId);
const created = (h: Harness, id: string): string => job(h, id)?.artworkId ?? (() => {throw new StepFailure('synthetic artwork missing');})();
const ended = (id: string, outcome: string) => expect(`${id} finishes ${outcome}`, h => job(h, id)?.status === 'finished' && job(h, id)?.outcome === outcome || `${String(job(h, id)?.status)} ${String(job(h, id)?.outcome)}`, 15_000);

async function command(h: Harness, family: 'art-request' | 'art-catalog-edit', requestId: string, data: object): Promise<void> {
  const answer = await h.gateway({as: 'browser', method: 'POST', path: `/api/v2/commands/${family}`, body: {target: 'art', requestId, data}});
  if (answer.status !== 200) throw new StepFailure(`${family} returned ${String(answer.status)}`);
}
const request = (h: Harness, id: string, targets = ['ui'], extra: object = {}) => command(h, 'art-request', id,
  {action: 'start', purpose: 'request', origin: {kind: 'owner'}, targets, text: 'SYNTHETIC_ART_MOON_GARDEN', ...extra});
const seed: Scenario['seed'] = {modules: ['core', 'art'], sections: {art: {recentLimit: 1}},
  follows: [{owner: OWNER, families: ['art']}, {owner: 'bunny/core', families: ['operation']}]};
const initialCalls = new WeakMap<Harness, number>();

export const scenarios: readonly Scenario[] = [{
  id: 'art-gallery', title: 'the real Art Gallery displays a saved synthetic browser composition',
  seed: {...seed, sections: {art: {recentLimit: 8}}}, keepCapturePage: true,
  capture: async context => {const {captureArtGallery} = await import('../../../verify/art-gallery.js');await captureArtGallery(context);},
  steps: [
    expect('core and art are running', h => running(h, ['core', 'art'])),
    act('the owner prepares one synthetic browser composition', h => request(h, 'art-gallery-seed')),
    ended('art-gallery-seed', 'succeeded'),
    expect('the saved browser composition is available', h => artwork(h, 'art-gallery-seed')?.compositions[0]?.target === 'ui' || 'browser art missing'),
  ],
}, {
  id: 'art-catalog', title: 'synthetic creation, private catalog edits and restart use the real authenticated art owner', seed,
  keepCapturePage: true,
  capture: async (context, harness) => {const {captureArtRendition} = await import('../../../verify/art-browser.js'); await captureArtRendition(context, harness);},
  steps: [
    expect('core and art are running', h => running(h, ['core', 'art'])),
    expect('anonymous catalog reads are refused', answers({as: 'anonymous', method: 'GET', path: '/modules/art/content/catalog'}, response => refusedWith(response, 401, 'unauthenticated'))),
    expect('a reader cannot request art', answers({as: 'reader', method: 'POST', path: '/api/v2/commands/art-request', body: {target: 'art', requestId: 'art-reader', data: {action: 'start', purpose: 'request', origin: {kind: 'owner'}, targets: ['ui']}}}, response => refusedWith(response, 403, 'forbidden'))),
    expect('a control credential cannot impersonate the dashboard', answers({as: 'operator', method: 'POST', path: '/api/v2/commands/art-request', body: {target: 'art', requestId: 'art-operator', data: {action: 'start', purpose: 'request', origin: {kind: 'owner'}, targets: ['ui']}}}, response => refusedWith(response, 403, 'forbidden'))),
    expect('authorization refusals make no provider calls', h => calls(h).imageCalls === 0 && calls(h).ideaCalls === 0 || 'a refused command reached a provider'),
    act('the browser requests one synthetic scene for all three targets', h => request(h, 'art-original', ['ui', 'tidbyt', 'pixoo'])),
    ended('art-original', 'succeeded'),
    expect('durable admission has its own tracked outcome', h => recorded(h, 'art-original', 'succeeded', 'observed')),
    expect('the catalog has still and animated renditions with fictional provenance', h => {
      const original = artwork(h, 'art-original');
      return original?.provenance.factual === false && original.compositions.length === 3 && original.compositions.every(value => value.renditions.length > 0 && value.outcome === 'succeeded') &&
        original.compositions.filter(value => value.target !== 'ui').every(value => value.motion === 'gif' && value.renditions[0]?.frames === 8) || 'renditions or provenance missing';
    }),
    expect('reported usage settled three image calls and one idea call', h => calls(h).imageCalls === 3 && calls(h).ideaCalls === 1 &&
      state(h)?.providers.every(provider => provider.spentMicros > 0 && provider.reservedMicros === 0 && provider.uncertainMicros === 0) === true || 'usage accounting differs'),
    expect('authenticated catalog retrieval names the exact original', async h => {
      const response = await h.gateway({as: 'reader', method: 'GET', path: '/modules/art/content/catalog'});
      return response.status === 200 && bodyOf<{artworks: ArtworkSummary[]}>(response)?.artworks[0]?.artworkId === created(h, 'art-original') || 'catalog read differs';
    }),
    act('the owner saves the original as a favorite and gives explicit positive feedback', async h => {
      const artworkId = created(h, 'art-original');
      await command(h, 'art-catalog-edit', 'art-favorite', {action: 'favorite', artworkId, favorite: true});
      await command(h, 'art-catalog-edit', 'art-more', {action: 'feedback', artworkId, signal: 'more'});
    }),
    expect('favorite and feedback are visible in the synced catalog', h => artwork(h, 'art-original')?.favorite === true && artwork(h, 'art-original')?.feedback === 'more' || 'explicit feedback missing'),
    act('the owner reuses the favorite for Pixoo without generation', h => command(h, 'art-catalog-edit', 'art-reuse', {action: 'reuse', artworkId: created(h, 'art-original'), target: 'pixoo'})),
    expect('reuse is durably admitted without claiming a display played it', h => recorded(h, 'art-reuse', 'succeeded', 'observed')),
    holds('reuse makes no additional provider call', h => calls(h).imageCalls === 3 && calls(h).ideaCalls === 1 || 'reuse regenerated art', 100),
    act('the owner requests a variation of the saved idea', h => request(h, 'art-variation', ['ui'], {purpose: 'variation', variationOf: created(h, 'art-original'), text: 'Make the moon red'})),
    ended('art-variation', 'succeeded'),
    expect('variation retains the source artwork identity', h => artwork(h, 'art-variation')?.variationOf === created(h, 'art-original') || 'variation identity missing'),
    act('the synthetic provider returns an invalid image for a new request', async h => {h.simulate({device: 'art', action: 'invalid-next'}); await request(h, 'art-invalid');}),
    ended('art-invalid', 'failed'),
    expect('invalid bytes are refused and their reported usage remains spent', h => job(h, 'art-invalid')?.targets[0]?.reason === 'invalid-output' && calls(h).imageCalls === 5 &&
      state(h)?.providers.find(provider => provider.provider === 'openai')?.spentMicros === 17_500 || 'invalid output was accepted, retried or refunded'),
    act('another valid image exceeds the one-item recent retention bound', h => request(h, 'art-newest')),
    ended('art-newest', 'succeeded'),
    expect('the favorite survives and only the newest unsaved artwork remains', h => artwork(h, 'art-original')?.favorite === true && state(h)?.retention.recent === 1 && artwork(h, 'art-variation') === undefined || 'retention removed a favorite or kept obsolete recent art'),
    act('the owner explicitly dismisses and deletes the newest artwork', async h => {
      const artworkId = created(h, 'art-newest');
      await command(h, 'art-catalog-edit', 'art-dismiss', {action: 'feedback', artworkId, signal: 'dismiss'});
      await command(h, 'art-catalog-edit', 'art-delete', {action: 'delete', artworkId});
    }),
    expect('deleted art leaves the catalog and cannot be varied', async h => {
      const response = await h.gateway({as: 'browser', method: 'POST', path: '/api/v2/commands/art-request', body: {target: 'art', requestId: 'art-deleted-variation', data: {action: 'start', purpose: 'variation', origin: {kind: 'owner'}, targets: ['ui'], variationOf: created(h, 'art-newest')}}});
      return artwork(h, 'art-newest') === undefined ? refusedWith(response, 404, 'not-found') : 'deleted artwork remains visible';
    }),
    act('an image response is lost', async h => {h.simulate({device: 'art', action: 'lose-next'}); await request(h, 'art-lost');}),
    ended('art-lost', 'uncertain'),
    expect('the lost response keeps uncertain spend', h => (state(h)?.providers.find(provider => provider.provider === 'openai')?.uncertainMicros ?? 0) > 0 || 'lost usage was refunded'),
    act('a provider holds the next image while the runtime stops', async h => {h.simulate({device: 'art', action: 'hold'}); await request(h, 'art-interrupted');}),
    expect('one synthetic image call is in flight', h => calls(h).pending === 1 || 'no held image'),
    act('the runtime restarts on the same private art store', async h => {initialCalls.set(h, calls(h).imageCalls); await h.restart(); h.simulate({device: 'art', action: 'release'});}),
    ended('art-interrupted', 'uncertain'),
    expect('the favorite survives restart with readable original renditions', async h => {
      const original = artwork(h, 'art-original'), ref = original?.compositions.find(value => value.target === 'ui')?.renditions[0]?.ref;
      if (ref === undefined) return 'saved rendition missing';
      const response = await h.gateway({as: 'reader', method: 'GET', path: `/modules/art/content/${ref}`});
      return original?.favorite === true && response.status === 200 && response.headers['content-type']?.startsWith('image/webp') === true || 'saved rendition unreadable';
    }),
    holds('restart and lost responses never resend image calls', h => calls(h).imageCalls === initialCalls.get(h) || 'provider call replayed', 250),
    expect('private request text never enters the art state or diagnostic records', h => !JSON.stringify([state(h), h.logs()]).includes('SYNTHETIC_ART_MOON_GARDEN') || 'private prompt escaped'),
  ],
}, {
  id: 'art-spending-limit', title: 'the real ledger stops paid calls at the synthetic monthly ceiling and preserves it after restart',
  seed: {...seed, sections: {art: {limits: {openai: {monthlyCeilingUsd: 0.11}, anthropic: {monthlyCeilingUsd: 0}}, recentLimit: 2}}},
  steps: [
    ...[1, 2, 3].flatMap(index => [act(`the owner requests synthetic image ${index}`, h => request(h, `art-spend-${index}`)), ended(`art-spend-${index}`, 'succeeded')]),
    act('the fourth reservation would exceed the monthly ceiling', h => request(h, 'art-spend-refused')),
    ended('art-spend-refused', 'rejected'),
    expect('the limit refuses before another provider request', h => job(h, 'art-spend-refused')?.targets[0]?.reason === 'monthly-ceiling' && calls(h).imageCalls === 3 && calls(h).ideaCalls === 0 || 'spending gate sent a call'),
    act('the runtime restarts on its spent ledger', h => h.restart()),
    act('the owner requests again after restart', h => request(h, 'art-spend-after-restart')),
    ended('art-spend-after-restart', 'rejected'),
    expect('restart retains spent usage and does not refund the ceiling', h => calls(h).imageCalls === 3 && job(h, 'art-spend-after-restart')?.targets[0]?.reason === 'monthly-ceiling' && state(h)?.providers[0]?.spentMicros === 10_500 || 'ledger was reset'),
  ],
}];
