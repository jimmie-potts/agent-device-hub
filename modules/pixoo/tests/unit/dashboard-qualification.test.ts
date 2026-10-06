import {afterEach, expect, it, vi} from 'vitest';
import {parseDashboardArgs, runDashboard} from '../../packages/device/src/dashboard-qualification.js';
import {FakeDeviceAdapter} from '../../packages/device/src/fake.js';
import {dashboardCases} from '../../packages/device/src/dashboard-fixtures.js';

afterEach(() => vi.useRealTimers());
it('defaults to fake even when a physical target is present in the environment', () => {
  expect(parseDashboardArgs([], {PIXOO_DEVICE_IP:'192.168.1.2'})).toMatchObject({mode:'fake', cadenceMs:3000, durationMs:15000});
  expect(parseDashboardArgs([], {PIXOO_DEVICE_IP:'192.168.1.2'})).not.toHaveProperty('ip');
});
it('replaces all pixels when the session disappears, supplies a next page and pulses only the attention tile and chip',async () => {
  const cases=dashboardCases();
  expect(cases.every(item=>item.rgb.length===12288)).toBe(true);
  expect(cases.some(item=>item.id==='next-page')).toBe(true);
  const card=cases.find(item=>item.id==='attention-pulse')!;
  const cleared=cases.find(item=>item.id==='session-cleared')!.rgb;
  expect(card.rgb.slice(0,50*64*3).some(value=>value!==0)).toBe(true);
  expect(cleared.slice(0,50*64*3).every(value=>value===0)).toBe(true);
  expect(cases.filter(item=>item.pulse).map(item=>item.id)).toEqual(['attention-pulse','return-page-1']);
  for(let i=0;i<4096;i++){
    const x=i%64,y=Math.floor(i/64),same=card.rgb.slice(i*3,i*3+3).join()===card.pulse!.slice(i*3,i*3+3).join();
    if(!same)expect((x>=1&&x<=20&&y>=1&&y<=20)||(x>=24&&x<=62&&y>=12&&y<=20)).toBe(true);
  }
  const device=new FakeDeviceAdapter();
  const report=await runDashboard(device,[card],{cadenceMs:1000,durationMs:1000});
  expect(report.uploads).toMatchObject([{id:'attention-pulse',frames:2,result:{ok:true}}]);
  expect(device.operations.filter(item=>item.kind==='uploadAnimation')).toHaveLength(1);
  expect(device.effects.map(item=>item.kind==='frame'?[item.frame.delayMs,item.frame.rgb]:null)).toEqual([[500,card.rgb],[500,card.pulse]]);
  await expect(runDashboard(device,[{...card,pulse:new Uint8Array(3)}],{cadenceMs:1000,durationMs:1000})).rejects.toThrow('Invalid synthetic events');
});
it('coalesces bursts to the latest picture without replaying obsolete pictures', async () => {
  vi.useFakeTimers();
  const device = new FakeDeviceAdapter({latencyMs:100});
  const events = [0, 10, 20, 30].map((atMs, index) => ({atMs, id:String(index), rgb:new Uint8Array(12288).fill(index)}));
  const pending = runDashboard(device, events, {cadenceMs:1000, durationMs:3000});
  await vi.runAllTimersAsync();
  const report = await pending;
  expect(report.uploads.map(item => item.id)).toEqual(['0','3']);
  expect(report.coalesced).toBe(2);
  expect(device.effects.filter(item => item.kind === 'frame').map(item => item.frame.rgb[0])).toEqual([0,3]);
});
it.each([
  ['--device'],['--duration-ms','60001'],['--cadence-ms','999'],['--wat'],
  ['--method','items'],['--cadence-ms','1000','--cadence-ms','2000'],
  ['--allow-display-change'],['--device','--allow-display-change','--confirm-exclusive-writer'],
])('rejects invalid admission %j', (...args) => {
  expect(()=>parseDashboardArgs(args,{})).toThrow();
});
it('admits only an explicit private target and complete physical metadata', () => {
  const args=['--device','--allow-display-change','--confirm-exclusive-writer','--owner','tester','--model','Pixoo64','--firmware','unknown','--source-revision','a'.repeat(40)];
  expect(()=>parseDashboardArgs(args,{})).toThrow('PIXOO_DEVICE_IP');
  expect(()=>parseDashboardArgs(args,{PIXOO_DEVICE_IP:'8.8.8.8'})).toThrow();
  expect(parseDashboardArgs(args,{PIXOO_DEVICE_IP:'192.168.1.2'})).toMatchObject({mode:'device',firmware:'unknown'});
});
it('stops on the first upload failure without retry or controls', async () => {
  vi.useFakeTimers();
  const device=new FakeDeviceAdapter();device.failNextUpload();
  const pending=runDashboard(device,dashboardCases(),{cadenceMs:1000,durationMs:15000});
  await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({status:'failed',uploads:[{result:{ok:false,code:'upload-failed'}}]});
  expect(device.operations).toHaveLength(1);expect(device.effects).toEqual([]);
});
it('bounds in-flight operations by the run deadline and stops at twenty uploads', async () => {
  vi.useFakeTimers();
  const slow=new FakeDeviceAdapter({latencyMs:2000});
  const pending=runDashboard(slow,dashboardCases(),{cadenceMs:1000,durationMs:1000});
  await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({status:'failed',elapsedMs:1000,uploads:[{result:{code:'timeout'}}]});
  const device=new FakeDeviceAdapter();
  const events=Array.from({length:30},(_,index)=>({atMs:index*1000,id:`case-${index}`,rgb:new Uint8Array(12288)}));
  const capped=runDashboard(device,events,{cadenceMs:1000,durationMs:60000});
  await vi.runAllTimersAsync();
  expect(await capped).toMatchObject({status:'bounded',remaining:10});
  expect((await capped).uploads).toHaveLength(20);
});
it('cancels a cadence wait without another upload and snapshots caller buffers', async () => {
  vi.useFakeTimers();
  const device=new FakeDeviceAdapter({latencyMs:10}),controller=new AbortController();
  const events=dashboardCases(),original=events[0]!.rgb[0];
  const pending=runDashboard(device,events,{cadenceMs:3000,durationMs:15000},controller.signal);
  events[0]!.rgb.fill(255);
  await vi.advanceTimersByTimeAsync(100);
  controller.abort();await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({status:'cancelled'});
  expect(device.operations).toHaveLength(1);
  expect(device.effects[0]).toMatchObject({frame:{rgb:expect.any(Uint8Array)}});
  const effect=device.effects[0]!;if(effect.kind==='frame')expect(effect.frame.rgb[0]).toBe(original);
});
