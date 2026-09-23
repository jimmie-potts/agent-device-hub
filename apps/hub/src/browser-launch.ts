import {createServer,createConnection,type Server} from 'node:net';
import {chmod,lstat,unlink} from 'node:fs/promises';
import {join} from 'node:path';

export type BrowserLaunch = {url:string;code:string};
const socketPath=(directory:string)=>join(directory,'bunny-launch.sock');

async function removeStaleSocket(path:string):Promise<void>{
 const previous=await lstat(path).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;});
 if(!previous)return;
 if(!previous.isSocket()||previous.uid!==process.getuid!())throw new Error('invalid-launch-socket');
 const stale=await new Promise<boolean>((resolve,reject)=>{
  const probe=createConnection(path);
  probe.setTimeout(1500,()=>probe.destroy(new Error('launch-probe-timeout')));
  probe.once('connect',()=>{probe.destroy();resolve(false);});
  probe.once('error',error=>{if((error as NodeJS.ErrnoException).code==='ECONNREFUSED')resolve(true);else reject(error);});
 });
 if(!stale)throw new Error('launch-socket-in-use');
 const current=await lstat(path).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;});
 if(current&&current.dev===previous.dev&&current.ino===previous.ino)await unlink(path);
}

/** The private Hub state directory is validated and owned by the Linux process. */
export async function startBrowserLaunch(directory:string,issue:()=>BrowserLaunch):Promise<()=>Promise<void>> {
 const path=socketPath(directory);
 await removeStaleSocket(path);
 const server:Server=createServer(socket=>{
  socket.setTimeout(1500,()=>socket.destroy());
  try{socket.end(JSON.stringify(issue())+'\n');}catch{socket.destroy();}
 });
 let listening=false;
 try {
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(path,()=>{server.off('error',reject);listening=true;resolve();});});
  await chmod(path,0o600);
  const own=await lstat(path);
  return async()=>{
   await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
   const current=await lstat(path).catch(()=>null);
   if(current?.dev===own.dev&&current.ino===own.ino)await unlink(path);
  };
 } catch(error) {
  if(listening){
   await new Promise<void>(resolve=>server.close(()=>resolve()));
   const current=await lstat(path).catch(()=>null);
   if(current?.isSocket()&&current.uid===process.getuid!())await unlink(path);
  }
  throw error;
 }
}

export async function requestBrowserLaunch(directory:string):Promise<BrowserLaunch> {
 const path=socketPath(directory);
 return new Promise((resolve,reject)=>{
  const socket=createConnection(path);let value='';
  socket.setTimeout(2000,()=>socket.destroy(new Error('launch-timeout')));
  socket.on('data',chunk=>{value+=chunk.toString('utf8');if(value.length>1024)socket.destroy(new Error('launch-capacity'));});
  socket.once('error',reject);
  socket.once('end',()=>{
   try{
    const result:unknown=JSON.parse(value);
    if(!result||typeof result!=='object'||Array.isArray(result)||typeof (result as BrowserLaunch).code!=='string'||!/^[A-Za-z0-9_-]{43}$/.test((result as BrowserLaunch).code)||typeof (result as BrowserLaunch).url!=='string')throw new Error('invalid-launch-response');
    const url=new URL((result as BrowserLaunch).url);
    if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/'||url.search||url.hash)throw new Error('invalid-launch-response');
    resolve(result as BrowserLaunch);
   }catch(error){reject(error);}
  });
 });
}
