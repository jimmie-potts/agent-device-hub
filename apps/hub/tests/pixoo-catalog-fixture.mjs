import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function crc(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
const chunk=(type,data)=>{const named=Buffer.concat([Buffer.from(type),data]),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE(crc(named));return Buffer.concat([size,named,sum]);};
/** Deterministic 4096-color RGB PNG, with adjacent duplicate animation frames. */
export function framePng(index=0){const data=Buffer.alloc(64*(1+64*3));for(let y=0;y<64;y++)for(let x=0;x<64;x++){const p=y*193+1+x*3;data[p]=(x*4+Math.floor(index/2)*10)%256;data[p+1]=y*4;data[p+2]=(x+y)%256;}const header=Buffer.alloc(13);header.writeUInt32BE(64);header.writeUInt32BE(64,4);header[8]=8;header[9]=2;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(data)),chunk('IEND',Buffer.alloc(0))]);}
export function pixooCatalogFixture(){
 const version='pixoo-integration/1.1',ids=Array.from({length:30},(_,i)=>hash('rendition-'+i));
 const media=ids.map((id,i)=>({assetId:uuid(i+1),renditionId:id,name:i===0?'Aurora variable.gif':i===1?'Historical two-frame.gif':`Prepared image ${i+1}.png`,format:i<2?'gif':'png',frameCount:i===0?20:i===1?2:1,durationMs:i===0?2000:i===1?1000:null,compatible:i!==0}));
 const playlists=[{id:uuid(100),name:'Evening colors',revision:1,itemCount:3,repeat:true,shuffle:false},{id:uuid(101),revision:1,itemCount:1,repeat:false,shuffle:false}];
 const state={revision:1,empty:false,removed:false,broken:false,reads:[],ids,media,playlists};
 state.snapshot=legacy=>({...legacy,apiVersion:version,catalogRevision:state.revision,capabilities:{...legacy.capabilities,catalog:{supported:true,preview:'png-frames',maximumPageSize:100}},currentMedia:state.empty?null:{renditionId:ids[0],itemId:uuid(200),playlistId:uuid(100),playlistRevision:1,itemIndex:0,itemCount:3,state:'playing',intent:'active',generation:3,uncertain:false}});
 state.serve=(req,res,legacy)=>{
  const url=new URL(req.url,'http://fixture.invalid'),path=url.pathname,root='/controller/pixoo-integration/v1';
  const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));return true;};
  if(path===root+'/snapshot'&&url.searchParams.get('apiVersion')===version)return send(200,state.snapshot(legacy));
  if(!path.startsWith(root+'/catalog/')&&!path.startsWith(root+'/renditions/'))return false;
  state.reads.push(req.url);
  if(path===root+'/catalog/renditions'||path===root+'/catalog/playlists'){const offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??25),all=state.empty?[]:path.endsWith('/renditions')?media:playlists;return send(200,{apiVersion:version,catalogRevision:state.revision,items:all.slice(offset,offset+limit),total:all.length,offset,limit});}
  if(path.startsWith(root+'/catalog/playlists/')){const p=playlists.find(p=>p.id===path.split('/').at(-1));if(!p)return send(404,{error:{code:'not-found'}});const {itemCount,...rest}=p;return send(200,{apiVersion:version,catalogRevision:state.revision,playlist:{...rest,createdAt:'2026-09-30T00:00:00.000Z',updatedAt:'2026-09-30T00:00:00.000Z',items:Array.from({length:itemCount},(_,i)=>({id:uuid(200+i),renditionId:ids[i],playback:i===0?{mode:'plays',totalPlays:3}:{mode:'duration',durationMs:5000}}))}});}
  const match=/\/renditions\/([a-f0-9]{64})\/(preview\.(png|json)|frames\/(\d+)\.png)$/.exec(path),item=match&&media.find(m=>m.renditionId===match[1]);
  if(!item||state.removed)return send(404,{error:{code:'not-found'}});
  const index=Number(match[4]??0);if(index>=item.frameCount)return send(404,{error:{code:'not-found'}});
  const manifest={apiVersion:version,renditionId:item.renditionId,width:64,height:64,frameCount:item.frameCount,durationMs:item.durationMs,frames:Array.from({length:item.frameCount},(_,i)=>({index:i,delayMs:item.frameCount===1?null:item.frameCount===2?500:i%2===0?50:150})),warnings:[]};
  const bytes=match[3]==='json'?Buffer.from(JSON.stringify(manifest)):framePng(index),etag='"'+hash(bytes)+'"';
  res.setHeader('etag',etag);res.setHeader('cache-control','private, max-age=31536000, immutable');
  if(req.headers['if-none-match']===etag){res.writeHead(304);res.end();return true;}
  res.setHeader('content-type',match[3]==='json'?'application/json':'image/png');res.end(state.broken?Buffer.from('broken'):bytes);return true;
 };
 return state;
}
