import {createHash} from 'node:crypto';
import {isAbsolute,resolve} from 'node:path';
import {fingerprintRegular,readRegular,requireValue} from './storage.js';
export const REPOSITORY='jimmie-potts/agent-device-hub';
export const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export type Tools={journalctl:string;codex:string;gh:string;git:string};
export type Limits={windowSeconds:number;querySeconds:number;planningSeconds:number;maxRows:number;maxBytes:number;maxFindings:number;maxPages:number;capacityBytes:number};
export type Config={schemaVersion:1;repository:typeof REPOSITORY;authority:string;checkout:string;stateRoot:string;
 tools:Tools;planWork:string;files:Record<string,string>;model:string;units:string[];limits:Limits};
/** A parsed JSON object whose keys are known but whose values are not yet checked (Hub #1144). */
export type Shape=Record<string,unknown>;
const DIGEST=/^[a-f0-9]{64}$/;
/** The value is a plain object with exactly `keys`; afterwards its members are read as `unknown`. */
export function exact(value:unknown,keys:string[],reason='invalid-shape'):asserts value is Shape {
 requireValue(value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(','),reason);
}
export const isString=(value:unknown):value is string=>typeof value==='string';
const isRecord=(value:unknown):value is Shape=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function absolutePath(value:unknown,reason:string):string {requireValue(isString(value)&&isAbsolute(value)&&resolve(value)===value,reason);return value;}
function tool(value:unknown):string {requireValue(isString(value)&&isAbsolute(value),'invalid-tool');return value;}
export function validateConfig(value:unknown):Config {
 exact(value,['schemaVersion','repository','authority','checkout','stateRoot','tools','planWork','files','model','units','limits'],'invalid-config');
 const {schemaVersion,repository,authority,model,units,files,limits}=value;
 requireValue(schemaVersion===1&&repository===REPOSITORY&&isString(authority)&&/^[a-z][a-z0-9-]{0,63}$/.test(authority),'invalid-authority');
 const checkout=absolutePath(value.checkout,'invalid-path'),stateRoot=absolutePath(value.stateRoot,'invalid-path'),planWork=absolutePath(value.planWork,'invalid-path');
 requireValue(!stateRoot.startsWith(checkout+'/')&&stateRoot!==checkout,'state-inside-checkout');
 exact(value.tools,['journalctl','codex','gh','git']);
 const tools:Tools={journalctl:tool(value.tools.journalctl),codex:tool(value.tools.codex),gh:tool(value.tools.gh),git:tool(value.tools.git)};
 requireValue(isRecord(files)&&Object.keys(files).length<=100,'invalid-fingerprints');
 for(const path of [...Object.values(tools),planWork])requireValue(isString(files[path])&&DIGEST.test(files[path]),'missing-fingerprint');
 const fingerprints:Record<string,string>={};
 for(const [path,digest] of Object.entries(files)){requireValue(isAbsolute(path)&&isString(digest)&&DIGEST.test(digest),'invalid-fingerprint');fingerprints[path]=digest;}
 requireValue(isString(model)&&/^gpt-6(?:\.1)?-(?:astra|sol)$/.test(model),'invalid-model');
 requireValue(Array.isArray(units)&&units.length>0&&units.length<=8&&units.every((unit:unknown):unit is string=>isString(unit)&&/^[A-Za-z0-9_.@-]+\.service$/.test(unit)),'invalid-units');
 const bounds:Record<keyof Limits,[number,number]>={windowSeconds:[1,86400],querySeconds:[1,120],planningSeconds:[1,1800],maxRows:[1,5000],maxBytes:[8192,32*1024*1024],maxFindings:[1,10],maxPages:[1,100],capacityBytes:[1024*1024,1024*1024*1024]};
 exact(limits,Object.keys(bounds));
 const limit=(key:keyof Limits):number=>{const [min,max]=bounds[key],candidate=limits[key];requireValue(typeof candidate==='number'&&Number.isSafeInteger(candidate)&&candidate>=min&&candidate<=max,'invalid-limit');return candidate;};
 const checked:Limits={windowSeconds:limit('windowSeconds'),querySeconds:limit('querySeconds'),planningSeconds:limit('planningSeconds'),maxRows:limit('maxRows'),maxBytes:limit('maxBytes'),maxFindings:limit('maxFindings'),maxPages:limit('maxPages'),capacityBytes:limit('capacityBytes')};
 return {schemaVersion:1,repository:REPOSITORY,authority,checkout,stateRoot,tools,planWork,files:fingerprints,model,units:[...units],limits:checked};
}
export async function fingerprints(config:Config){
 for(const [path,digest] of Object.entries(config.files))requireValue(await fingerprintRegular(path)===digest,'trusted-file-drift');
}
export async function loadConfig(path:string):Promise<Config>{
 const config=validateConfig(JSON.parse((await readRegular(path,128*1024,true)).toString('utf8')));await fingerprints(config);return config;
}
export type Request={schemaVersion:1;operation:'intake'|'reconcile';runId:string;deadline:number;authority:string;evidenceDirectory:string};
export function request(value:unknown,config:Config):Request {
 exact(value,['schemaVersion','operation','runId','deadline','authority','evidenceDirectory'],'invalid-request');
 const {schemaVersion,operation,runId,deadline,authority,evidenceDirectory}=value;
 requireValue(schemaVersion===1&&(operation==='intake'||operation==='reconcile'),'invalid-operation');
 requireValue(authority===config.authority,'unauthorized-maintenance');
 requireValue(isString(runId)&&/^[A-Za-z0-9-]{1,80}$/.test(runId),'invalid-run');
 requireValue(typeof deadline==='number'&&Number.isFinite(deadline)&&(operation==='reconcile'||deadline*1000>Date.now())&&deadline*1000-Date.now()<=36000*1000,'expired-deadline');
 requireValue(isString(evidenceDirectory)&&isAbsolute(evidenceDirectory)&&!evidenceDirectory.startsWith(config.checkout+'/'),'invalid-evidence-directory');
 return {schemaVersion:1,operation,runId,deadline,authority:config.authority,evidenceDirectory};
}
