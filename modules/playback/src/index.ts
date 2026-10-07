// The playback module (Hub #929): `@jimmie-potts/playback`. The runtime's shipped list takes `playbackFactory`; the
// cutover's installer (#935) takes `convertHostPlayback`; tests and disposable runs take `SimulatedSpeakers`.
export {
  CALL_TIMEOUT_MS, PLAYBACK_CONTROL_SCHEMA, PLAYBACK_MODULE, PLAYBACK_SCHEMA, POLL_MS, RETAINED, controlPlayback, createPlaybackModule, playbackFactory,
  playbackKey, type PlaybackModuleOptions,
} from './module.js';
export {
  configurePlayback, convertHostPlayback, routingIdOf, type ConvertedPlayback, type PlaybackConfig, type PlaybackSection,
} from './configuration.js';
export {
  ACTIONS, Presentation, STALE_MS, UNAVAILABLE_MS, isAction, type Availability, type PlaybackAction, type PlaybackObservation, type PlaybackStatus,
  type PresentedView,
} from './playback.js';
export {createSource, type Deadline, type SourceConfiguration, type SpeakerKind, type SpeakerSource} from './sources.js';
export {SONY_METHODS, SONY_READ, sonyConfiguration, sonyObservation, sonySource, type SonyConfiguration} from './sony.js';
export {CONTROL_PATH, SONOS_ACTIONS, SONOS_READS, sonosConfiguration, sonosObservation, sonosSource, type SonosConfiguration} from './sonos.js';
export {SONOS_SERVICE, httpSpeakers, type SonosReply, type SonyReply, type SpeakerTransport} from './transport.js';
export {SimulatedSpeakers, type SimulatedKind, type SpeakerState, type SpeakersState, type Track} from './simulated.js';
