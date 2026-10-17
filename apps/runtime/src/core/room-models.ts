import {lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {errorBody,type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import type {ModuleContent,ModuleContentRequest} from '@jimmie-potts/sdk';
import {PrivateFileError,readPrivateFile} from '../state.js';
import {MAX_ROOM_MODEL_BYTES,parseRoomCatalog,parseRoomModel,roomModelId} from '../room-model.js';

/** Core-owned, manually prepared content; no arbitrary path, executable asset or device operation. */
export async function readRoomContent(folder:string|(()=>string),ref:string,lifetime:AbortSignal,request?:ModuleContentRequest):Promise<ModuleContent|ErrorBody|undefined> {
  if(ref!=='room-model-catalog'&&!ref.startsWith('room-model-'))return undefined;
  const aborted=():boolean=>lifetime.aborted||request?.signal.aborted===true;
  if(aborted())return errorBody('cancelled');
  if(request!==undefined&&Object.keys(request.query).length>0)return errorBody('invalid-request');
  const id=ref==='room-model-catalog'?undefined:ref.slice('room-model-'.length);
  if(id!==undefined&&!roomModelId(id))return errorBody('invalid-request');
  try{
    const directory=join(typeof folder==='string'?folder:folder(),'room-models');
    const info=await lstat(directory);
    if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid?.()||(info.mode&0o077)!==0)return errorBody('forbidden');
    const bytes=await readPrivateFile(join(directory,id===undefined?'catalog.json':id+'.json'),id===undefined?65_536:MAX_ROOM_MODEL_BYTES);
    if(aborted())return errorBody('cancelled');
    let data:unknown;
    try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return errorBody('invalid-request');}
    const valid=id===undefined?parseRoomCatalog(data):parseRoomModel(data);
    if(valid===undefined||id!==undefined&&(!('id' in valid)||valid.id!==id))return errorBody('invalid-request');
    return {type:'application/json',bytes:Buffer.from(JSON.stringify(valid))};
  }catch(error){
    if(error instanceof PrivateFileError)return errorBody(error.problem==='missing'?'not-found':error.problem==='too-large'?'too-large':'forbidden');
    if(error instanceof Error&&'code' in error&&error.code==='ENOENT')return errorBody('not-found');
    return errorBody('internal');
  }
}
