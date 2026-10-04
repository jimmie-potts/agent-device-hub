import {readFileSync} from 'node:fs';
import {Ajv2020} from 'ajv/dist/2020.js';
import {validateSnapshot as validateEarlierSnapshot} from './validation.js';
import type {Snapshot} from './types.js';

// Snapshot 1.3 is snapshot 1.2 plus an optional root-session `hostSessionId` held in owner
// memory. It is content, not durable state: validation.ts and the durable schemas stay frozen.
const MAX_BYTES=16*1024*1024,MAX_NODES=1000000;
const check=new Ajv2020({strict:true,allErrors:false}).compile(JSON.parse(readFileSync(new URL('../schemas/snapshot-v1.3.schema.json',import.meta.url),'utf8')));
type Validation={ok:true;value:Snapshot}|{ok:false;code:'invalid-state'};
const invalid:Validation=Object.freeze({ok:false,code:'invalid-state'}) as Validation;

// Reject accessors and non-JSON input before serialization or schema traversal.
function bounded(value:unknown,depth=0,budget={nodes:0,bytes:0}):boolean {
  if(depth>20||++budget.nodes>MAX_NODES)return false;
  if(typeof value==='string'){
    budget.bytes+=Buffer.byteLength(value);
    return budget.bytes<=MAX_BYTES&&!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
  }
  if(typeof value==='number')return Number.isSafeInteger(value)&&value>=0;
  if(value===null||typeof value==='boolean')return true;
  if(typeof value!=='object')return false;
  const isArray=Array.isArray(value);
  if(!isArray&&Object.getPrototypeOf(value)!==Object.prototype)return false;
  const keys=Reflect.ownKeys(value);if(keys.length>10001)return false;
  for(const key of keys){
    if(isArray&&key==='length')continue;
    if(typeof key!=='string'||!bounded(key,depth+1,budget))return false;
    const descriptor=Object.getOwnPropertyDescriptor(value,key)!;
    if(!descriptor.enumerable||!('value' in descriptor)||!bounded(descriptor.value,depth+1,budget))return false;
  }
  return true;
}

/** Validate snapshots 1.0-1.3. A 1.3 snapshot must pass its own schema and, without the
 * host session field, every 1.2 semantic rule; errors stay content-free. */
export function validateSnapshot(input:unknown):Validation {
  const earlier=validateEarlierSnapshot(input);
  if(earlier.ok)return earlier;
  try{
    if(!bounded(input))return invalid;
    const encoded=JSON.stringify(input);
    if(Buffer.byteLength(encoded)>MAX_BYTES||!check(input))return invalid;
    const value=JSON.parse(encoded) as Snapshot;
    const projection={...value,apiVersion:'1.2',sessions:value.sessions.map(({hostSessionId:_,...session})=>session)};
    return validateEarlierSnapshot(projection).ok?{ok:true,value}:invalid;
  }catch{return invalid;}
}
