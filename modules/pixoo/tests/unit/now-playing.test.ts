import {expect,it} from 'vitest';
import type {PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import {cardLines,nowPlayingView,renderNowPlaying,trackKey,NOW_PLAYING_COLORS} from '../../src/presentation/now-playing.js';

const NOW=1_790_000_000_800;
type Known=Extract<PlaybackState['playback'],{status:'known'}>;
/** A playback/2.0 record observed 800 ms before NOW, with fields of the known playback replaced or removed by `playback`. */
const record=(playback:Partial<Record<keyof Known,unknown>>={},extra:Partial<PlaybackState>={}):PlaybackState=>{
 const known={status:'known',player:'playing',title:'Harvest Moon',artist:'Neil Young',album:'Harvest Moon',controls:['pause','next','previous'],...playback};
 for(const [name,value] of Object.entries(known))if(value===undefined)delete (known as Record<string,unknown>)[name];
 return {id:'presented',revision:1,availability:'available',observedAtMs:NOW-800,playback:known as Known,...extra};
};
const fresh={current:true,nowMs:NOW};
const pixel=(rgb:Uint8Array,x:number,y:number)=>Array.from(rgb.subarray((y*64+x)*3,(y*64+x)*3+3));
const dim=(color:readonly number[])=>color.map(value=>Math.floor(value/3));

it('shows a card for playing or paused playback with its title and artist',()=>{
 expect(nowPlayingView(record(),fresh)).toEqual({card:true,status:'playing',title:'HARVEST MOON',artist:'NEIL YOUNG',stale:false});
 expect(nowPlayingView(record({player:'paused',controls:['next','previous']}),fresh)).toMatchObject({card:true,status:'paused',stale:false});
});
it('marks a stale record, a copy that stopped following or an old observation stale until 30 seconds, then shows nothing',()=>{
 expect(nowPlayingView(record({},{availability:'stale'}),fresh)).toMatchObject({card:true,stale:true});
 expect(nowPlayingView(record(),{current:false,nowMs:NOW+400})).toMatchObject({card:true,stale:true});
 expect(nowPlayingView(record(),{current:true,nowMs:NOW+4200})).toMatchObject({card:true,stale:true});
 expect(nowPlayingView(record(),{current:true,nowMs:NOW+4199})).toMatchObject({card:true,stale:false});
 expect(nowPlayingView(record(),{current:false,nowMs:NOW+29_200})).toEqual({card:false});
});
it('shows nothing for unavailable, unknown, stopped or inactive playback, and never invents paused',()=>{
 expect(nowPlayingView(undefined,fresh)).toEqual({card:false});
 expect(nowPlayingView({id:'presented',revision:2,availability:'unavailable',playback:{status:'unknown'}},fresh)).toEqual({card:false});
 expect(nowPlayingView({id:'presented',revision:2,availability:'available',observedAtMs:NOW,playback:{status:'unknown'}},fresh)).toEqual({card:false});
 for(const player of ['stopped','inactive','unknown'])expect(nowPlayingView(record({player,controls:[]}),fresh)).toEqual({card:false});
});
it('keys a track by its title and artist only',()=>{
 expect(trackKey(nowPlayingView(record(),fresh))).toBe(trackKey(nowPlayingView(record({player:'paused',controls:[]}),fresh)));
 expect(trackKey(nowPlayingView(record({title:'Old King'}),fresh))).not.toBe(trackKey(nowPlayingView(record(),fresh)));
 expect(trackKey({card:false})).toBeNull();
});
it('wraps the title and artist into 16-column rows with a gap and truncates with a period',()=>{
 const lines=(playback:Partial<Record<keyof Known,unknown>>)=>cardLines(nowPlayingView(record(playback),fresh)).map(l=>[l.role,l.text,l.y]);
 expect(lines({})).toEqual([['title','HARVEST MOON',13],['artist','NEIL YOUNG',27]]);
 expect(lines({title:"Don't Stop Me Now (Remastered 2011) Live at Wembley Stadium 1986",artist:'Queen & Beyoncé'})).toEqual([
  ['title',"DON'T STOP ME",13],['title','NOW (REMASTERED',20],['title','2011) LIVE AT',27],['title','WEMBLEY STADIUM.',34],['artist','QUEEN & BEYONCE',48]]);
 expect(lines({title:'Supercalifragilisticexpialidocious',artist:undefined})).toEqual([['title','SUPERCALIFRAGILI',13],['title','STICEXPIALIDOCIO',20],['title','US',27]]);
 expect(lines({title:undefined})).toEqual([['artist','NEIL YOUNG',13]]);
 expect(lines({title:'Short',artist:'An Artist Whose Name Runs Over Four Whole Lines Of Text Here'})).toEqual([
  ['title','SHORT',13],['artist','AN ARTIST WHOSE',27],['artist','NAME RUNS OVER',34],['artist','FOUR WHOLE LINE.',41]]);
 expect(nowPlayingView(record({title:'AC/DC: Live, 1991',artist:'Motörhead 東京'}),fresh)).toMatchObject({title:'AC/DC: LIVE, 1991',artist:'MOTORHEAD --'});
 for(const line of cardLines(nowPlayingView(record({title:'x'.repeat(256),artist:'y '.repeat(120)}),fresh)))expect(line.text.length<=16&&line.y<=55).toBe(true);
});
it('draws a marker and status word, a divider and colored rows',()=>{
 const playing=renderNowPlaying(nowPlayingView(record(),fresh));expect(playing).toHaveLength(12288);
 expect(pixel(playing,0,1)).toEqual([...NOW_PLAYING_COLORS.playing]);expect(pixel(playing,2,1)).toEqual([0,0,0]);
 expect(pixel(playing,5,1)).toEqual([...NOW_PLAYING_COLORS.playing]);
 expect(pixel(playing,30,9)).toEqual([...NOW_PLAYING_COLORS.divider]);
 expect(pixel(playing,0,13)).toEqual([...NOW_PLAYING_COLORS.title]);expect(pixel(playing,0,27)).toEqual([...NOW_PLAYING_COLORS.artist]);
 const paused=renderNowPlaying(nowPlayingView(record({player:'paused',controls:[]}),fresh));
 expect(pixel(paused,0,1)).toEqual([...NOW_PLAYING_COLORS.paused]);expect(pixel(paused,1,1)).toEqual([0,0,0]);expect(pixel(paused,2,1)).toEqual([...NOW_PLAYING_COLORS.paused]);
});
it('dims a stale card and swaps its marker for ?',()=>{
 const stale=renderNowPlaying(nowPlayingView(record({},{availability:'stale'}),fresh));
 expect(pixel(stale,0,1)).toEqual(dim(NOW_PLAYING_COLORS.playing));expect(pixel(stale,1,1)).toEqual(dim(NOW_PLAYING_COLORS.playing));
 expect(pixel(stale,0,13)).toEqual(dim(NOW_PLAYING_COLORS.title));expect(pixel(stale,0,27)).toEqual(dim(NOW_PLAYING_COLORS.artist));
 expect(()=>renderNowPlaying({card:false})).toThrow();
});
