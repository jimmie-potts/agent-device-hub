import type {Animation} from '@pixoo/device';
import type {PlaybackCheckpoint,CaptureHooks,PlaybackPolicy} from '@pixoo/library';
export type {PlaybackCheckpoint,CaptureHooks,PlaybackPolicy} from '@pixoo/library';
export interface PlaybackStore {
  claim():()=>void;
  capture(playlistId:string,hooks?:CaptureHooks,revision?:number):Promise<PlaybackCheckpoint>;
  captureMedia?(renditionId:string,policy:PlaybackPolicy|undefined,hooks:CaptureHooks):Promise<PlaybackCheckpoint>;
  read():Promise<PlaybackCheckpoint|undefined>;
  save(record:PlaybackCheckpoint):Promise<void>;
  clear():Promise<void>;
  load(renditionId:string,signal:AbortSignal):Promise<Animation>;
}
export class PlaybackError extends Error {
  constructor(readonly code:'invalid-input'|'closed'|'busy'|'storage-error'|'no-context'|'screen-off'|'cancelled'|'unsupported-operation'){super(code);this.name='PlaybackError';}
}
export interface PlayerState {
  state:PlaybackCheckpoint['state'];intent:PlaybackCheckpoint['intent'];availability:'unknown'|'available'|'offline';
  generation:number;sessionId:string|null;playlistId:string|null;playlistRevision:number|null;itemId:string|null;
  estimatedReadyAtMs:number|null;dwellDeadlineMs:number|null;timing:'estimated';requestedScreenOn:boolean;
  lastError:PlaybackCheckpoint['lastError'];
}
