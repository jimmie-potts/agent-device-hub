import type {ArtJobSummary, ArtState, ArtRecord, ArtworkSummary} from '@jimmie-potts/event-contracts/v2/art-state';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {TRONBYT_SIMULATED_SECTION, type TronbytState} from '@jimmie-potts/tidbyt';
import type {SharedArtFixture} from '../../fixtures/presentation.js';
import {PIXOO_SECTION, pixooStatusBase} from './pixoo.js';
import {PLAYBACK_SECTION} from './playback.js';
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
const sharedState = (h: Harness): ArtRecord | undefined => h.reader.states<ArtRecord>('art', OWNER)[0]?.data;
const moments = (h: Harness) => h.reader.states<OperationRecord>('operation', 'bunny/core').map(message => message.data).filter(record => record.family === 'moment-play');
const fixture = async (h: Harness): Promise<SharedArtFixture | undefined> => bodyOf<SharedArtFixture>(await h.gateway({as: 'reader', method: 'GET', path: '/modules/presentation-fixture/content/result'}));
const sharedSyncs = new WeakMap<Harness, number>();
const {nowPlaying: _unusedCard, ...sharedTidbyt} = TRONBYT_SIMULATED_SECTION;

export const scenarios: readonly Scenario[] = [{
  id: 'shared-art', title: 'one saved idea selects the browser and gives exact displays independent tracked outcomes',
  memoryTimeoutMs: 60_000,
  seed: {modules: ['core', 'playback', 'pixoo', 'tidbyt', 'art', 'presentation-fixture'], sections: {art: {recentLimit: 1}},
    config: {playback: PLAYBACK_SECTION, pixoo: {device: {...PIXOO_SECTION.device, id: 'desk-display'}}, tidbyt: {...sharedTidbyt, id: 'shelf-display'}},
    follows: [{owner: OWNER, families: ['art']}, {owner: 'bunny/core', families: ['operation']},
      {owner: 'bunny/modules/pixoo', families: ['device']}, {owner: 'bunny/modules/tidbyt', families: ['device']}]},
  keepCapturePage: true,
  capture: async (context, h) => {
    const value = sharedState(h);
    if (value === undefined || !('selection' in value) || value.selection === null) throw new StepFailure('the browser selection is missing');
    const {captureSharedArt} = await import('../../../verify/shared-art-browser.js');await captureSharedArt(context, value.selection.artworkId);
  },
  steps: [
    expect('the producer and both configured display owners are ready', h => running(h, ['core', 'art', 'pixoo', 'tidbyt', 'presentation-fixture'])),
    ...pixooStatusBase('desk-display'),
    expect('the synthetic caller holds its initial Art copy without starting a plan', async h => {const value = await fixture(h);return value?.ready === true && value.plan === undefined || (value?.failure ?? 'fixture copy not ready');}),
    expect('current noncanonical display records declare exact art', h => ['desk-display', 'shelf-display'].every(id => h.reader.states<DeviceRecord>('device').some(message =>
      message.data.id === id && message.data.availability === 'available' && message.data.capabilities.moments.supported && message.data.capabilities.moments.art !== undefined)) || 'current art-capable display records missing', 5000),
    expect('the producer has synchronized both display routes', h => h.logs().filter(({record}) => record.event_name === 'runtime.sync.served'
      && record.attributes['bunny.participant'] === OWNER && record.attributes['bunny.pattern'] === 'sync device').length >= 2 || 'producer display routes are not current', 5000),
    act('the owner creates one synthetic idea for the browser and both displays', h => request(h, 'shared-art-seed', ['ui', 'pixoo', 'tidbyt'])),
    ended('shared-art-seed', 'succeeded'),
    expect('both display preparations succeed before their moment admissions', h => {
      const tracked = h.reader.states<OperationRecord>('operation', 'bunny/core').map(message => message.data);
      return tracked.filter(record => record.family === 'art-auto' && record.result === 'succeeded').length >= 2
        && moments(h).length === 2 && moments(h).every(record => record.status === 'accepted') || 'independent preparation or moment admission missing';
    }, 4000),
    act('an explicit favorite edit asks the synthetic caller to submit the identical pending plan again', h => command(h, 'art-catalog-edit', 'shared-art-duplicate', {action: 'favorite', artworkId: created(h, 'shared-art-seed'), favorite: true})),
    expect('duplicate intent is observed without another moment operation', async h => (await fixture(h))?.duplicates === 1 && moments(h).length === 2 || 'duplicate intent changed the operation count'),
    act('the synthetic Pixoo disconnects before the planned start', h => {h.simulate({device: 'pixoo', action: 'offline'});}),
    expect('the browser commits the original exact composition at the common start', async h => {
      const proof = await fixture(h), current = sharedState(h);
      if (proof?.failure !== undefined) return proof.failure;
      return proof?.plan !== undefined && proof.result !== undefined && !('error' in proof.result)
        && proof.result.displays.every(value => value.prepare.status === 'tracked' && value.moment.status === 'tracked')
        && current !== undefined && 'selection' in current && current.selection?.artworkId === proof.plan.artworkId
        && current.selection.compositionId === proof.plan.browser?.compositionId || 'exact browser selection or independently tracked handoffs missing';
    }, 6000),
    expect('the lost Pixoo leaves its own failure while the Tidbyt animation remains independently visible in simulation', h => {
      const pixoo = moments(h).find(record => record.target === 'desk-display'), server = deviceState<TronbytState>(h, 'tidbyt');
      return pixoo?.result === 'failed' && server.installations.bunnymoment?.animation?.frames.length === 8 || 'independent failed Pixoo or exact Tidbyt animation missing';
    }, 15_000),
    expect('the Tidbyt completes its own longer hold without changing the Pixoo result', h => moments(h).find(record => record.target === 'shelf-display')?.result === 'succeeded'
      && moments(h).find(record => record.target === 'desk-display')?.result === 'failed' || 'the independent outcomes did not settle', 35_000),
    expect('saved-art preparation and browser selection made no additional provider calls', h => calls(h).imageCalls === 3 && calls(h).ideaCalls === 1 || 'reuse regenerated art'),
    act('the owner removes the favorite flag and creates a newer browser composition', async h => {
      await command(h, 'art-catalog-edit', 'shared-art-unfavorite', {action: 'favorite', artworkId: created(h, 'shared-art-seed'), favorite: false});
      await request(h, 'shared-art-newer');
    }),
    ended('shared-art-newer', 'succeeded'),
    expect('newer art and recent pruning cannot replace the selected idea', h => {
      const current = sharedState(h), original = created(h, 'shared-art-seed');
      return current !== undefined && 'selection' in current && current.selection?.artworkId === original && current.artworks.some(value => value.artworkId === original)
        && current.retention.recentLimit === 1 && current.retention.recent === 2 || 'selection or selected bytes were pruned';
    }),
    act('the runtime restarts with its selected art and completed independent results', async h => {sharedSyncs.set(h, h.reader.syncs('art', OWNER));await h.restart();}),
    expect('restarted owners run and the reader obtains a fresh selected-art copy', async h => {
      const current = sharedState(h);
      return await running(h, ['core', 'art', 'pixoo', 'tidbyt', 'presentation-fixture']) === true && h.reader.syncs('art', OWNER) > (sharedSyncs.get(h) ?? Infinity)
        && current !== undefined && 'selection' in current && current.selection?.artworkId === created(h, 'shared-art-seed') || 'fresh retained selection missing';
    }, 5000),
    holds('restart initiates no presentation and repeats no provider call or moment', async h => {
      const proof = await fixture(h);
      return proof?.plan === undefined && proof?.duplicates === 0 && calls(h).imageCalls === 4 && calls(h).ideaCalls === 2 && moments(h).length === 2 || 'restart replayed saved intent';
    }, 250),
  ],
}, {
  id: 'art-theme', title: 'decoded contrasting art changes decoration while local lock and default remain under owner control',
  seed: {...seed, sections: {art: {recentLimit: 8}}}, keepCapturePage: true,
  capture: async (context, harness) => {const {captureArtTheme} = await import('../../../verify/art-theme.js');await captureArtTheme(context, harness);},
  steps: [
    expect('core and art are running', h => running(h, ['core', 'art'])),
    ...(['warm', 'cool'] as const).flatMap(colors => [
      act(`prepare a synthetic ${colors} browser composition`, async h => {h.simulate({device: 'art', action: `${colors}-colors`});await request(h, `art-theme-${colors}`);}),
      ended(`art-theme-${colors}`, 'succeeded'),
    ]),
    expect('two decoded compositions have distinct pixel-derived palettes', h => {
      const warm = artwork(h, 'art-theme-warm'), cool = artwork(h, 'art-theme-cool');
      return warm?.compositions.some(value => value.target === 'ui' && value.outcome === 'succeeded') === true && cool?.compositions.some(value => value.target === 'ui' && value.outcome === 'succeeded') === true && warm.palette.length > 0 && cool.palette.length > 0 && JSON.stringify(warm.palette) !== JSON.stringify(cool.palette) || 'contrasting ready palettes missing';
    }),
    expect('the two explicit requests made two synthetic ideas and images', h => calls(h).imageCalls === 2 && calls(h).ideaCalls === 2 || 'unexpected generation'),
  ],
}, {
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
