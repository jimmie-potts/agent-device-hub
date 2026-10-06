import {expect,it} from 'vitest';
import {cardLines,nowPlayingView,parsePlaybackSnapshot,renderNowPlaying,trackKey,NOW_PLAYING_COLORS,type PlaybackSnapshot} from '../../apps/server/src/now-playing.js';

const snapshot=(playback:Record<string,unknown>={},extra:Record<string,unknown>={}):PlaybackSnapshot=>({apiVersion:'1.0',sourceId:'ht-a9',availability:'available',observedAtMs:1_790_000_000_000,ageMs:800,
 playback:{status:'playing',title:'Harvest Moon',artist:'Neil Young',album:'Harvest Moon',controls:['pause','next','previous'],...playback},...extra} as PlaybackSnapshot);
const fresh={readOk:true,ageMs:800};
const pixel=(rgb:Uint8Array,x:number,y:number)=>Array.from(rgb.subarray((y*64+x)*3,(y*64+x)*3+3));
const dim=(color:readonly number[])=>color.map(value=>Math.floor(value/3));

it('shows a card for playing or paused playback with its title and artist',()=>{
 expect(nowPlayingView(snapshot(),fresh)).toEqual({card:true,status:'playing',title:'HARVEST MOON',artist:'NEIL YOUNG',stale:false});
 expect(nowPlayingView(snapshot({status:'paused',controls:['next','previous']}),fresh)).toMatchObject({card:true,status:'paused',stale:false});
});
it('marks a stale snapshot or failed read stale until 30 seconds, then shows nothing',()=>{
 expect(nowPlayingView(snapshot({},{availability:'stale',ageMs:6000}),{readOk:true,ageMs:6000})).toMatchObject({card:true,stale:true});
 expect(nowPlayingView(snapshot(),{readOk:false,ageMs:1200})).toMatchObject({card:true,stale:true});
 expect(nowPlayingView(snapshot(),{readOk:false,ageMs:30_000})).toEqual({card:false});
});
it('shows nothing for unavailable, stopped, inactive or unknown playback, and never invents paused',()=>{
 expect(nowPlayingView(undefined,{readOk:false,ageMs:0})).toEqual({card:false});
 expect(nowPlayingView({...snapshot(),availability:'unavailable',observedAtMs:null,ageMs:null,playback:null},{readOk:true,ageMs:0})).toEqual({card:false});
 for(const status of ['stopped','inactive','unknown'])expect(nowPlayingView(snapshot({status,controls:[]}),fresh)).toEqual({card:false});
});
it('validates the envelope strictly against the configured source',()=>{
 const good=snapshot();expect(parsePlaybackSnapshot(good,'ht-a9')).toEqual(good);
 const unavailable={...good,availability:'unavailable',observedAtMs:null,ageMs:null,playback:null};expect(parsePlaybackSnapshot(unavailable,'ht-a9')).toEqual(unavailable);
 const bad:unknown[]=[{...good,sourceId:'other'},{...good,apiVersion:'2.0'},{...good,availability:'fresh'},{...good,ageMs:-1},{...good,ageMs:null},{...good,extra:1},
  {...good,playback:null},{...unavailable,playback:good.playback},{...good,playback:{...good.playback,status:'buffering'}},{...good,playback:{...good.playback,title:''}},
  {...good,playback:{...good.playback,title:'x'.repeat(257)}},{...good,playback:{...good.playback,controls:'pause'}},{...good,playback:{...good.playback,artwork:'http://192.168.1.20/a'}},null,[],'text'];
 for(const value of bad)expect(parsePlaybackSnapshot(value,'ht-a9')).toBeUndefined();
});
it('keys a track by its title and artist only',()=>{
 expect(trackKey(nowPlayingView(snapshot(),fresh))).toBe(trackKey(nowPlayingView(snapshot({status:'paused',controls:[]}),fresh)));
 expect(trackKey(nowPlayingView(snapshot({title:'Old King'}),fresh))).not.toBe(trackKey(nowPlayingView(snapshot(),fresh)));
 expect(trackKey({card:false})).toBeNull();
});
it('wraps the title and artist into 16-column rows with a gap and truncates with a period',()=>{
 const lines=(playback:Record<string,unknown>)=>cardLines(nowPlayingView(snapshot(playback),fresh)).map(l=>[l.role,l.text,l.y]);
 expect(lines({})).toEqual([['title','HARVEST MOON',13],['artist','NEIL YOUNG',27]]);
 expect(lines({title:"Don't Stop Me Now (Remastered 2011) Live at Wembley Stadium 1986",artist:'Queen & Beyoncé'})).toEqual([
  ['title',"DON'T STOP ME",13],['title','NOW (REMASTERED',20],['title','2011) LIVE AT',27],['title','WEMBLEY STADIUM.',34],['artist','QUEEN & BEYONCE',48]]);
 expect(lines({title:'Supercalifragilisticexpialidocious',artist:undefined})).toEqual([['title','SUPERCALIFRAGILI',13],['title','STICEXPIALIDOCIO',20],['title','US',27]]);
 expect(lines({title:undefined})).toEqual([['artist','NEIL YOUNG',13]]);
 expect(lines({title:'Short',artist:'An Artist Whose Name Runs Over Four Whole Lines Of Text Here'})).toEqual([
  ['title','SHORT',13],['artist','AN ARTIST WHOSE',27],['artist','NAME RUNS OVER',34],['artist','FOUR WHOLE LINE.',41]]);
 expect(nowPlayingView(snapshot({title:'AC/DC: Live, 1991',artist:'Motörhead 東京'}),fresh)).toMatchObject({title:'AC/DC: LIVE, 1991',artist:'MOTORHEAD --'});
 for(const line of cardLines(nowPlayingView(snapshot({title:'x'.repeat(256),artist:'y '.repeat(120)}),fresh)))expect(line.text.length<=16&&line.y<=55).toBe(true);
});
it('draws a marker and status word, a divider and colored rows',()=>{
 const playing=renderNowPlaying(nowPlayingView(snapshot(),fresh));expect(playing).toHaveLength(12288);
 expect(pixel(playing,0,1)).toEqual([...NOW_PLAYING_COLORS.playing]);expect(pixel(playing,2,1)).toEqual([0,0,0]);
 expect(pixel(playing,5,1)).toEqual([...NOW_PLAYING_COLORS.playing]);
 expect(pixel(playing,30,9)).toEqual([...NOW_PLAYING_COLORS.divider]);
 expect(pixel(playing,0,13)).toEqual([...NOW_PLAYING_COLORS.title]);expect(pixel(playing,0,27)).toEqual([...NOW_PLAYING_COLORS.artist]);
 const paused=renderNowPlaying(nowPlayingView(snapshot({status:'paused',controls:[]}),fresh));
 expect(pixel(paused,0,1)).toEqual([...NOW_PLAYING_COLORS.paused]);expect(pixel(paused,1,1)).toEqual([0,0,0]);expect(pixel(paused,2,1)).toEqual([...NOW_PLAYING_COLORS.paused]);
});
it('dims a stale card and swaps its marker for ?',()=>{
 const stale=renderNowPlaying(nowPlayingView(snapshot({},{availability:'stale',ageMs:6000}),{readOk:true,ageMs:6000}));
 expect(pixel(stale,0,1)).toEqual(dim(NOW_PLAYING_COLORS.playing));expect(pixel(stale,1,1)).toEqual(dim(NOW_PLAYING_COLORS.playing));
 expect(pixel(stale,0,13)).toEqual(dim(NOW_PLAYING_COLORS.title));expect(pixel(stale,0,27)).toEqual(dim(NOW_PLAYING_COLORS.artist));
 expect(()=>renderNowPlaying({card:false})).toThrow();
});
