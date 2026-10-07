import type {PlaybackCheckpoint,Playlist,PlaylistItem,CaptureHooks} from '../../src/library/index.js';
import type {Animation} from '../../src/device/index.js';
export const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export class MemoryPlaybackStore {
  record:PlaybackCheckpoint|undefined;
  saved:PlaybackCheckpoint[]=[];
  loads:string[]=[];
  unavailable=new Set<string>();
  private owner=false;
  private sequence=100;
  playlist:Playlist={id:uuid(1),name:'Playback',revision:1,repeat:false,shuffle:false,createdAt:'2026-09-06T00:00:00.000Z',updatedAt:'2026-09-06T00:00:00.000Z',items:[
    {id:uuid(2),renditionId:'a'.repeat(64),playback:{mode:'plays',totalPlays:3}},
    {id:uuid(3),renditionId:'b'.repeat(64),playback:{mode:'duration',durationMs:1000}},
  ]};
  /** The fixture playlist's item at an index the test set up. */
  item(index:number):PlaylistItem {const item=this.playlist.items[index];if(!item)throw new Error(`No playlist item ${index}`);return item;}
  claim(){if(this.owner)throw new Error('busy');this.owner=true;return ()=>{this.owner=false;};}
  // Plain methods settle like the async ones they replace: a synchronous throw becomes a rejection.
  capture(id:string,hooks:CaptureHooks={}){return new Promise<PlaybackCheckpoint>(resolve=>{if(id!==this.playlist.id)throw new Error('missing playlist');const order=this.playlist.items.map(i=>i.id);const record={version:1,sessionId:uuid(++this.sequence),snapshot:structuredClone(this.playlist),order,cursor:0,history:[],historyCursor:null,currentItemId:order[0],frontierPlayed:false,intent:'paused',state:'paused',requestedScreenOn:true,lastError:null} as PlaybackCheckpoint;hooks.prepare?.(record);if(hooks.guard&&!hooks.guard())throw Object.assign(new Error('cancelled'),{code:'cancelled'});this.record=record;hooks.adopt?.(structuredClone(record));resolve(structuredClone(this.record));});}
  read(){return Promise.resolve(structuredClone(this.record));}
  save(record:PlaybackCheckpoint){this.record=structuredClone(record);this.saved.push(structuredClone(record));return Promise.resolve();}
  clear(){this.record=undefined;return Promise.resolve();}
  load(id:string):Promise<Animation>{this.loads.push(id);if(this.unavailable.has(id))return Promise.reject(Object.assign(new Error('bad media'),{code:'cache-corrupt'}));return Promise.resolve({frames:[{rgb:new Uint8Array(12288),delayMs:200},{rgb:new Uint8Array(12288).fill(1),delayMs:500}]});}
}
