// The remote client alone, for a browser page (Hub #922): `@jimmie-potts/sdk/remote`. Its module graph imports no Node
// built-in and no file, so the dashboard bundles it for the browser; the package's main entry also holds the bus, the
// edge, the outbox and the module host, which only Node runs. A test bundles this entry for the browser to keep it so.
export {IDLE_MS, REQUESTER_GRACE_MS, connectRemote, type RemoteAuth, type RemoteOptions, type RemoteParticipant} from './remote-client.js';
export {REMOTE_PATH, REQUEST_HEADER, SOURCE_HEADER} from './remote-protocol.js';
export {childOf} from './trace.js';
export {
  MAX_TIMEOUT_MS, SdkError, type Cancel, type CommandDraft, type Handler, type Overflow, type Participant, type RequestOptions, type RequestResult,
  type Scheduler, type Subscription,
} from './sdk.js';
export type {SyncChange, SyncCompleted, SyncedCopy, SyncHandler, SyncOptions, SyncResult} from './sync.js';
export type {Diagnostic, DiagnosticEvent, DiagnosticLevel, OnDiagnostic} from './diagnostics.js';
