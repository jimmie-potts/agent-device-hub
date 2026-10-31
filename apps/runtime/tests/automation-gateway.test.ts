import {createPowerLimits,PowerLimitStore} from '../src/core/power-limits.js';
import {deviceRecord} from './fixtures/device.js';
import {createRoutines} from '../src/core/power-schedules.js';
// The Automation HTTP boundary with the real gateway and rule store, without a listener or device.
import assert from 'node:assert/strict';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {Readable} from 'node:stream';
import {test, type TestContext} from 'node:test';
import {InProcessBus, edgeValidator, traceFields, type Scheduler,type TraceContext} from '@jimmie-potts/sdk';
import {RecordedSpans} from '@jimmie-potts/sdk/testing';
import {AutomationStore} from '../src/core/automation-store.js';
import {createAutomation, DEFAULT_INTERRUPT_SET, DEFAULT_SETTINGS} from '../src/core/automation.js';
import {tokenDigest} from '../src/credentials.js';
import {Gateway} from '../src/gateway/gateway.js';
import type {ModuleHost} from '../src/host.js';
import {LogWriter, type LogRecord} from '../src/log.js';

const controlToken = 'synthetic-automation-control', readToken = 'synthetic-automation-reader';
const control = {id: 'control', source: 'bunny/parts/control', digest: tokenDigest(controlToken), scopes: ['read', 'control'] as const};
const reader = {id: 'reader', source: 'bunny/parts/reader', digest: tokenDigest(readToken), scopes: ['read'] as const};
const parent = {traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'};
const rule = {name: 'Turn complete', kind: 'event', trigger: {source: 'core', kind: 'turn-ended'},
  action: {mood: 'celebrate', priorityClass: 'event', durationMs: 1000, targets: ['lines']}};
type Answer = {status: number; body: Record<string, unknown>};

async function boundary(context: TestContext) {
  const clock = {now: () => 1_700_000_000_000}, scheduler: Scheduler = {after: () => () => {}};
  const database = new DatabaseSync(':memory:');
  const store = new AutomationStore(database, () => {}, {settings: DEFAULT_SETTINGS, interruptSet: [...DEFAULT_INTERRUPT_SET]});
  const automation = createAutomation({store, clock: clock.now, monotonic: clock.now, active: () => true, routed: () => ['lines'],
    targets: () => Promise.resolve({presentation: 'quiet', alert: 'none'})});
  const routines=createRoutines({store,clock:clock.now,scheduler,active:()=>true,targets:()=>['lines'],owner:()=> 'bunny/modules/test-power',
    read:()=>Promise.resolve(undefined),current:()=>undefined,send:()=>Promise.reject(new Error('unexpected dispatch'))});
  const published:TraceContext[]=[],record=deviceRecord('desk-lamp',1,'wemo','available');record.capabilities.power={supported:true};
  let revision=0;
  const limits=createPowerLimits({store:new PowerLimitStore(database,work=>Promise.resolve(work({database,atMs:clock.now(),revision:()=>++revision,take:()=>{},record:()=>{},step:()=>{},add:(_key,draft,options)=>{if(options?.parent!==undefined)published.push(options.parent);return {...draft,specversion:'1.0',bunnyprofile:'2.0',id:'synthetic-publication',source:'bunny/core',time:new Date(clock.now()).toISOString(),datacontenttype:'application/json',...parent};}}))),
    clock:clock.now,scheduler,active:()=>true,targets:()=>['desk-lamp'],owner:()=> 'bunny/modules/wemo',current:()=>record,read:()=>Promise.resolve(record),send:()=>Promise.reject(new Error('unexpected dispatch'))});
  const controls={...automation,routines,limits};
  const logs: LogRecord[] = [], writer = new LogWriter(record => { logs.push(record); }, 'debug', clock), spans = new RecordedSpans();
  let ownerFailures = 0;
  const host = {modules: () => [], invoke: async <T>(_name: string, work: () => T | Promise<T>): Promise<T> => {
    try {return await work();} catch (error) {ownerFailures++; throw error;}
  }} as unknown as ModuleHost;
  const options = {bus: new InProcessBus({scheduler}), host, validator: edgeValidator(), families: new Set<string>(),
    credentials: [control, reader], clock, scheduler, log: writer.logger('bunny.runtime'), redactions: writer.redactions,
    stateDir: '/unused-automation-boundary', trace: spans, automation:controls,
    edge: {credentials: 'unused', launcher: false, mcp: false, editorLinks: {}, placeLinks: {}}};
  const gateway = new Gateway(options);
  await gateway.start('http://127.0.0.1:0', ['127.0.0.1:0']);
  context.after(async () => {await gateway.close(); await automation.close(); await routines.close(); await limits.close(); database.close();});
  const call = (method: string, path: string, input?: object | AsyncIterable<Buffer>, token: string | undefined = controlToken,
    header: string | undefined = '1'): Promise<Answer> => {
    const chunks = input === undefined ? [] : Symbol.asyncIterator in input ? input : [Buffer.from(JSON.stringify(input))];
    const request = Object.assign(Readable.from(chunks), {url: `/api/v2/automation/${path}`, method,
      headers: {host: '127.0.0.1:0', 'content-type': 'application/json', ...parent,
        ...(token === undefined ? {} : {authorization: `Bearer ${token}`}), ...(header === undefined ? {} : {'bunny-request': header})},
    }) as unknown as IncomingMessage;
    return new Promise(resolve => gateway.handle(request, {headersSent: false, destroyed: false,
      writeHead: (status: number) => ({end: (body: string) => {resolve({status, body: JSON.parse(body) as Record<string, unknown>});}}),
    } as unknown as ServerResponse));
  };
  return {gateway, automation:controls, call, logs, spans, published, ownerFailures: () => ownerFailures};
}

void test('Automation reads and CRUD require their scopes and every mutation requires the request header', async context => {
  const w = await boundary(context);
  assert.equal((await w.call('GET', 'rules', undefined, readToken)).status, 200);
  for (const [token, header, status] of [[readToken, '1', 403], [controlToken, '0', 403], ['unknown', '1', 401]] as const) {
    assert.equal((await w.call('POST', 'rules', rule, token, header)).status, status);
  }
  assert.deepEqual(w.automation.rules(), []);
  const created = await w.call('POST', 'rules', rule);
  assert.equal(created.status, 201); assert.equal(created.body.enabled, false); assert.equal(created.body.schema, 'automation/2.0');
  const id = String(created.body.id);
  assert.equal((await w.call('POST', `rules/${id}/enable`, {})).body.enabled, true);
  assert.equal((await w.call('PUT', `rules/${id}`, {...rule, name: 'Edited'})).body.name, 'Edited');
  assert.equal((await w.call('DELETE', `rules/${id}`, undefined, controlToken, '0')).status, 403);
  assert.equal(w.automation.rules().length, 1);
  assert.equal((await w.call('DELETE', `rules/${id}`)).body.deleted, true);
  assert.deepEqual(w.automation.rules(), []);
  assert.equal(w.ownerFailures(), 0);
});

void test('pending Automation writes lose authority on same-ID token rotation, with safe correlated refusal', async context => {
  const w = await boundary(context);
  let reached!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => {reached = resolve;});
  const held = new Promise<void>(resolve => {release = resolve;});
  context.after(() => {release();});
  async function* input() {yield Buffer.from('{'); reached(); await held; yield Buffer.from(JSON.stringify(rule).slice(1));}
  const pending = w.call('POST', 'rules', input());
  // The assertion avoids waiting on a body when the route itself is absent in the red control.
  const first = await Promise.race([started.then(() => 'reading'), pending.then(answer => answer.status)]);
  assert.equal(first, 'reading');
  w.gateway.access.replace([{...control, digest: tokenDigest('synthetic-rotated-automation')}, reader]);
  release();
  const answer = await pending;
  assert.equal(answer.status, 401); assert.equal((answer.body.error as {code: string}).code, 'unauthenticated');
  assert.deepEqual(w.automation.rules(), []); assert.equal(w.ownerFailures(), 0);
  const refusal = w.logs.find(record => record.attributes['bunny.code'] === 'unauthenticated');
  assert.ok(refusal); assert.equal(refusal.attributes['http.route'], '/api/v2/automation/rules');
  assert.equal(refusal.trace_id, traceFields(parent)?.traceId);
  assert.equal(w.spans.spans.at(-1)?.endedAtMs !== undefined, true);
  for (const secret of [controlToken, 'synthetic-rotated-automation', rule.name]) assert.equal(JSON.stringify([answer, w.logs, w.spans.spans]).includes(secret), false);
});

void test('invalid and oversized Automation input returns registry errors without failing the core', async context => {
  const w = await boundary(context);
  for (const [method, path, body, status, code] of [
    ['POST', 'rules', {...rule, name: ''}, 400, 'invalid-request'],
    ['POST', 'rules', {name: 'x'.repeat(9000)}, 413, 'too-large'],
    ['PUT', 'settings', {noFlourishes: 'wrong'}, 400, 'invalid-request'],
    ['GET', 'rules/secret-user-id', undefined, 404, 'not-found'],
  ] as const) {
    const answer = await w.call(method, path, body);
    assert.equal(answer.status, status); assert.equal((answer.body.error as {code: string}).code, code);
  }
  assert.equal((await w.call('GET', 'settings')).body.noFlourishes, false);
  assert.equal(w.ownerFailures(), 0); assert.deepEqual(w.automation.rules(), []);
  assert.equal(JSON.stringify(w.logs).includes('secret-user-id'), false);
});

void test('weekly routine routes preserve shared scope/header guards, bounded bodies, independent disabled definitions and an explicit run',async context=>{
  const w=await boundary(context),input={name:'Evening lights',days:[1,2,3,4,5],time:'17:00',actions:[{target:'lines',family:'power-set',data:{on:true}}]};
  assert.equal((await w.call('GET','routines',undefined,readToken)).status,200);
  for(const [token,header,status] of [[readToken,'1',403],[controlToken,'0',403],['unknown','1',401]] as const)
    assert.equal((await w.call('POST','routines',input,token,header)).status,status);
  assert.deepEqual(w.automation.routines.list(),[]);
  const created=await w.call('POST','routines',input);assert.equal(created.status,201);assert.equal(created.body.enabled,false);
  const id=String(created.body.id);
  assert.equal((await w.call('POST',`routines/${id}/enable`,{})).body.enabled,true);
  assert.equal((await w.call('PUT',`routines/${id}`,{...input,time:'18:00'})).body.enabled,true);
  assert.equal((await w.call('POST',`routines/${id}/disable`,{})).body.enabled,false);
  assert.equal((await w.call('POST','routines',{...input,extra:'synthetic-private'})).status,400);
  assert.equal((await w.call('POST','routines',{...input,name:'x'.repeat(9000)})).status,413);
  assert.equal((await w.call('GET','routines/missing')).status,404);
  assert.equal((await w.call('POST',`routines/${id}/run`,{},readToken)).status,403);
  assert.equal((await w.call('POST',`routines/${id}/run`,{},controlToken,'0')).status,403);
  // Run now needs no enabled state; the unavailable target is logged, never dispatched, and the reply names the run.
  const ran=await w.call('POST',`routines/${id}/run`,{});assert.equal(ran.status,200);assert.equal(ran.body.ran,true);assert.equal(ran.body.id,id);
  assert.deepEqual(w.automation.log(5).map(entry=>[entry.ruleId,entry.outcome,entry.reason]),[[id,'blocked','unavailable']]);
  assert.equal((await w.call('POST',`routines/${id}/run`,{extra:true})).status,400);
  assert.equal((await w.call('DELETE',`routines/${id}`,undefined,controlToken,'0')).status,403);
  assert.equal(w.automation.routines.list().length,1);
  assert.equal((await w.call('DELETE',`routines/${id}`)).body.deleted,true);
  assert.equal(w.ownerFailures(),0);
});
void test('weekly routine mutation loses authority during its body read without changing saved state',async context=>{
  const w=await boundary(context);let started!:()=>void,release!:()=>void;
  const reading=new Promise<void>(resolve=>{started=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
  context.after(()=>{release();});
  async function* body(){yield Buffer.from('{');started();await held;yield Buffer.from('"name":"Evening lights","days":[1],"time":"17:00","actions":[{"target":"lines","family":"power-set","data":{"on":true}}]}');}
  const pending=w.call('POST','routines',body());
  assert.equal(await Promise.race([reading.then(()=>'reading'),pending.then(answer=>answer.status)]),'reading');
  w.gateway.access.replace([{...control,digest:tokenDigest('synthetic-power-rotated')},reader]);release();
  assert.equal((await pending).status,401);assert.deepEqual(w.automation.routines.list(),[]);
  assert.equal(JSON.stringify(w.logs).includes('Evening lights'),false);
  assert.equal(w.logs.some(record=>record.attributes['http.route']==='/api/v2/automation/routines'),true);
});

void test('saving a maximum-on definition keeps the authenticated request trace through publication',async context=>{
  const w=await boundary(context);
  const answer=await w.call('PUT','power-limits/desk-lamp',{enabled:false,durationMs:60000});
  assert.equal(answer.status,200);assert.equal(w.published.length,1);
  assert.equal(traceFields(w.published[0] as TraceContext)?.traceId,traceFields(parent)?.traceId);
  const span=w.spans.spans.find(value=>value.name==='bunny.command.request');assert.ok(span);
  assert.equal(traceFields(w.published[0] as TraceContext)?.spanId,span.spanId);
});
