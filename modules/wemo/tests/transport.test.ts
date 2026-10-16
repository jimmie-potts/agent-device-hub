import assert from 'node:assert/strict';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {test, type TestContext} from 'node:test';
import {WemoTransport, type Plug} from '../src/transport.js';
const mac='000000000001';
export const description=(identity=mac,control='/upnp/control/basicevent1'):string=>`<?xml version="1.0"?><root><device><manufacturer>Belkin International Inc.</manufacturer><modelName>Socket</modelName><UDN>uuid:Socket-synthetic</UDN><macAddress>${identity}</macAddress><serviceList><service><serviceType>urn:Belkin:service:basicevent:1</serviceType><controlURL>${control}</controlURL></service><service><serviceType>urn:Belkin:service:metainfo:1</serviceType><controlURL>/upnp/control/metainfo1</controlURL></service></serviceList></device></root>`;
export const envelope=(action:string,value:string):string=>`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action}Response xmlns:u="urn:Belkin:service:basicevent:1">${value}</u:${action}Response></s:Body></s:Envelope>`;
async function fixture(context:TestContext,handle?:(request:IncomingMessage,response:ServerResponse)=>boolean) {
  const actions:string[]=[];
  const server=createServer((request,response)=>{
    actions.push(request.method==='GET'?'description':String(request.headers.soapaction));
    if(handle?.(request,response)===true)return;
    response.setHeader('Content-Type','text/xml');
    if(request.method==='GET'){response.end(description());return;}
    if(String(request.headers.soapaction).includes('GetMetaInfo'))response.end(envelope('GetMetaInfo',`<MetaInfo>${mac}|synthetic-serial|Plugin Device|synthetic-firmware|Wemo.Mini.SYN|Socket</MetaInfo>`));
    else response.end(envelope('GetBinaryState','<BinaryState>0</BinaryState>'));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  context.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
  const config:Plug={id:'desk-lamp',label:'Desk lamp',address:'127.0.0.1',port:(server.address() as AddressInfo).port,mac,configurationRevision:1};
  return {transport:new WemoTransport(config),actions,config};
}
void test('a fresh identity-checked local read returns observed off without any switch command',async context=>{
  const {transport,actions}=await fixture(context);
  assert.deepEqual(await transport.read(AbortSignal.timeout(2000)),{power:false,firmware:'synthetic-firmware'});
  assert.equal(actions.length,3);
  assert.ok(actions.every(action=>action==='description'||action.includes('#GetMetaInfo')||action.includes('#GetBinaryState')));
});
void test('on and off use exactly one identity-checked SOAP write each',async context=>{
  const {transport,actions}=await fixture(context,(request,response)=>{
    if(!String(request.headers.soapaction).includes('#SetBinaryState'))return false;
    let body='';request.on('data',chunk=>{body+=String(chunk);});request.on('end',()=>response.end(envelope('SetBinaryState',`<BinaryState>${body.includes('<BinaryState>1</BinaryState>')?'1':'0'}</BinaryState>`)));return true;
  });
  let guards=0;
  for(const on of [true,false])assert.deepEqual(await transport.setPower(on,AbortSignal.timeout(2000),()=>{guards++;return undefined;}),{result:'succeeded',evidence:'transmitted',connection:'available'});
  assert.equal(guards,2);assert.equal(actions.filter(value=>value.includes('#SetBinaryState')).length,2);assert.equal(actions.length,6);
});
for(const [name,body] of [['wrong identity',description('000000000099')],['foreign service origin',description(mac,'http://192.0.2.99/control')],['DTD','<!DOCTYPE root><root/>'],['malformed','<root>'],['oversized','x'.repeat(262145)]])void test(`${name} refuses before any write`,async context=>{
  const {transport,actions}=await fixture(context,(request,response)=>{if(request.method!=='GET')return false;response.end(body);return true;});
  assert.equal(await transport.read(AbortSignal.timeout(2000)),undefined);
  const result=await transport.setPower(true,AbortSignal.timeout(2000),()=>undefined);assert.equal(result.result,'failed');assert.equal(result.evidence,'none');assert.equal(actions.filter(value=>value.includes('#SetBinaryState')).length,0);
});
void test('a final fence refusal sends no power write',async context=>{
  const {transport,actions}=await fixture(context);const result=await transport.setPower(true,AbortSignal.timeout(2000),()=> 'revision-conflict');
  assert.equal(result.result,'failed');assert.equal(result.code,'revision-conflict');assert.equal(actions.filter(value=>value.includes('#SetBinaryState')).length,0);
});
void test('lost reply after a write is uncertain and is never retried',async context=>{
  const {transport,actions}=await fixture(context,(request,response)=>{if(!String(request.headers.soapaction).includes('#SetBinaryState'))return false;response.destroy();return true;});
  const result=await transport.setPower(true,AbortSignal.timeout(2000),()=>undefined);assert.equal(result.result,'uncertain');assert.equal(result.code,'uncertain-result');assert.equal(actions.filter(value=>value.includes('#SetBinaryState')).length,1);
});
void test('a deadline bounds a nonresponding description without retry or power write',async context=>{
  const {transport,actions}=await fixture(context,()=>true);assert.equal(await transport.read(AbortSignal.timeout(40)),undefined);assert.deepEqual(actions,['description']);
});
