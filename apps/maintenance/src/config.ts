import {createHash} from 'node:crypto';
import {isAbsolute,resolve} from 'node:path';
import {fingerprintRegular,readRegular,requireValue} from './storage.js';
export const REPOSITORY='jimmie-potts/agent-device-hub';
export const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export type Config={schemaVersion:1;repository:typeof REPOSITORY;authority:string;checkout:string;stateRoot:string;
 tools:{journalctl:string;codex:string;gh:string;git:string};planWork:string;files:Record<string,string>;model:string;
 units:string[];limits:{windowSeconds:number;querySeconds:number;planningSeconds:number;maxRows:number;maxBytes:number;maxFindings:number;maxPages:number;capacityBytes:number}};
export function exact(value:any,keys:string[],reason='invalid-shape'){
 requireValue(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(','),reason);
}
export function validateConfig(value:any):Config {
 exact(value,['schemaVersion','repository','authority','checkout','stateRoot','tools','planWork','files','model','units','limits'],'invalid-config');
 requireValue(value.schemaVersion===1&&value.repository===REPOSITORY&&/^[a-z][a-z0-9-]{0,63}$/.test(value.authority),'invalid-authority');
 for(const path of [value.checkout,value.stateRoot,value.planWork])requireValue(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'invalid-path');
 requireValue(!value.stateRoot.startsWith(value.checkout+'/')&&value.stateRoot!==value.checkout,'state-inside-checkout');
 exact(value.tools,['journalctl','codex','gh','git']);
 for(const path of Object.values(value.tools))requireValue(typeof path==='string'&&isAbsolute(path),'invalid-tool');
 requireValue(typeof value.files==='object'&&!Array.isArray(value.files)&&Object.keys(value.files).length<=100,'invalid-fingerprints');
 for(const path of [...Object.values(value.tools),value.planWork])requireValue(typeof path==='string'&&/^[a-f0-9]{64}$/.test(value.files[path]??''),'missing-fingerprint');
 for(const [path,digest] of Object.entries(value.files))requireValue(isAbsolute(path)&&typeof digest==='string'&&/^[a-f0-9]{64}$/.test(digest),'invalid-fingerprint');
 requireValue(typeof value.model==='string'&&/^gpt-6(?:\.1)?-(?:astra|sol)$/.test(value.model),'invalid-model');
 requireValue(Array.isArray(value.units)&&value.units.length>0&&value.units.length<=8&&value.units.every((unit:unknown)=>typeof unit==='string'&&/^[A-Za-z0-9_.@-]+\.service$/.test(unit)),'invalid-units');
 const bounds:Record<string,[number,number]>={windowSeconds:[1,86400],querySeconds:[1,120],planningSeconds:[1,1800],maxRows:[1,5000],maxBytes:[8192,32*1024*1024],maxFindings:[1,10],maxPages:[1,100],capacityBytes:[1024*1024,1024*1024*1024]};
 exact(value.limits,Object.keys(bounds));for(const [key,[min,max]] of Object.entries(bounds))requireValue(Number.isSafeInteger(value.limits[key])&&value.limits[key]>=min&&value.limits[key]<=max,'invalid-limit');
 return value;
}
export async function fingerprints(config:Config){
 for(const [path,digest] of Object.entries(config.files))requireValue(await fingerprintRegular(path)===digest,'trusted-file-drift');
}
export async function loadConfig(path:string):Promise<Config>{
 const config=validateConfig(JSON.parse((await readRegular(path,128*1024,true)).toString('utf8')));await fingerprints(config);return config;
}
export type Request={schemaVersion:1;operation:'intake'|'reconcile';runId:string;deadline:number;authority:string;evidenceDirectory:string};
export function request(value:any,config:Config):Request {
 exact(value,['schemaVersion','operation','runId','deadline','authority','evidenceDirectory'],'invalid-request');
 requireValue(value.schemaVersion===1&&['intake','reconcile'].includes(value.operation),'invalid-operation');
 requireValue(value.authority===config.authority,'unauthorized-maintenance');
 requireValue(typeof value.runId==='string'&&/^[A-Za-z0-9-]{1,80}$/.test(value.runId),'invalid-run');
 requireValue(Number.isFinite(value.deadline)&&(value.operation==='reconcile'||value.deadline*1000>Date.now())&&value.deadline*1000-Date.now()<=36000*1000,'expired-deadline');
 requireValue(typeof value.evidenceDirectory==='string'&&isAbsolute(value.evidenceDirectory)&&!value.evidenceDirectory.startsWith(config.checkout+'/'),'invalid-evidence-directory');
 return value;
}
