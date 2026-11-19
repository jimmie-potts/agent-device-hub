import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MUSIC_PLAYBACK_SOURCE, type MusicPlaybackField, type MusicPlaybackSample, type MusicPlaybackWork} from '@jimmie-potts/event-contracts/v2/music-playback';
import {connectRemote} from '@jimmie-potts/sdk';

const libraryScopeId = 'fixture-library';
const itemId = 'F17E';

/** Synthetic Music read evidence over the same disposable gateway as the capture fixture. */
export async function musicPlaybackProducer(url: string, token: string) {
  const client = await connectRemote({url, token, source: MUSIC_PLAYBACK_SOURCE});
  try {
    const endpoint = await client.openEndpoint<MusicPlaybackWork>({family: 'music-playback-work', respond: () => {
      throw new Error('The synthetic playback fixture serves observations only.');
    }});
    const registration = await endpoint.request('music-playback-endpoint', {type: 'org.bunny.music-playback.endpoint.requested',
      dataschema: 'https://bunny.invalid/events/music-playback-endpoint/2.0',
      data: {requestId: randomUUID(), action: 'enable', libraryScopeId}}, {timeoutMs: 5000});
    assert.equal(registration.status, 'accepted');
    const processEpoch = randomUUID();
    let sequence = 0, playingItem = itemId;
    let anchor = {atMs: Date.now(), positionMs: 1000};
    return {
      item: {libraryScopeId, itemId},
      async observe(change: {itemId: string; positionMs: number} | undefined = undefined) {
        const now = Date.now();
        if (change !== undefined) {
          playingItem = change.itemId;
          anchor = {atMs: now, positionMs: change.positionMs};
        }
        const interval = {earliestAtMs: now - 10, latestAtMs: now};
        const field = <T>(value: T): MusicPlaybackField<T> => ({status: 'observed', value, interval});
        const sample: MusicPlaybackSample = {
          sequence: ++sequence, interval, clockUncertaintyMs: 50, discontinuity: sequence === 1 || change !== undefined, status: 'sample',
          processEpoch, libraryScopeId, state: field('playing'), position: field((anchor.positionMs + now - anchor.atMs) / 1000), item: field(playingItem),
          itemAssociation: {status: 'bounded-match', interval},
          metadata: {title: field(playingItem === itemId ? 'Synthetic Music' : 'Synthetic different Music item'), artist: field('Synthetic artist'), album: field('Synthetic album'), durationSeconds: field(120)},
          outputSelection: {status: 'observed', provenance: 'music-declared-selection', interval, selectionInterval: interval,
            airPlayEnabled: field(false), devices: []},
        };
        await endpoint.publish<MusicPlaybackSample>('music-playback-observation', {kind: 'occurrence', type: 'org.bunny.music-playback.observed',
          dataschema: 'https://bunny.invalid/events/music-playback-observation/2.0', data: sample});
      },
      async close() {await endpoint.close(); await client.close();},
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}
