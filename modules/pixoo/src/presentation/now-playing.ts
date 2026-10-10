import type {PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import type {NowPlayingView} from '../core/index.js';
import {drawGlyph,drawText,glyphs,type Color} from './pixel-font.js';
// Text card for the playback owner's 2.0 or 2.1 record (Hub #929, #229). The owner publishes playback, artwork and
// availability changes and says itself when the record turns stale or unavailable (ADR 0012, "Consumers and recovery"), so
// the card follows the record's `availability` and whether the module's copy still follows its owner, never the age of
// `observedAtMs`: a song that plays on unchanged keeps a current card. See openspec bunny-pixoo-module.
export type {NowPlayingView};
const fallback=glyphs['?']??'';
/** Uppercase, fold accents to base letters, collapse whitespace, and map characters outside the pixel alphabet to '-'. */
function cardText(value:string|undefined):string {
 return Array.from((value??'').normalize('NFD').replace(/\p{M}/gu,'').replace(/\s+/g,' ').trim().toUpperCase()).map(char=>Object.hasOwn(glyphs,char)?char:'-').join('');
}
/**
 * The card for the playback owner's record. `current` says whether the module's copy follows its owner. No record, an
 * unavailable one, one without known playback, or a player neither playing nor paused shows no card. A record its owner
 * marks stale, or a copy that stopped following its owner, shows a stale card.
 */
export function nowPlayingView(record:PlaybackState|undefined,{current}:{current:boolean}):NowPlayingView {
 if(record===undefined||record.availability==='unavailable')return {card:false};
 const {playback}=record;
 if(playback.status!=='known'||(playback.player!=='playing'&&playback.player!=='paused'))return {card:false};
 return {card:true,status:playback.player,title:cardText(playback.title),artist:cardText(playback.artist),stale:!current||record.availability==='stale'};
}
/** A track's identity: its title and artist, independent of status and staleness. */
export function trackKey(view:NowPlayingView):string|null {return view.card?JSON.stringify([view.title,view.artist]):null;}

const COLUMNS=16,FIRST_ROW=13,PITCH=7,ROWS=7,MAX_ARTIST_ROWS=3;
/** Wrap at spaces, split words longer than a row, and end cut-off text with '.'. */
function wrap(value:string,rows:number):string[] {
 const out:string[]=[];let current='';
 for(let word of value.split(' ').filter(Boolean)){
  while(word.length>COLUMNS){if(current!==''){out.push(current);current='';}out.push(word.slice(0,COLUMNS));word=word.slice(COLUMNS);}
  if(word==='')continue;
  if(current==='')current=word;else if(current.length+1+word.length<=COLUMNS)current+=` ${word}`;else{out.push(current);current=word;}
 }
 if(current!=='')out.push(current);
 if(out.length<=rows)return out;
 if(rows<1)return [];
 const kept=out.slice(0,rows),last=kept[rows-1]??'';
 kept[rows-1]=(last.length<COLUMNS?last:last.slice(0,COLUMNS-1))+'.';
 return kept;
}
export type CardLine={role:'title'|'artist';text:string;y:number};
/** Title rows first (up to four with an artist, else seven), a one-row gap, then up to three artist rows. */
export function cardLines(view:NowPlayingView):CardLine[] {
 if(!view.card)return [];
 const title=wrap(view.title,view.artist!==''?4:ROWS);
 const start=title.length>0?title.length+1:0;
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
 drawGlyph(rgb,view.stale?fallback:view.status==='playing'?play:pause,0,1,marker);
 drawText(rgb,view.status==='playing'?'PLAYING':'PAUSED',5,1,marker);
 const divider=shade(NOW_PLAYING_COLORS.divider);for(let x=0;x<64;x++)rgb.set(divider,(9*64+x)*3);
 for(const line of cardLines(view))drawText(rgb,line.text,0,line.y,shade(line.role==='title'?NOW_PLAYING_COLORS.title:NOW_PLAYING_COLORS.artist));
 return rgb;
}
