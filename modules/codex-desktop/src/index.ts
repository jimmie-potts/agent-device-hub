// The Codex Desktop runtime module (Hub #926): the module and its factory, its configuration and the cutover's
// conversion, the read evidence rules, the marker and its readers, and the simulated marker tests and disposable runs use.
export {LIFECYCLE_SCHEMA, MARKER_DEVICE, MODULE_NAME, POLL_MS, READ_BACKOFF_MAX_MS, READ_TIMEOUT_MS, RESEND_FIRST_MS, RESEND_MAX_MS, createCodexDesktopModule, markerDeviceOf, type CodexDesktopModuleOptions} from './module.js';
export {MAX_SOURCES, configureCodexDesktop, convertHubCodexDesktop, remoteOnlySection, type CodexDesktopConfig, type DesktopSourceConfig, type LegacySection} from './configuration.js';
export {DESKTOP_METADATA_KEYS, DESKTOP_METADATA_SCHEMA, DESKTOP_METADATA_TYPE, FEED_FRESH_MS, RemoteFeed, RemoteFeeds, type FeedRefusal} from './remote.js';
export {READ_SETTLE_MS, readEvidence, readObservation, type DesktopSource, type Evidence} from './evidence.js';
export {MARKER_FILE, MAX_MARKER_BYTES, markerReadOf, readMarker, unreadSessions, type MarkerRead} from './marker.js';
export {folderReader, type MarkerTransport} from './transport.js';
export {readDesktopMetadata, metadataOf, type DesktopMetadata} from './metadata.js';
export {serveReads, type ReadMarker} from './serve.js';
export {SimulatedMarker, type MarkerState} from './simulated.js';
export {CODEX_DESKTOP_SIMULATED_SECTION, codexDesktopFactory} from './factory.js';
export {codexDesktopSimulation, registration} from './registration.js';
