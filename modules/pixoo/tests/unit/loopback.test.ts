import {EventEmitter} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {connect,type Server} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {launch,type LaunchedProcess} from '../helpers/launch.js';
import {listenLoopback} from '../helpers/loopback.js';

const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});

describe('test listeners',()=>{
 it('never keep an installed port the kernel hands out, such as 41231',async()=>{
  const handed=[41231,41230,45123],closed:number[]=[];let current=0;
  const server=Object.assign(new EventEmitter(),{
   listen(_port:number,_host:string,ready:()=>void){current=handed.shift()!;ready();return server;},
   address:()=>({port:current,address:'127.0.0.1',family:'IPv4'}),
   close(done:()=>void){closed.push(current);done();return server;},
  });
  expect(await listenLoopback(server as unknown as Server)).toBe(45123);
  expect(closed).toEqual([41231,41230]);
 });
});

// The launched process names 41231, then 41230, as if the kernel had handed them out, then listens on a real ephemeral port.
const child=`
const {appendFileSync,existsSync,readFileSync,writeFileSync}=require('node:fs');
const {createServer}=require('node:net');
const state=process.env.LAUNCH_STATE,counter=state+'/launches',log=state+'/log';
const launch=existsSync(counter)?Number(readFileSync(counter,'utf8')):0;writeFileSync(counter,String(launch+1));
const record=entry=>appendFileSync(log,JSON.stringify({pid:process.pid,...entry})+'\\n');
process.once('SIGTERM',()=>{record({terminated:true});process.exit(0);});
const announce=port=>{record({port});console.log('listening on http://127.0.0.1:'+port);};
if(launch===0)announce(41231);else if(launch===1)announce(41230);
else{const server=createServer(socket=>socket.end());server.listen(0,'127.0.0.1',()=>announce(server.address().port));}
setInterval(()=>{},1000);
`;
const ready=(line:string)=>/^listening on (http:\/\/127\.0\.0\.1:\d+)$/.exec(line)?.[1];
const running=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};

describe('the launch helper',()=>{
 it('retries a launch whose ready line names 41231 or 41230 and stops each rejected launch',async()=>{
  const state=await mkdtemp(join(tmpdir(),'pixoo-launch-'));cleanup.push(()=>rm(state,{recursive:true,force:true}));
  const launched:LaunchedProcess=await launch({argv:[process.execPath,'-e',child],env:{...process.env,LAUNCH_STATE:state},ready});
  cleanup.push(()=>launched.stop());
  const entries=(await readFile(join(state,'log'),'utf8')).trim().split('\n').map(line=>JSON.parse(line) as {pid:number;port?:number;terminated?:true});
  // A real listener handed an installed port would add another stopped launch before the last entry.
  const [first,firstStop,second,secondStop]=entries,last=entries.at(-1);
  expect(first).toMatchObject({port:41231});expect(firstStop).toEqual({pid:first!.pid,terminated:true});
  expect(second).toMatchObject({port:41230});expect(secondStop).toEqual({pid:second!.pid,terminated:true});
  expect(running(first!.pid)).toBe(false);expect(running(second!.pid)).toBe(false);
  expect(last).toEqual({pid:launched.child.pid,port:launched.port});
  expect([41230,41231]).not.toContain(launched.port);
  expect(launched.url).toBe(`http://127.0.0.1:${launched.port}`);
  // The accepted launch serves the port it named.
  await new Promise<void>((resolve,reject)=>{const socket=connect(launched.port,'127.0.0.1',()=>{socket.destroy();resolve();});socket.once('error',reject);});
  await launched.stop();
  expect(launched.child.exitCode).toBe(0);
 });
});
