import type {PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import {moduleOwner, type ModuleEntry} from './modules.ts';

/** Only the current synced owner and its running catalog declaration admit an image request. */
export function playbackArtworkUrl(record: PlaybackState, owner: string, live: boolean, modules: readonly ModuleEntry[] | undefined): string | undefined {
  const image = record.artwork;
  if (!live || record.availability !== 'available' || record.playback.status !== 'known'
    || (record.playback.player !== 'playing' && record.playback.player !== 'paused') || image?.status !== 'ready'
    || image.mediaType !== 'image/png' || !Number.isSafeInteger(record.revision) || record.revision < 1
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(image.generation)) return undefined;
  const owners = modules?.filter(module => moduleOwner(module.name) === owner);
  const module = owners?.length === 1 ? owners[0] : undefined;
  if (module?.state !== 'running' || !module.serves.includes('playback')) return undefined;
  return `/modules/${module.name}/content/artwork.${image.generation}.${record.revision}`;
}
