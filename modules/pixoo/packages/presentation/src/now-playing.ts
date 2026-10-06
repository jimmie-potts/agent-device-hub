import type {NowPlayingView} from '@pixoo/core';
import {drawGlyph,drawText,glyphs,type Color} from './pixel-font.js';
// Now-playing card for the hub's shared playback snapshot (GET /api/playback/v1/snapshot).
// The view and staleness rules match the hub's Tidbyt tile; see openspec now-playing-cards.
export type PlaybackStatus='playing'|'paused'|'stopped'|'inactive'|'unknown';
export type PlaybackSnapshot={
 apiVersion:'1.0';sourceId:string;availability:'available'|'stale'|'unavailable';observedAtMs:number|null;ageMs:number|null;
 playback:null|{status:PlaybackStatus;title?:string;artist?:string;album?:string;controls:string[]};
};
export type {NowPlayingView};
export const PLAYBACK_UNAVAILABLE_MS=30000;
const STALE_MS=5000,TEXT_LIMIT=256;
const statuses:readonly string[]=['playing','paused','stopped','inactive','unknown'],availabilities:readonly string[]=['available','stale','unavailable'];
const plain=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&Object.getPrototypeOf(value)===Object.prototype;
const keysWithin=(value:Record<string,unknown>,allowed:readonly string[],required:readonly string[])=>Object.keys(value).every(key=>allowed.includes(key))&&required.every(key=>Object.hasOwn(value,key));
const age=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const metadata=(value:unknown)=>value===undefined||(typeof value==='string'&&value.length>0&&Array.from(value).length<=TEXT_LIMIT);
/** The snapshot when it is a valid version 1.0 envelope for `sourceId`, otherwise undefined. */
export function parsePlaybackSnapshot(value:unknown,sourceId:string):PlaybackSnapshot|undefined {
 const envelope=['apiVersion','sourceId','availability','observedAtMs','ageMs','playback'];
 if(!plain(value)||!keysWithin(value,envelope,envelope)||value.apiVersion!=='1.0'||value.sourceId!==sourceId||!availabilities.includes(value.availability as string))return undefined;
 // Only a source that was never read, or has gone silent, has no playback; it may also have no observation time or age.
 if(value.availability==='unavailable')return value.playback===null&&(value.observedAtMs===null||age(value.observedAtMs))&&(value.ageMs===null||age(value.ageMs))?structuredClone(value) as PlaybackSnapshot:undefined;
 const playback=value.playback;
 if(!age(value.observedAtMs)||!age(value.ageMs)||!plain(playback)||!keysWithin(playback,['status','title','artist','album','controls'],['status','controls'])
  ||!statuses.includes(playback.status as string)||!metadata(playback.title)||!metadata(playback.artist)||!metadata(playback.album)
  ||!Array.isArray(playback.controls)||playback.controls.length>4||!playback.controls.every(action=>typeof action==='string'))return undefined;
 return structuredClone(value) as PlaybackSnapshot;
}
/** Uppercase, fold accents to base letters, collapse whitespace, and map characters outside the pixel alphabet to '-'. */
function cardText(value:string|undefined):string {
 return Array.from((value??'').normalize('NFD').replace(/\p{M}/gu,'').replace(/\s+/g,' ').trim().toUpperCase()).map(char=>Object.hasOwn(glyphs,char)?char:'-').join('');
}
/** `ageMs` is the snapshot's own age plus the time since it was received. */
export function nowPlayingView(snapshot:PlaybackSnapshot|undefined,options:{readOk:boolean;ageMs:number}):NowPlayingView {
 const playback=snapshot?.playback;
 if(!snapshot||snapshot.availability==='unavailable'||!playback||options.ageMs>=PLAYBACK_UNAVAILABLE_MS||(playback.status!=='playing'&&playback.status!=='paused'))return {card:false};
 return {card:true,status:playback.status,title:cardText(playback.title),artist:cardText(playback.artist),stale:!options.readOk||snapshot.availability==='stale'||options.ageMs>=STALE_MS};
}
/** A track's identity: its title and artist, independent of status and staleness. */
export function trackKey(view:NowPlayingView):string|null {return view.card?JSON.stringify([view.title,view.artist]):null;}

const COLUMNS=16,FIRST_ROW=13,PITCH=7,ROWS=7,MAX_ARTIST_ROWS=3;
/** Wrap at spaces, split words longer than a row, and end cut-off text with '.'. */
function wrap(value:string,rows:number):string[] {
 const out:string[]=[];let current='';
 for(let word of value.split(' ').filter(Boolean)){
  while(word.length>COLUMNS){if(current){out.push(current);current='';}out.push(word.slice(0,COLUMNS));word=word.slice(COLUMNS);}
  if(!word)continue;
  if(!current)current=word;else if(current.length+1+word.length<=COLUMNS)current+=` ${word}`;else{out.push(current);current=word;}
 }
 if(current)out.push(current);
 if(out.length<=rows)return out;
 if(rows<1)return [];
 const kept=out.slice(0,rows),last=kept[rows-1]!;
 kept[rows-1]=(last.length<COLUMNS?last:last.slice(0,COLUMNS-1))+'.';
 return kept;
}
export type CardLine={role:'title'|'artist';text:string;y:number};
/** Title rows first (up to four with an artist, else seven), a one-row gap, then up to three artist rows. */
export function cardLines(view:NowPlayingView):CardLine[] {
 if(!view.card)return [];
 const title=wrap(view.title,view.artist?4:ROWS);
 const start=title.length?title.length+1:0;
 const artist=wrap(view.artist,Math.min(MAX_ARTIST_ROWS,ROWS-start));
 return [...title.map((text,i)=>({role:'title' as const,text,y:FIRST_ROW+i*PITCH})),...artist.map((text,i)=>({role:'artist' as const,text,y:FIRST_ROW+(start+i)*PITCH}))];
}
export const NOW_PLAYING_COLORS:Readonly<Record<'playing'|'paused'|'title'|'artist'|'divider',Color>>=Object.freeze({
 playing:[70,200,100],paused:[230,170,60],title:[200,200,200],artist:[70,170,220],divider:[35,35,35],
});
const play='100110111110100',pause='101101101101101';
/** Draw a card as a 64×64 RGB frame: marker and status word, a divider, then the title and artist rows. */
export function renderNowPlaying(view:NowPlayingView):Uint8Array {
 if(!view.card)throw new Error('now-playing-card-required');
 const rgb=new Uint8Array(64*64*3);
 const shade=(color:Color):Color=>view.stale?[Math.floor(color[0]/3),Math.floor(color[1]/3),Math.floor(color[2]/3)]:color;
 const marker=shade(view.status==='playing'?NOW_PLAYING_COLORS.playing:NOW_PLAYING_COLORS.paused);
 drawGlyph(rgb,view.stale?glyphs['?']!:view.status==='playing'?play:pause,0,1,marker);
 drawText(rgb,view.status==='playing'?'PLAYING':'PAUSED',5,1,marker);
 const divider=shade(NOW_PLAYING_COLORS.divider);for(let x=0;x<64;x++)rgb.set(divider,(9*64+x)*3);
 for(const line of cardLines(view))drawText(rgb,line.text,0,line.y,shade(line.role==='title'?NOW_PLAYING_COLORS.title:NOW_PLAYING_COLORS.artist));
 return rgb;
}
