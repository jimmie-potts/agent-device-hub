import {isIP} from 'node:net';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {Configure} from '@jimmie-potts/sdk';
import type {Plug} from './transport.js';
export type WemoConfig={plugs:Plug[]};
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown,min:number,max=Number.MAX_SAFE_INTEGER):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const invalid=()=>errorBody('invalid-request',{detail:'Wemo needs one or two distinct qualified F7C063 plugs with explicit identity, address and revision'});
export const configureWemo:Configure<WemoConfig>=section=>{
  if(!object(section)||Object.keys(section).some(key=>key!=='plugs'&&key!=='secrets')||!Array.isArray(section.plugs)||section.plugs.length<1||section.plugs.length>2)return invalid();
  const plugs:Plug[]=[],ids=new Set<string>(),macs=new Set<string>(),addresses=new Set<string>(),labels=new Set<string>();
  for(const value of section.plugs){
    if(!object(value)||Object.keys(value).some(key=>!['id','label','address','port','mac','configurationRevision','model','firmware'].includes(key))||value.model!=='F7C063'||
      typeof value.id!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)||value.id.length>128||
      typeof value.label!=='string'||value.label.trim().length===0||value.label.length>80||[...value.label].some(c=>(c.codePointAt(0)??0)<32)||
      typeof value.address!=='string'||isIP(value.address)!==4||['0','127','255'].includes(value.address.split('.')[0]??'')||Number(value.address.split('.')[0])>=224||
      !integer(value.port,49151,49159)||typeof value.mac!=='string'||!/^[0-9a-f]{12}$/.test(value.mac)||!integer(value.configurationRevision,1)||
      typeof value.firmware!=='string'||value.firmware.length<1||value.firmware.length>128)return invalid();
    if(labels.has(value.label)||ids.has(value.id)||macs.has(value.mac)||addresses.has(value.address))return invalid();
    labels.add(value.label);ids.add(value.id);macs.add(value.mac);addresses.add(value.address);
    plugs.push({id:value.id,label:value.label,address:value.address,port:value.port,mac:value.mac,configurationRevision:value.configurationRevision,firmware:value.firmware});
  }
  return {config:{plugs},devices:plugs.map(p=>p.id)};
};
