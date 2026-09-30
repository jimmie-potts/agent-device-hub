// Shared fake controller for hub tests (Hub #576). It speaks controller v1 over loopback HTTP and is built on the
// contract package's fixtures and validators, so it cannot drift from the released contract. It is not a suite:
// its name does not match `*.test.mjs`. Hub #335 extends it with moment admission and a command spy.
//
// const fake = await startFakeController({serves: '1.1'});  // or '1.0' or '1.0-negotiating'
// t.after(fake.close);
// new ControllerClient(fake.config());                        // or startHub({controllers: [fake.config()]})
//
// serves '1.1'             answers apiVersion=1.0 and 1.1 through negotiateApiVersion; a malformed or foreign-major value is invalid-request.
// serves '1.0'             answers a versioned read with 400 invalid-request, as the Nanoleaf controller and the local controller host do.
// serves '1.0-negotiating' answers a versioned read with a 1.0 snapshot, the contract's "negotiates but serves only 1.0".
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {validate,negotiateApiVersion,downgradeSnapshot} from '@jimmie-potts/device-contracts';

const fixtures=JSON.parse(await readFile(new URL('../fixtures/controller-v1.json',import.meta.resolve('@jimmie-potts/device-contracts')),'utf8'));
const fixture=(definition,id)=>structuredClone(fixtures.schemaCases.find(c=>id?c.id===id:c.definition===definition&&c.valid).value);

export const FAKE_CONTROLLER_TOKEN='c'.repeat(43);
const SERVES=['1.1','1.0','1.0-negotiating'];

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
 * mode (the desired mode both snapshots report, such as 'Quiet'; the fixture's is 'Work').
 * Returns: endpoint; config(overrides) for a hub controller entry; requests, a log of every request;
 * reads(), snapshot reads, with versioned() and unversioned() counts; commands, the POSTs seen (the fake admits none);
 * snapshot10() and snapshot11(), the documents it currently serves; restart({epoch,serves}) for a new epoch;
 * failNext(mode,{times,versioned}) with mode 'timeout' or '5xx'; close().
 */
export async function startFakeController(options={}){
  const state={serves:options.serves??'1.1',epoch:options.epoch??'runtime-1'};
  assert.ok(SERVES.includes(state.serves),'unknown serves value');
  const identity={...(options.controllerId?{controllerId:options.controllerId}:{}),...(options.deviceId?{deviceId:options.deviceId}:{})};
  const token=options.token??FAKE_CONTROLLER_TOKEN,requests=[],commands=[],failures=[];
  const document=version=>{
    const overrides={identity:{...identity,controllerEpoch:state.epoch}};
    const value=snapshotV1_1(overrides);
    if(options.moment)value.state.moment=structuredClone(options.moment);
    if(options.mode)value.state.desired.mode={status:'known',value:options.mode};
    assert.ok(validate('snapshotV1_1',value),'fake 1.1 snapshot must validate');
    return version==='1.1'?value:downgradeSnapshot(value);
  };
  const reply=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  const server=createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;
    const url=new URL(req.url,'http://fake.invalid');
    const entry={method:req.method,pathname:url.pathname,search:url.search,params:[...url.searchParams.keys()],versioned:url.searchParams.has('apiVersion'),epoch:state.epoch};
    requests.push(entry);
    if(req.headers.authorization!==`Bearer ${token}`)return reply(res,401,{failure:{code:'unauthenticated'}});
    if(req.method==='POST'&&url.pathname==='/controller/v1/commands'){
      commands.push(text?JSON.parse(text):null);
      return reply(res,422,{failure:{code:'unsupported-capability'}});
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
    reads:Object.assign(()=>count(()=>true),{versioned:()=>count(r=>r.versioned),unversioned:()=>count(r=>!r.versioned)}),
    snapshot10:()=>document('1.0'),snapshot11:()=>document('1.1'),
    config:(overrides={})=>({id:'wall',kind:'nanoleaf',endpoint,token,
      controllerId:snapshotV1_0({identity}).identity.controllerId,deviceId:snapshotV1_0({identity}).identity.deviceId,...overrides}),
    restart:next=>{
      if(next.serves!==undefined){assert.ok(SERVES.includes(next.serves),'unknown serves value');state.serves=next.serves;}
      state.epoch=next.epoch??`${state.epoch}-restarted`;
    },
    failNext:(mode,{times=1,versioned}={})=>{assert.ok(['timeout','5xx'].includes(mode));failures.push({mode,times,versioned});},
    close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}),
  };
}
