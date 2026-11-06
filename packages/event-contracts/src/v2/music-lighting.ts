import type {Message, MessageValidator} from './index.js';
import {defineFamily, registerFamilies, routedSubject} from './registry.js';

export * from './music-lighting-data.js';
import type {LightingDeviceState, LightingState} from './music-lighting-data.js';

const lightSubject = routedSubject('device');
/** A state record names its own light, so a record cannot be published under another light's key. */
const ownRecord = (message: Message): string | undefined => lightSubject(message)
  ?? (message.subject === (message.data as LightingState | LightingDeviceState).id ? undefined : 'envelope /subject must name the record\'s light');

export const musicLightingFamilies = [
  defineFamily('music-lighting-control', 'command', 'org.bunny.music-lighting.control.requested', lightSubject),
  defineFamily('music-lighting-state', 'state', 'org.bunny.music-lighting.updated', ownRecord),
  defineFamily('music-lighting-work', 'command', 'org.bunny.music-lighting.work.requested', lightSubject),
  defineFamily('music-lighting-device', 'state', 'org.bunny.music-lighting-device.updated', message => {
    const session = (message.data as LightingDeviceState).session;
    return ownRecord(message) ?? (session?.status === 'ended' && session.ended.generation !== session.generation
      ? 'payload /session/ended must name the session generation' : undefined);
  }),
] as const;
export function registerMusicLightingFamilies(validator: MessageValidator): void {registerFamilies(validator, musicLightingFamilies);}
