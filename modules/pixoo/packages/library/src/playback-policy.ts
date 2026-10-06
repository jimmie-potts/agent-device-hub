import {MediaError,type MediaProfile,type Rendition} from '@pixoo/media';
import {LibraryError,policySchema,validate,type PlaybackPolicy} from './contracts.js';
/** Effective delays and admission use the same active profile as playback loads. */
export function renditionTiming(rendition:Rendition,profile?:Readonly<MediaProfile>,stillDelayMs=100):number[]{
 const delays=rendition.frames.map(frame=>rendition.source.format==='gif'?frame.delayMs??100:stillDelayMs);
 if(!delays.length||delays.some(value=>!Number.isSafeInteger(value)||value<1))throw new MediaError('invalid-input');
 if(profile?.name==='pixoo64-hosted-2026-10-01'&&delays.some(delay=>delay%10))throw new MediaError('profile-limit');
 if(profile&&(delays.length>profile.maxFrames||delays.some(delay=>delay<profile.minDelayMs||delay>profile.maxDelayMs)||profile.uniformTiming&&delays.some(delay=>delay!==delays[0])))throw new MediaError('profile-limit');
 return delays;
}
export function playbackPolicy(rendition:Rendition,input:PlaybackPolicy|undefined,profile?:Readonly<MediaProfile>,stillDelayMs=100):PlaybackPolicy{
 const delays=renditionTiming(rendition,profile,stillDelayMs);
 const policy=validate(policySchema,input??(delays.length>1?{mode:'plays',totalPlays:3}:{mode:'duration',durationMs:30000}));
 const duration=policy.mode==='duration'?policy.durationMs:policy.totalPlays*delays.reduce((a,b)=>a+b,0);
 if(!Number.isSafeInteger(duration)||duration<1||policy.mode==='plays'&&delays.length<2)throw new LibraryError('invalid-input');
 return policy;
}
