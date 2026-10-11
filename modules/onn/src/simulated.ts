import {errorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {SdkError} from '@jimmie-potts/sdk';
import type {CurrentApp} from './actions.js';
import type {AppObservation, Attempt, OnnAction, OnnTransport} from './transport.js';
import type {MetadataSession} from './metadata.js';
/** In-memory device state survives a disposable host restart. It stores no text. */
export class SimulatedOnn implements OnnTransport {
  online = true;
  app: CurrentApp = 'none';
  effects = 0;
  #elapsed=0;
  #position=0;
  #selection=1;
  #paused=false;
  #browsing=false;
  execute(action: OnnAction, signal: AbortSignal, beforeEffect: () => ErrorCode | undefined = () => undefined): Promise<Attempt> {
    signal.throwIfAborted();
    const code = beforeEffect(); if (code !== undefined) return Promise.resolve({result: 'failed', evidence: 'none', code, connection: 'unknown'});
    if (!this.online) return Promise.resolve({result: 'failed', evidence: 'none', code: 'unavailable', connection: 'unavailable'});
    this.effects += 1;
    if (action.kind === 'app') {this.app = action.app;this.#browsing=true;}
    if (action.kind === 'key' && action.key === 'home') this.app = 'other';
    if (action.kind === 'key' && action.key === 'play-pause')this.#paused=!this.#paused;
    return Promise.resolve({result: 'succeeded', evidence: 'transmitted', connection: 'available'});
  }
  read(signal: AbortSignal): Promise<AppObservation | undefined> {
    signal.throwIfAborted();this.#elapsed+=5000;
    if(!this.online)return Promise.resolve(undefined);
    const sessions:MetadataSession[]=[];
    if((this.app==='youtube'||this.app==='stremio')&&!this.#browsing){
      if(!this.#paused)this.#position+=5000;
      sessions.push({app:this.app,metadata:{title:this.app==='youtube'?`Synthetic YouTube title ${this.#selection}`:'Synthetic Stremio series',displayTitle:null,subtitle:this.app==='stremio'?`Synthetic episode ${this.#selection}`:null,artist:this.app==='youtube'?'Synthetic channel':null,album:null,genre:null,description:null,mediaId:`synthetic-${this.app}-${this.#selection}`,durationMs:120000},playback:{state:this.#paused?2:3,positionMs:this.#position,speed:this.#paused?0:1,positionUpdatedElapsedMs:this.#elapsed},omissions:[]});
    }
    return Promise.resolve({app:this.app,metadata:{schema:'onn-metadata/2.0',deviceElapsedMs:this.#elapsed,sessions}});
  }
  state(): {online: boolean; app: CurrentApp; effects: number} {return {online: this.online, app: this.app, effects: this.effects};}
  act(action: string): void {
    if (action === 'online') this.online = true;
    else if (action === 'offline') this.online = false;
    else if (action === 'physical-youtube'||action==='physical-stremio') {this.app=action==='physical-youtube'?'youtube':'stremio';this.#browsing=false;this.#selection=1;this.#position=0;this.#paused=false;}
    else if(action==='physical-next'){this.#selection+=1;this.#position=0;this.#browsing=false;}
    else if(action==='physical-pause')this.#paused=true;
    else if(action==='physical-resume')this.#paused=false;
    else if(action==='physical-exit')this.#browsing=true;
    else throw new SdkError(errorBody('invalid-request', {detail: 'unknown ONN simulation action'}));
  }
}
