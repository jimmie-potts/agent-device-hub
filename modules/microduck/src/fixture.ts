import {randomUUID} from 'node:crypto';
import {spawn, execFileSync, type ChildProcess} from 'node:child_process';
import {closeSync, lstatSync, mkdirSync, openSync, readdirSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createConnection} from 'node:net';
import {setTimeout as pause} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {VendorPair} from './pair.js';
import {bodyListener, checkRoot, fileEvidence, namespace, params, processIdentity, VENDOR, type Witness} from './witness.js';
export type Fixture = {root:string;session:string;body:ChildProcess;daemon:ChildProcess;stop:()=>Promise<void>};
async function ready(pair:VendorPair,probe:()=>boolean|Promise<boolean>):Promise<void> {
  const deadline=Date.now()+15000;
  while(Date.now()<deadline&&!pair.ended){if(await probe())return;await pause(50);}
  throw new Error('MicroDuck fixture readiness deadline');
}
async function portReady():Promise<boolean> {
  return await new Promise(resolve=>{
    const s=createConnection({host:'127.0.0.1',port:17801}),timer=setTimeout(()=>{s.destroy();resolve(false);},200);
    s.once('connect',()=>{clearTimeout(timer);s.destroy();resolve(true);});s.once('error',()=>{clearTimeout(timer);s.destroy();resolve(false);});
  });
}
async function enableSetup(socket:string):Promise<void> {
  await new Promise<void>((resolve,reject)=>{
    const s=createConnection(socket),timer=setTimeout(()=>{s.destroy();reject(new Error('MicroDuck setup deadline'));},2000);let buffer='';
    s.once('connect',()=>{s.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'hello',params:{api_version:47}})+'\n');});
    const finish=(error?:Error):void=>{clearTimeout(timer);s.destroy();if(error===undefined)resolve();else reject(error);};
    s.on('data',chunk=>{
      buffer+=chunk.toString();if(buffer.length>16384){finish(new Error('MicroDuck setup frame limit'));return;}
      let newline=buffer.indexOf('\n');
      while(newline>=0){
        try {
          const value:unknown=JSON.parse(buffer.slice(0,newline));buffer=buffer.slice(newline+1);
          if(typeof value!=='object'||value===null||!('id'in value)||!('result'in value)||typeof value.result!=='object'||value.result===null)throw new Error('MicroDuck setup answer invalid');
          if(value.id===1){
            if(!('api_version'in value.result)||value.result.api_version!==47||!('revision'in value.result)||value.result.revision!==VENDOR.revision)throw new Error('MicroDuck setup identity mismatch');
            s.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'robot.enable',params:{on:true,toggle:false}})+'\n');
          }else if(value.id===2){if(!('accepted'in value.result)||value.result.accepted!==true)throw new Error('MicroDuck setup refused');finish();}
          else throw new Error('MicroDuck setup correlation mismatch');
        }catch {finish(new Error('MicroDuck setup refused'));}
        newline=buffer.indexOf('\n');
      }
    });s.once('error',()=>finish(new Error('MicroDuck setup connection failed')));
  });
}
export async function startFixture(options:{enablePolicy:boolean;leaseMs?:number}):Promise<Fixture> {
  if(process.versions.node.split('.')[0]!=='24')throw new Error('MicroDuck fixture requires Node 24');
  const leaseMs=options.leaseMs??180000;
  if(!Number.isInteger(leaseMs)||leaseMs<1000||leaseMs>7200000)throw new Error('MicroDuck fixture lease invalid');
  const session=randomUUID(),root='/tmp/bunny-md-'+session.replaceAll('-','');mkdirSync(root,{mode:0o700});checkRoot(root);
  const path=join(root,'witness.json');
  const pair=new VendorPair(()=>{try{unlinkSync(path);}catch(error){if(!(typeof error==='object'&&error!==null&&'code'in error&&error.code==='ENOENT'))throw error;}});
  const timer=setTimeout(()=>{void pair.stop();},leaseMs);
  const signal=():void=>{void pair.stop();};process.once('SIGTERM',signal);process.once('SIGINT',signal);
  const stop=async():Promise<void>=>{clearTimeout(timer);process.removeListener('SIGTERM',signal);process.removeListener('SIGINT',signal);await pair.stop();};
  try {
    writeFileSync(join(root,'robotd.toml'),params,{mode:0o600,flag:'wx'});
    const files=fileEvidence(root);
    const versions=execFileSync(VENDOR.python,['-c','import sys,mujoco,numpy,onnxruntime;print(sys.version.split()[0],mujoco.__version__,numpy.__version__,onnxruntime.__version__)'],{timeout:5000,encoding:'utf8'}).trim();
    if(versions!=='3.12.13 3.10.0 2.4.1 1.24.4')throw new Error('MicroDuck Python runtime mismatch');
    const capi='/opt/venv/lib/python3.12/site-packages/onnxruntime/capi';
    const library=readdirSync(capi).find(x=>x==='libonnxruntime.so.1.24.4');if(library===undefined)throw new Error('MicroDuck ONNX runtime missing');
    const env={...process.env,PYTHONPATH:VENDOR.rl,PYTHONNOUSERSITE:'1',MICRODUCK_TELEMETRY:'0',DO_NOT_TRACK:'1',DUCK_RUNTIME_DIR:root,ORT_DYLIB_PATH:join(capi,library),OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1',MKL_NUM_THREADS:'1'};
    const launch=(name:string,argv:string[]):ChildProcess=>{
      if(pair.ended)throw new Error('MicroDuck pair ended before launch');
      const executable=argv[0];if(executable===undefined)throw new Error('MicroDuck executable missing');
      const fd=openSync(join(root,name+'.log'),'wx',0o600);let child:ChildProcess;
      try {child=spawn(executable,argv.slice(1),{env,stdio:['ignore',fd,fd]});}finally{closeSync(fd);}
      pair.add(child);return child;
    };
    const body=launch('body',[VENDOR.python,'-m','mjlab_microduck.sim.body_server','--host','127.0.0.1','--port','17801','--ducks','1','--headless','--keyframe','HOME']);
    await ready(pair,portReady);
    if(body.pid===undefined||pair.ended)throw new Error('MicroDuck body ended during setup');
    bodyListener(body.pid);
    const daemon=launch('robotd',[VENDOR.binary,'--sim','127.0.0.1:17801','--params',join(root,'robotd.toml'),'--socket',join(root,'robotd.sock')]);
    await ready(pair,()=>{try{return lstatSync(join(root,'robotd.sock')).isSocket();}catch{return false;}});
    if(options.enablePolicy)await enableSetup(join(root,'robotd.sock'));
    if(body.pid===undefined||daemon.pid===undefined||pair.ended)throw new Error('MicroDuck pair ended during setup');
    const witness:Witness={schema:'microduck-fixture/1',session,namespace:namespace('time'),networkNamespace:namespace('net'),pidNamespace:namespace('pid'),
      body:processIdentity(body.pid),daemon:processIdentity(daemon.pid),supervisor:processIdentity(process.pid),bodyListenerInode:bodyListener(body.pid),socketInode:lstatSync(join(root,'robotd.sock')).ino,files};
    writeFileSync(path,JSON.stringify(witness),{mode:0o600,flag:'wx'});
    writeFileSync(join(root,'setup.json'),JSON.stringify({session,explicitEnable:options.enablePolicy,versions}),{mode:0o600,flag:'wx'});
    return {root,session,body,daemon,stop};
  }catch(error){await stop();throw error;}
}
if(process.argv[1]!==undefined&&fileURLToPath(import.meta.url)===process.argv[1]) {
  if(process.argv.slice(2).some(x=>x!=='--enable-policy'))throw new Error('MicroDuck fixture accepts only explicit --enable-policy');
  const fixture=await startFixture({enablePolicy:process.argv.includes('--enable-policy'),leaseMs:7200000});
  process.stdout.write(JSON.stringify({root:fixture.root,session:fixture.session,simulated:true})+'\n');
}
