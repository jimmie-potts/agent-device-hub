import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {homedir} from 'node:os';
import {isAbsolute,join,win32} from 'node:path';
import {validDisplayText,type Envelope} from '@jimmie-potts/agent-lifecycle-contracts';

const MAX_BYTES=1024*1024,MAX_LINES=8192,MAX_LINE_BYTES=65536,DEADLINE_MS=100;
let pending=0;
export type MetadataOptions={codexHome?:string};
type Title=NonNullable<Envelope['title']>;
function path(value:string):string|null {
  if(value.length>4096||/[\u0000-\u001f\u007f]/u.test(value))return null;
  if(process.platform==='linux'&&/^[A-Za-z]:[\\/]/u.test(value))return `/mnt/${value[0].toLowerCase()}/${value.slice(3).replaceAll('\\','/')}`;
  return isAbsolute(value)?value:null;
}
export function projectName(cwd:string|null):string|undefined {
  if(!cwd)return undefined;
  const name=win32.basename(cwd.replace(/[\\/]+$/u,''));
  return validDisplayText(name,80)&&name!=='.'&&name!=='..'?name:undefined;
}
function title(value:unknown,source:Title['source']):Title|undefined {
  // Validate before truncating, so a credential beyond the display bound cannot be hidden.
  if(typeof value!=='string'||!validDisplayText(value,MAX_LINE_BYTES))return undefined;
  return {value:[...value].slice(0,160).join(''),source};
}
async function lookup(filePath:string,provider:'codex'|'claude',sessionId:string,signal:AbortSignal):Promise<Title|undefined>{
  const selected=path(filePath);if(!selected||!selected.endsWith('.jsonl')||signal.aborted)return;
  const file=await open(selected,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const info=await file.stat();if(!info.isFile()||signal.aborted)return;
    const start=Math.max(0,info.size-MAX_BYTES),buffer=Buffer.alloc(Math.min(info.size,MAX_BYTES));
    const {bytesRead}=await file.read(buffer,0,buffer.length,start);if(signal.aborted)return;
    let bytes=buffer.subarray(0,bytesRead);
    // The start of a bounded tail can split a UTF-8 character or JSON record.
    if(start){const newline=bytes.indexOf(10);if(newline<0)return;bytes=bytes.subarray(newline+1);}
    const lines=new TextDecoder('utf-8',{fatal:true}).decode(bytes).split('\n');
    if(lines.length>MAX_LINES)return;
    let custom:Title|undefined,automatic:Title|undefined;
    for(const line of lines){
      if(signal.aborted)return;
      if(!line||Buffer.byteLength(line)>MAX_LINE_BYTES)continue;
      let row;try{row=JSON.parse(line);}catch{continue;}
      if(!row||typeof row!=='object'||Array.isArray(row))continue;
      if(provider==='codex'){
        if(row.id===sessionId&&Object.hasOwn(row,'thread_name'))automatic=title(row.thread_name,'provider');
      }else if(row.sessionId===sessionId){
        if(row.type==='custom-title')custom=title(row.customTitle,'user');
        if(row.type==='ai-title')automatic=title(row.aiTitle,'provider');
      }
    }
    // An older custom title may be outside a Claude tail: do not substitute an AI title for it.
    return provider==='claude'?custom??(start===0?automatic:undefined):automatic;
  }finally{await file.close();}
}
export async function readSessionTitle(provider:'codex'|'claude',sessionId:string,transcriptPath:string|null,options:MetadataOptions={}):Promise<Title|undefined>{
  if(pending>=4)return;
  const home=options.codexHome??process.env.CODEX_HOME??join(homedir(),'.codex');
  const filePath=provider==='codex'?join(home,'session_index.jsonl'):transcriptPath;
  if(!filePath)return;
  pending++;
  const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const work=lookup(filePath,provider,sessionId,abort.signal).catch(()=>undefined).finally(()=>{pending--;});
  try{return await Promise.race([work,new Promise<undefined>(resolve=>{timer=setTimeout(()=>{abort.abort();resolve(undefined);},DEADLINE_MS);})]);}
  finally{clearTimeout(timer);abort.abort();}
}
/** Metadata enrichment never discards the lifecycle envelope to make room for a title. */
export function withMetadata(event:Envelope,metadata:{title?:Title;project?:string}):Envelope {
  let result:Envelope={...event,apiVersion:'1.1',...metadata};
  if(Buffer.byteLength(JSON.stringify(result))>2048){delete result.title;}
  if(Buffer.byteLength(JSON.stringify(result))>2048){delete result.project;}
  return Object.freeze(result);
}
export async function enrichCodexTitle(event:Envelope,codexHome:string):Promise<Envelope>{
  if(event.apiVersion!=='1.1'||event.identity.provider!=='codex'||event.parent.status==='known')return event;
  const value=await readSessionTitle('codex',event.identity.sessionId,null,{codexHome});
  return value?withMetadata(event,{title:value}):event;
}
