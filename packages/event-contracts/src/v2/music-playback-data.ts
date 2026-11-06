import type {ErrorDetail} from './errors.js';

export const MUSIC_PLAYBACK_SOURCE = 'bunny/parts/music-playback';
export const MUSIC_PLAYBACK_OWNER = 'bunny/modules/playback';
export const MUSIC_PLAYBACK_POLL_MS = 2000;
export const MUSIC_PLAYBACK_WORK_MS = 3000;
export const MUSIC_PLAYBACK_RESULT_MS = 4000;
export const MUSIC_PLAYBACK_CLOCK_SKEW_MS = 100;
export const MUSIC_PLAYBACK_REGISTRATION_SKEW_MS = 50;
export const MUSIC_PLAYBACK_CLOCK_DRIFT_MS = 25;
export type MusicPlaybackAction = 'play' | 'pause' | 'next' | 'previous';
export type MusicPlaybackError = Pick<ErrorDetail, 'code' | 'retryable'>;
/** Conservative runtime-wall bounds for the original native request/reply interval. */
export type MusicPlaybackInterval = {earliestAtMs: number; latestAtMs: number};
export type MusicPlaybackField<T> = {status: 'observed'; value: T; interval: MusicPlaybackInterval}
  | {status: 'unavailable'; error: MusicPlaybackError; interval: MusicPlaybackInterval};
export type MusicPlayerState = 'playing' | 'paused' | 'stopped' | 'fast-forwarding' | 'rewinding';
export type MusicOutputKind = 'computer' | 'airport-express' | 'apple-tv' | 'airplay-device' | 'bluetooth' | 'homepod' | 'tv' | 'unknown';
export type MusicOutputSelection = {status: 'unavailable'; error: MusicPlaybackError; interval: MusicPlaybackInterval} | {
  status: 'observed'; provenance: 'music-declared-selection'; interval: MusicPlaybackInterval; selectionInterval: MusicPlaybackInterval;
  airPlayEnabled: MusicPlaybackField<boolean>;
  devices: {ordinal: number; name: MusicPlaybackField<string>; kind: MusicPlaybackField<MusicOutputKind>;
    active: MusicPlaybackField<boolean>; available: MusicPlaybackField<boolean>; selected: MusicPlaybackField<boolean>}[];
};
type MusicObservationBase = {sequence: number; interval: MusicPlaybackInterval; clockUncertaintyMs: number; discontinuity: boolean};
export type MusicPlaybackSample = MusicObservationBase & {
  status: 'sample'; processEpoch: string; libraryScopeId: string;
  state: MusicPlaybackField<MusicPlayerState>; position: MusicPlaybackField<number>; item: MusicPlaybackField<string>;
  itemAssociation: {status: 'bounded-match'; interval: MusicPlaybackInterval} | {status: 'unavailable'};
  metadata: {title: MusicPlaybackField<string>; artist: MusicPlaybackField<string>; album: MusicPlaybackField<string>;
    durationSeconds: MusicPlaybackField<number>};
  outputSelection: MusicOutputSelection;
};
export type MusicPlaybackObservation = MusicPlaybackSample | (MusicObservationBase & {status: 'unavailable'; error: MusicPlaybackError});
export type MusicPlaybackEndpoint = {requestId: string} & ({action: 'enable'; libraryScopeId: string} | {action: 'disable'});
export type MusicPlaybackWork = {requestId: string; operationId: string; processEpoch: string; action: MusicPlaybackAction};
export type MusicPlaybackResult = Omit<MusicPlaybackWork, 'requestId'> &
  ({status: 'sent'} | {status: 'unsent' | 'refused' | 'uncertain'; error: MusicPlaybackError});
export type MusicPlaybackLost = {id: string};
export type PlaybackPositionState = {
  id: string; revision: number; playbackRevision: number; presentationGeneration: string;
  source: 'sony' | 'sonos' | 'music' | null; availability: 'available' | 'stale' | 'unavailable';
  recordingAssociation: 'unqualified';
  evidence: {status: 'unavailable'; reason: 'unsupported' | 'missing' | 'clock' | 'disconnected'}
    | {status: 'observed'; endpointId: string; observation: MusicPlaybackSample};
};
