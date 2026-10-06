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
 showing:'dashboard'|'card'|'none';takeover:'popup'|'whole'|null;lastTakeover:'resumed'|'dropped'|null;card:number[]|null;
}
