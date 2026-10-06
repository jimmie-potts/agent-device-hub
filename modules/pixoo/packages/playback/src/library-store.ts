import type {Library,PlaybackCheckpoint,CaptureHooks,PlaybackPolicy} from '@pixoo/library';
import {renditionTiming} from '@pixoo/library';
import {MediaError,type MediaProfile} from '@pixoo/media';
import type {PlaybackStore} from './contracts.js';
import {PlaybackError} from './contracts.js';
const owners=new WeakSet<Library>();
/** Shares the library's private storage and its existing exclusive process owner. */
export class LibraryPlaybackStore implements PlaybackStore {
  private readonly profile:Readonly<MediaProfile>|undefined;
  private readonly stillDelayMs:number;
  constructor(private library:Library,options:{profile?:Readonly<MediaProfile>;stillDelayMs?:number}={}){
    this.profile=options.profile?Object.freeze({...options.profile}):undefined;
    this.stillDelayMs=options.stillDelayMs??100;
    if(!Number.isSafeInteger(this.stillDelayMs)||this.stillDelayMs<1||this.stillDelayMs>655350)throw new MediaError('invalid-input');
  }
  claim():()=>void {if(owners.has(this.library))throw new PlaybackError('busy');owners.add(this.library);return ()=>{owners.delete(this.library);};}
  capture(id:string,hooks?:CaptureHooks,revision?:number){return this.library.createPlaybackCheckpoint(id,{...hooks,...(revision===undefined?{}:{revision}),...(this.profile?{profile:this.profile}:{}),stillDelayMs:this.stillDelayMs});}
  captureMedia(id:string,policy:PlaybackPolicy|undefined,hooks:CaptureHooks){return this.library.createMediaCheckpoint(id,policy,{...hooks,...(this.profile?{profile:this.profile}:{}),stillDelayMs:this.stillDelayMs});}
  read(){return this.library.getPlaybackCheckpoint();}
  save(record:PlaybackCheckpoint){return this.library.savePlaybackCheckpoint(record);}
  clear(){return this.library.clearPlaybackCheckpoint();}
  async load(id:string,signal:AbortSignal){
    const {rendition,frames}=await this.library.readRendition(id,signal);
    const delays=renditionTiming(rendition,this.profile,this.stillDelayMs);
    const prepared=frames.map((rgb,index)=>({rgb,delayMs:delays[index]!}));
    return {frames:prepared};
  }
}
