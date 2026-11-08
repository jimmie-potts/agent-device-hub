import {z} from 'zod';
// Browser-facing now-playing setting and state. The pixoo-integration/1.0 contract does not carry these.
export const nowPlayingMedia=z.enum(['off','popup','whole']);
export const nowPlayingSetting=z.object({version:z.literal(1),media:nowPlayingMedia}).strict();
export const nowPlayingRequest=z.object({media:nowPlayingMedia}).strict();
export type NowPlayingMedia=z.infer<typeof nowPlayingMedia>;
export type NowPlayingSetting=z.infer<typeof nowPlayingSetting>;
export type NowPlayingView={card:false}|{card:true;status:'playing'|'paused';title:string;artist:string;stale:boolean};
export interface NowPlayingState {
 configured:boolean;setting:NowPlayingSetting;source:'current'|'stale'|'unavailable';view:NowPlayingView;
 showing:'dashboard'|'card'|'moment'|'none';takeover:'popup'|'whole'|null;lastTakeover:'resumed'|'dropped'|null;card:number[]|null;
}
// Whether moments may play over the status base (Hub #1287, ADR 0014). A value saved before ADR 0014 names the same
// setting `overMonitor`; it reads as `overStatus`, so the owner's choice carries over.
export const momentSetting=z.union([
 z.object({version:z.literal(1),overStatus:z.boolean()}).strict(),
 z.object({version:z.literal(1),overMonitor:z.boolean()}).strict().transform(({version,overMonitor})=>({version,overStatus:overMonitor})),
]);
export type MomentSetting=z.output<typeof momentSetting>;
