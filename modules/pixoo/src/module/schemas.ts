// The Pixoo module's own 2.0 families (Hub #843), beside the general device families of `@jimmie-potts/event-contracts`
// (#918). Its states are the presentation (`pixoo-display`) and the library's catalog (`pixoo-rendition`,
// `pixoo-playlist`), served through sync. Its commands show one rendition, set Monitor's view and Now Playing, change
// playlists and media, and dismiss a finished turn on the Pixoo only. Each schema is closed, and each record fits the
// 256 KiB cap: a playlist holds at most 1,000 items.
import {SCHEMA_BASE} from '@jimmie-potts/event-contracts/v2';
import {deviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';

const block = (name: string): object => ({$ref: `${SCHEMA_BASE}blocks/2.0#/$defs/${name}`});
const closed = (properties: Record<string, object>, optional: readonly string[] = []): object => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties).filter(key => !optional.includes(key)), properties,
});
const nullable = (schema: object): object => ({oneOf: [{type: 'null'}, schema]});
const integer = (minimum: number, maximum: number): object => ({type: 'integer', minimum, maximum});
const uuid = {type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'};
const hash = {type: 'string', pattern: '^[a-f0-9]{64}$'};
// The library's names: 1 to 120 characters with no control characters. The library trims and checks them again.
const name = {type: 'string', minLength: 1, maxLength: 120, pattern: '^[^\\u0000-\\u001f\\u007f]+$'};
const revision = integer(1, Number.MAX_SAFE_INTEGER);
const neutralId = {type: 'string', pattern: '^[A-Za-z0-9_.-]{1,128}$'};
const policy = {oneOf: [
  closed({mode: {const: 'duration'}, durationMs: revision}),
  closed({mode: {const: 'plays'}, totalPlays: revision}),
]};
const filter = closed({
  q: {type: 'string', maxLength: 120},
  provider: {enum: ['codex', 'claude']},
  projectId: neutralId,
  session: closed({provider: {enum: ['codex', 'claude']}, client: {enum: ['cli', 'desktop', 'code']}, hostId: neutralId, sourceId: neutralId, sessionId: neutralId}),
}, ['q', 'provider', 'projectId', 'session']);
const transform = closed({
  fit: {enum: ['fit', 'crop']}, scaling: {enum: ['nearest', 'smooth']},
  background: {type: 'array', minItems: 3, maxItems: 3, items: integer(0, 255)},
});
/** What every Pixoo command carries besides its own fields: the request ID the SDK adds, and the general guards. */
const guarded = (properties: Record<string, object>, optional: readonly string[] = []): object => closed({
  requestId: block('requestId'),
  expectedConfigurationRevision: block('revision'),
  expectedGeneration: block('ticket'),
  ...properties,
}, ['expectedConfigurationRevision', 'expectedGeneration', ...optional]);

export const PIXOO_KIND = 'pixoo';
/** The module's own families, by name. */
export const FAMILIES = {
  display: 'pixoo-display',
  rendition: 'pixoo-rendition',
  playlist: 'pixoo-playlist',
  show: 'pixoo-media-show',
  monitor: 'pixoo-monitor-set',
  nowPlaying: 'pixoo-now-playing-set',
  playlistChange: 'pixoo-playlist-change',
  assetChange: 'pixoo-asset-change',
  dismiss: 'pixoo-notice-dismiss',
} as const;
export const schemaOf = (family: string): string => `${SCHEMA_BASE}${family}/2.0`;
export const OUTCOME_SCHEMA = `${SCHEMA_BASE}outcome/2.0`;
export const REMOVAL_SCHEMA = `${SCHEMA_BASE}removal/2.0`;
export const DEVICE_SCHEMA = schemaOf('device');

/** At most this many bytes of media an import may carry inline; larger media goes through the module's incoming folder. */
export const MAX_INLINE_BYTES = 160 * 1024;
const BASE64_LIMIT = Math.ceil(MAX_INLINE_BYTES / 3) * 4;

/** The Pixoo's own payload schemas, by `dataschema`. */
export const pixooOwnSchemas: Readonly<Record<string, object>> = {
  [schemaOf(FAMILIES.display)]: closed({
    id: block('routingId'), revision: block('revision'),
    mode: {enum: ['monitor', 'media']}, participating: {type: 'boolean'}, pendingMode: nullable({enum: ['monitor', 'media']}),
    showing: {enum: ['dashboard', 'card', 'none']},
    monitor: closed({
      filter, cadenceMs: integer(1000, 10000), connection: {enum: ['current', 'stale', 'unavailable']},
      sessions: integer(0, 10000), matched: integer(0, 10000), attention: integer(0, 10000), page: integer(0, 10000), pages: integer(1, 10000),
    }),
    nowPlaying: closed({media: {enum: ['off', 'popup', 'whole']}, card: {type: 'boolean'}, stale: {type: 'boolean'}, takeover: nullable({enum: ['popup', 'whole']})}),
    player: closed({
      state: {enum: ['idle', 'loading', 'playing', 'paused', 'reconnecting', 'error']}, intent: {enum: ['active', 'paused', 'stopped']},
      playlistId: nullable(uuid), itemId: nullable(uuid), renditionId: nullable(hash), lastError: nullable({type: 'string', pattern: '^[a-z][a-z0-9-]{0,63}$'}),
    }),
  }),
  [schemaOf(FAMILIES.rendition)]: closed({
    id: hash, revision: block('revision'), assetId: uuid, name, format: {enum: ['png', 'jpeg', 'gif']},
    frameCount: integer(1, 1000), durationMs: nullable(integer(1, Number.MAX_SAFE_INTEGER)), compatible: {type: 'boolean'},
  }),
  [schemaOf(FAMILIES.playlist)]: closed({
    id: uuid, revision: block('revision'), name, playlistRevision: revision, repeat: {type: 'boolean'}, shuffle: {type: 'boolean'},
    items: {type: 'array', maxItems: 1000, items: closed({id: uuid, renditionId: hash, playback: policy})},
  }),
  [schemaOf(FAMILIES.show)]: guarded({renditionId: hash, playback: policy}, ['playback']),
  [schemaOf(FAMILIES.monitor)]: guarded({filter, cadenceMs: integer(1000, 10000)}),
  [schemaOf(FAMILIES.nowPlaying)]: guarded({media: {enum: ['off', 'popup', 'whole']}}),
  [schemaOf(FAMILIES.playlistChange)]: guarded({change: {oneOf: [
    closed({operation: {const: 'create'}, name, repeat: {type: 'boolean'}, shuffle: {type: 'boolean'}}, ['repeat', 'shuffle']),
    closed({operation: {const: 'rename'}, playlistId: uuid, revision, name}),
    closed({operation: {const: 'options'}, playlistId: uuid, revision, repeat: {type: 'boolean'}, shuffle: {type: 'boolean'}}, ['repeat', 'shuffle']),
    closed({operation: {const: 'items'}, playlistId: uuid, revision, items: {type: 'array', maxItems: 1000, items: closed({id: uuid, renditionId: hash, playback: policy}, ['id', 'playback'])}}),
    closed({operation: {const: 'order'}, playlistId: uuid, revision, itemIds: {type: 'array', maxItems: 1000, items: uuid}}),
    closed({operation: {const: 'duplicate'}, playlistId: uuid, revision, name}),
    closed({operation: {const: 'delete'}, playlistId: uuid, revision}),
  ]}}),
  [schemaOf(FAMILIES.assetChange)]: guarded({change: {oneOf: [
    closed({operation: {const: 'import'}, name, content: {oneOf: [
      closed({inline: {type: 'string', minLength: 1, maxLength: BASE64_LIMIT, pattern: '^[A-Za-z0-9+/]+={0,2}$'}}),
      closed({staged: closed({file: hash, bytes: integer(1, 10 * 1024 * 1024)})}),
    ]}}),
    closed({operation: {const: 'render'}, assetId: uuid, transform}, ['transform']),
    closed({operation: {const: 'delete'}, assetId: uuid}),
  ]}}),
  [schemaOf(FAMILIES.dismiss)]: guarded({session: {type: 'string', pattern: '^[0-9a-f]{64}$'}, noticeId: block('id')}),
};

/** The general device families (#918) the module uses, by `dataschema`, so the SDK edge and the kit can check them. */
export const deviceSchemas: Readonly<Record<string, object>> = Object.fromEntries(
  deviceFamilies.filter(family => ['device', 'power-set', 'brightness-set', 'media-start', 'media-control', 'device-mode-set'].includes(family.family))
    .map(family => [family.dataschema, family.schema]),
);
/** Every payload schema the module's messages use: the general device families and its own. */
export const pixooSchemas: Readonly<Record<string, object>> = {...deviceSchemas, ...pixooOwnSchemas};

// Payload types

type Guards = {expectedConfigurationRevision?: number; expectedGeneration?: {epoch: string; sequence: number}};
export type Policy = {mode: 'duration'; durationMs: number} | {mode: 'plays'; totalPlays: number};
export type Filter = {q?: string | undefined; provider?: 'codex' | 'claude' | undefined; projectId?: string | undefined; session?: SessionRecord['identity'] | undefined};
export type DisplayRecord = {
  id: string; revision: number; mode: 'monitor' | 'media'; participating: boolean; pendingMode: 'monitor' | 'media' | null;
  showing: 'dashboard' | 'card' | 'none';
  monitor: {filter: Filter; cadenceMs: number; connection: 'current' | 'stale' | 'unavailable'; sessions: number; matched: number; attention: number; page: number; pages: number};
  nowPlaying: {media: 'off' | 'popup' | 'whole'; card: boolean; stale: boolean; takeover: 'popup' | 'whole' | null};
  player: {
    state: 'idle' | 'loading' | 'playing' | 'paused' | 'reconnecting' | 'error'; intent: 'active' | 'paused' | 'stopped';
    playlistId: string | null; itemId: string | null; renditionId: string | null; lastError: string | null;
  };
};
export type RenditionRecord = {
  id: string; revision: number; assetId: string; name: string; format: 'png' | 'jpeg' | 'gif'; frameCount: number; durationMs: number | null; compatible: boolean;
};
export type PlaylistRecord = {
  id: string; revision: number; name: string; playlistRevision: number; repeat: boolean; shuffle: boolean;
  items: {id: string; renditionId: string; playback: Policy}[];
};
export type ShowRequest = Guards & {requestId: string; renditionId: string; playback?: Policy};
export type MonitorSetRequest = Guards & {requestId: string; filter: Filter; cadenceMs: number};
export type NowPlayingSetRequest = Guards & {requestId: string; media: 'off' | 'popup' | 'whole'};
export type PlaylistChangeRequest = Guards & {requestId: string; change:
  | {operation: 'create'; name: string; repeat?: boolean; shuffle?: boolean}
  | {operation: 'rename'; playlistId: string; revision: number; name: string}
  | {operation: 'options'; playlistId: string; revision: number; repeat?: boolean; shuffle?: boolean}
  | {operation: 'items'; playlistId: string; revision: number; items: {id?: string; renditionId: string; playback?: Policy}[]}
  | {operation: 'order'; playlistId: string; revision: number; itemIds: string[]}
  | {operation: 'duplicate'; playlistId: string; revision: number; name: string}
  | {operation: 'delete'; playlistId: string; revision: number};
};
export type AssetChangeRequest = Guards & {requestId: string; change:
  | {operation: 'import'; name: string; content: {inline: string} | {staged: {file: string; bytes: number}}}
  | {operation: 'render'; assetId: string; transform?: {fit: 'fit' | 'crop'; scaling: 'nearest' | 'smooth'; background: [number, number, number]}}
  | {operation: 'delete'; assetId: string};
};
export type NoticeDismissRequest = Guards & {requestId: string; session: string; noticeId: string};
