/** Browser-safe retained history documents; wire values and fields are unchanged. */
import type {MetadataSession, Omission} from './metadata-types.js';

export type HistoryApp = 'youtube' | 'stremio';
export type GapReason = 'startup' | 'unavailable' | 'busy' | 'storage' | 'clock';
export type Intake = {intakeId: string; runId: string; poll: number; receivedAtMs: number};
export type ProjectionOmission = {field: Omission['field']; reason: 'projection-limit'; originalBytes: number};
export type SessionProjection = MetadataSession & {projectionOmissions: ProjectionOmission[]};
export type HistoryGap = Intake & {sequence: number; reason: GapReason};
export type Coverage = {
  collectionStartedAtMs: number | null; gapCount: number; recentGaps: HistoryGap[]; storageAvailable: boolean; pendingGap: (Intake & {reason:'storage'}) | null;
  limits: {pollMs: 5000; staleMs: 15000; candidates: 500; textBytes: 512; responseBytes: 131072; recentGaps: 20; sourceSessions: 8; sourceTextBytes: 8192; sourceReplyBytes: 262144};
  semantics: 'observations-only';
};
export type AcceptedEvidence = Intake & {sequence: number; deviceElapsedMs: number; reader: {sha256: string; sourceVersion: string}};
export type HistoryState = {
  schema: 'onn-history-state/2.0'; enabled: boolean; status: 'disabled' | 'fresh' | 'stale' | 'unavailable';
  current: SessionProjection[]; ambiguous: boolean; currentEvidence: 'fresh-observation' | 'last-observed' | 'none';
  lastAccepted: AcceptedEvidence | null; coverage: Coverage;
};
export type HistoryProvenance = {
  source: 'android-media-session'; readerSchema: 'onn-metadata/2.0';
  semantics: 'selected-title-observed' | 'title-observed';
};
export type HistoryObservation = AcceptedEvidence & SessionProjection & {id: string; provenance: HistoryProvenance};
export type HistoryOccurrence = {
  id: string; app: HistoryApp; firstObservedAtMs: number; matchingObservedAtMs: number;
  identityConfidence: 'unsupported' | 'source-id' | 'ambiguous'; observation: HistoryObservation;
};
export type PageOmission = {reason: 'response-limit'; continuation: true};
export type HistoryPage = {
  schema: 'onn-history/2.0'; cutoff: number; ordering: 'evidence-desc'; items: HistoryOccurrence[];
  nextCursor: string | null; coverage: Coverage; pageOmissions: PageOmission[];
};
export type HistoryDetail = {
  schema: 'onn-history-detail/2.0'; cutoff: number; occurrence: HistoryOccurrence;
  observations: HistoryObservation[]; nextCursor: string | null; coverage: Coverage; pageOmissions: PageOmission[];
};
