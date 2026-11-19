import {createHash} from 'node:crypto';
import type {MusicOutputSelection, MusicPlaybackSample, PlaybackPositionState} from '@jimmie-potts/event-contracts/v2/music-playback';
import type {MeasuredItem} from './music-show-data.js';

const POSITION_VALIDITY_MS = 5000;
const MAX_POSITION_INTERVAL_MS = 600;
const POSITION_READING_TOLERANCE_MS = 25;

export type MeasuredPosition = Readonly<{
  item: MeasuredItem; revision: number; context: string; discontinuity: boolean; seekRevision: number; paused: boolean; positionMs: number;
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
    discontinuity: observation.discontinuity, seekRevision: observation.discontinuity ? position.revision : 0, paused: state === 'paused', positionMs: Math.floor(observation.position.value * 1000 + elapsed)};
}


function observedMovement(sample: MusicPlaybackSample | undefined) {
  return sample?.state.status === 'observed' && sample.state.value === 'playing' && sample.position.status === 'observed'
    ? sample.position : undefined;
}

/** Confirm that the second sampled position fits the time that could have passed between native reads. */
export function matchesPlaybackProgress(previous: PlaybackPositionState | undefined, current: PlaybackPositionState): boolean {
  const before = observedMovement(previous?.evidence.status === 'observed' ? previous.evidence.observation : undefined);
  const after = observedMovement(current.evidence.status === 'observed' ? current.evidence.observation : undefined);
  if (before === undefined || after === undefined) return false;
  const distance = (after.value - before.value) * 1000;
  const minimum = after.interval.earliestAtMs - before.interval.latestAtMs;
  const maximum = after.interval.latestAtMs - before.interval.earliestAtMs;
  return minimum >= 0 && distance >= Math.max(0, minimum - POSITION_READING_TOLERANCE_MS)
    && distance <= maximum + POSITION_READING_TOLERANCE_MS;
}
