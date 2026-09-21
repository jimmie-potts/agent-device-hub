import {z} from 'zod';
import {requestIdentity} from './api.js';
const neutralId=z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/);
export const sessionIdentity=z.object({provider:z.enum(['codex','claude']),client:z.enum(['cli','desktop','code']),hostId:neutralId,sourceId:neutralId,sessionId:neutralId}).strict();
export const monitorFilter=z.object({q:z.string().max(120).optional(),provider:z.enum(['codex','claude']).optional(),projectId:neutralId.optional(),session:sessionIdentity.optional()}).strict();
export const presentationConfiguration=z.object({version:z.literal(1),mode:z.enum(['monitor','media']),filter:monitorFilter,cadenceMs:z.number().int().min(1000).max(10000)}).strict();
export const integrationAction=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('mode'),mode:z.enum(['monitor','media'])}).strict(),
 z.object({operation:z.literal('view'),filter:monitorFilter,cadenceMs:z.number().int().min(1000).max(10000)}).strict(),
]);
const guard={apiVersion:z.literal('pixoo-integration/1.0'),requestId:requestIdentity,expectedConfigurationRevision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),expectedGeneration:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),action:integrationAction};
export const integrationRequest=z.object(guard).strict();
export const nativeIntegrationRequest=z.object({...guard,controllerId:neutralId,deviceId:neutralId}).strict();
export const sharedMonitorAction=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('label'),requestId:z.string().max(100),identity:sessionIdentity,label:z.string().max(160).nullable()}).strict(),
 z.object({operation:z.literal('acknowledge'),requestId:z.string().max(100),identity:sessionIdentity,noticeId:neutralId}).strict(),
]);
export type MonitorFilter=z.infer<typeof monitorFilter>;
export type SessionIdentity=z.infer<typeof sessionIdentity>;
export type PresentationConfiguration=z.infer<typeof presentationConfiguration>;
export type IntegrationAction=z.infer<typeof integrationAction>;
export type IntegrationRequest=z.infer<typeof integrationRequest>;
export interface PresentationStatus {
 configuration:PresentationConfiguration;
 sourceRevision:number|null;
 sourceConnection:'current'|'stale'|'unavailable';
 renditionGeneration:number|null;
 generation:number;
 pendingMode:'monitor'|'media'|null;
 participating:boolean;
 inFlight:number;
 lastOutcome:null|{generation:number;renditionGeneration:number;status:'sent'|'failed'|'uncertain'|'cancelled';code?:string};
}
export interface IntegrationSnapshot extends PresentationStatus {
 apiVersion:'pixoo-integration/1.0';serverId:string;nextRequestId:string;configurationRevision:number;
 capabilities:{modes:Array<'monitor'|'media'>;filters:Array<keyof MonitorFilter>;minimumCadenceMs:number;maximumCadenceMs:number};
 identity?:{controllerId:string;deviceId:string;sourceId:string};
}
export const integrationPaths=['/controller/pixoo-integration/v1/snapshot','/controller/pixoo-integration/v1/commands','/controller/pixoo-integration/v1/events'] as const;
