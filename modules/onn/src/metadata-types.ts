/** Browser-safe metadata fields shared by intake and history projections. */
export const TEXT_FIELDS = Object.freeze(['title','displayTitle','subtitle','artist','album','genre','description','mediaId'] as const);
export type Metadata = {[Field in typeof TEXT_FIELDS[number]]: string | null} & {durationMs: number | null};
export interface Playback {state:number;positionMs:number;speed:number;positionUpdatedElapsedMs:number}
export interface Omission {field:typeof TEXT_FIELDS[number];reason:'credential-redacted'|'oversized'}
export interface MetadataSession {app:'youtube'|'stremio';metadata:Metadata|null;playback:Playback|null;omissions:Omission[]}
export interface MetadataSample {schema:'onn-metadata/2.0';deviceElapsedMs:number;sessions:MetadataSession[]}
