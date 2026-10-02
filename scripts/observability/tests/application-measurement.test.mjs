import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { applicationSnapshot, applicationSummary, parseProcessStat } from '../application-measurement.mjs';

test('process stat parser discards names, preserves CPU ticks and rejects truncated or dead processes', () => {
  const fields = Array(50).fill('0'); fields[0] = 'S'; fields[1] = '42'; fields[2] = '123';
  fields[11] = '17'; fields[12] = '3'; fields[17] = '2'; fields[19] = '123456';
  const parsed = parseProcessStat('123 (synthetic ) name) ' + fields.join(' '));
  assert.deepEqual(parsed, { pid: 123, parentPid: 42, groupPid: 123, startTicks: '123456', userTicks: 17, systemTicks: 3, childTicks: 0, threads: 2 });
  assert.equal(JSON.stringify(parsed).includes('synthetic'), false);
  assert.throws(() => parseProcessStat('123 (short) S 42'));
  fields[0] = 'Z'; assert.throws(() => parseProcessStat('123 (dead) ' + fields.join(' ')));
});

test('separate owned application process yields CPU/RSS evidence and replacement identity fails closed', async t => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    process.on('message', message => {
      if(message==='work') { globalThis.bytes=Buffer.alloc(32*1024*1024,1); const until=performance.now()+100; while(performance.now()<until){}; process.send('worked'); }
      if(message==='close') process.disconnect();
    }); process.send('ready');
  `], { detached: true, stdio: ['ignore','ignore','ignore','ipc'] });
  t.after(() => { if(child.exitCode===null)child.kill(); });
  await once(child,'message');
  const first = await applicationSnapshot({ pid: child.pid, parentPid: process.pid });
  child.send('work'); await once(child,'message');
  const last = await applicationSnapshot({ pid: child.pid, parentPid: process.pid, startTicks: first.startTicks });
  assert.ok(last.rssBytes > first.rssBytes + 16*1024*1024);
  assert.ok(last.userTicks + last.systemTicks > first.userTicks + first.systemTicks);
  assert.equal(last.processCount, 1); assert.equal(last.source, 'linux-proc-stat-smaps-rollup');
  const summary = applicationSummary([first,last]);
  assert.ok(summary.meanCpuCores > 0); assert.equal(summary.peakRssBytes, last.rssBytes);
  await assert.rejects(applicationSnapshot({ pid: child.pid, parentPid: process.pid, startTicks: '1' }));
  await assert.rejects(applicationSnapshot({ pid: child.pid, parentPid: process.pid + 1 }));
  await assert.rejects(applicationSnapshot({ pid: child.pid, parentPid: process.pid }, {signal: AbortSignal.abort()}));
  assert.throws(() => applicationSummary([last,first]));
  child.send('close'); await once(child,'close');
});

test('large monotonic timestamps retain nanosecond precision while CPU uses only the bounded interval',()=>{
  const start=10000000000000000n;
  const sample=(offset,ticks)=>({source:'linux-proc-stat-smaps-rollup',pid:123,parentPid:42,startTicks:'1',processCount:1,
    ticksPerSecond:100,userTicks:ticks,systemTicks:0,rssBytes:100,
    startedNs:String(start+offset),cpuObservedNs:String(start+offset+1n),finishedNs:String(start+offset+2n)});
  assert.equal(applicationSummary([sample(0n,0),sample(1000000000n,25)]).meanCpuCores,0.25);
});
