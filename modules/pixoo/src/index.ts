// The Pixoo runtime module (Hub #843): `@jimmie-potts/pixoo`. The runtime's shipped list takes `pixooFactory`; tests and
// disposable runs build the module with `SimulatedPixoo`, and the installer (#935) converts the Pixoo service's settings
// with `convertPixooSettings`.
export {PIXOO_MODULE, createPixooModule, pixooFactory, type PixooOptions, type PixooTiming} from './module/module.js';
export {DEFAULT_DEVICE_ID, HOSTED_PROFILE, SIMULATED_SECTION, configurePixoo, convertPixooSettings, type PixooConfig, type PixooSettingsFiles} from './module/configuration.js';
export {SimulatedPixoo, frameDigest, httpPixooTransport, type PixooTransport, type SimulatedMode, type SimulatedPixooState} from './module/transport.js';
export {FAMILIES, PIXOO_KIND, pixooOwnSchemas, pixooSchemas, schemaOf, type DisplayRecord, type PlaylistRecord, type RenditionRecord} from './module/schemas.js';
export {renderDashboard} from './presentation/dashboard-pixels.js';
export {DashboardPager} from './presentation/agent-dashboard.js';
export {monitorView} from './presentation/sources.js';
export {nowPlayingView, renderNowPlaying} from './presentation/now-playing.js';
