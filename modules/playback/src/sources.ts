// One speaker, as the playback module polls and commands it. A source has no ID of its own: clients see only the
// playback ID, and logs name a source by its kind (Hub #233).
import type {PlaybackAction, PlaybackObservation} from './playback.js';
import {sonosSource, type SonosConfiguration} from './sonos.js';
import {sonySource, type SonyConfiguration} from './sony.js';
import type {SpeakerTransport} from './transport.js';

export type SpeakerKind = 'sony' | 'sonos';
export type SourceConfiguration = SonyConfiguration | SonosConfiguration;
/** Runs one call with a signal that aborts at the call's deadline or when the module stops. */
export type Deadline = <T>(call: (signal: AbortSignal) => Promise<T>) => Promise<T>;

export interface SpeakerSource {
  readonly kind: SpeakerKind;
  /** One complete read, normalized. Rejects when any call fails: a failed read is never an observation. */
  read(): Promise<PlaybackObservation>;
  /**
   * Sends `action` once. Resolves `sent` when the speaker took it, or `failed` when it refused before any effect.
   * Rejects when the result is uncertain: no answer by the deadline, or an answer that is neither.
   */
  command(action: PlaybackAction): Promise<'sent' | 'failed'>;
}

/** The source for one configured speaker. */
export function createSource(config: SourceConfiguration, transport: SpeakerTransport, deadline: Deadline): SpeakerSource {
  switch (config.kind) {
    case 'sony':
      return sonySource(config, transport, deadline);
    case 'sonos':
      return sonosSource(config, transport, deadline);
  }
}
