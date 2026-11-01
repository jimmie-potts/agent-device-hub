import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {WebSocketServer} from 'ws';
import {HttpReachy} from '../src/transport.js';
import {configureReachy} from '../src/configuration.js';
import {REACHY_SIMULATED_SECTION as config} from '../src/registration.js';
void test('configuration admits only an explicitly owned numeric-loopback simulator',()=>{
  assert.ok('config'in configureReachy(config));
  for(const endpoint of ['http://localhost:18861','http://192.0.2.1:18861','https://127.0.0.1:18861','http://127.0.0.1','http://127.0.0.1:18861/path','http://u:p@127.0.0.1:18861','http://127.0.0.1:18861/?x=1'])assert.ok('error'in configureReachy({...config,endpoint}));
  assert.ok('error'in configureReachy({...config,ownership:'shared'}));
});
void test('real HTTP/WS adapter verifies backend, finite wire values, redirects and final guards',{timeout:10000},async t=>{
  let simulated=true,redirect=false,large=false;const writes:{path:string;body:unknown}[]=[];
  const id='12345678-1234-1234-1234-123456789abc';
  const server=createServer((req,res)=>{void (async()=>{
    if(redirect){res.writeHead(302,{location:'/other'}).end();return;}
    if(req.url==='/api/daemon/status'){res.setHeader('content-type','application/json');res.end(JSON.stringify({state:'running',simulation_enabled:simulated,mockup_sim_enabled:false,no_media:true,backend_status:{error:null,motor_control_mode:'enabled'}}));return;}
    let body='';for await(const chunk of req)body+=String(chunk);writes.push({path:req.url??'',body:JSON.parse(body)});
    res.end(large?'x'.repeat(32769):JSON.stringify(req.url==='/api/move/stop'?{message:`Stopped move with UUID: ${id}`}:{uuid:id}));
  })().catch(()=>res.destroy());});
  const ws=new WebSocketServer({server});ws.on('connection',(socket,req)=>{if(req.url?.startsWith('/api/state/')===true)socket.send(JSON.stringify({antennas_position:[.1,-.1]}));else socket.send(JSON.stringify({uuid:id,type:'move_completed'}));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{for(const client of ws.clients)client.terminate();await new Promise<void>(resolve=>server.close(()=>resolve()));ws.close();});
  const adapter=new HttpReachy(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),abort=new AbortController();t.after(()=>abort.abort());
  let states=0;const close=await adapter.connect({state:()=>{states++;},event:()=>{},lost:()=>{}},abort.signal);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(states,1);
  assert.equal(await adapter.move([.2,-.2],abort.signal),id);assert.deepEqual(writes,[{path:'/api/move/goto',body:{antennas:[.2,-.2],duration:.6}}]);
  await adapter.cancel(id,abort.signal);assert.deepEqual(writes[1],{path:'/api/move/stop',body:{uuid:id}});
  await assert.rejects(adapter.cancel(id,abort.signal,()=>{throw new Error('deadline');}));assert.equal(writes.length,2);
  await assert.rejects(adapter.move([0,0],abort.signal,()=>{throw new Error('deadline');}));assert.equal(writes.length,2);
  simulated=false;await assert.rejects(adapter.move([0,0],abort.signal));assert.equal(writes.length,2);simulated=true;
  redirect=true;await assert.rejects(adapter.move([0,0],abort.signal));assert.equal(writes.length,2);redirect=false;
  large=true;await assert.rejects(adapter.move([0,0],abort.signal));assert.equal(writes.length,3);close();
});
