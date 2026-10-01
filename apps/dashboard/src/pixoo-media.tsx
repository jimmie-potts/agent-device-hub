import React,{useEffect,useId,useRef,useState} from 'react';
import {Api,ApiError} from './client';
import type {Pixoo} from './controls';
import {widgetDefinition,type WidgetSize} from './widgets';
import type {CatalogPage,Rendition,PlaylistSummary,PlaylistReply,PreviewManifest} from '../../hub/src/pixoo-catalog';
export type {PlaylistSummary};
const prefix=(alias:string)=>`/api/controllers/v1/${encodeURIComponent(alias)}/integration`;
const message=(e:unknown)=>e instanceof ApiError?e.code:'preview-unavailable';
export const available=(snapshot:Pixoo|undefined)=>snapshot?.apiVersion==='pixoo-integration/1.1'&&snapshot.capabilities.catalog?.supported===true;
export function frameAt(frames:PreviewManifest['frames'],elapsed:number):number {
 const duration=frames.reduce((n,f)=>n+(f.delayMs??0),0);if(!duration)return 0;
 let time=((elapsed%duration)+duration)%duration;for(let i=0;i<frames.length;i++){time-=frames[i].delayMs??0;if(time<0)return i;}return 0;
}
function Frame({bitmap,label}:{bitmap?:ImageBitmap;label:string}){
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{const ctx=canvas.current?.getContext('2d');if(ctx){ctx.clearRect(0,0,64,64);ctx.imageSmoothingEnabled=false;if(bitmap)ctx.drawImage(bitmap,0,0);}},[bitmap]);
 return <canvas ref={canvas} width={64} height={64} role="img" aria-label={label} className="pixoo-frame"/>;
}
/** A complete admitted animation is loaded sequentially, then timed from its manifest. Cleanup owns every decoded bitmap. */
function Animation({api,alias,id,active,label}:{api:Api;alias:string;id:string;active:boolean;label:string}){
 const [bitmaps,setBitmaps]=useState<ImageBitmap[]>([]),[manifest,setManifest]=useState<PreviewManifest>(),[frame,setFrame]=useState(0),[error,setError]=useState(''),[loaded,setLoaded]=useState(0);
 const [reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),[playing,setPlaying]=useState(false);
 useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)'),change=()=>{setReduced(media.matches);if(media.matches)setPlaying(false);};media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
 useEffect(()=>{
  const stop=new AbortController(),owned:ImageBitmap[]=[];setBitmaps([]);setManifest(undefined);setFrame(0);setLoaded(0);setError('');setPlaying(false);
  if(active)void(async()=>{
   const m=await api.request<PreviewManifest>(`${prefix(alias)}/renditions/${id}/preview.json`,undefined,stop.signal);
   if(m.renditionId!==id||m.frameCount<1||m.frameCount>1000||m.frames.length!==m.frameCount)throw new ApiError('invalid-preview');
   if(stop.signal.aborted)return;setManifest(m);
   for(const f of m.frames){
    const {blob}=await api.png(`${prefix(alias)}/renditions/${id}/frames/${f.index}.png`,stop.signal);
    const bitmap=await createImageBitmap(blob);if(stop.signal.aborted){bitmap.close();return;}owned.push(bitmap);setLoaded(owned.length);
   }
   if(!stop.signal.aborted){setBitmaps([...owned]);setPlaying(!matchMedia('(prefers-reduced-motion: reduce)').matches);}
  })().catch(e=>{if(!stop.signal.aborted)setError(message(e));});
  return()=>{stop.abort();owned.forEach(b=>b.close());};
 },[api,alias,id,active]);
 useEffect(()=>{if(!active||!playing||!manifest||bitmaps.length!==manifest.frameCount||bitmaps.length<2)return;let handle=0;const start=performance.now();const tick=(now:number)=>{setFrame(frameAt(manifest.frames,now-start));handle=requestAnimationFrame(tick);};handle=requestAnimationFrame(tick);return()=>cancelAnimationFrame(handle);},[active,playing,manifest,bitmaps]);
 return <div className="pixoo-animation"><Frame bitmap={bitmaps[frame]} label={`${label}, frame ${frame+1}`}/><div>
 {error?<p role="status" className="warning">Preview incomplete: {error}. Select it again to reload.</p>:bitmaps.length?<p className="hint">{bitmaps.length} frame{bitmaps.length===1?'':'s'} · {manifest?.durationMs===null?'Still image':`${manifest?.durationMs} ms per loop`}</p>:<p role="status" className="hint">{active?`Loading preview${manifest?` · ${loaded}/${manifest.frameCount} frames`:''}…`:'Preview paused while hidden.'}</p>}
 {bitmaps.length>1&&<button className="secondary" onClick={()=>setPlaying(!playing)}>{playing?'Pause preview':'Play preview'}</button>}
 {reduced&&<p className="hint">Reduced motion: previews start paused.</p>}
 </div></div>;
}
function useThumbnails(api:Api,alias:string,ids:readonly string[],active:boolean){
 const [images,setImages]=useState<Record<string,ImageBitmap>>({}),[error,setError]=useState(''),key=ids.join(',');
 useEffect(()=>{const stop=new AbortController(),owned:ImageBitmap[]=[];setImages({});setError('');if(active)void(async()=>{for(const id of new Set(ids)){const {blob}=await api.png(`${prefix(alias)}/renditions/${id}/preview.png`,stop.signal);const bitmap=await createImageBitmap(blob);if(stop.signal.aborted){bitmap.close();return;}owned.push(bitmap);setImages(old=>({...old,[id]:bitmap}));}})().catch(e=>{if(!stop.signal.aborted)setError(message(e));});return()=>{stop.abort();owned.forEach(b=>b.close());};},[api,alias,key,active]);
 return {images,error};
}
function MediaWidget({id,size,children}:{id:string;size:WidgetSize;children:React.ReactNode}){const heading=useId();return <section className={`widget widget-${size} pixoo-widget`} data-widget={id} data-size={size} aria-labelledby={heading}><h3 id={heading}>{widgetDefinition(id)?.name}</h3>{children}</section>;}
function Unavailable(){return <p className="hint">Not available on this Pixoo version. Existing controls remain available.</p>;}
function Pages({offset,total,onChange}:{offset:number;total:number;onChange:(n:number)=>void}){return <div className="actions pixoo-pagination"><button className="secondary" disabled={offset===0} onClick={()=>onChange(Math.max(0,offset-25))}>Previous page</button><span className="hint">{total?`${offset+1}–${Math.min(offset+25,total)} of ${total}`:'0 items'}</span><button className="secondary" disabled={offset+25>=total} onClick={()=>onChange(offset+25)}>Next page</button></div>;}
function Compatibility({compatible}:{compatible:boolean}){return <span className={compatible?'hint':'warning'}>{compatible?'Fits configured profile · physical output unverified':'Preview available · playback outside configured profile'}</span>;}
type CatalogProps={api:Api;alias:string;snapshot?:Pixoo;visible:boolean;onNames?:(names:PlaylistSummary[])=>void;size?:'medium'|'large'};
function CatalogWidget({api,alias,snapshot,visible,onNames,size='large',part}:CatalogProps&{part:'media'|'playlists'}){
 const enabled=available(snapshot),revision=snapshot?.catalogRevision;
 const [media,setMedia]=useState<CatalogPage<Rendition>>(),[playlists,setPlaylists]=useState<CatalogPage<PlaylistSummary>>(),[offset,setOffset]=useState(0),[playlistOffset,setPlaylistOffset]=useState(0),[selected,setSelected]=useState(''),[selectedPlaylist,setSelectedPlaylist]=useState(''),[detail,setDetail]=useState<PlaylistReply>(),[error,setError]=useState(''),[detailError,setDetailError]=useState(''),[reload,setReload]=useState(0),[itemOffset,setItemOffset]=useState(0);
 useEffect(()=>{const stop=new AbortController();setError('');if(!enabled){setMedia(undefined);setPlaylists(undefined);}if(visible&&enabled)void(async()=>{
  if(part==='media'){
   const page=await api.request<CatalogPage<Rendition>>(`${prefix(alias)}/catalog/renditions?offset=${offset}&limit=25`,undefined,stop.signal);
   if(page.catalogRevision!==revision)throw new ApiError('catalog-changed');if(!stop.signal.aborted)setMedia(page);
  }else{
   const page=await api.request<CatalogPage<PlaylistSummary>>(`${prefix(alias)}/catalog/playlists?offset=${playlistOffset}&limit=25`,undefined,stop.signal);
   if(page.catalogRevision!==revision)throw new ApiError('catalog-changed');if(!stop.signal.aborted){setPlaylists(page);onNames?.(page.items);}
  }
 })().catch(e=>{if(!stop.signal.aborted)setError(message(e));});return()=>stop.abort();},[api,alias,enabled,visible,revision,offset,playlistOffset,reload,part]);
 useEffect(()=>{const stop=new AbortController();setDetail(undefined);setDetailError('');if(visible&&enabled&&selectedPlaylist)void api.request<PlaylistReply>(`${prefix(alias)}/catalog/playlists/${selectedPlaylist}`,undefined,stop.signal).then(value=>{if(value.catalogRevision!==revision)throw new ApiError('catalog-changed');if(!stop.signal.aborted)setDetail(value);}).catch(e=>{if(!stop.signal.aborted)setDetailError(message(e));});return()=>stop.abort();},[api,alias,enabled,visible,revision,selectedPlaylist,reload]);
 const mediaThumbs=useThumbnails(api,alias,media?.items.map(r=>r.renditionId)??[],visible&&enabled),itemThumbs=useThumbnails(api,alias,detail?.playlist.items.slice(itemOffset,itemOffset+25).map(i=>i.renditionId)??[],visible&&enabled);
 const selectedItem=media?.items.find(r=>r.renditionId===selected);
 return <div className="pixoo-catalog">
 {part==='media'&&<MediaWidget id="pixoo-media" size={size}>{!enabled?<Unavailable/>:<>
 <p className="hint">Prepared 64×64 media from your Pixoo library. Select a rendition to preview it here.</p>
 {error?<p role="status" className="warning">Catalog unavailable: {error}. <button className="secondary" onClick={()=>setReload(n=>n+1)}>Reload catalog</button></p>:!media?<p role="status">Loading media…</p>:media.items.length===0?<p>No media in this library.</p>:<ul className="pixoo-media-grid">{media.items.map(r=><li key={r.renditionId}><button className="secondary" aria-pressed={selected===r.renditionId} onClick={()=>setSelected(selected===r.renditionId?'':r.renditionId)}><Frame bitmap={mediaThumbs.images[r.renditionId]} label={r.name}/><span>{r.name}</span><small>{r.format.toUpperCase()} · {r.frameCount} frames</small></button><Compatibility compatible={r.compatible}/></li>)}</ul>}
 {mediaThumbs.error&&<p role="status" className="warning">Thumbnail loading incomplete: {mediaThumbs.error}</p>}
 {selectedItem&&<div className="pixoo-selection"><h4>{selectedItem.name}</h4><Animation api={api} alias={alias} id={selectedItem.renditionId} active={visible} label={selectedItem.name}/><Compatibility compatible={selectedItem.compatible}/></div>}
 {media&&<Pages offset={media.offset} total={media.total} onChange={n=>{setOffset(n);setSelected('');}}/>}
 </>}</MediaWidget>}
 {part==='playlists'&&<MediaWidget id="pixoo-playlists" size={size}>{!enabled?<Unavailable/>:<>
 <p className="hint">Inspect a playlist's saved order and playback policy.</p>{error&&<p role="status" className="warning">Catalog unavailable: {error}. <button className="secondary" onClick={()=>setReload(n=>n+1)}>Reload catalog</button></p>}
 {playlists?.items.length===0?<p>No saved playlists.</p>:<div className="actions">{playlists?.items.map(p=><button className="secondary" key={p.id} aria-pressed={selectedPlaylist===p.id} onClick={()=>{setSelectedPlaylist(p.id);setItemOffset(0);}}>{p.name??p.id} · {p.itemCount} items</button>)}</div>}
 {playlists&&<Pages offset={playlists.offset} total={playlists.total} onChange={setPlaylistOffset}/>}
 {detailError&&<p role="status" className="warning">Playlist unavailable: {detailError}</p>}
 {detail&&<><h4>{detail.playlist.name??detail.playlist.id}</h4><p className="hint">{detail.playlist.repeat?'Repeats':'Once'} · {detail.playlist.shuffle?'Shuffle enabled; shown in saved order':'Saved order'}</p><ol className="pixoo-filmstrip" tabIndex={0} aria-label="Playlist filmstrip">{detail.playlist.items.slice(itemOffset,itemOffset+25).map((item,i)=><li key={item.id}><Frame bitmap={itemThumbs.images[item.renditionId]} label={`Playlist item ${itemOffset+i+1}`}/><span>Item {itemOffset+i+1}</span><small>{item.playback.mode==='duration'?`${item.playback.durationMs} ms`:`${item.playback.totalPlays} plays`}</small></li>)}</ol><Pages offset={itemOffset} total={detail.playlist.items.length} onChange={setItemOffset}/></>}
 {itemThumbs.error&&<p role="status" className="warning">Filmstrip incomplete: {itemThumbs.error}</p>}
 </>}</MediaWidget>}</div>;
}
export function PixooMediaGrid(props:CatalogProps){return <CatalogWidget {...props} part="media"/>;}
export function PixooPlaylists(props:CatalogProps){return <CatalogWidget {...props} part="playlists"/>;}
export function PixooCatalog(props:CatalogProps){return <><PixooMediaGrid {...props}/><PixooPlaylists {...props}/></>;}
export function PixooNowShowing({api,alias,snapshot,visible,stale,size='small'}:{api:Api;alias:string;snapshot?:Pixoo;visible:boolean;stale:boolean;size?:WidgetSize}){
 const media=snapshot?.currentMedia,[playlist,setPlaylist]=useState<PlaylistReply>(),[error,setError]=useState('');
 useEffect(()=>{const stop=new AbortController();setPlaylist(undefined);setError('');if(visible&&media?.playlistId)void api.request<PlaylistReply>(`${prefix(alias)}/catalog/playlists/${media.playlistId}`,undefined,stop.signal).then(value=>{if(value.catalogRevision!==snapshot?.catalogRevision)throw new ApiError('catalog-changed');if(!stop.signal.aborted)setPlaylist(value);}).catch(e=>{if(!stop.signal.aborted)setError(message(e));});return()=>stop.abort();},[api,alias,visible,media?.playlistId,snapshot?.catalogRevision]);
 return <MediaWidget id="pixoo-now-showing" size={size}>{!available(snapshot)?<Unavailable/>:!media?<p className="hint">No current media selection reported.</p>:<>
 <p>{playlist?.playlist.name??media.playlistId??'Single rendition'} · reported item {media.itemIndex+1} of {media.itemCount}</p>{playlist&&playlist.playlist.revision!==media.playlistRevision&&<p className="warning">Playlist changed since this playback selection was captured.</p>}
 <p className={stale||media.uncertain?'warning':'hint'}>{stale?'Stale: last reported selection':media.uncertain?'Transmission uncertain':`Player ${media.state} · requested ${media.intent}`}. Physical display unverified.</p>
 {snapshot?.configuration.mode!=='media'&&<p className="warning">Monitor mode: this is the retained media selection.</p>}
 <p className="hint">Preview availability does not qualify device playback; check the media grid's profile status.</p>
 <Animation api={api} alias={alias} id={media.renditionId} active={visible&&!stale} label="Current media selection"/>
 {error&&<p className="warning">Playlist name unavailable: {error}</p>}
 </>}</MediaWidget>;
}
