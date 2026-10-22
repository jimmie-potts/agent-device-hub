import {request} from 'node:http';
import {XMLParser, XMLValidator} from 'fast-xml-parser';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {Outcome} from '@jimmie-potts/sdk';
export type Plug={id:string;label:string;address:string;port:number;mac:string;configurationRevision:number;firmware?:string};
export type Observation={power:boolean;firmware:string};
export type Attempt={result:'succeeded'|'failed'|'uncertain';evidence:'none'|'transmitted';code?:ErrorCode;connection:'available'|'unavailable'|'unknown'};
export interface PlugTransport {read(signal:AbortSignal):Promise<Observation|undefined>;setPower(on:boolean,signal:AbortSignal,beforeEffect:()=>ErrorCode|undefined):Promise<Attempt>;}
const BASIC='urn:Belkin:service:basicevent:1',META='urn:Belkin:service:metainfo:1';
const MAX_BYTES=262144;
const parser=new XMLParser({ignoreAttributes:true,removeNSPrefix:true,parseTagValue:false,processEntities:false});
class Refused extends Error {constructor(readonly code:ErrorCode='unavailable'){super('local Wemo operation refused');}}
const object=(v:unknown):Record<string,unknown>=>{if(v===null||typeof v!=='object'||Array.isArray(v))throw new Refused();return v as Record<string,unknown>;};
const text=(v:unknown):string=>{if(typeof v!=='string'||v.length>4096)throw new Refused();return v;};
const mac=(v:unknown):string=>{const value=text(v).replace(/[:-]/g,'').toLowerCase();if(!/^[0-9a-f]{12}$/.test(value))throw new Refused();return value;};
function xml(value:string):Record<string,unknown> {
  if(value.includes('<!')||XMLValidator.validate(value)!==true)throw new Refused();
  return object(parser.parse(value) as unknown);
}
function soap(value:string,action:string):Record<string,unknown> {
  const body=object(object(xml(value).Envelope).Body);
  if(Object.hasOwn(body,'Fault'))throw new Refused();
  return object(body[`${action}Response`]);
}
/** Explicit numeric origin only; redirects, proxies, discovery and retries are absent. */
export class WemoTransport implements PlugTransport {
  constructor(readonly config:Plug) {}
  #origin():string {return `http://${this.config.address}:${this.config.port}`;}
  #url(path:unknown):URL {
    const url=new URL(text(path),this.#origin());
    if(url.origin!==this.#origin()||url.username!==''||url.password!==''||url.search!==''||url.hash!=='')throw new Refused();
    return url;
  }
  #request(url:URL,signal:AbortSignal,action?:{service:string;name:'GetMetaInfo'|'GetBinaryState'|'SetBinaryState';on?:boolean},before?:()=>void):Promise<string> {
    signal.throwIfAborted();
    const body=action===undefined?undefined:`<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action.name} xmlns:u="${action.service}">${action.on===undefined?'':`<BinaryState>${action.on?1:0}</BinaryState>`}</u:${action.name}></s:Body></s:Envelope>`;
    return new Promise((resolve,reject)=>{
      const req=request(url,{method:body===undefined?'GET':'POST',agent:false,signal,
        headers:{Connection:'close',...(action===undefined?{}:{SOAPACTION:`"${action.service}#${action.name}"`,'Content-Type':'text/xml; charset="utf-8"','Content-Length':Buffer.byteLength(body??'')})}},res=>{
        if(res.statusCode!==200){res.destroy();reject(new Refused());return;}
        const chunks:Buffer[]=[];let size=0;
        res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>MAX_BYTES){res.destroy(new Refused());return;}chunks.push(chunk);});
        res.on('error',reject);res.on('aborted',()=>reject(new Refused()));
        res.on('end',()=>{try{resolve(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{reject(new Refused());}});
      });
      req.on('error',reject);
      try{signal.throwIfAborted();before?.();req.end(body);}catch(error){req.destroy();reject(error);}
    });
  }
  async #identity(signal:AbortSignal):Promise<{basic:URL;firmware:string}> {
    const root=xml(await this.#request(this.#url('/setup.xml'),signal));
    const device=object(object(root.root).device);
    if(!/belkin/i.test(text(device.manufacturer))||text(device.modelName)!=='Socket'||!text(device.UDN).startsWith('uuid:Socket')||mac(device.macAddress)!==mac(this.config.mac))throw new Refused();
    const listed=object(device.serviceList).service,services=Array.isArray(listed)?listed:[listed];
    const service=(kind:string):URL=>{
      const matches=services.map(object).filter(value=>value.serviceType===kind);
      if(matches.length!==1)throw new Refused();return this.#url(matches[0]?.controlURL);
    };
    const basic=service(BASIC),meta=service(META);
    const parts=text(soap(await this.#request(meta,signal,{service:META,name:'GetMetaInfo'}),'GetMetaInfo').MetaInfo).split('|');
    if(parts.length!==6||mac(parts[0])!==mac(this.config.mac)||parts[5]!=='Socket'||parts[3]===undefined||parts[3]===''||this.config.firmware!==undefined&&parts[3]!==this.config.firmware)throw new Refused();
    return {basic,firmware:parts[3]};
  }
  async read(signal:AbortSignal):Promise<Observation|undefined> {
    try {
      const bounded=AbortSignal.any([signal,AbortSignal.timeout(4500)]),identity=await this.#identity(bounded);
      const value=text(soap(await this.#request(identity.basic,bounded,{service:BASIC,name:'GetBinaryState'}),'GetBinaryState').BinaryState).split('|')[0];
      return value==='0'||value==='1'?{power:value==='1',firmware:identity.firmware}:undefined;
    }catch{return undefined;}
  }
  async setPower(on:boolean,signal:AbortSignal,beforeEffect:()=>ErrorCode|undefined):Promise<Attempt> {
    let possible=false,reached=false;
    try {
      const bounded=AbortSignal.any([signal,AbortSignal.timeout(4500)]),identity=await this.#identity(bounded);reached=true;
      const response=await this.#request(identity.basic,bounded,{service:BASIC,name:'SetBinaryState',on},()=>{
        const code=beforeEffect();if(code!==undefined)throw new Refused(code);possible=true;
      });
      const value=text(soap(response,'SetBinaryState').BinaryState).split('|')[0];
      if(value!==(on?'1':'0'))throw new Refused();
      return {result:Outcome.succeeded,evidence:Outcome.transmitted,connection:'available'};
    }catch(error){
      return {result:possible?Outcome.uncertain:Outcome.failed,evidence:Outcome.none,code:possible?'uncertain-result':error instanceof Refused?error.code:'unavailable',connection:reached?'available':'unavailable'};
    }
  }
}
