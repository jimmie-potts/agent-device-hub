// The Codex Desktop runtime module (Hub #926): the module and its factory, its configuration and the cutover's
// conversion, the read evidence rules, the marker and its readers, and the simulated marker tests and disposable runs use.
export {LIFECYCLE_SCHEMA, MARKER_DEVICE, MODULE_NAME, POLL_MS, READ_BACKOFF_MAX_MS, READ_TIMEOUT_MS, RESEND_FIRST_MS, RESEND_MAX_MS, createCodexDesktopModule, type CodexDesktopModuleOptions} from './module.js';
export {configureCodexDesktop, convertHubCodexDesktop, type CodexDesktopConfig} from './configuration.js';
export {READ_SETTLE_MS, readEvidence, readObservation, type DesktopSource, type Evidence} from './evidence.js';
export {MARKER_FILE, MAX_MARKER_BYTES, markerReadOf, readMarker, unreadSessions, type MarkerRead} from './marker.js';
export {folderReader, type MarkerTransport} from './transport.js';
export {serveReads, type ReadMarker} from './serve.js';
export {SimulatedMarker, type MarkerState} from './simulated.js';
export {CODEX_DESKTOP_SIMULATED_SECTION, codexDesktopFactory} from './factory.js';
export {codexDesktopSimulation, registration} from './registration.js';
