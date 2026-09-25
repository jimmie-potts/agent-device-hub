/** Wire contract 1.0 and 1.1. Validate untrusted values before treating them as these types. */
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
export type ApiVersion = '1.0' | '1.1';
export type Instant = { domain: 'controller-monotonic'; epoch: string; atMs: number };
export type PriorityClass = 'event' | 'flourish';
/** API 1.1 only. The start is in the receiving controller's own monotonic clock. */
export type MomentCommand = {
  kind: 'moment'; momentId: string; mood: string; palette?: string[]; durationMs: number;
  priorityClass: PriorityClass; coversStatus: boolean; start: Instant & { toleranceMs: number };
};
export type CommandV1_1 = Command | MomentCommand;
export type MomentsCapability = Capability<{ moods: string[]; maxDurationMs: number; coversStatus: boolean }>;
export type CapabilitiesV1_1 = Capabilities & { moments: MomentsCapability };
export type Request = {
  apiVersion: '1.0'; controllerId: string; deviceId: string; requestId: Ticket;
  expectedConfigurationRevision: number; expectedGeneration: Ticket; command: Command;
};
export type RequestV1_1 = Omit<Request, 'apiVersion' | 'command'> & { apiVersion: '1.1'; command: CommandV1_1 };
export type FailureCode = 'unauthenticated' | 'forbidden' | 'unsupported-capability' | 'invalid-request'
  | 'unknown-device' | 'revision-conflict' | 'stale-generation' | 'request-conflict' | 'request-expired'
  | 'request-order' | 'capacity' | 'external-control' | 'transport-failure' | 'uncertain-result';
export type MomentFailureCode = 'moment-duplicate' | 'moment-missed' | 'moment-blocked';
export type PriorEffects = 'none' | 'possible' | 'confirmed-transmission';
export type Receipt = {
  apiVersion: '1.0'; controllerId: string; deviceId: string; requestId: Ticket;
  configurationRevision: number; generation: Ticket;
  outcome: 'queued' | 'sent' | 'failed' | 'partially-applied' | 'uncertain' | 'cancelled';
  priorEffects: PriorEffects; completedOperations: string[]; uncertainOperations: string[];
  failure?: { code: FailureCode };
};
export type ReceiptV1_1 = Omit<Receipt, 'apiVersion' | 'failure'> & {
  apiVersion: '1.1'; failure?: { code: FailureCode | MomentFailureCode };
};
export type MomentCurrent = { status: 'none' }
  | { status: 'scheduled'; momentId: string; requestId: Ticket; mood: string; priorityClass: PriorityClass;
      coversStatus: boolean; startAt: Instant; durationMs: number }
  | { status: 'playing'; momentId: string; requestId: Ticket; mood: string; priorityClass: PriorityClass;
      coversStatus: boolean; endAt: Instant };
export type MomentEnding = 'completed' | 'preempted' | 'superseded' | 'interrupted';
export type MomentLast = { status: 'none' }
  | { status: 'known'; momentId: string; requestId: Ticket; ending: MomentEnding; endedAt: Instant };
export type MomentState = { current: MomentCurrent; last: MomentLast };
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
export type SnapshotV1_1 = Omit<Snapshot, 'apiVersion' | 'capabilities' | 'state'> & {
  apiVersion: '1.1'; capabilities: CapabilitiesV1_1;
  state: Omit<Snapshot['state'], 'pending' | 'lastOutcome'> & {
    pending: { requestId: Ticket; command: CommandV1_1; generation: Ticket }[];
    lastOutcome: { status: 'unknown' } | { status: 'known'; receipt: Receipt | ReceiptV1_1 };
    moment: MomentState;
  };
};
export type FeedEvent = { apiVersion: '1.0'; kind: 'change' | 'resync'; cursor: Ticket; snapshot: Snapshot };
export type FeedEventV1_1 = { apiVersion: '1.1'; kind: 'change' | 'resync'; cursor: Ticket; snapshot: SnapshotV1_1 };
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
/** A controller serving 1.1 as well as 1.0. Both envelopes share one ticket sequence. */
export type AdmissionStateV1_1 = Omit<AdmissionState, 'capabilities' | 'cache' | 'pending'> & {
  apiVersions: ApiVersion[]; capabilities: CapabilitiesV1_1;
  cache: { request: Request | RequestV1_1; receipt: Receipt | ReceiptV1_1 }[]; pending: { request: Request | RequestV1_1 }[];
};
export type Admission = { state: AdmissionState; auth: Authorization; request: unknown; bodyBytes: number };
export type AdmissionV1_1 = Omit<Admission, 'state'> & { state: AdmissionStateV1_1 };
export type AdmissionResult = {
  decision: FailureCode | 'queued' | 'replay' | 'join'; reserved: boolean;
  nextSequence: number; scheduled: number; receipt?: Receipt;
};
export type AdmissionResultV1_1 = Omit<AdmissionResult, 'receipt'> & { receipt?: Receipt | ReceiptV1_1 };
/** Device-neutral presentation terms for moment precedence. */
export type Presentation = 'status' | 'content' | 'quiet';
export type Alert = 'none' | 'attention' | 'failure';
/** Trusted owner state for the moment reference. `base` is a neutral label of whatever the device shows without a moment. */
export type MomentDevice = MomentState & {
  clockEpoch: string; presentation: Presentation; base: string; alert: Alert; recentMomentIds: string[];
};
/** Events arrive in the device writer's order. Times are the device's own monotonic milliseconds. */
export type MomentEvent =
  | { kind: 'deliver'; nowMs: number; requestId: Ticket; command: MomentCommand }
  | { kind: 'tick'; nowMs: number }
  | { kind: 'alert'; nowMs: number; alert: Alert }
  | { kind: 'base'; nowMs: number; base: string }
  | { kind: 'mode'; nowMs: number; presentation: Presentation; base: string }
  | { kind: 'command'; nowMs: number }
  | { kind: 'restart'; nowMs: number; clockEpoch: string; presentation: Presentation; base: string; alert: Alert };
export type MomentStep = {
  showing: 'base' | 'moment' | 'alert'; base: string; momentId: string | null;
  receipts: { requestId: Ticket; outcome: 'sent' | 'failed' | 'cancelled'; failure?: MomentFailureCode }[];
  ended: null | { momentId: string; requestId: Ticket; ending: MomentEnding };
};
export type ReferenceInput =
  | ({ operation: 'authorize' } & Authorization)
  | ({ operation: 'admit' } & (Admission | AdmissionV1_1))
  | { operation: 'batch-admit'; state: AdmissionState | AdmissionStateV1_1; items: Omit<Admission, 'state'>[] }
  | { operation: 'dequeue'; expectedGeneration: Ticket; currentGeneration: Ticket; priorEffects: PriorEffects }
  | { operation: 'feed'; cursor: unknown; snapshot: Snapshot; events: FeedEvent[] }
  | { operation: 'project'; snapshot: Snapshot; event: FeedEvent }
  | { operation: 'read'; snapshot: Snapshot }
  | { operation: 'sample'; snapshot: Snapshot; sampleClock: Clock; serviceHealth: Snapshot['serviceHealth'] }
  | { operation: 'clock'; renderer: Renderer | null; supportedProfiles: Profile[]; expectedClockEpoch: string;
      fresh: boolean; receivedAtLocalMs: number; nowLocalMs: number }
  | { operation: 'moment'; device: MomentDevice; events: MomentEvent[] }
  | { operation: 'downgrade'; snapshot: SnapshotV1_1 };
