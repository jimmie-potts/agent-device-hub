import {RETRYABLE} from './errors.js';
import type {Message, MessageValidator} from './index.js';
import {defineFamily, registerFamilies, routedSubject} from './registry.js';
import type {MusicPlaybackError, MusicPlaybackField, MusicPlaybackInterval, MusicPlaybackLost, MusicPlaybackObservation,
  MusicPlaybackResult, MusicPlaybackSample, PlaybackPositionState} from './music-playback-data.js';
export * from './music-playback-data.js';

const endpointSubject = routedSubject('routing');
const errorValid = (error: MusicPlaybackError): boolean => RETRYABLE[error.code] === error.retryable;
const intervalValid = (interval: MusicPlaybackInterval, outer: MusicPlaybackInterval = interval): boolean =>
  interval.earliestAtMs <= interval.latestAtMs && outer.earliestAtMs <= interval.earliestAtMs && interval.latestAtMs <= outer.latestAtMs;
function fieldValid<T>(field: MusicPlaybackField<T>, outer: MusicPlaybackInterval, bytes?: number): boolean {
  return intervalValid(field.interval, outer) && (field.status === 'unavailable' ? errorValid(field.error)
    : bytes === undefined || typeof field.value !== 'string' || Buffer.byteLength(field.value, 'utf8') <= bytes);
}
function sampleValid(sample: MusicPlaybackSample): boolean {
  const {interval, state, position, item, metadata, itemAssociation, outputSelection} = sample;
  if (!intervalValid(interval) || !fieldValid(state, interval) || !fieldValid(position, interval) || !fieldValid(item, interval)
    || !fieldValid(metadata.title, interval, 256) || !fieldValid(metadata.artist, interval, 256)
    || !fieldValid(metadata.album, interval, 256) || !fieldValid(metadata.durationSeconds, interval)) return false;
  if (itemAssociation.status === 'bounded-match' && (item.status !== 'observed' || !intervalValid(itemAssociation.interval, interval)
    || (position.status === 'observed' && !intervalValid(position.interval, itemAssociation.interval)))) return false;
  if (!intervalValid(outputSelection.interval, interval)) return false;
  if (outputSelection.status === 'unavailable') return errorValid(outputSelection.error);
  return intervalValid(outputSelection.selectionInterval, outputSelection.interval) && fieldValid(outputSelection.airPlayEnabled, outputSelection.interval)
    && outputSelection.devices.every((device, index) => device.ordinal === index && fieldValid(device.name, outputSelection.interval, 128)
      && fieldValid(device.kind, outputSelection.interval) && fieldValid(device.active, outputSelection.interval)
      && fieldValid(device.available, outputSelection.interval) && fieldValid(device.selected, outputSelection.interval));
}
function checkObservation(message: Message): string | undefined {
  const subject = endpointSubject(message);
  if (subject !== undefined) return subject;
  const observation = message.data as MusicPlaybackObservation;
  const valid = observation.status === 'sample' ? sampleValid(observation) : intervalValid(observation.interval) && errorValid(observation.error);
  return valid ? undefined : 'payload Music observation has contradictory intervals, identity, fields or error flags';
}
function checkPosition(message: Message): string | undefined {
  const state = message.data as PlaybackPositionState;
  if (message.subject !== state.id) return 'envelope /subject must name the playback record';
  if (state.playbackRevision > state.revision) return 'payload playback revision must not exceed the owner revision';
  if (state.evidence.status === 'observed' && (state.source !== 'music' || state.availability === 'unavailable' || !sampleValid(state.evidence.observation)))
    return 'payload observed position requires qualified Music presentation evidence';
  return undefined;
}
export const musicPlaybackFamilies = [
  defineFamily('music-playback-endpoint', 'command', 'org.bunny.music-playback.endpoint.requested', endpointSubject),
  defineFamily('music-playback-observation', 'occurrence', 'org.bunny.music-playback.observed', checkObservation),
  defineFamily('music-playback-work', 'command', 'org.bunny.music-playback.work.requested', endpointSubject),
  defineFamily('music-playback-result', 'occurrence', 'org.bunny.music-playback.result.observed', message => {
    const result = message.data as MusicPlaybackResult;
    return endpointSubject(message) ?? (result.status !== 'sent' && (!errorValid(result.error)
      || result.status === 'uncertain' && result.error.code !== 'uncertain-result') ? 'payload result error must retain its registered meaning' : undefined);
  }),
  defineFamily('music-playback-lost', 'occurrence', 'org.bunny.music-playback.endpoint-lost', message =>
    message.subject === (message.data as MusicPlaybackLost).id ? undefined : 'envelope /subject must name the lost endpoint'),
  defineFamily('playback-position', 'state', 'org.bunny.playback.position.updated', checkPosition),
] as const;
export function registerMusicPlaybackFamilies(validator: MessageValidator): void {registerFamilies(validator, musicPlaybackFamilies);}
