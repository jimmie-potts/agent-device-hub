import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'dashboard-client-'));
try {
 await build({entryPoints:['apps/dashboard/src/client.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'client.mjs')});
 const {makeCommand,safeEditorUrl,Api,ApiError,failureMessage,resultMessage,generalReasons,brightnessDraft,sceneOptions,nanoleafContentReason,playbackControls,playbackEvidence,playbackRequest,lightingCommand,lightingReasons,observedColor}=await import(join(dir,'client.mjs'));
 test('lighting requests carry the snapshot guards, the lifx-light profile and only the lighting command',()=>{
  const snapshot={identity:{controllerId:'lifx',deviceId:'desk'},configurationRevision:4,generation:{epoch:'g',sequence:1},nextRequestId:{epoch:'e',sequence:9}};
  assert.deepEqual(lightingCommand(snapshot,{kind:'lifx.color.set',hue:200,saturation:80}),{apiVersion:'1.0',controllerId:'lifx',deviceId:'desk',requestId:{epoch:'e',sequence:9},expectedConfigurationRevision:4,expectedGeneration:{epoch:'g',sequence:1},profile:{profileId:'lifx-light',profileVersion:'1.0.0'},command:{kind:'lifx.color.set',hue:200,saturation:80}});
  const lighting=(color,temperature,observation={status:'unknown'})=>({lighting:{capabilities:{color,temperature,effects:false},pending:[],observation,visible:{status:'unknown'}}});
  // A missing capability is named before scope, like the general controls.
  assert.deepEqual(lightingReasons(lighting(false,null),'Your credential is read-only'),{color:'Color is not declared for this bulb’s qualified model',temperature:'Color temperature is not declared for this bulb’s qualified model'});
  assert.deepEqual(lightingReasons(lighting(true,{minimum:1500,maximum:9000}),'Your credential is read-only'),{color:'Your credential is read-only',temperature:'Your credential is read-only'});
  assert.deepEqual(lightingReasons(lighting(true,{minimum:1500,maximum:9000})),{color:undefined,temperature:undefined});
  assert.deepEqual(lightingReasons(undefined),{color:'No lighting snapshot',temperature:'No lighting snapshot'});
  // Wire units become degrees, percent and kelvin; no read stays unknown.
  assert.equal(observedColor(lighting(true,null).lighting),undefined);
  assert.deepEqual(observedColor(lighting(true,null,{status:'known',color:{hue:65535,saturation:32768,brightness:1,kelvin:3500},evidenceAgeMs:1200}).lighting),{hue:360,saturation:50,kelvin:3500,ageMs:1200});
 });
 test('mode commands preserve the edited revision and original server ticket',()=>{
  const snapshot={identity:{controllerId:'c',deviceId:'d'},configurationRevision:2,generation:{epoch:'g',sequence:7},nextRequestId:{epoch:'e',sequence:3}};
  const command=makeCommand(snapshot,{kind:'mode.set',mode:'Quiet'});
  assert.deepEqual(command,{apiVersion:'1.0',controllerId:'c',deviceId:'d',expectedConfigurationRevision:2,expectedGeneration:{epoch:'g',sequence:7},requestId:{epoch:'e',sequence:3},command:{kind:'mode.set',mode:'Quiet'}});
 });
 test('a delayed read cannot replace observations after a submitted write',async()=>{
  const original=globalThis.fetch;let release;
  globalThis.fetch=async(_url,options)=>options.method==='POST'?Response.json({ok:true}):new Promise(resolve=>{release=resolve;});
  try {const api=new Api('a'.repeat(43));const read=api.request('/snapshot');await api.request('/commands',{action:'explicit'});release(Response.json({revision:1}));await assert.rejects(read,error=>error.code==='snapshot-superseded');}finally{globalThis.fetch=original;}
 });
 test('partial receipts retain prior effects instead of claiming no application',()=>{
  const result=failureMessage(new ApiError('transport-failure',503,{outcome:'partially-applied',priorEffects:'confirmed-transmission',completedOperations:['mode'],uncertainOperations:['refresh']}));assert.equal(result.message,'Partly applied: mode was sent; refresh is unknown (transport-failure). Check the device, then reload current values before trying again.');assert.equal(result.locked,true);assert.doesNotMatch(result.message,/Not applied/);
  assert.deepEqual(failureMessage(new ApiError('capacity',429)),{message:'Not applied: too many commands are waiting (capacity). Nothing changed.',locked:false,settled:'rejected',code:'capacity'});
 });
 test('status text says what happened and whether anything changed, never claiming a physical result',()=>{
  const check='B.U.N.N.Y. can’t see the device, so check it to confirm.';
  assert.deepEqual(resultMessage({outcome:'queued',priorEffects:'none'}),{message:'Queued. The device hasn’t received it yet.',locked:false,settled:'accepted'});
  assert.deepEqual(resultMessage({outcome:'sent',priorEffects:'confirmed-transmission'}),{message:`Sent to the device. ${check}`,locked:false,settled:'accepted'});
  assert.deepEqual(resultMessage({outcome:'applied',priorEffects:'configuration'}),{message:`Saved. ${check}`,locked:false,settled:'accepted'});
  assert.deepEqual(resultMessage(undefined),{message:`Saved. ${check}`,locked:false,settled:'accepted'},'a saved integration configuration is not a physical result');
  assert.deepEqual(resultMessage(undefined,{device:false}),{message:'Saved.',locked:false,settled:'accepted'},'session labels and acknowledgments carry no device wording');
  assert.deepEqual(resultMessage({outcome:'cancelled',priorEffects:'none'},{sameMode:true}),{message:'Already in effect. Nothing was sent.',locked:false,settled:'accepted'},'a same-mode command with nothing to reapply');
  assert.deepEqual(resultMessage({outcome:'cancelled',priorEffects:'none'}),{message:'Not applied: it was cancelled before it ran (cancelled). Nothing changed.',locked:false,settled:'rejected',code:'cancelled'},'any other cancel, such as another client cancelling a queued integration command, is not reported as in effect');
  assert.equal(resultMessage({outcome:'cancelled',priorEffects:'none',failure:{code:'stale-generation'}},{sameMode:true}).settled,'rejected','a superseded same-mode command is still a rejection');
  assert.deepEqual(resultMessage({outcome:'cancelled',priorEffects:'none',failure:{code:'stale-generation'}}),{message:'Not applied: the device moved on before this arrived (stale-generation). Nothing changed.',locked:false,settled:'rejected',code:'stale-generation'});
  assert.deepEqual(resultMessage({outcome:'failed',priorEffects:'none',failure:{code:'unsupported-capability'}}),{message:'Not applied: the device doesn’t accept this in its current state (unsupported-capability). Nothing changed.',locked:false,settled:'rejected',code:'unsupported-capability'});
  assert.deepEqual(resultMessage({outcome:'failed',priorEffects:'none',failure:{code:'new-code'}}),{message:'Not applied: the controller refused it (new-code). Nothing changed.',locked:false,settled:'rejected',code:'new-code'},'an unknown code is still named');
  for(const receipt of [{outcome:'uncertain',priorEffects:'possible',failure:{code:'uncertain-result'}},{outcome:'failed',priorEffects:'possible',failure:{code:'transport-failure'}},{outcome:'failed',failure:{code:'transport-failure'}},{outcome:'mystery',priorEffects:'none'}]){
   const result=resultMessage(receipt);assert.equal(result.locked,true,JSON.stringify(receipt));assert.equal(result.settled,'locked');assert.match(result.message,/^Result unknown: this may have reached the device/);assert.match(result.message,/reload current values before trying again\.$/);
  }
  assert.deepEqual(resultMessage({outcome:'failed',priorEffects:'confirmed-transmission',completedOperations:['display'],failure:{code:'stale-generation'}}),{message:'Partly applied: display was sent (stale-generation). Check the device, then reload current values before trying again.',locked:true,settled:'locked',code:'stale-generation'});
  for(const text of [check,'Queued. The device hasn’t received it yet.'])assert.doesNotMatch(text,/confirmed on|changed on the device|is now/,'transport success never claims a physical result');
 });
 test('transport failures without a receipt are uncertain; definite rejections name the code',()=>{
  assert.deepEqual(failureMessage(new ApiError('uncertain-result')),{message:'Result unknown: this may have reached the device (uncertain-result). Check the device, then reload current values before trying again.',locked:true,settled:'locked',code:'uncertain-result'});
  assert.deepEqual(failureMessage(new Error('lost')),failureMessage(new ApiError('uncertain-result')));
  assert.deepEqual(failureMessage(new ApiError('revision-conflict',409)),{message:'Not applied: another client changed this device first (revision-conflict). Nothing changed.',locked:false,settled:'rejected',code:'revision-conflict'});
  assert.deepEqual(failureMessage(new ApiError('stale-generation',409,{outcome:'failed',priorEffects:'none',failure:{code:'stale-generation'}})).settled,'rejected');
 });
 test('controller reads and commands serialize per device without blocking another device',async()=>{
  const original=globalThis.fetch;const order=[];let release;
  globalThis.fetch=async(url,options)=>{order.push(url);if(url.endsWith('/slow'))return new Promise(resolve=>{release=resolve;});return Response.json({ok:true});};
  try {const api=new Api('a'.repeat(43));const slow=api.request('/api/controllers/v1/one/slow');const write=api.request('/api/controllers/v1/one/commands',{});await api.request('/api/controllers/v1/two/snapshot');assert.deepEqual(order,['/api/controllers/v1/one/slow','/api/controllers/v1/two/snapshot']);release(Response.json({revision:1}));await slow;await write;assert.equal(order.at(-1),'/api/controllers/v1/one/commands');}finally{globalThis.fetch=original;}
 });
 test('general controls name the missing capability, scope or mode and preserve declared power',()=>{
  const capabilities={power:{supported:true},brightness:{supported:true,minimum:0,maximum:100},media:{supported:true,actions:['pause'],playlistIds:['p1'],renditionIds:[]},zones:{supported:false},scenes:{supported:false},preview:{supported:false},modes:{supported:false}};
  const snapshot={capabilities};
  assert.deepEqual(generalReasons({snapshot,control:true}),{power:undefined,brightness:undefined,media:undefined,scenes:'Scenes are not declared by this controller'});
  assert.deepEqual(generalReasons({snapshot:undefined,control:true}),{power:'No controller snapshot',brightness:'No controller snapshot',media:'No controller snapshot',scenes:'No controller snapshot'});
  assert.deepEqual(generalReasons({snapshot,control:false}),{power:'Your credential is read-only',brightness:'Your credential is read-only',media:'Your credential is read-only',scenes:'Scenes are not declared by this controller'});
  assert.deepEqual(generalReasons({snapshot:{capabilities:{...capabilities,power:{supported:false},media:{supported:false}}},control:true}),{power:'Power is not declared by this controller',brightness:undefined,media:'Media is not declared by this controller',scenes:'Scenes are not declared by this controller'});
  assert.deepEqual(generalReasons({snapshot,control:true,content:'Pixoo is in Monitor'}),{power:undefined,brightness:undefined,media:'Pixoo is in Monitor',scenes:'Scenes are not declared by this controller'});
  assert.deepEqual(generalReasons({snapshot,control:true,common:'Device is externally controlled',content:'Pixoo is in Monitor'}),{power:'Device is externally controlled',brightness:'Device is externally controlled',media:'Device is externally controlled',scenes:'Scenes are not declared by this controller'});
  assert.deepEqual(generalReasons({snapshot:{capabilities:{...capabilities,power:{supported:false}}},control:false,content:'Pixoo is in Monitor'}),{power:'Power is not declared by this controller',brightness:'Your credential is read-only',media:'Your credential is read-only',scenes:'Scenes are not declared by this controller'},'a missing capability is named before scope, and scope before mode');
 });
 test('scene availability follows capability, scope and mode; content gating never touches power or brightness',()=>{
  const sceneId='scene-'+'a'.repeat(64);
  const capabilities={power:{supported:true},brightness:{supported:true,minimum:0,maximum:100},media:{supported:false},zones:{supported:false},scenes:{supported:true,sceneIds:[sceneId]},preview:{supported:false},modes:{supported:true,values:['Work','Quiet','Free']}};
  const snapshot={capabilities};
  assert.deepEqual(generalReasons({snapshot,control:true}),{power:undefined,brightness:undefined,media:'Media is not declared by this controller',scenes:undefined});
  assert.deepEqual(generalReasons({snapshot,control:true,content:'Nanoleaf is in Work'}),{power:undefined,brightness:undefined,media:'Media is not declared by this controller',scenes:'Nanoleaf is in Work'});
  assert.deepEqual(generalReasons({snapshot,control:false,content:'Nanoleaf is in Work'}).scenes,'Your credential is read-only','scope is named before mode gating');
  assert.deepEqual(generalReasons({snapshot:{capabilities:{...capabilities,scenes:{supported:false}}},control:true,content:'Nanoleaf is in Work'}).scenes,'Scenes are not declared by this controller','a missing capability is named before mode gating');
  assert.deepEqual(generalReasons({snapshot:undefined,control:true}).scenes,'No controller snapshot');
 });
 test('scene options come from controller v1 IDs and use only supplied integration names',()=>{
  const a='scene-'+'a'.repeat(64),b='scene-'+'b'.repeat(64),c='scene-'+'c'.repeat(64);
  const snapshot={capabilities:{scenes:{supported:true,sceneIds:[a,b]}}};
  assert.deepEqual(sceneOptions(snapshot,{scenes:[{id:a,name:'Beach Waves'},{id:b},{id:c,name:'Not advertised on controller v1'}]}),[{value:a,label:'Beach Waves'},{value:b,label:b}]);
  assert.deepEqual(sceneOptions(snapshot,undefined),[{value:a,label:a},{value:b,label:b}],'IDs are shown until the integration supplies names');
  assert.deepEqual(sceneOptions(snapshot,{scenes:[{id:a,name:'Beach Waves',path:'/private/PRIVATE_CANARY'}]}).map(o=>o.label),['Beach Waves',b],'nothing beyond the supplied name is copied');
  assert.deepEqual(sceneOptions({capabilities:{scenes:{supported:false}}},{scenes:[{id:a,name:'Beach Waves'}]}),[],'an integration list cannot add scenes the controller does not declare');
 });
 test('Nanoleaf scene gating names Work, Quiet, a pending mode change and an unknown mode, and clears in Free',()=>{
  const base={state:{desired:{mode:{status:'known',value:'Free'}},pending:[]}};
  assert.equal(nanoleafContentReason(base),undefined);
  assert.equal(nanoleafContentReason({state:{desired:{mode:{status:'known',value:'Work'}},pending:[]}}),'Nanoleaf is in Work and presents agent status; scene activation needs Free');
  assert.equal(nanoleafContentReason({state:{desired:{mode:{status:'known',value:'Quiet'}},pending:[]}}),'Nanoleaf is in Quiet and presents agent status; scene activation needs Free');
  assert.equal(nanoleafContentReason({state:{desired:{mode:{status:'known',value:'Free'}},pending:[{requestId:{epoch:'e',sequence:1},command:{kind:'mode.set',mode:'Work'},generation:{epoch:'g',sequence:1}}]}}),'Nanoleaf is switching to Work; wait for the observed mode');
  assert.equal(nanoleafContentReason({state:{desired:{mode:{status:'known',value:'Free'}},pending:[{requestId:{epoch:'e',sequence:1},command:{kind:'brightness.set',percent:5},generation:{epoch:'g',sequence:1}}]}}),undefined,'a pending brightness override does not gate scenes');
  assert.equal(nanoleafContentReason({state:{desired:{mode:{status:'unknown'}},pending:[]}}),'Nanoleaf mode is unknown; scene activation needs an observed Free mode');
 });
 test('the brightness draft uses desired, then observed evidence, and keeps missing evidence unknown',()=>{
  const capabilities={brightness:{supported:true,minimum:0,maximum:100}};
  const clock={domain:'controller-monotonic',epoch:'c',sampledAtMs:1};
  assert.deepEqual(brightnessDraft({capabilities,state:{desired:{brightness:{status:'known',value:35}},observation:{status:'known',clock,evidenceAgeMs:0,power:{status:'unknown'},brightness:{status:'known',value:10}}}}),{value:35,source:'desired'});
  assert.deepEqual(brightnessDraft({capabilities,state:{desired:{brightness:{status:'unknown'}},observation:{status:'known',clock,evidenceAgeMs:0,power:{status:'unknown'},brightness:{status:'known',value:10}}}}),{value:10,source:'observed'});
  assert.deepEqual(brightnessDraft({capabilities,state:{desired:{brightness:{status:'unknown'}},observation:{status:'unknown'}}}),{value:50,source:'unknown'});
  assert.deepEqual(brightnessDraft({capabilities:{brightness:{supported:false}},state:{desired:{brightness:{status:'unknown'}},observation:{status:'unknown'}}}),{value:50,source:'unknown'});
 });
 test('playback buttons follow declared controls, control scope and availability, and name what is missing',()=>{
  const snap=(availability,playback)=>({apiVersion:'1.0',sourceId:'ht-a9',availability,observedAtMs:1,ageMs:0,playback});
  const playing=snap('available',{status:'playing',title:'Song',controls:['pause','next','previous']});
  assert.deepEqual(playbackControls(playing,true),{actions:['pause','next','previous'],undeclared:['play']});
  assert.deepEqual(playbackControls(snap('available',{status:'paused',controls:['next','previous']}),true),{actions:['next','previous'],undeclared:['play','pause']});
  assert.deepEqual(playbackControls(playing,false),{actions:[],reason:'Your credential is read-only'});
  assert.deepEqual(playbackControls(undefined,true),{actions:[],reason:'B.U.N.N.Y. couldn’t read the playback source'});
  assert.deepEqual(playbackControls(snap('stale',playing.playback),true),{actions:[],reason:'The source’s last read is stale; controls return when it answers again'});
  assert.deepEqual(playbackControls(snap('unavailable',null),true),{actions:[],reason:'The source is unavailable'});
  assert.deepEqual(playbackControls(snap('available',{status:'inactive',controls:[]}),true),{actions:[],reason:'AirPlay isn’t the receiver’s current input'});
  assert.deepEqual(playbackControls(snap('available',{status:'stopped',controls:[]}),true),{actions:[],reason:'The source declares no controls while stopped'});
 });
 test('playback receipts map to the shared command outcomes',()=>{
  const receipt=outcome=>({requestId:'r',sourceId:'ht-a9',action:'next',outcome});
  assert.deepEqual(resultMessage(playbackEvidence(receipt('sent')),{device:false}),{message:'Sent to the device.',locked:false,settled:'accepted'});
  assert.deepEqual(resultMessage(playbackEvidence(receipt('failed')),{device:false}),{message:'Not applied: the receiver refused it (receiver-refused). Nothing changed.',locked:false,settled:'rejected',code:'receiver-refused'});
  const uncertain=resultMessage(playbackEvidence(receipt('uncertain')),{device:false});
  assert.deepEqual([uncertain.locked,uncertain.settled,uncertain.code],[true,'locked','uncertain-result']);
  assert.equal(failureMessage(new ApiError('unsupported-control',422,{error:{code:'unsupported-control'}})).message,'Not applied: the source doesn’t offer this right now (unsupported-control). Nothing changed.');
  assert.equal(failureMessage(new ApiError('source-unavailable',503,{error:{code:'source-unavailable'}})).message,'Not applied: the source isn’t answering (source-unavailable). Nothing changed.');
 });
 test('a playback command is built only from a fresh read that still offers the action for the displayed source',()=>{
  const snapshot=(controls,extra={})=>({apiVersion:'1.0',sourceId:'ht-a9',availability:'available',observedAtMs:1,ageMs:0,playback:{status:'playing',controls},...extra});
  assert.deepEqual(playbackRequest({snapshot:snapshot(['pause','next'])},{sourceId:'ht-a9',action:'next',control:true,requestId:'bunny-1'}),{request:{requestId:'bunny-1',sourceId:'ht-a9',action:'next'}});
  assert.deepEqual(playbackRequest({snapshot:snapshot(['next','previous'])},{sourceId:'ht-a9',action:'pause',control:true,requestId:'bunny-2'}),{blocked:'this source no longer offers pause'});
  assert.deepEqual(playbackRequest({snapshot:snapshot(['pause'],{availability:'stale'})},{sourceId:'ht-a9',action:'pause',control:true,requestId:'bunny-3'}),{blocked:'The source’s last read is stale; controls return when it answers again'});
  assert.deepEqual(playbackRequest({snapshot:snapshot(['pause'],{sourceId:'kitchen'})},{sourceId:'ht-a9',action:'pause',control:true,requestId:'bunny-4'}),{blocked:'the hub now reports a different playback source'});
  assert.deepEqual(playbackRequest({snapshot:snapshot(['pause']),error:'connection-unavailable'},{sourceId:'ht-a9',action:'pause',control:true,requestId:'bunny-5'}),{blocked:'B.U.N.N.Y. couldn’t read the playback source'});
 });
 test('editor links reject credentials, javascript, nonloopback and secret query strings',()=>{
  assert.equal(safeEditorUrl('http://127.0.0.1:8765/wall'),'http://127.0.0.1:8765/wall');
  for(const url of ['javascript:alert(1)','http://user:pass@127.0.0.1/','http://example.com/','http://127.0.0.1/?token=x'])assert.equal(safeEditorUrl(url),undefined);
 });
}finally{await rm(dir,{recursive:true,force:true});}
