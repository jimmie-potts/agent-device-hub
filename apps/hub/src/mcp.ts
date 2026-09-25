import {createHash} from 'node:crypto';
import {createDeviceRegistry,bindServiceTools,createMcpHandler,type ServiceExtension,type McpHandler,type JsonSchema,type DeviceRegistration} from '@jimmie-potts/device-mcp';
import type {Credential} from './server.js';
import type {ControllerClient} from './controllers.js';
import {HttpError,object} from './common.js';
import type {PlaybackReceipt} from './playback.js';
import {LIGHTING_PROFILE} from './lifx-lighting.js';

// Logical application service; never advertised as a physical device.
export const HOST_SERVICE = 'hub-service';
export type HubMcp = McpHandler;
type Options = {origin:string;clients:Map<string,ControllerClient>;authenticate(token:string):Credential|null;
 principal(id:string,scope:'read'|'control',device:string):Credential;
 sessions(principal:Credential,query?:string,provider?:string):Record<string,unknown>;
 command(principal:Credential,input:unknown):Promise<unknown>;
 /** The configured playback source. Tools bind its ID; the caller never supplies a target. */
 playback?:{sourceId:string;snapshot():unknown;command(principal:Credential,input:unknown):Promise<{status:number;body:PlaybackReceipt}>}};
export const shape=(properties:Record<string,object>,required=Object.keys(properties)):JsonSchema=>({type:'object',additionalProperties:false,properties,required});
const id={type:'string',pattern:'^[A-Za-z0-9_.-]{1,128}$'};
const count={type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER};
const ticket=shape({epoch:id,sequence:count});
const identity=shape({provider:{enum:['codex','claude']},client:{enum:['cli','desktop','code']},hostId:id,sourceId:id,sessionId:id});
const requestString={type:'string',minLength:1,maxLength:100};
const resultSchema=shape({result:{type:'object'},status:{type:'integer'},code:{type:'string'},priorEffects:{enum:['none','possible']},retry:{const:'never-automatically'},requestId:{anyOf:[ticket,{type:'string',maxLength:128}]}},[]);
// Known owner rejections before effects; all other write failures remain uncertain.
const rejected=new Set(['unauthenticated','forbidden','invalid-input','invalid-request','unknown-device','revision-conflict','stale-generation','request-conflict','request-expired','request-order','capacity','unsupported-capability','owner-quiesced','monitor-unavailable','unsupported-control','source-unavailable','unknown-source']);
export function toolPrefix(alias:string):string {return 'device_'+alias.replace(/[^A-Za-z0-9_]/g,'_').slice(0,48)+'_'+createHash('sha256').update(alias).digest('hex').slice(0,16);}
export function createHubMcp(options:Options):McpHandler {
 if(options.clients.has(HOST_SERVICE))throw new Error('reserved-mcp-alias');
 function extension(target:string,scope:'read'|'control',description:string,inputSchema:JsonSchema,invoke:(args:Record<string,unknown>,principal:Credential)=>Promise<unknown>|unknown):ServiceExtension {
  const write=scope==='control';
  return {inputSchema,outputSchema:resultSchema,scope,description,
   annotations:{readOnlyHint:!write,destructiveHint:write,idempotentHint:!write,openWorldHint:true},
   async invoke(args,context){
    try {
     const principal=options.principal(context.principalId,scope,target);
     const value=await invoke(args,principal);
     const failed=object(value)&&(value.ok===false||value.outcome==='failed'||value.outcome==='cancelled'||value.outcome==='uncertain'||value.outcome==='partially-applied');
     return {data:{result:value as Record<string,unknown>},isError:failed};
    }catch(error){
     const known=error instanceof HttpError && rejected.has(error.code);
     const code=known?error.code:write?'uncertain-result':'transport-failure';
     return {data:{code,priorEffects:write&&!known?'possible':'none',retry:'never-automatically',
      ...(args.requestId!==undefined?{requestId:args.requestId}:typeof args.request_id==='string'?{requestId:args.request_id}:{})},isError:true};
    }
   }};
 }
 const readDescription=(purpose:string)=>purpose+' Does not change state. Unknown observation and readership stay unknown; health and transmission do not prove physical effects or task success.';
 const writeDescription=(purpose:string)=>purpose+' Preserve the original request identity for explicit replay; never automatically retry an ambiguous write. Acceptance does not prove physical effects or task success.';
 const host:Record<string,ServiceExtension>={
  sessions:extension(HOST_SERVICE,'read',readDescription('Read observed agent sessions, optionally filtering by provider and by q, a case-insensitive match against each session\'s label, or its session ID when it has no label. Returns the qualified snapshot, matching identities and the next request ID for hub_label, hub_acknowledge and hub_recover_approval.'),shape({q:{type:'string',maxLength:120},provider:{enum:['codex','claude']}},[]),(args,p)=>options.sessions(p,args.q as string|undefined,args.provider as string|undefined)),
  devices:extension(HOST_SERVICE,'read','List authorized configured device aliases and their bound tool prefixes, and the authorized playback source with its playback tool prefix. No network discovery or device writes.',shape({}),(_args,p)=>({devices:[...options.clients].filter(([alias])=>p.devices.includes(alias)).map(([alias,c])=>({alias,controllerId:c.config.controllerId,deviceId:c.config.deviceId,kind:c.config.kind,toolPrefix:toolPrefix(alias)})),
   ...(options.playback&&p.devices.includes(options.playback.sourceId)?{playback:{sourceId:options.playback.sourceId,toolPrefix:toolPrefix(options.playback.sourceId)}}:{})})),
  label:extension(HOST_SERVICE,'control',writeDescription('Set the user-chosen label for one session identity, or pass null to remove it. Use the next request ID from hub_sessions as request_id.'),shape({request_id:requestString,identity,label:{anyOf:[{type:'string',maxLength:160},{type:'null'}]}}),(args,p)=>options.command(p,{operation:'label',requestId:args.request_id,identity:args.identity,label:args.label})),
  acknowledge:extension(HOST_SERVICE,'control',writeDescription('Acknowledge one attention notice on a session for a configured consumer. Use the next request ID from hub_sessions as request_id. Reading a notice never acknowledges it.'),shape({request_id:requestString,identity,noticeId:id,consumerId:id}),(args,p)=>options.command(p,{operation:'acknowledge',requestId:args.request_id,identity:args.identity,noticeId:args.noticeId,consumerId:args.consumerId})),
  recover_approval:extension(HOST_SERVICE,'control',writeDescription('Only on explicit user request, retire one uncertain uncorrelated approval monitor marker for an exact session and turn. Read hub_sessions immediately first for request_id and expected_revision. This does not approve or deny the Codex permission, and fresh approval evidence can create a new marker.'),shape({request_id:requestString,identity,turn_id:id,expected_revision:count}),(args,p)=>options.command(p,{operation:'recover-approval',requestId:args.request_id,identity:args.identity,turnId:args.turn_id,expectedRevision:args.expected_revision}))
 };
 const registrations:DeviceRegistration[]=[{controllerId:'hub',deviceId:HOST_SERVICE,extensions:host}];
 const names=new Map<string,string>([[HOST_SERVICE,'hub']]);
 for(const [alias,client] of options.clients){
  const bound={controllerId:client.config.controllerId,deviceId:client.config.deviceId};
  const extensions:Record<string,ServiceExtension>={status:extension(alias,'read',readDescription('Read this device owner\'s validated controller snapshot. Its power, brightness, mode and media tools take their request identity and revision/generation guards from this snapshot.'),shape({}),()=>client.snapshot())};
  const guards={requestId:ticket,expectedConfigurationRevision:count,expectedGeneration:ticket};
  function command(name:string,purpose:string,fields:Record<string,object>,make:(args:Record<string,unknown>)=>unknown){
   extensions[name]=extension(alias,'control',writeDescription(purpose+' Take the request identity and revision/generation guards from the latest status result. An unsupported capability returns the owner\'s rejection.'),shape({...guards,...fields}),async args=>(await client.command({apiVersion:'1.0',...bound,requestId:args.requestId,expectedConfigurationRevision:args.expectedConfigurationRevision,expectedGeneration:args.expectedGeneration,command:make(args)})).body);
  }
  const kind=client.config.kind;
  // The Tidbyt owner declares every controller v1 capability unsupported; its local host publishes the status and now-playing tiles.
  if(kind==='tidbyt'){registrations.push({controllerId:bound.controllerId,deviceId:alias,extensions});names.set(alias,toolPrefix(alias));continue;}
  command('power_set','Turn this device on or off through its owning controller.',{on:{type:'boolean'}},a=>({kind:'power.set',on:a.on}));
  command('brightness_set','Set this device\'s brightness percentage through its owning controller.',{percent:{type:'integer',minimum:0,maximum:100}},a=>({kind:'brightness.set',percent:a.percent}));
  if(kind==='lifx'){
   extensions.lighting_status=extension(alias,'read',readDescription('Read this LIFX bulb\'s lighting snapshot: its controller v1 snapshot, whether color and color temperature are qualified, pending lighting requests, and the last observed color in LIFX wire units with its age. Its request identity and revision/generation guards serve color_set and temperature_set.'),shape({}),()=>client.lightingSnapshot());
   const lighting=(name:string,purpose:string,fields:Record<string,object>,make:(args:Record<string,unknown>)=>unknown)=>{
    extensions[name]=extension(alias,'control',writeDescription(purpose+' It never turns the bulb on or changes power or brightness. Take the request identity and revision/generation guards from the latest status or lighting_status result. An unqualified bulb returns the owner\'s rejection.'),shape({...guards,...fields}),async args=>(await client.lightingCommand({apiVersion:'1.0',...bound,requestId:args.requestId,expectedConfigurationRevision:args.expectedConfigurationRevision,expectedGeneration:args.expectedGeneration,profile:{...LIGHTING_PROFILE},command:make(args)})).body);
   };
   lighting('color_set','Set this LIFX bulb\'s hue in degrees and saturation in percent.',{hue:{type:'integer',minimum:0,maximum:360},saturation:{type:'integer',minimum:0,maximum:100}},a=>({kind:'lifx.color.set',hue:a.hue,saturation:a.saturation}));
   lighting('temperature_set','Set this LIFX bulb\'s color temperature in kelvin. Hue and saturation are kept, so the light looks white only at zero saturation.',{kelvin:{type:'integer',minimum:1500,maximum:9000}},a=>({kind:'lifx.temperature.set',kelvin:a.kelvin}));
   registrations.push({controllerId:bound.controllerId,deviceId:alias,extensions});names.set(alias,toolPrefix(alias));continue;
  }
  command('mode_set','Switch this device\'s controller mode through its owning controller.',{mode:{enum:client.config.kind==='pixoo'?['monitor','media']:['Work','Quiet','Free']}},a=>({kind:'mode.set',mode:a.mode}));
  const mediaMode=' For Pixoo, read integration_status and explicitly select Media through integration_set before playback; wait for the observed Media mode. This tool does not switch or restore modes.';
  command('media_start','Start a saved playlist by an ID advertised in this owner\'s media capability.'+mediaMode,{playlistId:id},a=>({kind:'media.start',playlistId:a.playlistId}));
  command('media_control','Issue a playback action supported by this owner\'s media capability.'+mediaMode,{action:{enum:['pause','resume','stop','next','previous','restart-with-changes','clear']}},a=>({kind:'media.control',action:a.action}));
  extensions.integration_status=extension(alias,'read',readDescription('Read this device\'s validated Pixoo or Nanoleaf agent-status integration snapshot, which carries the request identity and revision guards for integration_set.'),shape({}),()=>client.integrationSnapshot());
  if(client.config.kind==='pixoo'){
   const filter=shape({q:{type:'string',maxLength:120},provider:{enum:['codex','claude']},projectId:id,session:identity},[]);
   const action={oneOf:[shape({operation:{const:'mode'},mode:{enum:['monitor','media']}}),shape({operation:{const:'view'},filter,cadenceMs:{type:'integer',minimum:1000,maximum:10000}})]};
   extensions.integration_set=extension(alias,'control',writeDescription('Change the Pixoo agent-status integration: switch between monitor and media mode, or set the monitor view filter and update interval. Take the request identity and revision/generation guards from the latest integration_status result.'),shape({request_id:requestString,expectedConfigurationRevision:count,expectedGeneration:count,action}),async args=>(await client.integrationCommand({apiVersion:'pixoo-integration/1.0',...bound,requestId:args.request_id,expectedConfigurationRevision:args.expectedConfigurationRevision,expectedGeneration:args.expectedGeneration,action:args.action})).body);
  }else{
   const project={type:'string',pattern:'^project-[a-f0-9]{64}$'},nullableProject={anyOf:[project,{type:'null'}]},task={type:'string',pattern:'^task-[a-f0-9]{64}$'};
   const commandSchema={oneOf:[
    {...shape({kind:{const:'settings.set'},style:{enum:['classic','project']},coverage:{enum:['whole','status']}},['kind']),minProperties:2},
    shape({kind:{const:'elements.assign'},elements:{type:'array',minItems:1,maxItems:300,items:{...shape({id:{type:'string',pattern:'^[0-9]{1,5}:[0-9]{1,5}$'},projectId:nullableProject,signature:{enum:[0,1]}},['id']),minProperties:2}}}),
    shape({kind:{const:'task.assign'},taskId:task,projectId:nullableProject}),
    shape({kind:{const:'project.color'},projectId:project,color:{type:'string',pattern:'^#[a-fA-F0-9]{6}$'}})]};
   const nativeTicket=shape({epoch:{type:'string',pattern:'^[a-f0-9]{32}$'},sequence:count});
   extensions.integration_set=extension(alias,'control',writeDescription('Apply one declared Nanoleaf integration command: display settings, panel element assignment, task assignment or project color. Take the request identity and expected revision from the latest integration_status result, then use integration_receipt to follow the outcome.'),shape({requestId:nativeTicket,expectedRevision:{type:'string',pattern:'^[a-f0-9]{64}$'},command:commandSchema}),async args=>(await client.integrationCommand({apiVersion:'nanoleaf.integration/1.0',...bound,...args})).body);
   extensions.integration_receipt=extension(alias,'read',readDescription('Look up the Nanoleaf receipt for an earlier integration_set by its original requestId.'),shape({requestId:nativeTicket}),async args=>(await client.integrationReceipt(args.requestId)).body);
   extensions.integration_cancel=extension(alias,'control',writeDescription('Explicitly cancel an earlier Nanoleaf integration_set by its original requestId. Check integration_receipt for the resulting outcome.'),shape({requestId:nativeTicket}),async args=>(await client.integrationCancel({apiVersion:'nanoleaf.integration/1.0',deviceId:bound.deviceId,requestId:args.requestId})).body);
  }
  registrations.push({controllerId:bound.controllerId,deviceId:alias,extensions});names.set(alias,toolPrefix(alias));
 }
 if(options.playback){
  const playback=options.playback,sourceId=playback.sourceId;
  // A receipt is the source's answer: sent was transmitted, failed was refused before any effect, uncertain may have taken effect.
  const effects={sent:'confirmed-transmission',failed:'none',uncertain:'possible'} as const;
  registrations.push({controllerId:'hub-playback',deviceId:sourceId,extensions:{
   playback_status:extension(sourceId,'read',readDescription('Read this playback source\'s shared snapshot: availability, observation age, status, the title, artist and album it reports, and the controls it currently declares. A stale snapshot keeps its last values for context; an unavailable one has no playback. While paused, some sources, including the Sony HT-A9, keep reporting the previous title after next or previous until playback resumes.'),shape({}),()=>playback.snapshot()),
   playback_command:extension(sourceId,'control',writeDescription('Send one playback action to this source. Only actions in the latest playback_status controls are accepted, and only while the source is available. Choose a new requestId for each intended action; repeating one returns its original receipt without another call.'),shape({requestId:id,action:{enum:['play','pause','next','previous']}}),async(args,p)=>{
    const {body}=await playback.command(p,{requestId:args.requestId,sourceId,action:args.action});
    return {...body,priorEffects:effects[body.outcome]};
   })
  }});
  names.set(sourceId,toolPrefix(sourceId));
 }
 const registry=createDeviceRegistry(registrations);
 const tools=registrations.flatMap(r=>bindServiceTools(registry,{deviceId:r.deviceId,bindings:Object.keys(r.extensions!).map(extension=>({extension,name:names.get(r.deviceId)+'_'+extension}))}));
 return createMcpHandler({enabled:true,registry,tools,allowedHosts:[new URL(options.origin).host],allowedOrigins:[options.origin],limits:{requestTimeoutMs:2500},
  authenticate:async token=>{const value=options.authenticate(token);return value?{id:value.id,credential:{kind:'machine',status:'active',declared:true,
   devices:[...value.devices.filter(d=>d!==HOST_SERVICE),HOST_SERVICE],scopes:value.scopes.filter((s):s is 'read'|'control'=>s==='read'||s==='control')}}:null;}});
}
