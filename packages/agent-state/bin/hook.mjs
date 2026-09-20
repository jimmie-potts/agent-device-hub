#!/usr/bin/env node
import {createReadStream} from 'node:fs';
import {request} from 'node:http';

// Every path exits silently with success. No provider permissions or output protocol.
const finish=()=>process.exit(0);
process.on('uncaughtException',finish);
process.on('unhandledRejection',finish);
// Leave 100 ms of the frozen three-second budget for process startup/scheduling.
let timer=setTimeout(finish,Math.max(1,2900-performance.now()));
function deadline(milliseconds){
  clearTimeout(timer);
  timer=setTimeout(finish,Math.max(1,Math.min(milliseconds,2900)-performance.now()));
}
async function readBounded(stream,maximum){
  const chunks=[];let bytes=0;
  for await(const chunk of stream){
    bytes+=chunk.length;
    if(bytes>maximum){stream.destroy();throw new Error('oversized');}
    chunks.push(chunk);
  }
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));
}
try{
  if(process.argv.length!==3)finish();
  const config=await readBounded(createReadStream(process.argv[2],{highWaterMark:8192}),8192);
  if(!config||typeof config!=='object'||Array.isArray(config)||
    Object.keys(config).some(key=>!['source','endpoint','enabled','qualified','timeoutMs'].includes(key))||
    config.enabled!==true||config.qualified!==true||typeof config.endpoint!=='string')finish();
  const timeout=config.timeoutMs??2900;
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>3000)finish();
  deadline(timeout);
  const url=new URL(config.endpoint);
  if(url.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(url.hostname)||!url.port||
    url.username||url.password||url.search||url.hash||url.pathname!=='/v1/agent-events')finish();
  const {normalizeHook}=await import('../dist/providers.js');
  const raw=await readBounded(process.stdin,65536);
  const event=normalizeHook(raw,config.source,Date.now());
  if(!event)finish();
  const body=JSON.stringify(event);
  const outgoing=request(url,{method:'POST',agent:false,headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)}},response=>{
    response.destroy();outgoing.destroy();finish();
  });
  outgoing.on('error',finish);
  outgoing.end(body);
}catch{finish();}
