import assert from 'node:assert/strict';
import {createServer,type Socket} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test,type TestContext} from 'node:test';
import {once} from 'node:events';
import {UnixMicroDuck,BeforeSendError} from '../src/transport.js';
import {VENDOR} from '../src/witness.js';
async function peer(t:TestContext) {
  const dir=await mkdtemp(join(tmpdir(),'md-')),path=join(dir,'rpc'),clients=new Set<Socket>(),calls:string[]=[];
  let staleWitness=false,wrongHello=false,dropHead=false,refuseHead=false;
  const server=createServer(socket=>{
    clients.add(socket);socket.once('close',()=>{clients.delete(socket);});let buffer='';
    socket.on('data',chunk=>{
      buffer+=chunk.toString();let n=buffer.indexOf('\n');
      while(n>=0){const request:unknown=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);
        assert.ok(typeof request==='object'&&request!==null&&'method'in request&&typeof request.method==='string'&&'id'in request);calls.push(request.method);
        let result:unknown={accepted:true};
        if(request.method==='hello')result={api_version:wrongHello?1:47,daemon_version:'0.18.3',revision:VENDOR.revision};
        if(request.method==='robot.policies')result={slots:['walk','stand','sitstand','ground_pick','kick_left','kick_right','roulade'].map(slot=>({slot,path:slot==='walk'?VENDOR.policy:null,error:null,overridden:true}))};
        if(request.method==='robot.health')result={healthy:true};
        if(request.method==='robot.head'&&refuseHead)result={accepted:false};
        if(!(request.method==='robot.head'&&dropHead))socket.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n');
        n=buffer.indexOf('\n');
      }
    });
  });server.listen(path);await once(server,'listening');
  const transport=new UnixMicroDuck(dir,()=>({socket:path,guard:()=>{if(staleWitness)throw new BeforeSendError('synthetic witness drift');return 'synthetic-session';}}));
  t.after(async()=>{for(const s of clients)s.destroy();await new Promise<void>(resolve=>{server.close(()=>resolve());});await rm(dir,{recursive:true,force:true});});
  return {transport,calls,send:(text:string)=>{for(const s of clients)s.write(text);},stale:()=>{staleWitness=true;},wrongHello:()=>{wrongHello=true;},dropHead:()=>{dropHead=true;},refuse:()=>{refuseHead=true;}};
}
void test('real Unix framing correlates replies and sends only finite head inputs',{timeout:10000},async t=>{
  const p=await peer(t),abort=new AbortController();let lost=false;
  const close=await p.transport.connect({state:()=>{},lost:()=>{lost=true;}},abort.signal);t.after(close);
  let before=0;await p.transport.head(.1,abort.signal,()=>{before++;});assert.equal(before,1);assert.deepEqual(p.calls,['hello','robot.policies','robot.subscribe','robot.health','robot.policies','robot.head']);
  await assert.rejects(p.transport.head(1,abort.signal,()=>{before++;}),BeforeSendError);assert.equal(before,1);
  p.stale();await assert.rejects(p.transport.head(0,abort.signal,()=>{before++;}));assert.equal(before,1);assert.equal(lost,false);
});
void test('API mismatch, oversized frames and lost replies do not retry',{timeout:10000},async t=>{
  const wrong=await peer(t);wrong.wrongHello();await assert.rejects(wrong.transport.connect({state:()=>{},lost:()=>{}},new AbortController().signal));assert.deepEqual(wrong.calls,['hello']);
  const p=await peer(t),abort=new AbortController();let lost=false;const close=await p.transport.connect({state:()=>{},lost:()=>{lost=true;}},abort.signal);t.after(close);
  p.dropHead();await assert.rejects(p.transport.head(.1,abort.signal,()=>{}));assert.equal(p.calls.filter(x=>x==='robot.head').length,1);assert.equal(lost,true);
  const q=await peer(t);let ended:()=>void=()=>{};const observed=new Promise<void>(resolve=>{ended=resolve;});const end=await q.transport.connect({state:()=>{},lost:()=>{ended();}},abort.signal);t.after(end);q.send('x'.repeat(256*1024+1));await observed;
});
void test('old socket close does not end a newer observation connection',{timeout:10000},async t=>{
  const p=await peer(t),signal=new AbortController().signal;
  await p.transport.connect({state:()=>{},lost:()=>{}},signal);
  let lost=false;const close=await p.transport.connect({state:()=>{},lost:()=>{lost=true;}},signal);t.after(close);
  await p.transport.head(0,signal,()=>{});assert.equal(lost,false);
});
