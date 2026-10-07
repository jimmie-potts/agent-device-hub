import {createServer,type ServerResponse} from 'node:http';
import {randomBytes} from 'node:crypto';
import {DeviceRequestError,validateDeviceIp} from './http-transport.js';

export interface HostedFile {url:string;transferred:Promise<void>;revoke():void}
export interface HostedFiles {publish(bytes:Uint8Array,signal:AbortSignal):HostedFile}
export interface HostedFileConfig {bind:string;port:number;origin:string}
export function validateHostedFileConfig(config:HostedFileConfig):HostedFileConfig {
 const origin=new URL(config.origin);
 if(config.bind!=='0.0.0.0'&&config.bind!=='127.0.0.1')validateDeviceIp(config.bind);
 if(origin.hostname!=='127.0.0.1')validateDeviceIp(origin.hostname);
 if(origin.protocol!=='http:'||origin.username!==''||origin.password!==''||origin.pathname!=='/'||origin.search!==''||origin.hash!==''||!Number.isInteger(config.port)||config.port<0||config.port>65535)throw new TypeError('Invalid hosted GIF configuration');
 return {...config,origin:origin.origin};
}
/** Separate listener: only bounded prepared bytes, never the API or media store. */
export async function startHostedFiles(input:HostedFileConfig):Promise<HostedFiles&{port:number;close():Promise<void>}> {
 const config=validateHostedFileConfig(input);
 let current:{path:string;bytes:Buffer;requests:number;reserved:number;responses:Set<ServerResponse>;complete():void;revoke():void}|undefined;
 const server=createServer((request,response)=>{
  const file=current;
  if(!file||request.url!==file.path){response.writeHead(404).end();return;}
  if(++file.requests>10){response.writeHead(429).end();file.revoke();return;}
  if(request.method!=='GET'&&request.method!=='HEAD'){response.writeHead(405,{allow:'GET, HEAD'}).end();return;}
  let start=0,end=file.bytes.length-1,status=200;
  if(request.headers.range!==undefined&&request.headers.range!==''){
   const range=/^bytes=(\d+)-(\d*)$/.exec(request.headers.range);
   if(!range){response.writeHead(416).end();return;}
   start=Number(range[1]);end=range[2]!==undefined&&range[2]!==''?Number(range[2]):end;
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||end>=file.bytes.length){response.writeHead(416).end();return;}status=206;
  }
  const count=end-start+1,body=request.method==='GET';
  if(body){file.reserved+=count;if(file.reserved>file.bytes.length*5){response.writeHead(429).end();file.revoke();return;}}
  file.responses.add(response);response.once('close',()=>file.responses.delete(response));
  response.once('finish',()=>{if(body&&start===0&&end===file.bytes.length-1)file.complete();});
  response.writeHead(status,{'content-type':'image/gif','content-length':count,'cache-control':'no-store','connection':'close','accept-ranges':'bytes',...(status===206?{'content-range':`bytes ${start}-${end}/${file.bytes.length}`}:{})});
  response.end(body?file.bytes.subarray(start,end+1):undefined);
 });
 server.requestTimeout=5000;server.headersTimeout=5000;server.timeout=5000;server.maxConnections=4;
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(config.port,config.bind,()=>{server.off('error',reject);resolve();});});
 const address=server.address();if(address===null||typeof address==='string')throw new Error('Hosted listener unavailable');
 let closed=false;
 return {port:address.port,publish(bytes,signal){
  if(closed||signal.aborted||bytes.length===0||bytes.length>10*1024*1024)throw new DeviceRequestError('invalid-input');
  current?.revoke();
  let complete!:()=>void,fail!:(error:Error)=>void,revoked=false;
  const transferred=new Promise<void>((resolve,reject)=>{complete=resolve;fail=reject;});
  // Revocation may precede the command response and the caller's await.
  void transferred.catch(()=>{});
  const revoke=()=>{if(revoked)return;revoked=true;clearTimeout(expiry);signal.removeEventListener('abort',revoke);if(current===file)current=undefined;for(const response of file.responses)response.destroy();fail(new DeviceRequestError('upload-failed'));};
  const file={path:`/gif/${randomBytes(32).toString('hex')}.gif`,bytes:Buffer.from(bytes),requests:0,reserved:0,responses:new Set<ServerResponse>(),complete,revoke};
  const expiry=setTimeout(revoke,15000);expiry.unref();current=file;signal.addEventListener('abort',revoke,{once:true});
  return {url:(new URL(config.origin).port==='0'?`http://${new URL(config.origin).hostname}:${address.port}`:config.origin)+file.path,transferred,revoke};
 },async close(){closed=true;current?.revoke();server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}
