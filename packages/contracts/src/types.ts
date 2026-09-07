/** Wire contract 1.0. Validate untrusted values before treating them as these types. */
export type Ticket = { epoch: string; sequence: number };
export type Identity = { deviceId: string; controllerId: string; sourceId: string; controllerEpoch: string; label?: string };
export type Clock = { domain: 'controller-monotonic'; epoch: string; sampledAtMs: number };
export type Mode = 'Work' | 'Quiet' | 'Free' | 'Monitor' | 'Media';
export type Known<T> = { status: 'unknown' } | { status: 'known'; value: T };
export type Capability<T = object> = { supported: false } | ({ supported: true } & T);
export type Profile = { profileId: string; profileVersion: string };
export type MediaAction = 'pause' | 'resume' | 'stop' | 'next' | 'previous' | 'restart-with-changes' | 'clear';
export type Capabilities = {
  power: Capability;
  brightness: Capability<{ minimum: 0; maximum: 100 }>;
  media: Capability<{ actions: MediaAction[]; playlistIds: string[]; renditionIds: string[] }>;
  zones: Capability<{ zoneIds: string[] }>;
  scenes: Capability<{ sceneIds: string[] }>;
  preview: Capability<{ profiles: Profile[] }>;
  modes?: Capability<{ values: Mode[] }>;
};
export type Command =
  | { kind: 'power.set'; on: boolean }
  | { kind: 'brightness.set'; percent: number }
  | { kind: 'scene.activate'; sceneId: string }
  | { kind: 'zone.power.set'; zoneId: string; on: boolean }
  | { kind: 'media.start'; playlistId: string }
  | { kind: 'media.control'; action: MediaAction }
  | { kind: 'mode.set'; mode: Mode };
export type Request = {
  apiVersion: '1.0'; controllerId: string; deviceId: string; requestId: Ticket;
  expectedConfigurationRevision: number; expectedGeneration: Ticket; command: Command;
};
export type FailureCode = 'unauthenticated' | 'forbidden' | 'unsupported-capability' | 'invalid-request'
  | 'unknown-device' | 'revision-conflict' | 'stale-generation' | 'request-conflict' | 'request-expired'
  | 'request-order' | 'capacity' | 'external-control' | 'transport-failure' | 'uncertain-result';
export type PriorEffects = 'none' | 'possible' | 'confirmed-transmission';
export type Receipt = {
  apiVersion: '1.0'; controllerId: string; deviceId: string; requestId: Ticket;
  configurationRevision: number; generation: Ticket;
  outcome: 'queued' | 'sent' | 'failed' | 'partially-applied' | 'uncertain' | 'cancelled';
  priorEffects: PriorEffects; completedOperations: string[]; uncertainOperations: string[];
  failure?: { code: FailureCode };
};
export type Snapshot = {
  apiVersion: '1.0'; identity: Identity; configurationRevision: number; generation: Ticket;
  nextRequestId: Ticket; cursor: Ticket; sampleClock: Clock;
  serviceHealth: 'unknown' | 'ready' | 'degraded' | 'unavailable'; capabilities: Capabilities;
  limits: { maxPending: number; maxBodyBytes: number; maxInFlight: number; maxReceipts: number;
    maxEvents: number; maxStreams: number; authenticationTimeoutMs: number };
  state: {
    desired: { power: Known<boolean>; brightness: Known<number>; mode: Known<Mode> };
    pending: { requestId: Ticket; command: Command; generation: Ticket }[];
    lastSuccessfulSend: { status: 'unknown' } | { status: 'known'; requestId: Ticket; clock: Clock; operationIds: string[] };
    lastOutcome: { status: 'unknown' } | { status: 'known'; receipt: Receipt };
    externalControl: { status: 'unknown' } | { status: 'known'; owner: 'controller' | 'external'; clock: Clock };
    observation: { status: 'unknown' } | { status: 'known'; clock: Clock; evidenceAgeMs: number; power: Known<boolean>; brightness: Known<number> };
  };
};
export type FeedEvent = { apiVersion: '1.0'; kind: 'change' | 'resync'; cursor: Ticket; snapshot: Snapshot };
export type Renderer = Profile & {
  rendererEpoch: string; generation: Ticket; clock: Clock; deadlineMs?: number;
  updateOutcome: 'accepted' | 'pending' | 'sent' | 'partial' | 'failed' | 'uncertain' | 'cancelled';
};
/** Synthetic authorization facts supplied by an owning server, never credentials themselves. */
export type Authorization = {
  credential: null | { kind: 'machine' | 'browser'; status: 'active' | 'overlap' | 'revoked' | 'invalid';
    declared: boolean; devices: string[]; scopes: ('read' | 'control')[] };
  deviceId: string; scope: 'read' | 'control'; hostAllowed: boolean;
  originPresent: boolean; originAllowed: boolean; fetchMetadataAllowed: boolean;
};
export type AdmissionState = {
  controllerId: string; deviceId: string; epoch: string; nextSequence: number;
  configurationRevision: number; generation: Ticket; capabilities: Capabilities;
  maxBodyBytes: number; maxInFlight: number; maxQueue: number; maxReceipts: number;
  inFlight: number; queueDepth: number;
  cache: { request: Request; receipt: Receipt }[]; pending: { request: Request }[];
};
export type Admission = { state: AdmissionState; auth: Authorization; request: unknown; bodyBytes: number };
export type AdmissionResult = {
  decision: FailureCode | 'queued' | 'replay' | 'join'; reserved: boolean;
  nextSequence: number; scheduled: number; receipt?: Receipt;
};
export type ReferenceInput =
  | ({ operation: 'authorize' } & Authorization)
  | ({ operation: 'admit' } & Admission)
  | { operation: 'batch-admit'; state: AdmissionState; items: Omit<Admission, 'state'>[] }
  | { operation: 'dequeue'; expectedGeneration: Ticket; currentGeneration: Ticket; priorEffects: PriorEffects }
  | { operation: 'feed'; cursor: unknown; snapshot: Snapshot; events: FeedEvent[] }
  | { operation: 'project'; snapshot: Snapshot; event: FeedEvent }
  | { operation: 'read'; snapshot: Snapshot }
  | { operation: 'sample'; snapshot: Snapshot; sampleClock: Clock; serviceHealth: Snapshot['serviceHealth'] }
  | { operation: 'clock'; renderer: Renderer | null; supportedProfiles: Profile[]; expectedClockEpoch: string;
      fresh: boolean; receivedAtLocalMs: number; nowLocalMs: number };
