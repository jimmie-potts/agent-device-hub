// The Tidbyt module (Hub #930): `@jimmie-potts/tidbyt`. The runtime's shipped list takes `tidbytFactory`; the cutover's
// installer (#935) takes `convertTidbytRunner`; tests and disposable runs take `SimulatedCloud`, and the catalog draws
// its expected tiles with the views, the frames and `picture`.
export {
  CALL_TIMEOUT_MS, COMMAND_FAMILIES, DEVICE_SCHEMA, MIN_INTERVAL_MS, NOW_PLAYING_POLL_MS, NO_CONTROLS, REFRESH_MS, RENDER_TIMEOUT_MS, RESYNC_FIRST_MS,
  RESYNC_MAX_MS, SIMULATED_SECTION, STATUS_POLL_MS, SYNC_TIMEOUT_MS, TIDBYT_MODULE, createTidbytModule, deviceKey, deviceState, reportsUnavailable,
  tidbytFactory, type TidbytModuleOptions, type TidbytTiming,
} from './module.js';
export {registration, tidbytSimulation} from './registration.js';
export {
  API_KEY_SECRET, DEFAULT_DEVICE_ID, DEFAULT_NOW_PLAYING_INSTALLATION, DEFAULT_STATUS_INSTALLATION, configureTidbyt, convertTidbytRunner,
  parseRunnerCredentials, playbackIdOf, type ConvertedTidbyt, type RunnerCredentials, type TidbytConfig, type TidbytSection,
} from './configuration.js';
export {
  API, CLOUD_DEVICE_ID, CloudConfigurationError, INSTALLATION_ID, MAX_ADDITIONAL_INSTALLATIONS, TidbytCloudConnection, type CloudConfig, type CloudFailure,
  type CloudFetch, type ListResult, type WriteResult,
} from './cloud.js';
export {CloudQueue, TileWriter, type CallKind, type NotSent, type TileCall, type TileMemory, type TileTarget, type TileWriterOptions} from './writer.js';
export {FRAME_BYTES, FRAME_HEIGHT, FRAME_WIDTH, renderFrame, type Frame, type FrameFailure} from './render.js';
export {LABEL_CHARS, STATUS_COLORS, STATUS_ROWS, statusFrame, statusView, type StatusRow, type StatusState, type StatusView, type StatusViewOptions} from './status.js';
export {
  CARD_COLUMNS, CARD_ROWS, NOW_PLAYING_COLORS, PLAYBACK_LOST_MS, cardLines, nowPlayingFrame, nowPlayingView, type CardLine, type CardView,
  type NowPlayingView, type PlaybackFeed,
} from './nowplaying.js';
export {renderTile, tileFrame, type TileReply, type TileRequest} from './tiles.js';
export {decodeLossless, picture} from './picture.js';
export {acquireLease, type Lease, type LeaseRefusal, type LeaseResult} from './lease.js';
export {
  REMEMBERED_CALLS, SIMULATED_API_KEY, SIMULATED_DEVICE, SimulatedCloud, type CloudCall, type CloudState, type ShownInstallation, type SimulatedCloudOptions,
} from './simulated.js';
