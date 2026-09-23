import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'dashboard-client-'));
try {
 await build({entryPoints:['apps/dashboard/src/client.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'client.mjs')});
 const {makeCommand,safeEditorUrl,Api,ApiError,failureMessage,generalReasons,brightnessDraft,sceneOptions,nanoleafContentReason}=await import(join(dir,'client.mjs'));
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
  const result=failureMessage(new ApiError('transport-failure',503,{outcome:'partially-applied',priorEffects:'confirmed-transmission',completedOperations:['mode'],uncertainOperations:['refresh']}));assert.match(result.message,/partially-applied/);assert.match(result.message,/confirmed-transmission/);assert.equal(result.locked,true);assert.doesNotMatch(result.message,/Not applied/);
  assert.equal(failureMessage(new ApiError('capacity',429)).locked,false);
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
 test('editor links reject credentials, javascript, nonloopback and secret query strings',()=>{
  assert.equal(safeEditorUrl('http://127.0.0.1:8765/wall'),'http://127.0.0.1:8765/wall');
  for(const url of ['javascript:alert(1)','http://user:pass@127.0.0.1/','http://example.com/','http://127.0.0.1/?token=x'])assert.equal(safeEditorUrl(url),undefined);
 });
}finally{await rm(dir,{recursive:true,force:true});}
