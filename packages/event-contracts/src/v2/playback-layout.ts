import type {Message} from './index.js';
import {defineFamily} from './registry.js';

export type PlaybackPlacement = {playback: string; rooms: string[]};
export type PlaybackLayoutRecord = {id: 'playback'; revision: number; assignments: PlaybackPlacement[]};
export type PlaybackLayoutSetRequest = {requestId: string; expectedRevision: number; assignments: PlaybackPlacement[]};

function checkPlacement(message: Message): string | undefined {
  if (message.subject !== 'playback') return 'envelope /subject must be playback';
  if (message.kind === 'state' && message.source !== 'bunny/core') return 'envelope /source not the core';
  const {assignments} = message.data as PlaybackLayoutRecord | PlaybackLayoutSetRequest;
  if (new Set(assignments.map(item => item.playback)).size !== assignments.length) return 'payload /assignments duplicate playback identity';
  return undefined;
}

export const playbackLayoutFamilies = [
  defineFamily('playback-layout', 'state', 'org.bunny.playback-layout.updated', checkPlacement),
  defineFamily('playback-layout-set', 'command', 'org.bunny.playback-layout.set.requested', checkPlacement),
] as const;
