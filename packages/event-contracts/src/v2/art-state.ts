// The art module's state family and content references (Hub #680). #682, #683 and #684 consume them. The exact-artwork
// handoff families belong to #679 and are not here. The record carries references and amounts only: prompts, keys,
// locations and image bytes stay in the module, and bytes are read through its authenticated content route.
import {SCHEMA_BASE, type ErrorCode, type MessageValidator} from './index.js';
import {defineFamily, registerFamilies} from './registry.js';

export const ART_ID = 'art';
export const ART_STATE_SCHEMA = `${SCHEMA_BASE}art/2.0`;
export const ART_STATE_TYPE = 'org.bunny.art.updated';
export const ART_STATE_KEY = 'bunny.state.art.art';

export type ArtProviderName = 'openai' | 'anthropic';
export type ArtTarget = 'ui' | 'tidbyt' | 'pixoo';
export type ArtDisplayTarget = Exclude<ArtTarget, 'ui'>;
export type ArtPurpose = 'request' | 'ambient' | 'appearance' | 'variation';
export type ArtAdmission = 'owner' | 'automatic';
/** One artwork's result, as the qualification record's rules derive it from its targets. */
export type ArtOutcome = 'succeeded' | 'partial' | 'failed' | 'uncertain' | 'rejected' | 'cancelled';
export type ArtTargetOutcome = 'pending' | 'succeeded' | 'failed' | 'uncertain' | 'rejected' | 'cancelled';
/** Why a target did not succeed, in words the dashboard can show. Never provider text. */
export type ArtReason = 'no-key' | 'unsupported' | 'unknown-price' | 'monthly-ceiling' | 'daily-pace' | 'loop-guard' | 'moderation'
  | 'provider-refused' | 'invalid-output' | 'lost-response' | 'restart' | 'cancelled' | 'storage';
export type ArtFeedback = 'more' | 'less' | 'dismiss';
export type ArtMotion = 'still' | 'sheet' | 'local';

/** One provider's month, in integer micro-dollars. A kept reservation is `uncertain`, and it is never refunded. */
export type ArtProviderSpend = {
  provider: ArtProviderName; available: boolean; ceilingMicros: number; paceMicros: number;
  spentMicros: number; reservedMicros: number; uncertainMicros: number; remainingMicros: number;
  /** Everything this provider's calls hold today, which the daily pace reads. */
  todayMicros: number;
  /** What settlements passed their reservations by this month: a price table fault. */
  excessMicros: number;
  /** Kept reservations of earlier months, which a new month does not erase. */
  earlierUncertainMicros: number;
};
export type ArtRendition = {renditionId: string; width: number; height: number; frames: number; durationMs: number; format: 'png' | 'gif' | 'webp'; bytes: number; ref: string};
export type ArtComposition = {target: ArtTarget; compositionId: string | null; outcome: ArtOutcome; motion: ArtMotion; renditions: ArtRendition[]};
export type ArtJobTarget = {target: ArtTarget; outcome: ArtTargetOutcome; code: ErrorCode | null; reason: ArtReason | null};
export type ArtJobSummary = {requestId: string; purpose: ArtPurpose; admittedBy: ArtAdmission; status: 'queued' | 'running' | 'finished'; outcome: ArtOutcome | null;
  artworkId: string; createdAtMs: number; finishedAtMs: number | null; targets: ArtJobTarget[]};
export type ArtProvenance = {generatedBy: ArtProviderName | 'local'; factual: false};
export type ArtworkSummary = {artworkId: string; createdAtMs: number; favorite: boolean; feedback: ArtFeedback | null; variationOf: string | null; palette: string[];
  provenance: {generatedBy: 'openai' | 'local'; factual: false}; compositions: ArtComposition[]};
/** A composition a device confirmed staging. The module offers it; only the core's automation path can show it. */
export type ArtCandidate = {artworkId: string; target: ArtDisplayTarget; compositionId: string; favorite: boolean; stagedUntilMs: number};
export type ArtState = {
  id: typeof ART_ID; revision: number; month: string; day: string;
  providers: [ArtProviderSpend, ArtProviderSpend];
  guard: {calls: number; limit: number; windowMs: number};
  /** How many generated sprite sheets passed or failed validation, which measures the rejection rate. */
  sheets: {accepted: number; rejected: number};
  jobs: ArtJobSummary[]; artworks: ArtworkSummary[]; candidates: ArtCandidate[];
  retention: {recentLimit: number; recent: number; favorites: number; retained: {artworkId: string; target: ArtDisplayTarget; untilMs: number}[]};
};

/** The module's content references, read at `/modules/art/content/<ref>`. */
export const artContentRef = {
  /** JSON: `{artworks, nextAfter}`; query `after` and `limit` (at most 100). */
  catalog: 'catalog',
  /** JSON: `{calls, nextAfter}`, the inspectable call ledger; query `after` and `limit` (at most 100). */
  ledger: 'ledger',
  /** JSON: one artwork's full result, with its calls. */
  artwork: (artworkId: string): string => `artwork.${artworkId}`,
  /** The bytes of one rendition. */
  rendition: (renditionId: string): string => `rendition.${renditionId}`,
} as const;

const artFamily = defineFamily('art', 'state', ART_STATE_TYPE, message => message.subject === ART_ID ? undefined : 'envelope /subject must be art');
export const artSchemas: Readonly<Record<string, object>> = {[artFamily.dataschema]: artFamily.schema};
export function registerArtStateFamily(validator: MessageValidator): void {registerFamilies(validator, [artFamily]);}
