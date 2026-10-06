import { z } from 'zod';
import type { MediaSource, Rendition } from '@pixoo/media';
export type LibraryErrorCode='cancelled'|'invalid-input'|'not-found'|'revision-conflict'|'asset-referenced'|'busy'|'closed'|'migration-error'|'database-error'|'cleanup-pending'|'storage-error'|'catalog-corrupt'|'checkpoint-owned';
const messages:Record<LibraryErrorCode,string>={
  cancelled:'The selection was superseded before admission.',
  'invalid-input':'Check the supplied name, IDs, revision and playback policy.', 'not-found':'The requested catalog entry does not exist.',
  'revision-conflict':'Reload the playlist and apply edits to its current revision.', 'asset-referenced':'Remove playlist entries and release retained sessions before deleting this asset.',
  busy:'Close the other library owner before opening this storage directory.', closed:'Open a library before making requests.',
  'migration-error':'The database schema is incompatible or a migration failed; preserve the database for inspection.', 'database-error':'The metadata transaction failed.',
  'cleanup-pending':'File cleanup is pending; resolve the storage error and retry cleanup.', 'storage-error':'Use writable private storage outside source control.',
  'checkpoint-owned':'Clear or replace the playback checkpoint before releasing its session.',
  'catalog-corrupt':'Stored metadata and immutable media disagree; preserve the files for inspection.',
};
export class LibraryError extends Error {
  constructor(readonly code:LibraryErrorCode,readonly details:Record<string,unknown>={}) {super(messages[code]);this.name='LibraryError';}
}
export const idSchema=z.uuid();
export const hashSchema=z.string().regex(/^[a-f0-9]{64}$/);
export const nameSchema=z.string().trim().min(1).max(120).refine(s=>Array.from(s).every(character=>character.charCodeAt(0)>31 && character.charCodeAt(0)!==127));
export const revisionSchema=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const value=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const policySchema=z.discriminatedUnion('mode',[z.object({mode:z.literal('duration'),durationMs:value}).strict(),z.object({mode:z.literal('plays'),totalPlays:value}).strict()]);
export type PlaybackPolicy=z.infer<typeof policySchema>;
export const itemInputSchema=z.object({id:idSchema.optional(),renditionId:hashSchema,playback:policySchema.optional()}).strict();
export const itemsSchema=z.array(itemInputSchema).max(1000);
export type ItemInput=z.infer<typeof itemInputSchema>;
export interface PlaylistItem {id:string;renditionId:string;playback:PlaybackPolicy}
export interface Playlist {id:string;name:string;revision:number;repeat:boolean;shuffle:boolean;createdAt:string;updatedAt:string;items:PlaylistItem[]}
export interface Asset {id:string;name:string;contentHash:string;source:MediaSource;createdAt:string}
export interface ImportResult {asset:Asset;rendition:Rendition}
export interface SessionReference {id:string;renditionIds:string[];createdAt:string}
export function validate<T>(schema:z.ZodType<T>,input:unknown):T {const r=schema.safeParse(input);if(!r.success)throw new LibraryError('invalid-input');return r.data;}
