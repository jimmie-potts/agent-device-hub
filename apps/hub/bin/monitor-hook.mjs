#!/usr/bin/env node
// Observational only: no output protocol, permissions, retry, device or child process.
import {request} from 'node:http';
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
const finish=()=>process.exit(0);
process.on('uncaughtException',finish);process.on('unhandledRejection',finish);
setTimeout(finish,Math.max(1,2900-performance.now()));
async function bounded(stream,maximum){let size=0;const chunks=[];for await(const chunk of stream){size+=chunk.length;if(size>maximum){stream.destroy();throw new Error('limit');}chunks.push(chunk);}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
try{
 if(process.argv.length!==3)finish();
 const file=await open(process.argv[2],constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 let config;try{const info=await file.stat();if(!info.isFile()||info.nlink!==1||info.uid!==process.getuid()||(info.mode&0o077)!==0||info.size>8192)finish();config=await bounded(file.createReadStream(),8192);}finally{await file.close();}
 if(!config||Object.keys(config).sort().join(',')!=='enabled,endpoint,qualified,source,token'||config.enabled!==true||config.qualified!==true||typeof config.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(config.token))finish();
 const url=new URL(config.endpoint);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.search||url.hash||url.pathname!=='/api/monitor/v1/events')finish();
 const raw=await bounded(process.stdin,65536);
 if(!raw||typeof raw.hook_event_name!=='string')finish();
 const {normalizeHook}=await import('@jimmie-potts/agent-state/providers');
 const event=normalizeHook(raw,{...config.source,hook:raw.hook_event_name},Date.now());if(!event)finish();
 const body=JSON.stringify(event),outgoing=request(url,{method:'POST',agent:false,headers:{authorization:'Bearer '+config.token,'x-pixoo-request':'1','content-type':'application/json','content-length':Buffer.byteLength(body)}},response=>{response.destroy();outgoing.destroy();finish();});
 outgoing.on('error',finish);outgoing.end(body);
}catch{finish();}
