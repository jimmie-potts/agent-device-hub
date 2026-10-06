/** Consumer projection of Pixoo #96's catalog-integration contract. The producer owns storage and playback. */
import {createHash} from 'node:crypto';
import {HttpError,object} from './common.js';
export const catalogVersion='pixoo-integration/1.1' as const;
type Check=(v:unknown)=>boolean;
const shape=(v:unknown,r:Record<string,Check>,o:Record<string,Check>={}):boolean=>object(v)&&Object.keys(r).every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>Object.hasOwn(r,k)||Object.hasOwn(o,k))&&Object.entries(v).every(([k,x])=>(r[k]??o[k])(x));
const one=(...values:unknown[]):Check=>v=>values.includes(v);
const count:Check=v=>Number.isSafeInteger(v)&&(v as number)>=0;
const positive:Check=v=>count(v)&&(v as number)>0;
const boolean:Check=v=>typeof v==='boolean';
const hash:Check=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid:Check=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
// eslint-disable-next-line no-control-regex -- rejects control characters
const name:Check=v=>typeof v==='string'&&v.length>=1&&v.length<=120&&v.trim()===v&&!/[\x00-\x1f\x7f]/.test(v);
export type PlaybackPolicy={mode:'duration';durationMs:number}|{mode:'plays';totalPlays:number};
export type Rendition={assetId:string;renditionId:string;name:string;format:'png'|'jpeg'|'gif';frameCount:number;durationMs:number|null;compatible:boolean};
export type PlaylistSummary={id:string;name?:string;revision:number;itemCount:number;repeat:boolean;shuffle:boolean};
export type Playlist={id:string;name?:string;revision:number;repeat:boolean;shuffle:boolean;createdAt:string;updatedAt:string;items:{id:string;renditionId:string;playback:PlaybackPolicy}[]};
export type CatalogPage<T>={apiVersion:typeof catalogVersion;catalogRevision:number;items:T[];offset:number;limit:number;total:number};
export type PlaylistReply={apiVersion:typeof catalogVersion;catalogRevision:number;playlist:Playlist};
export type PreviewManifest={apiVersion:typeof catalogVersion;renditionId:string;width:64;height:64;frameCount:number;durationMs:number|null;frames:{index:number;delayMs:number|null}[];warnings:{frame:number;code:'missing-delay'|'zero-delay';effectiveDelayMs:100}[]};
export type CurrentMedia={renditionId:string;itemId:string;playlistId:string|null;playlistRevision:number|null;itemIndex:number;itemCount:number;state:'idle'|'loading'|'playing'|'paused'|'reconnecting'|'error';intent:'active'|'paused'|'stopped';generation:number;uncertain:boolean};
export const catalogCapabilities:Check=v=>shape(v,{supported:one(true),preview:one('png-frames'),maximumPageSize:one(100)});
export const currentMedia:Check=v=>v===null||shape(v,{renditionId:hash,itemId:uuid,playlistId:x=>x===null||uuid(x),playlistRevision:x=>x===null||positive(x),itemIndex:count,itemCount:positive,state:one('idle','loading','playing','paused','reconnecting','error'),intent:one('active','paused','stopped'),generation:count,uncertain:boolean})&&object(v)&&(v.itemIndex as number)<(v.itemCount as number);
const policy:Check=v=>shape(v,{mode:one('duration'),durationMs:positive})||shape(v,{mode:one('plays'),totalPlays:positive});
const rendition:Check=v=>shape(v,{assetId:uuid,renditionId:hash,name,format:one('png','jpeg','gif'),frameCount:x=>positive(x)&&(x as number)<=1000,durationMs:x=>x===null||count(x),compatible:boolean});
const summary:Check=v=>shape(v,{id:uuid,revision:positive,itemCount:x=>count(x)&&(x as number)<=1000,repeat:boolean,shuffle:boolean},{name});
const date:Check=v=>typeof v==='string'&&v.length<=40&&Number.isFinite(Date.parse(v));
const playlist:Check=v=>shape(v,{id:uuid,revision:positive,repeat:boolean,shuffle:boolean,createdAt:date,updatedAt:date,items:x=>Array.isArray(x)&&x.length<=1000&&x.every(i=>shape(i,{id:uuid,renditionId:hash,playback:policy}))},{name});
export type CatalogOperation={kind:'renditions'|'playlists';offset:number;limit:number}|{kind:'playlist';id:string}|{kind:'manifest'|'preview';id:string}|{kind:'frame';id:string;index:number};
export function pixooCatalogPath(op:CatalogOperation):string {
 if(op.kind==='renditions'||op.kind==='playlists'){
  if(!count(op.offset)||!positive(op.limit)||op.limit>100)throw new HttpError('invalid-request',400);
  return `/catalog/${op.kind}?offset=${op.offset}&limit=${op.limit}`;
 }
 if(op.kind==='playlist'){if(!uuid(op.id))throw new HttpError('invalid-request',400);return '/catalog/playlists/'+op.id;}
 if(!('id'in op)||!hash(op.id))throw new HttpError('invalid-request',400);
 if(op.kind==='frame'){if(!count(op.index)||op.index>=1000)throw new HttpError('invalid-request',400);return `/renditions/${op.id}/frames/${op.index}.png`;}
 return `/renditions/${op.id}/preview.${op.kind==='preview'?'png':'json'}`;
}
/** Parse only the advertised route families, rejecting repeated/unknown query parameters. */
export function catalogOperation(path:string,query:URLSearchParams):CatalogOperation {
 const list=/^catalog\/(renditions|playlists)$/.exec(path);
 if(list){if([...query.keys()].some(k=>!['offset','limit'].includes(k))||query.getAll('offset').length>1||query.getAll('limit').length>1||[...query.values()].some(v=>! /^(0|[1-9][0-9]*)$/.test(v)))throw new HttpError('invalid-request',400);const op={kind:list[1] as 'renditions'|'playlists',offset:Number(query.get('offset')??0),limit:Number(query.get('limit')??25)};pixooCatalogPath(op);return op;}
 if(query.size)throw new HttpError('invalid-request',400);
 const item=/^catalog\/playlists\/([^/]+)$/.exec(path),preview=/^renditions\/([^/]+)\/preview\.(png|json)$/.exec(path),frame=/^renditions\/([^/]+)\/frames\/(0|[1-9][0-9]*)\.png$/.exec(path);
 const op:CatalogOperation|undefined=item?{kind:'playlist',id:item[1]}:preview?{kind:preview[2]==='png'?'preview':'manifest',id:preview[1]}:frame?{kind:'frame',id:frame[1],index:Number(frame[2])}:undefined;
 if(!op)throw new HttpError('invalid-request',400);pixooCatalogPath(op);return op;
}
export function validateCatalogReply(v:unknown,op:CatalogOperation):boolean {
 if(op.kind==='playlist')return shape(v,{apiVersion:one(catalogVersion),catalogRevision:count,playlist})&&object(v)&&object(v.playlist)&&v.playlist.id===op.id;
 if(op.kind!=='renditions'&&op.kind!=='playlists')return false;
 return shape(v,{apiVersion:one(catalogVersion),catalogRevision:count,items:x=>Array.isArray(x)&&x.length<=op.limit&&x.every(op.kind==='renditions'?rendition:summary),offset:one(op.offset),limit:one(op.limit),total:count})&&object(v)&&Array.isArray(v.items)&&v.items.length<=Math.max(0,(v.total as number)-op.offset)&&new Set(v.items.map(item=>object(item)?item.renditionId??item.id:null)).size===v.items.length;
}
export function validateManifest(v:unknown,id:string):v is PreviewManifest {
 if(!shape(v,{apiVersion:one(catalogVersion),renditionId:one(id),width:one(64),height:one(64),frameCount:x=>positive(x)&&(x as number)<=1000,durationMs:x=>x===null||count(x),frames:x=>Array.isArray(x)&&x.length<=1000&&x.every(f=>shape(f,{index:count,delayMs:x=>x===null||positive(x)})),warnings:x=>Array.isArray(x)&&x.length<=1000&&x.every(w=>shape(w,{frame:count,code:one('missing-delay','zero-delay'),effectiveDelayMs:one(100)}))}))return false;
 const m=v as PreviewManifest;return m.frames.length===m.frameCount&&m.frames.every((f,i)=>f.index===i)&&m.warnings.every(w=>w.frame<m.frameCount)&&(m.frameCount===1&&m.durationMs===null&&m.frames[0].delayMs===null||m.frames.every(f=>f.delayMs!==null)&&m.frames.reduce((sum,f)=>sum+(f.delayMs??0),0)===m.durationMs);
}
export type Representation={status:number;headers:Record<string,string>;body:Buffer};
export async function previewReply(response:Response,op:CatalogOperation,conditional?:string):Promise<Representation>{
 const etag=response.headers.get('etag'),cache=response.headers.get('cache-control');
 if(!etag||!/^"[a-f0-9]{64}"$/.test(etag)||cache!=='private, max-age=31536000, immutable')throw new HttpError('incompatible-controller',502);
 const type=op.kind==='manifest'?'application/json':'image/png';
 const headers={'content-type':type,'cache-control':cache,etag,'x-content-type-options':'nosniff'};
 if(response.status===304){if(!conditional||conditional!==etag)throw new HttpError('incompatible-controller',502);return {status:304,headers,body:Buffer.alloc(0)};}
 if(response.headers.get('content-type')?.split(';')[0]!==type||!response.body)throw new HttpError('incompatible-controller',502);
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>(op.kind==='manifest'?131072:65536))throw new HttpError('incompatible-controller',502);chunks.push(chunk.value);}}finally{await reader.cancel().catch(()=>{});}
 const body=Buffer.concat(chunks);
 if('"'+createHash('sha256').update(body).digest('hex')+'"'!==etag)throw new HttpError('incompatible-controller',502);
 if(op.kind==='manifest'){let v:unknown;try{v=JSON.parse(body.toString('utf8'));}catch{throw new HttpError('incompatible-controller',502);}if(!('id'in op)||!validateManifest(v,op.id))throw new HttpError('incompatible-controller',502);}
 else if(body.length<33||body.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||body.toString('ascii',12,16)!=='IHDR'||body.readUInt32BE(16)!==64||body.readUInt32BE(20)!==64)throw new HttpError('incompatible-controller',502);
 return {status:200,headers,body};
}
