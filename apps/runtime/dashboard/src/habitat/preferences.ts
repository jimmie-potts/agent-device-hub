import {bindingValue,json,object,settingsFrom} from './session.ts';
export const PREFERENCE_KEYS=['bunny.burrow.aprons.v1','bunny.burrow.workshop-places.v2','bunny.burrow.music-places.v1','bunny.burrow.dorm-places.v1','bunny.burrow.mail-places.v1','bunny.burrow.music-recovery.workshop-controls.v1','bunny.burrow.live-binding.v1','bunny.burrow.live-bindings.v2'] as const;
const schema='bunny-habitat-settings/1.0';
export function exportPreferences(storage:Pick<Storage,'getItem'>):string{
 const preferences:Record<string,string>={};for(const key of PREFERENCE_KEYS){const value=storage.getItem(key);if(value!==null)preferences[key]=value;}
 return JSON.stringify({schema,preferences});
}
function validValue(key:string,raw:string):boolean{
 const value=json(raw);
 if(key==='bunny.burrow.aprons.v1')return Array.isArray(value)&&value.length===10&&(value as unknown[]).every(color=>typeof color==='string'&&/^#[0-9a-f]{6}$/i.test(color));
 if(key==='bunny.burrow.music-recovery.workshop-controls.v1')return typeof value==='boolean';
 if(key==='bunny.burrow.live-binding.v1')return bindingValue(value)!==null;
 if(key==='bunny.burrow.live-bindings.v2'){
  if(!object(value)||value['version']!==2||typeof value['automatic']!=='boolean'||!Array.isArray(value['bindings'])||value['bindings'].length>10)return false;
  const settings=settingsFrom(raw);return settings.bindings.length===value['bindings'].length;
 }
 return Array.isArray(value)&&value.length===10&&(value as unknown[]).every(item=>object(item)&&typeof item['x']==='number'&&Number.isFinite(item['x'])&&item['x']>=0&&item['x']<=1600&&typeof item['y']==='number'&&Number.isFinite(item['y'])&&item['y']>=0&&item['y']<=1400&&(item['facing']===1||item['facing']===-1)&&(item['layout']===undefined||typeof item['layout']==='string'&&item['layout'].length<=128));
}
export function parsePreferences(raw:string):Record<string,string>|null{
 if(raw.length>65536)return null;const value=json(raw);
 if(!object(value)||value['schema']!==schema||!object(value['preferences'])||Object.keys(value).some(k=>k!=='schema'&&k!=='preferences'))return null;
 const preferences:Record<string,string>={};
 for(const [key,item]of Object.entries(value['preferences'])){
  if(!(PREFERENCE_KEYS as readonly string[]).includes(key)||typeof item!=='string'||item.length>16000||!validValue(key,item))return null;
  preferences[key]=item;
 }
 return preferences;
}
/** Validate before any write; preserve both a backup and previous visible values on partial failure. */
export function importPreferences(raw:string,storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>):boolean{
 const preferences=parsePreferences(raw);if(preferences===null)return false;
 const legacy=preferences[PREFERENCE_KEYS[6]];
 if(legacy!==undefined&&preferences[PREFERENCE_KEYS[7]]===undefined)preferences[PREFERENCE_KEYS[7]]=JSON.stringify(settingsFrom(null,legacy));
 const backup:Record<string,string|null>={};
 try{
  for(const key of PREFERENCE_KEYS)backup[key]=storage.getItem(key);
  storage.setItem('bunny.burrow.dashboard-import-backup.v1',JSON.stringify(backup));
  for(const [key,value]of Object.entries(preferences))storage.setItem(key,value);
  return true;
 }catch{
  for(const [key,value]of Object.entries(backup)){try{if(value===null)storage.removeItem(key);else storage.setItem(key,value);}catch{/* Storage remains unavailable; original backup is retained if it was written. */}}
  return false;
 }
}
