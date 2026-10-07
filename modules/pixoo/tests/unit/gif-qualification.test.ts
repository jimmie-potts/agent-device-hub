import {afterEach,expect,it,vi} from 'vitest';
import {parseGifQualificationArgs,runGifQualification,gifQualificationCases} from '../../src/device/gif-qualification.js';
import {FakeDeviceAdapter} from '../../src/device/fake.js';
afterEach(()=>vi.useRealTimers());
it('defaults to offline preview even with a configured target',()=>{
 expect(parseGifQualificationArgs([],{PIXOO_DEVICE_IP:'192.168.1.2'})).toEqual({mode:'fake'});
 expect(()=>parseGifQualificationArgs(['--device'],{})).toThrow();
 expect(()=>parseGifQualificationArgs(['--max-frames','500'],{})).toThrow();
});
it('runs only the five fixed stages, with complete frames and unchanged delays',async()=>{
 vi.useFakeTimers();const device=new FakeDeviceAdapter();
 const pending=runGifQualification(device);await vi.runAllTimersAsync();const report=await pending;
 expect(report.status).toBe('complete');expect(report.uploads.map(u=>u.id)).toEqual(['A','B','C','D','E']);
 expect(report.uploads.map(u=>u.delaysMs)).toEqual([Array(20).fill(500),Array(20).fill(100),[200,800],[800,200],[500,500]]);
 expect(device.operations.map(o=>o.kind)).toEqual(['probe',...Array<string>(5).fill('uploadAnimation')]);
 expect(device.effects.filter(e=>e.kind==='frame')).toHaveLength(46);
 expect(report.elapsedMs).toBeGreaterThanOrEqual(70000);expect(report.elapsedMs).toBeLessThan(71000);
 expect(gifQualificationCases()[0]?.animation.frames).toHaveLength(20);
});
it('stops the sequence on failed upload without recovery writes',async()=>{
 vi.useFakeTimers();const device=new FakeDeviceAdapter();device.failNextUpload();
 const pending=runGifQualification(device);await vi.runAllTimersAsync();
 expect(await pending).toMatchObject({status:'failed',uploads:[{id:'A',result:{ok:false}}]});
 expect(device.operations).toHaveLength(2);
});
it('cancels a hold without submitting the next stage',async()=>{
 vi.useFakeTimers();const device=new FakeDeviceAdapter(),abort=new AbortController();
 const pending=runGifQualification(device,abort.signal);await vi.advanceTimersByTimeAsync(1000);abort.abort();await vi.runAllTimersAsync();
 expect(await pending).toMatchObject({status:'cancelled',uploads:[{id:'A'}]});expect(device.operations).toHaveLength(2);
});

it('bounds an in-flight upload at fifteen seconds and does not send later stages',async()=>{
 vi.useFakeTimers();const {HttpDeviceAdapter}=await import('../../src/device/http-adapter.js');
 const {GIF_EXPERIMENT_PROFILE}=await import('../../src/device/gif-qualification.js');
 const {DeviceRequestError}=await import('../../src/device/http-transport.js');
 const commands:string[]=[];
 const device=new HttpDeviceAdapter({ip:'192.168.1.2',profile:GIF_EXPERIMENT_PROFILE},async(body,signal)=>{
  commands.push(String(body.Command));if(body.Command==='Draw/SendHttpGif')return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DeviceRequestError('cancelled')),{once:true}));
  return {error_code:0,SelectIndex:1,Brightness:30,LightSwitch:1,PicId:1};
 });
 const pending=runGifQualification(device);await vi.runAllTimersAsync();
 expect(await pending).toMatchObject({status:'failed',uploads:[{result:{ok:false,code:'timeout',priorEffects:'possible'}}]});
 expect(commands).toEqual(['Channel/GetIndex','Channel/GetAllConf','Draw/GetHttpGifId','Draw/SendHttpGif']);await device.close();
});
it('requires known powered-on state and does not change controls',async()=>{
 const {HttpDeviceAdapter}=await import('../../src/device/http-adapter.js');
 const {GIF_EXPERIMENT_PROFILE}=await import('../../src/device/gif-qualification.js');
 const commands:string[]=[];const device=new HttpDeviceAdapter({ip:'192.168.1.2',profile:GIF_EXPERIMENT_PROFILE},body=>{commands.push(String(body.Command));return Promise.resolve({error_code:0,SelectIndex:1,Brightness:30,LightSwitch:0});});
 expect(await runGifQualification(device)).toMatchObject({status:'failed',uploads:[]});expect(commands).toHaveLength(2);await device.close();
});
