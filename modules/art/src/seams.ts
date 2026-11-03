// The small typed seams for what is not on main yet. #679 owns the `art-request`, `art-auto` and `art-dispatch` families and
// #1418 owns weather. The module talks only to these types, and the integration after each merge replaces an `unwired`
// default in `registration.ts` and nothing else. Until then the shipped module admits no command and offers nothing.
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {ArtDisplayTarget, ArtFeedback, ArtPurpose, ArtTarget} from '@jimmie-potts/event-contracts/v2/art-state';
import type {Command, Reply, Sdk, Subscription, TraceContext} from '@jimmie-potts/sdk';

/** A request for new art. `purpose` and `origin` are labels: the family that admitted it decides owner or automatic. */
export type ArtGenerate = {requestId: string; action: 'generate'; purpose: ArtPurpose; origin?: {kind: 'owner' | 'schedule' | 'weather'; reference?: string};
  text?: string; targets: ArtTarget[]; variationOf?: string; animated?: boolean; source?: 'generate' | 'procedural'};
/** What only `art-request` carries. A cancel names any job, automatic or not, and admits no work. */
export type ArtOwnerAction = ArtGenerate
  | {requestId: string; action: 'cancel'; job: string}
  | {requestId: string; action: 'favorite'; artworkId: string; favorite: boolean}
  | {requestId: string; action: 'feedback'; artworkId: string; signal: ArtFeedback}
  | {requestId: string; action: 'delete'; artworkId: string}
  | {requestId: string; action: 'reuse'; artworkId: string; target: ArtDisplayTarget};
export type ArtCommandHandlers = {
  /** `bunny.cmd.art-request.art`: the owner's. The tracker admits it only from the dashboard's source. */
  readonly owner: (command: Command<ArtOwnerAction>) => Promise<Reply>;
  /** `bunny.cmd.art-auto.art`: automatic, under the pace and the guard, whatever its payload says. Only the core can send it. */
  readonly automatic: (command: Command<ArtGenerate>) => Promise<Reply>;
};
/** Binds the handlers to #679's families. */
export type ArtCommandSeam = {serve(sdk: Sdk, handlers: ArtCommandHandlers): Promise<Subscription[]>};
export const unwiredCommands: ArtCommandSeam = {serve: () => Promise.resolve([])};

/** What `art-stage` needs, ready for #679's wire format. A display composition has exactly one rendition. */
export type ArtStageRequest = {requestId: string; compositionId: string; target: ArtDisplayTarget; format: 'png' | 'gif'; width: number; height: number; frames: number;
  sha256: string; bytes: Uint8Array; lifetimeMs: number};
export type ArtAmbientRequest = {requestId: string; target: 'tidbyt'; compositionId: string | null};
export type StageResult = 'succeeded' | 'failed' | 'uncertain';
/** `art-dispatch` to the core, which forwards tracked `art-stage` and `art-ambient-set`, and the core's operation record back. */
export type ArtDispatchSeam = {
  stage(request: ArtStageRequest, parent: TraceContext): Promise<Reply>;
  ambient(request: ArtAmbientRequest, parent: TraceContext): Promise<Reply>;
  /** Reports each staged request's final operation result. Nothing is offered until this says `succeeded`. */
  watch(sdk: Sdk, result: (requestId: string, result: StageResult) => void): Promise<Subscription[]>;
};
const unwired = (): Promise<Reply> => Promise.resolve(errorBody('unavailable', {detail: 'the art handoff is not wired'}));
export const unwiredDispatch: ArtDispatchSeam = {stage: unwired, ambient: unwired, watch: () => Promise.resolve([])};

/** Condition words from #1418's state record and when they stop being facts. A location never passes through here. */
export type WeatherWords = {readonly words: readonly string[]; readonly staleAtMs: number};
export type WeatherSeam = {start(sdk: Sdk): Promise<Subscription[]>; read(): WeatherWords | null};
export const unwiredWeather: WeatherSeam = {start: () => Promise.resolve([]), read: () => null};
