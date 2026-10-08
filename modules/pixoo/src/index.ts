// The Pixoo runtime module (Hub #843): `@jimmie-potts/pixoo`. The runtime's shipped list takes `pixooFactory`; tests and
// disposable runs build the module with `SimulatedPixoo`, and the installer (#935) converts the Pixoo service's settings
// with `convertPixooSettings` and migrates its library with the runtime's `migrate-pixoo` tool, which runs
// `migrateLibrary` and `verifyMigration` (#931).
export {PIXOO_MODULE, createPixooModule, pixooFactory, type PixooOptions, type PixooTiming} from './module/module.js';
export {pixooSimulation, registration} from './module/registration.js';
export {DEFAULT_DEVICE_ID, HOSTED_PROFILE, SIMULATED_SECTION, configurePixoo, convertPixooSettings, type PixooConfig, type PixooSettingsFiles} from './module/configuration.js';
export {SimulatedPixoo, frameDigest, httpPixooTransport, type PixooTransport, type SimulatedMode, type SimulatedPixooState} from './module/transport.js';
export {FAMILIES, PIXOO_KIND, pixooOwnSchemas, pixooSchemas, schemaOf, type DisplayRecord, type PlaylistRecord, type RenditionRecord} from './module/schemas.js';
export {renderDashboard} from './presentation/dashboard-pixels.js';
export {DashboardPager} from './presentation/agent-dashboard.js';
export {monitorView} from './presentation/sources.js';
export {nowPlayingView, renderNowPlaying} from './presentation/now-playing.js';
export {
  INSTALLED_LIBRARY, InstalledLibrary, MIGRATION_SCHEMA, MigrationError, migrateLibrary, verifyMigration, writeSyntheticLibrary, type Destination, type MigratedStore,
  type MigrationCode, type MigrationReport, type Mismatches, type SyntheticLibrary, type VerificationReport,
} from './migration/index.js';
