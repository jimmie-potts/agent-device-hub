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
// Whether a moment the hub marks as allowed to cover status may play over Monitor (Hub #1287).
export const momentSetting=z.object({version:z.literal(1),overMonitor:z.boolean()}).strict();
export type MomentSetting=z.infer<typeof momentSetting>;
