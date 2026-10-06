import {z} from 'zod';
import {buildIdentitySchema} from './build.js';
export const apiId=z.uuid(),apiHash=z.string().regex(/^[a-f0-9]{64}$/);
export const apiRevision=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const apiName=z.string().trim().min(1).max(120).refine(s=>Array.from(s).every(c=>c.charCodeAt(0)>31&&c.charCodeAt(0)!==127));
export const playlistCreate=z.object({name:apiName,repeat:z.boolean().optional(),shuffle:z.boolean().optional()}).strict();
export const playlistRename=z.object({revision:apiRevision,name:apiName}).strict();
export const playlistOptions=z.object({revision:apiRevision,repeat:z.boolean().optional(),shuffle:z.boolean().optional()}).strict().refine(v=>v.repeat!==undefined||v.shuffle!==undefined);
export const playbackPolicy=z.discriminatedUnion('mode',[
 z.object({mode:z.literal('duration'),durationMs:apiRevision}).strict(),z.object({mode:z.literal('plays'),totalPlays:apiRevision}).strict(),
]);
export const playlistItems=z.object({revision:apiRevision,items:z.array(z.object({id:apiId.optional(),renditionId:apiHash,playback:playbackPolicy.optional()}).strict()).max(1000)}).strict();
export const playlistOrder=z.object({revision:apiRevision,itemIds:z.array(apiId).max(1000)}).strict();
export const expectedRevision=z.object({revision:apiRevision}).strict();
export const assetQuery=z.object({offset:z.coerce.number().int().min(0).max(1000000).default(0),limit:z.coerce.number().int().min(1).max(100).default(25),q:z.string().max(120).default('')}).strict();
export const transformRequest=z.object({fit:z.enum(['fit','crop']),scaling:z.enum(['nearest','smooth']),background:z.tuple([z.number().int().min(0).max(255),z.number().int().min(0).max(255),z.number().int().min(0).max(255)])}).strict();
export const renditionRequest=z.object({transform:transformRequest.optional()}).strict();
export const deviceConfiguration=z.object({ip:z.ipv4().refine(ip=>{const [a,b]=ip.split('.').map(Number);return a===10||a===172&&b!>=16&&b!<=31||a===192&&b===168;}),model:apiName.optional(),firmware:apiName.optional(),profile:z.enum(['simulator-v1','pixoo64-smoke-2026-09-06','pixoo64-gif-2026-10-01','pixoo64-hosted-2026-10-01'])}).strict();
export type DeviceConfiguration=z.infer<typeof deviceConfiguration>;
export const requestIdentity=z.string().regex(/^[a-f0-9-]{36}:[1-9][0-9]{0,15}$/);
export const catalogQuery=z.object({q:z.string().max(120).default(''),offset:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),limit:z.number().int().min(1).max(100).default(25)}).strict();
export const playerCommand=z.discriminatedUnion('command',[
 z.object({requestId:requestIdentity,command:z.literal('start'),playlistId:apiId,revision:apiRevision.optional()}).strict(),
 z.object({requestId:requestIdentity,command:z.literal('show-media'),renditionId:apiHash,playback:playbackPolicy.optional()}).strict(),
 z.object({requestId:requestIdentity,command:z.enum(['pause','resume','stop','next','previous','restart-with-changes','clear'])}).strict(),
]);
export type PlayerCommand=z.infer<typeof playerCommand>;
export const displayCommand=z.object({requestId:requestIdentity,brightness:z.number().int().min(0).max(100).optional(),screenOn:z.boolean().optional()}).strict().refine(v=>(v.brightness!==undefined)!==(v.screenOn!==undefined));
export const apiErrorSchema=z.object({error:z.object({code:z.string(),message:z.string(),details:z.record(z.string(),z.unknown()).optional()})});

export const emptyRequest=z.object({}).strict();

export const diagnosticsSchema=z.object({
 build:buildIdentitySchema,
 status:z.literal('ready'),mode:z.enum(['simulator','device']),uptimeMs:z.number().int().nonnegative(),library:z.literal('ready'),
 device:z.object({connected:z.boolean().nullable(),availability:z.enum(['unknown','available','offline'])}).strict(),
 player:z.object({state:z.enum(['idle','loading','playing','paused','reconnecting','error']),intent:z.enum(['active','paused','stopped'])}).strict(),
 logging:z.object({persistent:z.literal(false)}).strict(),
 limits:z.object({requests:z.literal(32),eventClients:z.literal(16),eventHistory:z.literal(32),commandReceipts:z.literal(256),playbackRenditions:z.literal(2)}).strict(),
}).strict();
