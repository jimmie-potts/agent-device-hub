// Shared fake controller for hub tests (Hub #576). It speaks controller v1 over loopback HTTP and is built on the
// contract package's fixtures and validators, so it cannot drift from the released contract. It is not a suite:
// its name does not match `*.test.mjs`. Hub #335 added command admission through the contract's reference `admit`,
// scripted answers, a holdable request and a moment spy.
//
// const fake = await startFakeController({serves: '1.1'});  // or '1.0' or '1.0-negotiating'
// t.after(fake.close);
// new ControllerClient(fake.config());                        // or startHub({controllers: [fake.config()]})
//
// serves '1.1'             answers apiVersion=1.0 and 1.1 through negotiateApiVersion; a malformed or foreign-major value is invalid-request.
// serves '1.0'             answers a versioned read with 400 invalid-request, as the Nanoleaf controller and the local controller host do.
// serves '1.0-negotiating' answers a versioned read with a 1.0 snapshot, the contract's "negotiates but serves only 1.0".
//
// POST /commands runs the contract's reference `admit` against the snapshot the fake serves: 202 with the receipt for
// `queued`, the contract's HTTP status with the receipt for a failed or replayed one, and a bare typed failure for a
// refusal that reserves no ticket. A controller that serves only 1.0 refuses a 1.1 envelope as invalid-request.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {validate,negotiateApiVersion,downgradeSnapshot,admit} from '@jimmie-potts/device-contracts';

const fixtures=JSON.parse(await readFile(new URL('../fixtures/controller-v1.json',import.meta.resolve('@jimmie-potts/device-contracts')),'utf8'));
const fixture=(definition,id)=>structuredClone(fixtures.schemaCases.find(c=>id?c.id===id:c.definition===definition&&c.valid).value);

export const FAKE_CONTROLLER_TOKEN='c'.repeat(43);
const SERVES=['1.1','1.0','1.0-negotiating'];
/** The contract's HTTP mapping for typed failures. Moment failures ride in 200 receipts. */
const HTTP_STATUS={'invalid-request':400,'unauthenticated':401,'forbidden':403,'unknown-device':404,'revision-conflict':409,'stale-generation':409,
  'request-conflict':409,'request-order':409,'request-expired':410,'unsupported-capability':422,'capacity':429};
const receiptStatus=receipt=>(receipt.failure&&HTTP_STATUS[receipt.failure.code])||200;

/** The fixture's valid 1.0 snapshot. */
export const snapshotV1_0=(overrides={})=>{
  const value=fixture('snapshot');
  return Object.assign(value,overrides,{identity:{...value.identity,...overrides.identity}});
};
/** A valid 1.1 snapshot from the same fixture: the `moments` capability and idle `state.moment`. */
export function snapshotV1_1(overrides={}){
  const base=snapshotV1_0(overrides),moments=fixture('snapshotV1_1','snapshot-v1.1-valid-playing').capabilities.moments;
  const value={...base,apiVersion:'1.1',capabilities:{...base.capabilities,moments},
    state:{...base.state,moment:{current:{status:'none'},last:{status:'none'}}}};
  assert.ok(validate('snapshotV1_1',value),'fixture 1.1 snapshot must validate');
  return value;
}

/**
 * Starts a loopback controller for one device.
 * Options: serves, epoch (controller epoch), controllerId, deviceId, token, moment (state.moment for the 1.1 snapshot),
 * moments (the 1.1 `moments` capability, for example {supported:false}), sampleClock ({epoch,sampledAtMs} overrides),
 * mode (the desired mode both snapshots report, such as 'Quiet'; the fixture's is 'Work').
 * Returns: endpoint; config(overrides) for a hub controller entry; requests, a log of every request;
 * reads(), snapshot reads, with versioned() and unversioned() counts; commands, every POST body seen; moments(), the
 * moment requests among them; snapshot10() and snapshot11(), the documents it currently serves; restart({epoch,serves})
 * for a new controller, ticket and clock epoch; failNext(mode,{times,versioned}) with mode 'timeout' or '5xx' for reads;
 * answerNext(answer) for the next POST; hold({method}) to stall the next matching request; close().
 *
 * answerNext takes {receipt:{...fields},status} to change the admitted receipt, for example a device's moment-missed;
 * {failure:code,status} for a typed refusal without admission; {body,status} for a raw answer; {mode:'timeout'} to admit
 * and never answer; or {mode:'drop'} to admit and close the connection. hold returns {reached,release}: `reached`
 * resolves when the stalled request arrives and release() lets it continue.
 */
export async function startFakeController(options={}){
  const state={serves:options.serves??'1.1',epoch:options.epoch??'runtime-1',restarts:0};
  assert.ok(SERVES.includes(state.serves),'unknown serves value');
  const identity={...(options.controllerId?{controllerId:options.controllerId}:{}),...(options.deviceId?{deviceId:options.deviceId}:{})};
  const token=options.token??FAKE_CONTROLLER_TOKEN,requests=[],commands=[],failures=[],answers=[],holds=[];
  const base=snapshotV1_0({identity});
  // Each epoch starts a fresh ticket sequence, admission cache and clock epoch, as a controller restart does.
  const fresh=()=>({ticket:{epoch:state.restarts?`requests-${state.epoch}`:base.nextRequestId.epoch,sequence:base.nextRequestId.sequence},
    configurationRevision:base.configurationRevision,cache:[],
    clock:{...base.sampleClock,...options.sampleClock,...(state.restarts?{epoch:`clock-${state.epoch}`}:{})}});
  let current=fresh();
  const document=version=>{
    const overrides={identity:{...identity,controllerEpoch:state.epoch},nextRequestId:{...current.ticket},
      configurationRevision:current.configurationRevision,sampleClock:{...current.clock}};
    const value=snapshotV1_1(overrides);
    if(options.moments)value.capabilities.moments=structuredClone(options.moments);
    if(options.moment)value.state.moment=structuredClone(options.moment);
    if(options.mode)value.state.desired.mode={status:'known',value:options.mode};
    assert.ok(validate('snapshotV1_1',value),'fake 1.1 snapshot must validate');
    return version==='1.1'?value:downgradeSnapshot(value);
  };
  const admitted=(request,bodyBytes)=>{
    const snapshot=document('1.1');
    const result=admit({request,bodyBytes,auth:{credential:{kind:'machine',status:'active',declared:true,devices:[snapshot.identity.deviceId],scopes:['read','control']},
      deviceId:snapshot.identity.deviceId,scope:'control',hostAllowed:true,originPresent:false,originAllowed:true,fetchMetadataAllowed:true},
      state:{controllerId:snapshot.identity.controllerId,deviceId:snapshot.identity.deviceId,epoch:current.ticket.epoch,nextSequence:current.ticket.sequence,
        configurationRevision:current.configurationRevision,generation:snapshot.generation,capabilities:snapshot.capabilities,
        apiVersions:state.serves==='1.1'?['1.0','1.1']:['1.0'],maxBodyBytes:snapshot.limits.maxBodyBytes,maxInFlight:32,maxQueue:32,maxReceipts:256,
        inFlight:0,queueDepth:0,cache:current.cache,pending:[]}});
    if(result.reserved){
      current.ticket.sequence=result.nextSequence;current.configurationRevision=result.receipt.configurationRevision;
      current.cache.push({request,receipt:result.receipt});
    }
    return result;
  };
  const reply=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  const server=createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;
    const url=new URL(req.url,'http://fake.invalid');
    const entry={method:req.method,pathname:url.pathname,search:url.search,params:[...url.searchParams.keys()],versioned:url.searchParams.has('apiVersion'),epoch:state.epoch};
    requests.push(entry);
    const held=holds.findIndex(h=>!h.method||h.method===req.method);
    if(held>=0){const [h]=holds.splice(held,1);h.arrived();await h.gate;}
    if(req.headers.authorization!==`Bearer ${token}`)return reply(res,401,{failure:{code:'unauthenticated'}});
    if(req.method==='POST'&&url.pathname==='/controller/v1/commands'){
      let body=null;try{body=text?JSON.parse(text):null;}catch{}
      commands.push(body);
      const answer=answers.shift()??{};
      if(answer.failure)return reply(res,answer.status??HTTP_STATUS[answer.failure],{failure:{code:answer.failure}});
      if('body' in answer)return reply(res,answer.status??200,answer.body);
      const result=admitted(body,Buffer.byteLength(text));
      if(answer.mode==='timeout')return;
      if(answer.mode==='drop')return res.destroy();
      if(!result.receipt)return reply(res,HTTP_STATUS[result.decision],{failure:{code:result.decision}});
      const receipt={...result.receipt,...structuredClone(answer.receipt??{})};
      if(answer.receipt){current.cache.at(-1).receipt=receipt;assert.ok(validate(receipt.apiVersion==='1.1'?'receiptV1_1':'receipt',receipt),'scripted receipt must validate');}
      return reply(res,answer.status??(result.decision==='queued'&&!answer.receipt?202:receiptStatus(receipt)),receipt);
    }
    if(req.method!=='GET'||url.pathname!=='/controller/v1/snapshot')return reply(res,404,{failure:{code:'invalid-request'}});
    const failure=failures.find(f=>f.times>0&&(f.versioned===undefined||f.versioned===entry.versioned));
    if(failure){
      failure.times--;
      if(failure.mode==='timeout')return;
      return reply(res,503,{failure:{code:'controller-unavailable'}});
    }
    // Every declared parameter appears once, and nothing else is admitted.
    const params=[...url.searchParams.keys()],allowed=['deviceId',...(state.serves==='1.0'?[]:['apiVersion'])];
    if(params.some(name=>!allowed.includes(name))||new Set(params).size!==params.length)return reply(res,400,{failure:{code:'invalid-request'}});
    const deviceId=snapshotV1_0({identity}).identity.deviceId;
    if(url.searchParams.get('deviceId')!==deviceId)return reply(res,404,{failure:{code:'unknown-device'}});
    const requested=url.searchParams.get('apiVersion');
    const served=state.serves==='1.1'?['1.0','1.1']:['1.0'];
    const negotiated=negotiateApiVersion(requested,served);
    if(negotiated.decision!=='serve')return reply(res,400,{failure:{code:'invalid-request'}});
    reply(res,200,document(negotiated.apiVersion));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const endpoint=`http://127.0.0.1:${server.address().port}/controller/v1`;
  const count=predicate=>requests.filter(r=>r.method==='GET'&&r.pathname==='/controller/v1/snapshot'&&predicate(r)).length;
  return {
    endpoint,requests,commands,
    moments:()=>commands.filter(body=>body?.command?.kind==='moment'),
    reads:Object.assign(()=>count(()=>true),{versioned:()=>count(r=>r.versioned),unversioned:()=>count(r=>!r.versioned)}),
    snapshot10:()=>document('1.0'),snapshot11:()=>document('1.1'),
    config:(overrides={})=>({id:'wall',kind:'nanoleaf',endpoint,token,
      controllerId:snapshotV1_0({identity}).identity.controllerId,deviceId:snapshotV1_0({identity}).identity.deviceId,...overrides}),
    restart:next=>{
      if(next.serves!==undefined){assert.ok(SERVES.includes(next.serves),'unknown serves value');state.serves=next.serves;}
      state.epoch=next.epoch??`${state.epoch}-restarted`;state.restarts++;current=fresh();
    },
    answerNext:answer=>{answers.push(answer);},
    hold:({method}={})=>{
      let arrived,release;const reached=new Promise(resolve=>{arrived=resolve;}),gate=new Promise(resolve=>{release=resolve;});
      holds.push({method,arrived,gate});return {reached,release};
    },
    failNext:(mode,{times=1,versioned}={})=>{assert.ok(['timeout','5xx'].includes(mode));failures.push({mode,times,versioned});},
    close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}),
  };
}
