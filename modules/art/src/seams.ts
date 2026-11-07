// The boundaries the module reaches other owners through, on the real families: `v2/art` for jobs and the handoff, the
// module's own `art-catalog-edit`, and #1418's `weather-state`. A module imports only the SDK and the contracts, so the
// weather family is read here by its name and fields. Tests pass fakes for `dispatch` and `weather`.
import {errorBody, type ErrorBody, type ErrorDetail, type Message} from '@jimmie-potts/event-contracts/v2';
import {ART_SUBJECT, EXTENDED_ART_DISPATCH_SCHEMA, LEGACY_ART_STAGE_MAX_FRAMES, artCommandRefusal, type ArtAuto22, type ArtDispatch21, type ArtFormat, type ArtRequest} from '@jimmie-potts/event-contracts/v2/art';
import {ART_CATALOG_EDIT_KEY, type ArtCatalogEdit, type ArtDisplayTarget} from '@jimmie-potts/event-contracts/v2/art-state';
import {artStageSupported, extendedArtStageSupported, type DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {CORE_SOURCE, type OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {Outcome, type Cancel, type Command, type ModuleContext, type Reply, type RequestResult, type Sdk, type Subscription, type SyncedCopy, type TraceContext} from '@jimmie-potts/sdk';

export type ArtCommandHandlers = {
  /** `bunny.cmd.art-request.art`: the owner's. The tracker admits it only from the dashboard's source. */
  readonly owner: (command: Command<ArtRequest>) => Promise<Reply>;
  /** `bunny.cmd.art-auto.art`: automatic, under the pace and the guard, whatever its payload says. Only the core can send it. */
  readonly automatic: (command: Command<ArtAuto22>) => Promise<Reply>;
  /** `bunny.cmd.art-catalog-edit.art`: the owner's change to saved art. */
  readonly catalog: (command: Command<ArtCatalogEdit>) => Promise<Reply>;
};
/** Every sender but the core is refused before its command is read. The gateway and tracker refuse them earlier too. */
const fromCore = <T extends {requestId: string}>(handler: (command: Command<T>) => Promise<Reply>) => (command: Command<T>): Promise<Reply> | ErrorBody =>
  artCommandRefusal(command.source) ?? handler(command);
export async function serveCommands(sdk: Sdk, handlers: ArtCommandHandlers): Promise<Subscription[]> {
  return [
    await sdk.respond<ArtRequest>(`bunny.cmd.art-request.${ART_SUBJECT}`, fromCore(handlers.owner)),
    await sdk.respond<ArtAuto22>(`bunny.cmd.art-auto.${ART_SUBJECT}`, fromCore(handlers.automatic)),
    await sdk.respond<ArtCatalogEdit>(ART_CATALOG_EDIT_KEY, fromCore(handlers.catalog)),
  ];
}

/** What a stage needs. A display composition has exactly one rendition. */
export type ArtStageRequest = {requestId: string; compositionId: string; target: ArtDisplayTarget; format: ArtFormat; width: number; height: number; frames: number; durationMs: number;
  sha256: string; bytes: Uint8Array; lifetimeMs: number; expectedTargetId?: string};
export type ArtAmbientRequest = {requestId: string; target: 'tidbyt'; expectedTargetId?: string} & (
  | {compositionId: string; authorization?: string}
  | {compositionId: null; authorization?: never}
);
export type StageResult = 'succeeded' | 'failed' | 'uncertain' | 'conflict';
/** `art-dispatch` to the core, which forwards tracked `art-stage` and `art-ambient-set`, and the core's operation records back. */
export type ArtDispatchSeam = {
  stage(request: ArtStageRequest, parent: TraceContext): Promise<Reply>;
  ambient(request: ArtAmbientRequest, parent: TraceContext): Promise<Reply>;
  /** Reports final stage and ambient operation results; admission alone is never completion. */
  watch(result: (requestId: string, result: StageResult, error?: ErrorDetail) => void): Promise<Subscription[]>;
};
/** Condition words from #1418's state record and when they stop being facts. A location never passes through here. */
export type WeatherWords = {readonly words: readonly string[]; readonly staleAtMs: number};
export type WeatherSeam = {start(): Promise<Subscription[]>; read(): WeatherWords | null};

const DISPATCH_TIMEOUT_MS = 10_000;
const FOLLOW_MAX_MS = 30_000;
/**
 * Follows one owner's family from the module's start, without waiting on it: an absent or late owner only delays the copy,
 * so a start never depends on another module. Syncing current state is not replay, and nothing here sends a command.
 */
function follow<T extends object>(context: Pick<ModuleContext, 'sdk' | 'scheduler' | 'signal'>, family: string, owner: string, seen: (message: {subject: string; data: T}) => void): Subscription {
  let closed = false, retryMs = 1000, retry: Cancel | undefined, copy: Subscription | undefined;
  const again = (): void => {
    if (closed || context.signal.aborted || retry !== undefined) return;
    const delay = retryMs;
    retryMs = Math.min(FOLLOW_MAX_MS, retryMs * 2);
    retry = context.scheduler.after(delay, () => {retry = undefined; void attempt();});
  };
  const attempt = async (): Promise<void> => {
    if (closed || context.signal.aborted) return;
    try {
      const result = await context.sdk.sync<T>([family], change => {
        if (closed || context.signal.aborted) return;
        if (change.type === 'updated') seen(change.message);
        else if (change.type === 'failed') {copy = undefined; again();}
      }, {owner, timeoutMs: 5000});
      if (result.status !== 'synced') {again(); return;}
      if (closed || context.signal.aborted) {await result.copy.close(); return;}
      copy = result.copy; retryMs = 1000;
      for (const message of result.copy.states()) seen(message);
    } catch {again();}
  };
  void attempt();
  return {close: async () => {closed = true; retry?.(); await copy?.close();}};
}
const asReply = (answer: RequestResult): Reply => answer.status === 'accepted' ? {status: 'accepted'} : answer.status === 'rejected' ? answer.error : errorBody('uncertain-result');
const stageResultOf = (record: OperationRecord): StageResult | undefined => {
  if (record.result === 'conflict' || record.status === 'conflict') return 'conflict';
  if (record.result === Outcome.succeeded) return Outcome.succeeded;
  if (record.result === Outcome.uncertain || record.status === Outcome.uncertain) return Outcome.uncertain;
  if (record.result === Outcome.failed || record.status === Outcome.rejected || record.status === 'expired') return Outcome.failed;
  return undefined;
};
/** Identity is usable only while this exact owner's SDK copy is current. Connectivity remains the device owner's decision. */
function followDevices(context: Pick<ModuleContext, 'sdk' | 'scheduler' | 'signal'>, kind: ArtDisplayTarget) {
  let closed = false, fresh = false, retryMs = 1000, retry: Cancel | undefined, copy: SyncedCopy<DeviceRecord> | undefined;
  const again = (): void => {
    if (closed || context.signal.aborted || retry !== undefined) return;
    const delay = retryMs;
    retryMs = Math.min(FOLLOW_MAX_MS, retryMs * 2);
    retry = context.scheduler.after(delay, () => {retry = undefined; void attempt();});
  };
  const attempt = async (): Promise<void> => {
    if (closed || context.signal.aborted) return;
    fresh = false;
    try {
      const result = await context.sdk.sync<DeviceRecord>(['device'], change => {
        if (closed || context.signal.aborted) return;
        if (change.type === 'synced') fresh = true;
        else if (change.type === 'failed') {fresh = false; copy = undefined; again();}
      }, {owner: `bunny/modules/${kind}`, timeoutMs: 5000, onRestarted: () => {fresh = false;}});
      if (result.status !== 'synced') {again(); return;}
      if (closed || context.signal.aborted) {await result.copy.close(); return;}
      copy = result.copy; retryMs = 1000;
    } catch {fresh = false; again();}
  };
  void attempt();
  return {
    read: (): Message<DeviceRecord>[] | undefined => closed || context.signal.aborted || !fresh || copy === undefined ? undefined : copy.states(),
    close: async () => {closed = true; fresh = false; retry?.(); await copy?.close(); copy = undefined;},
  };
}

export function realDispatch(context: Pick<ModuleContext, 'sdk' | 'scheduler' | 'signal'>): ArtDispatchSeam {
  const devices: Partial<Record<ArtDisplayTarget, ReturnType<typeof followDevices>>> = {};
  const resolve = (kind: ArtDisplayTarget): Message<DeviceRecord> | ErrorBody => {
    const records = devices[kind]?.read();
    if (records === undefined) return errorBody('unavailable');
    const matches = records.filter(record => record.data.kind === kind);
    if (matches.length > 1) return errorBody('invalid-state');
    const device = matches[0];
    if (device === undefined) return errorBody('unavailable');
    return device.data.capabilities.moments.supported && device.data.capabilities.moments.art !== undefined ? device : errorBody('unsupported-capability');
  };

  /** An extended stage names art-dispatch/2.2; otherwise an authorized ambient uses 2.1 and everything else 2.0. */
  const send = async (data: ArtDispatch21, parent: TraceContext, dataschema = `https://bunny.invalid/events/art-dispatch/${'authorization' in data ? '2.1' : '2.0'}`): Promise<Reply> =>
    asReply(await context.sdk.request<ArtDispatch21>(`bunny.cmd.art-dispatch.${ART_SUBJECT}`,
      {type: 'org.bunny.art.dispatch.requested', subject: ART_SUBJECT, dataschema, data}, {requestId: data.requestId, timeoutMs: DISPATCH_TIMEOUT_MS, parent}));
  return {
    stage: ({requestId, target, bytes, ...rest}, parent) => {
      const {compositionId, format, width, height, frames, durationMs, sha256, lifetimeMs, expectedTargetId} = rest;
      const device = resolve(target);
      if ('error' in device) return Promise.resolve(device);
      if (expectedTargetId !== undefined && device.data.id !== expectedTargetId) return Promise.resolve(errorBody('invalid-state', {detail: 'the configured display no longer matches the preparation target'}));
      const base64 = Buffer.from(bytes).toString('base64');
      const extended = frames > LEGACY_ART_STAGE_MAX_FRAMES;
      const allowed = extended ? extendedArtStageSupported(device, {format, base64}) : artStageSupported(device.data.capabilities, {format, base64});
      if (!allowed) return Promise.resolve(errorBody('unsupported-capability'));
      return send({requestId, target: device.data.id, family: 'art-stage', data: {compositionId, format, width, height, frames, durationMs, sha256, lifetimeMs, base64}},
        parent, extended ? EXTENDED_ART_DISPATCH_SCHEMA : undefined);
    },
    ambient: ({requestId, target, compositionId, expectedTargetId, authorization}, parent) => {
      const device = resolve(target);
      if ('error' in device) return Promise.resolve(device);
      if (expectedTargetId !== undefined && device.data.id !== expectedTargetId) return Promise.resolve(errorBody('invalid-state', {detail: 'the configured art target changed'}));
      return send(authorization === undefined || compositionId === null
        ? {requestId, target: device.data.id, family: 'art-ambient-set', data: {compositionId}}
        : {requestId, target: device.data.id, family: 'art-ambient-set', data: {compositionId}, authorization}, parent);
    },
    watch: result => {
      const pixoo = followDevices(context, 'pixoo'), tidbyt = followDevices(context, 'tidbyt');
      devices.pixoo = pixoo; devices.tidbyt = tidbyt;
      return Promise.resolve([pixoo, tidbyt, follow<OperationRecord>(context, 'operation', CORE_SOURCE, ({data}) => {
        const final = stageResultOf(data);
        // The module ignores a request it did not stage, so a sync's whole list costs nothing.
        if (final !== undefined && (data.family === 'art-stage' || data.family === 'art-ambient-set')) result(data.requestId, final, data.error);
      })]);
    },
  };
}

/** The fields of `weather-state` this module reads. An unavailable record has no words, so it says nothing. */
type WeatherRecord = {status: string; staleAtMs?: unknown; words?: unknown};
export function realWeather(context: Pick<ModuleContext, 'sdk' | 'scheduler' | 'signal'>): WeatherSeam {
  let latest: WeatherWords | null = null;
  return {
    start: () => Promise.resolve([follow<WeatherRecord>(context, 'weather-state', 'bunny/modules/weather', ({data}) => {
      latest = data.status === 'available' && typeof data.staleAtMs === 'number' && Array.isArray(data.words) && data.words.every(word => typeof word === 'string')
        ? {staleAtMs: data.staleAtMs, words: data.words} : null;
    })]),
    read: () => context.signal.aborted ? null : latest,
  };
}
