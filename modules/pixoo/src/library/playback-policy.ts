import {MediaError,type MediaProfile,type Rendition} from '../media/index.js';
import {animationRoute, frameCountRefusal, timingRefusal} from '../device/animation-policy.js';
import {LibraryError,policySchema,validate,type PlaybackPolicy} from './contracts.js';
export class PlaybackRouteError extends MediaError {
  constructor(readonly detail: string) { super('profile-limit'); }
}

/** Effective delays and admission use the same active profile as playback loads. */
export function renditionTiming(rendition:Rendition,profile?:Readonly<MediaProfile>,stillDelayMs=100):number[]{
 const delays=rendition.frames.map(frame=>rendition.source.format==='gif'?frame.delayMs??100:stillDelayMs);
 if(delays.length===0||delays.some(value=>!Number.isSafeInteger(value)||value<1))throw new MediaError('invalid-input');
 if(profile) {
   const route = animationRoute(profile.name);
   const refusal = frameCountRefusal(route, delays.length) ?? timingRefusal(route, delays);
   if (refusal !== undefined) throw new PlaybackRouteError(refusal);
 }
 return delays;
}
export function playbackPolicy(rendition:Rendition,input:PlaybackPolicy|undefined,profile?:Readonly<MediaProfile>,stillDelayMs=100):PlaybackPolicy{
 const delays=renditionTiming(rendition,profile,stillDelayMs);
 const policy=validate(policySchema,input??(delays.length>1?{mode:'plays',totalPlays:3}:{mode:'duration',durationMs:30000}));
 const duration=policy.mode==='duration'?policy.durationMs:policy.totalPlays*delays.reduce((a,b)=>a+b,0);
 if(!Number.isSafeInteger(duration)||duration<1||policy.mode==='plays'&&delays.length<2)throw new LibraryError('invalid-input');
 return policy;
}
