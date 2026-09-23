import {createHash} from 'node:crypto';
import {createDeviceRegistry,bindServiceTools,createMcpHandler,type ServiceExtension,type McpHandler,type JsonSchema,type DeviceRegistration} from '@jimmie-potts/device-mcp';
import type {Credential} from './server.js';
import type {ControllerClient} from './controllers.js';
import {HttpError,object} from './common.js';

// Logical application service; never advertised as a physical device.
export const HOST_SERVICE = 'hub-service';
export type HubMcp = McpHandler;
type Options = {origin:string;clients:Map<string,ControllerClient>;authenticate(token:string):Credential|null;
 principal(id:string,scope:'read'|'control',device:string):Credential;
 sessions(principal:Credential,query?:string,provider?:string):Record<string,unknown>;
 command(principal:Credential,input:unknown):Promise<unknown>};
export const shape=(properties:Record<string,object>,required=Object.keys(properties)):JsonSchema=>({type:'object',additionalProperties:false,properties,required});
const id={type:'string',pattern:'^[A-Za-z0-9_.-]{1,128}$'};
const count={type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER};
const ticket=shape({epoch:id,sequence:count});
const identity=shape({provider:{enum:['codex','claude']},client:{enum:['cli','desktop','code']},hostId:id,sourceId:id,sessionId:id});
const requestString={type:'string',minLength:1,maxLength:100};
const resultSchema=shape({result:{type:'object'},status:{type:'integer'},code:{type:'string'},priorEffects:{enum:['none','possible']},retry:{const:'never-automatically'},requestId:{anyOf:[ticket,{type:'string',maxLength:128}]}},[]);
// Known owner rejections before effects; all other write failures remain uncertain.
const rejected=new Set(['unauthenticated','forbidden','invalid-input','invalid-request','unknown-device','revision-conflict','stale-generation','request-conflict','request-expired','request-order','capacity','unsupported-capability','owner-quiesced','monitor-unavailable']);
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
  devices:extension(HOST_SERVICE,'read','List authorized configured device aliases and their bound tool prefixes. No network discovery or device writes.',shape({}),(_args,p)=>({devices:[...options.clients].filter(([alias])=>p.devices.includes(alias)).map(([alias,c])=>({alias,controllerId:c.config.controllerId,deviceId:c.config.deviceId,kind:c.config.kind,toolPrefix:toolPrefix(alias)}))})),
  label:extension(HOST_SERVICE,'control',writeDescription('Set the user-chosen label for one session identity, or pass null to remove it. Use the next request ID from hub_sessions as request_id.'),shape({request_id:requestString,identity,label:{anyOf:[{type:'string',maxLength:160},{type:'null'}]}}),(args,p)=>options.command(p,{operation:'label',requestId:args.request_id,identity:args.identity,label:args.label})),
  acknowledge:extension(HOST_SERVICE,'control',writeDescription('Acknowledge one attention notice on a session for a configured consumer. Use the next request ID from hub_sessions as request_id. Reading a notice never acknowledges it.'),shape({request_id:requestString,identity,noticeId:id,consumerId:id}),(args,p)=>options.command(p,{operation:'acknowledge',requestId:args.request_id,identity:args.identity,noticeId:args.noticeId,consumerId:args.consumerId})),
  recover_approval:extension(HOST_SERVICE,'control',writeDescription('Only on explicit user request, retire one uncertain uncorrelated approval monitor marker for an exact session and turn. Read hub_sessions immediately first for request_id and expected_revision. This does not approve or deny the Codex permission, and fresh approval evidence can create a new marker.'),shape({request_id:requestString,identity,turn_id:id,expected_revision:count}),(args,p)=>options.command(p,{operation:'recover-approval',requestId:args.request_id,identity:args.identity,turnId:args.turn_id,expectedRevision:args.expected_revision}))
 };
 const registrations:DeviceRegistration[]=[{controllerId:'hub',deviceId:HOST_SERVICE,extensions:host}];
 const names=new Map<string,string>([[HOST_SERVICE,'hub']]);
 for(const [alias,client] of options.clients){
  const bound={controllerId:client.config.controllerId,deviceId:client.config.deviceId};
  const extensions:Record<string,ServiceExtension>={status:extension(alias,'read',readDescription('Read this device owner\'s validated controller snapshot. Its power, brightness and mode tools take their request identity and revision/generation guards from this snapshot.'),shape({}),()=>client.snapshot())};
  const guards={requestId:ticket,expectedConfigurationRevision:count,expectedGeneration:ticket};
  function command(name:string,purpose:string,fields:Record<string,object>,make:(args:Record<string,unknown>)=>unknown){
   extensions[name]=extension(alias,'control',writeDescription(purpose+' Take the request identity and revision/generation guards from the latest status result. An unsupported capability returns the owner\'s rejection.'),shape({...guards,...fields}),async args=>(await client.command({apiVersion:'1.0',...bound,requestId:args.requestId,expectedConfigurationRevision:args.expectedConfigurationRevision,expectedGeneration:args.expectedGeneration,command:make(args)})).body);
  }
  command('power_set','Turn this device on or off through its owning controller.',{on:{type:'boolean'}},a=>({kind:'power.set',on:a.on}));
  command('brightness_set','Set this device\'s brightness percentage through its owning controller.',{percent:{type:'integer',minimum:0,maximum:100}},a=>({kind:'brightness.set',percent:a.percent}));
  command('mode_set','Switch this device\'s controller mode through its owning controller.',{mode:{enum:client.config.kind==='pixoo'?['monitor','media']:['Work','Quiet','Free']}},a=>({kind:'mode.set',mode:a.mode}));
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
 const registry=createDeviceRegistry(registrations);
 const tools=registrations.flatMap(r=>bindServiceTools(registry,{deviceId:r.deviceId,bindings:Object.keys(r.extensions!).map(extension=>({extension,name:names.get(r.deviceId)+'_'+extension}))}));
 return createMcpHandler({enabled:true,registry,tools,allowedHosts:[new URL(options.origin).host],allowedOrigins:[options.origin],limits:{requestTimeoutMs:2500},
  authenticate:async token=>{const value=options.authenticate(token);return value?{id:value.id,credential:{kind:'machine',status:'active',declared:true,
   devices:[...value.devices.filter(d=>d!==HOST_SERVICE),HOST_SERVICE],scopes:value.scopes.filter((s):s is 'read'|'control'=>s==='read'||s==='control')}}:null;}});
}
