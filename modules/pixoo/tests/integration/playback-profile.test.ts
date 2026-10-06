import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {Library} from '@pixoo/library';
import {PIXOO64_SMOKE_PROFILE} from '@pixoo/media';
import {LibraryPlaybackStore} from '../../packages/playback/src/library-store.js';
import {gifFixture} from '../helpers/media-fixtures.js';
const cleanup:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'pixoo-playback-profile-'));cleanup.push(()=>rm(directory,{recursive:true,force:true}));
 const library=await Library.open({directory});cleanup.push(()=>library.close());return library;
}
async function imported(library:Library,bytes:Buffer,name:string){async function* input(){yield bytes;}return library.importMedia(input(),name);}
function animation(delays:number[]){return gifFixture(1,1,delays.map(delay=>({width:1,height:1,pixels:[1],delay})));}
it('checks existing renditions against the active device bounds without rewriting GIF timing',async()=>{
 const library=await fixture(),device=new LibraryPlaybackStore(library,{profile:PIXOO64_SMOKE_PROFILE,stillDelayMs:500});
 const accepted=await imported(library,animation([50,50]),'accepted.gif');
 const loaded=await device.load(accepted.rendition.id,new AbortController().signal);
 expect(loaded.frames.map(frame=>frame.delayMs)).toEqual([500,500]);
 for(const delays of [[10],[50,10],[50,50,50]]){
  const rejected=await imported(library,animation(delays),'simulator.gif');
  await expect(device.load(rejected.rendition.id,new AbortController().signal)).rejects.toMatchObject({code:'profile-limit'});
  const simulator=await new LibraryPlaybackStore(library).load(rejected.rendition.id,new AbortController().signal);
  expect(simulator.frames.map(frame=>frame.delayMs)).toEqual(delays.map(delay=>delay*10));
 }
});
it('uses a device still-frame transmission delay without changing stored rendition or playback dwell',async()=>{
 const library=await fixture(),bytes=await sharp({create:{width:1,height:1,channels:3,background:'#ff0000'}}).png().toBuffer();
 const item=await imported(library,bytes,'still.png');
 const playlist=await library.createPlaylist('Still'),stored=await library.replaceItems(playlist.id,1,[{renditionId:item.rendition.id,playback:{mode:'duration',durationMs:7000}}]);
 const store=new LibraryPlaybackStore(library,{profile:PIXOO64_SMOKE_PROFILE,stillDelayMs:500});
 expect((await store.load(item.rendition.id,new AbortController().signal)).frames[0]!.delayMs).toBe(500);
 expect((await library.getRendition(item.rendition.id)).frames[0]!.delayMs).toBeNull();
 expect((await store.capture(stored.id)).snapshot.items[0]!.playback).toEqual({mode:'duration',durationMs:7000});
 expect((await new LibraryPlaybackStore(library).load(item.rendition.id,new AbortController().signal)).frames[0]!.delayMs).toBe(100);
});
