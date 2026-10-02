import test from 'node:test';
import assert from 'node:assert/strict';
import {HubStatusFeed} from '../dist/index.js';

test('Hub status feed exposes a cancelable subscription without changing snapshot selection', () => {
  const feed=new HubStatusFeed({hubUrl:'http://127.0.0.1:8788',ownerId:'owner',token:'t'.repeat(43)});
  assert.equal(typeof feed.subscribe,'function');
  const sub=feed.subscribe();sub.close();
});

import {clockTimers,streamFetch,frame,flush} from './helpers/streams.mjs';
const setup=t=>{
  const c=clockTimers(),f=streamFetch();
  const feed=new HubStatusFeed({hubUrl:'http://127.0.0.1:8788',ownerId:'owner',token:'t'.repeat(43),timers:c.timers,fetch:f.fetch});
  const sub=feed.subscribe();t.after(()=>sub.close());return {...c,...f,feed,sub};
};

test('incremental CRLF frames validate identity and use only the read-only changes route',async t=>{
  const s=setup(t),next=s.sub.next();await flush();const c=s.connections[0];
  assert.equal(c.url,'http://127.0.0.1:8788/api/monitor/v1/changes');assert.equal(c.options.headers.Authorization,'Bearer '+'t'.repeat(43));assert.equal(c.options.redirect,'error');
  const bytes=frame(3,'resync').replaceAll('\n','\r\n');let settled=false;next.then(()=>settled=true);
  for(const ch of bytes.slice(0,-2)){c.send(ch);await Promise.resolve();}
  await flush();assert.equal(settled,false);c.send(bytes.slice(-2));
  assert.deepEqual(await next,{done:false,value:{kind:'resync',revision:3}});
});

test('heartbeats maintain liveness without notices; a storm retains only the latest pending hint',async t=>{
  const s=setup(t),first=s.sub.next();await flush();const c=s.connections[0];let settled=false;first.then(()=>settled=true);
  c.send(': heartbeat\n\n');await flush();assert.equal(settled,false);
  c.send(frame(1));assert.equal((await first).value.revision,1);
  for(let i=2;i<=500;i++)c.send(frame(i));await flush();
  assert.equal((await s.sub.next()).value.revision,500);
  const pending=s.sub.next();s.sub.close();assert.equal((await pending).done,true);assert.equal(s.pending.size,0);assert.equal(c.options.signal.aborted,true);
});

for(const [name,content] of [
  ['wrong owner',frame(1,'state',{ownerId:'other'})],['unavailable',frame(1,'state',{connection:'unavailable'})],
  ['wrong version',frame(1,'state',{apiVersion:'2.0'})],['unsafe revision',frame(1,'state',{revision:9007199254740992})],
  ['unknown field',frame(1,'state',{token:'excluded'})],['malformed JSON','event: state\nid: 11111111-1111-4111-8111-111111111111:1\ndata: {\n\n'],
  ['oversized frame',':'+ 'x'.repeat(8193)],['oversized chunk',new Uint8Array(65537)],['invalid UTF-8',new Uint8Array([255])],
])test(`${name} aborts the stream and reconnects with no replay cursor`,async t=>{
  const s=setup(t);const waiting=s.sub.next();await flush();s.connections[0].send(content);await flush();
  assert.equal(s.connections[0].options.signal.aborted,true);assert.equal(s.connections.length,1);
  await s.advance(999);assert.equal(s.connections.length,1);await s.advance(1);assert.equal(s.connections.length,2);
  assert.equal(s.connections[1].options.headers['Last-Event-ID'],undefined);s.connections[1].send(frame(8,'resync'));assert.equal((await waiting).value.revision,8);
});

test('idle stream is cancelled at ten seconds and stop cancels the reconnect timer',async t=>{
  const s=setup(t),waiting=s.sub.next();await flush();await s.advance(9999);assert.equal(s.connections[0].options.signal.aborted,false);
  await s.advance(1);assert.equal(s.connections[0].options.signal.aborted,true);s.sub.close();await s.advance(60000);
  assert.equal(s.connections.length,1);assert.equal((await waiting).done,true);assert.equal(s.pending.size,0);
});

test('closed streams reconnect, resync current state and do not reuse historical cursors',async t=>{
  const s=setup(t),first=s.sub.next();await flush();s.connections[0].send(frame(9));await first;s.connections[0].end();await flush();
  const next=s.sub.next();await s.advance(1000);s.connections[1].send(frame(2,'resync'));assert.deepEqual((await next).value,{kind:'resync',revision:2});
  assert.equal(Object.keys(s.connections[1].options.headers).some(k=>k.toLowerCase()==='last-event-id'),false);
});

test('header deadline and authentication failures use finite exponential reconnect delays',async t=>{
  const s=clockTimers();let calls=0,signal;
  const feed=new HubStatusFeed({hubUrl:'http://127.0.0.1:8788',ownerId:'owner',token:'t'.repeat(43),timers:s.timers,fetch:async(_u,o)=>{
    calls++;signal=o.signal;if(calls>1)return new Response('',{status:401});
    return new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(new Error('abort')),{once:true}));
  }});
  const sub=feed.subscribe();t.after(()=>sub.close());const waiting=sub.next();await flush();await s.advance(2500);assert.equal(signal.aborted,true);assert.equal(calls,1);
  await s.advance(1000);assert.equal(calls,2);await s.advance(1999);assert.equal(calls,2);await s.advance(1);assert.equal(calls,3);
  for(const delay of [4000,8000,16000,30000,30000]){const before=calls;await s.advance(delay);assert.equal(calls,before+1);}
  sub.close();assert.equal((await waiting).done,true);assert.equal(s.pending.size,0);
});

test('a connection rotates after one MiB of complete heartbeats without queue growth',async t=>{
  const s=setup(t),waiting=s.sub.next();await flush();const heartbeat=':'+ 'x'.repeat(999)+'\n\n';
  for(let i=0;i<1100;i++){s.connections[0].send(heartbeat);await flush();if(s.connections[0].options.signal.aborted)break;}
  assert.equal(s.connections[0].options.signal.aborted,true);await s.advance(1000);assert.equal(s.connections.length,2);s.sub.close();assert.equal((await waiting).done,true);
});

test('snapshot cancellation preserves version-selected URL and owner validation',async()=>{
  let requested,signal;
  const feed=new HubStatusFeed({hubUrl:'http://127.0.0.1:8788',ownerId:'owner',token:'t'.repeat(43),snapshotVersion:'1.2',fetch:async(u,o)=>{
    requested=u;signal=o.signal;return new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
  }});
  const abort=new AbortController();const pending=feed.snapshot(abort.signal);abort.abort();await assert.rejects(pending,/feed-unavailable/);
  assert.equal(requested,'http://127.0.0.1:8788/api/monitor/v1/sessions?snapshotVersion=1.2');assert.equal(signal.aborted,true);
});
