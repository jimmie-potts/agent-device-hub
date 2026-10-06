import {createHash} from 'node:crypto';
import {systemClock, type Clock, type DeviceAdapter, type OperationResult, type UploadResult} from './contracts.js';
import {validateDeviceIp} from './http-transport.js';

export interface DashboardSettings {cadenceMs:number; durationMs:number}
/** One synthetic picture. `pulse`, when present, is its second frame; both play at 500 ms in one upload. */
export interface DashboardEvent {atMs:number; id:string; rgb:Uint8Array; pulse?:Uint8Array}
export type DashboardConfig = DashboardSettings & {preview?:string} & (
  {mode:'fake'} | {mode:'device'; ip:string; owner:string; model:string; firmware:string; sourceRevision:string}
);
function bounded(value:number, min:number, max:number) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
function validateSettings(settings:DashboardSettings) {
  if (!bounded(settings.cadenceMs,1000,10000) || !bounded(settings.durationMs,1000,60000))
    throw new Error('Cadence must be 1000–10000 ms and duration 1000–60000 ms');
}
export function parseDashboardArgs(args:string[], env:NodeJS.ProcessEnv):DashboardConfig {
  const values = new Map<string,string>();
  const switches = new Set(['--device','--allow-display-change','--confirm-exclusive-writer']);
  const options = new Set(['--cadence-ms','--duration-ms','--preview','--owner','--model','--firmware','--source-revision','--method']);
  for (let index=0; index<args.length; index++) {
    const key=args[index]!;
    if (values.has(key)) throw new Error('Duplicate option');
    if (switches.has(key)) values.set(key,'true');
    else if (options.has(key) && args[index+1] && !args[index+1]!.startsWith('--')) values.set(key,args[++index]!);
    else throw new Error('Unknown or missing option');
  }
  if (values.has('--method') && values.get('--method') !== 'frame') throw new Error('Text/item candidate unavailable: exact preview and device support unqualified');
  const settings = {cadenceMs:Number(values.get('--cadence-ms') ?? 3000),durationMs:Number(values.get('--duration-ms') ?? 15000)};
  validateSettings(settings);
  const preview=values.get('--preview');
  const common={...settings,...(preview!==undefined?{preview}:{})};
  if (!values.has('--device')) {
    if (['--allow-display-change','--confirm-exclusive-writer','--owner','--model','--firmware','--source-revision'].some(key=>values.has(key))) throw new Error('Physical options require --device');
    return {...common,mode:'fake'};
  }
  if (!values.has('--allow-display-change') || !values.has('--confirm-exclusive-writer')) throw new Error('Physical mode requires --allow-display-change and --confirm-exclusive-writer');
  const owner=values.get('--owner'), model=values.get('--model'), firmware=values.get('--firmware'), sourceRevision=values.get('--source-revision');
  if (!owner?.trim() || model !== 'Pixoo64' || !firmware?.trim() || !sourceRevision || !/^[a-f0-9]{40}$/.test(sourceRevision)) throw new Error('Record --owner, --model Pixoo64, --firmware (unknown is allowed), and exact --source-revision');
  if (!env.PIXOO_DEVICE_IP) throw new Error('PIXOO_DEVICE_IP is required');
  return {...common,mode:'device',ip:validateDeviceIp(env.PIXOO_DEVICE_IP),owner,model,firmware,sourceRevision};
}

export interface DashboardUpload {
  id:string; eventAtMs:number; submittedAtMs:number; acknowledgedAfterEventMs:number;
  /** Hash of every frame's bytes in order. */
  sha256:string; frames:number; result:OperationResult<UploadResult>;
}
/** One pending picture, no retries. The adapter remains the sole serialized writer. */
export async function runDashboard(device:DeviceAdapter, events:readonly DashboardEvent[], settings:DashboardSettings,
  signal?:AbortSignal, clock:Clock=systemClock) {
  validateSettings(settings);
  if (!events.length || events.length>64 || events.some((event,index)=>
    !bounded(event.atMs,0,60000) || (index>0 && event.atMs<events[index-1]!.atMs) ||
    !/^[a-zA-Z0-9-]{1,40}$/.test(event.id) || !(event.rgb instanceof Uint8Array) || event.rgb.length!==12288 ||
    (event.pulse!==undefined && (!(event.pulse instanceof Uint8Array) || event.pulse.length!==12288)))) throw new Error('Invalid synthetic events');
  const pictures=events.map(event=>({atMs:event.atMs,id:event.id,frames:[event.rgb,...(event.pulse?[event.pulse]:[])].map(rgb=>new Uint8Array(rgb))}));
  const start=clock.now(), deadline=start+settings.durationMs;
  const uploads:DashboardUpload[]=[];
  let cursor=0,coalesced=0,nextEligible=start;
  let status:'complete'|'bounded'|'cancelled'|'failed'='complete';
  const wait=(ms:number)=>new Promise<void>(resolve=>{
    if (signal?.aborted) {resolve();return;}
    const finish=()=>{cancel();signal?.removeEventListener('abort',finish);resolve();};
    const cancel=clock.schedule(ms,finish);
    signal?.addEventListener('abort',finish,{once:true});
  });
  while (cursor<pictures.length) {
    if (signal?.aborted) {status='cancelled';break;}
    if (clock.now()>=deadline || uploads.length>=20) {status='bounded';break;}
    const due=Math.max(start+pictures[cursor]!.atMs,nextEligible);
    if (due>clock.now()) {await wait(Math.min(due,deadline)-clock.now());continue;}
    let latest=cursor;
    while (latest+1<pictures.length && start+pictures[latest+1]!.atMs<=clock.now()) latest++;
    coalesced+=latest-cursor;
    const picture=pictures[latest]!;
    cursor=latest+1;
    const submittedAtMs=clock.now()-start;
    const result=await device.uploadAnimation({frames:picture.frames.map(rgb=>({rgb,delayMs:500}))}, {
      generation:device.generation,timeoutMs:Math.min(5000,deadline-clock.now()),...(signal?{signal}:{})});
    uploads.push({id:picture.id,eventAtMs:picture.atMs,submittedAtMs,
      acknowledgedAfterEventMs:clock.now()-start-picture.atMs,
      sha256:picture.frames.reduce((hash,rgb)=>hash.update(rgb),createHash('sha256')).digest('hex'),frames:picture.frames.length,result});
    if (!result.ok) {status=signal?.aborted?'cancelled':'failed';break;}
    nextEligible=start+submittedAtMs+settings.cadenceMs;
  }
  return {candidate:'complete-frame',status,cadenceMs:settings.cadenceMs,durationMs:settings.durationMs,
    elapsedMs:clock.now()-start,coalesced,remaining:pictures.length-cursor,uploads,
    visibleMeasurements:'not-recorded',textItemCandidate:'unqualified-exact-preview'};
}
