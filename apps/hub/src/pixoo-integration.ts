import {object,id} from './common.js';
type Check=(value:unknown)=>boolean;
const shape=(value:unknown,required:Record<string,Check>,optional:Record<string,Check>={}):boolean=>object(value)&&Object.keys(required).every(k=>Object.hasOwn(value,k))&&Object.keys(value).every(k=>Object.hasOwn(required,k)||Object.hasOwn(optional,k))&&Object.entries(value).every(([k,v])=>(required[k]??optional[k])(v));
const one=(...values:unknown[]):Check=>value=>values.includes(value);
const count:Check=value=>Number.isSafeInteger(value)&&(value as number)>=0;
const nullableCount:Check=value=>value===null||count(value);
const mode=one('monitor','media');
const cadence:Check=value=>count(value)&&(value as number)>=1000&&(value as number)<=10000;
const ticket:Check=value=>typeof value==='string'&&/^[a-f0-9-]{36}:[1-9][0-9]{0,15}(?![\s\S])/.test(value);
const identity:Check=value=>shape(value,{provider:one('codex','claude'),client:one('cli','desktop','code'),hostId:id,sourceId:id,sessionId:id});
const filter:Check=value=>shape(value,{}, {q:v=>typeof v==='string'&&v.length<=120,provider:one('codex','claude'),projectId:id,session:identity});
export const pixooVersion='pixoo-integration/1.0';
export function validatePixooRequest(value:unknown):value is Record<string,unknown>{
 return shape(value,{apiVersion:one(pixooVersion),controllerId:id,deviceId:id,requestId:ticket,expectedConfigurationRevision:count,expectedGeneration:count,
 action:v=>shape(v,{operation:one('mode'),mode})||shape(v,{operation:one('view'),filter,cadenceMs:cadence})});
}
/** Strict projection of the owning service's IntegrationSnapshot, including optional native identity. */
export function validatePixooSnapshot(value:unknown,native=false):boolean{
 return shape(value,{
 apiVersion:one(pixooVersion),serverId:v=>typeof v==='string'&&/^[a-f0-9-]{36}(?![\s\S])/.test(v),nextRequestId:ticket,configurationRevision:count,
 configuration:v=>shape(v,{version:one(1),mode,filter,cadenceMs:cadence}),sourceRevision:nullableCount,sourceConnection:one('current','stale','unavailable'),renditionGeneration:nullableCount,generation:count,pendingMode:one(null,'monitor','media'),participating:v=>typeof v==='boolean',inFlight:v=>v===0||v===1,
 lastOutcome:v=>v===null||shape(v,{generation:count,renditionGeneration:count,status:one('sent','failed','uncertain','cancelled')},{code:id}),
 capabilities:v=>shape(v,{modes:a=>JSON.stringify(a)==='["monitor","media"]',filters:a=>Array.isArray(a)&&a.length===4&&new Set(a).size===4&&a.every(v=>['provider','projectId','session','q'].includes(v)),minimumCadenceMs:one(1000),maximumCadenceMs:one(10000)})
 },{identity:v=>shape(v,{controllerId:id,deviceId:id,sourceId:id})})&&(!native||(object(value)&&Object.hasOwn(value,'identity')));
}
