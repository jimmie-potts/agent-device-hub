import {createHash} from 'node:crypto';
import type {MusicOutputSelection, PlaybackPositionState} from '@jimmie-potts/event-contracts/v2/music-playback';
import type {MeasuredItem} from './music-show-data.js';

const POSITION_VALIDITY_MS = 5000;
const MAX_POSITION_INTERVAL_MS = 600;

export type MeasuredPosition = Readonly<{
  item: MeasuredItem; revision: number; context: string; discontinuity: boolean; paused: boolean; positionMs: number;
}>;

export function sameMeasuredItem(left: MeasuredItem, right: MeasuredItem): boolean {
  return left.libraryScopeId === right.libraryScopeId && left.itemId === right.itemId;
}

function declaredOutput(selection: MusicOutputSelection): unknown {
  if (selection.status !== 'observed' || selection.airPlayEnabled.status !== 'observed') return null;
  const devices = selection.devices.map(device => [device.ordinal, device.name, device.kind, device.active, device.available, device.selected]
    .map(field => typeof field === 'number' ? field : field.status === 'observed' ? field.value : null));
  return [selection.airPlayEnabled.value, devices];
}

/** Uses the midpoint of the bounded native read interval and expires at the oldest possible observation time. */
export function measuredPosition(position: PlaybackPositionState | undefined, wallMs: number): MeasuredPosition | undefined {
  if (position?.source !== 'music' || position.availability !== 'available' || position.evidence.status !== 'observed') return undefined;
  const {endpointId, observation} = position.evidence;
  if (observation.itemAssociation.status !== 'bounded-match' || observation.position.status !== 'observed'
      || observation.item.status !== 'observed' || observation.state.status !== 'observed') return undefined;
  const {earliestAtMs, latestAtMs} = observation.position.interval;
  const state = observation.state.value, output = declaredOutput(observation.outputSelection);
  if (state !== 'playing' && state !== 'paused'
      || !Number.isFinite(wallMs) || earliestAtMs > wallMs || wallMs - earliestAtMs >= POSITION_VALIDITY_MS
      || wallMs - observation.state.interval.earliestAtMs >= POSITION_VALIDITY_MS
      || latestAtMs < earliestAtMs || latestAtMs - earliestAtMs > MAX_POSITION_INTERVAL_MS) return undefined;
  const elapsed = state === 'playing' ? Math.max(0, wallMs - (earliestAtMs + latestAtMs) / 2) : 0;
  return {item: {libraryScopeId: observation.libraryScopeId, itemId: observation.item.value},
    revision: position.revision, context: createHash('sha256').update(JSON.stringify([position.presentationGeneration, endpointId, observation.processEpoch, output])).digest('hex'),
    discontinuity: observation.discontinuity, paused: state === 'paused', positionMs: Math.floor(observation.position.value * 1000 + elapsed)};
}
