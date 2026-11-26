import type {CodingDispatch} from '@jimmie-potts/event-contracts/v2/coding';
import type {CodingJobDetail} from '../src/coding/job-page.js';
// Coding-worker slots through the companions module (Hub #2028): one slot per companion, a proposal bound to the
// worker's connection, and an approved hand-off that waits for a busy slot and is sent once when it frees. Each
// profile has one conversation until New conversation (#2029), so a companion's own second hand-off cannot arise here
// end to end; it is covered in coding-coordinator.test.ts. An older worker that declares no slots holds one run for
// every companion, which makes another companion's hand-off wait through the real module. Fake core dispatcher, fake
// worker and scripted providers only; time moves only on the harness's manual clock, and waits yield turns.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {test, type TestContext} from 'node:test';
import type {AssistantProfile, AssistantTaskSummary} from '@jimmie-potts/event-contracts/v2/assistant';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {CodingHarnessReadiness, CodingResult, CodingWork} from '@jimmie-potts/event-contracts/v2/coding';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {InProcessBus, type Command, type RequestResult} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import type {CodingJobPage} from '../src/coding/job-page.js';
import {AssistantStore} from '../src/assistant/store.js';
import {CodingStore} from '../src/coding/store.js';
import {createCompanionsModule, type CompanionsOptions} from '../src/module.js';
import {OPENAI_MODEL, OpenAIProvider} from '../src/assistant/openai.js';
import type {ModelProvider, TurnInput, TurnReply} from '../src/assistant/provider.js';
import {sharing, type ShareQuery} from '../src/assistant/sharing.js';

const PROFILES = ['bunny', 'reachy', 'microduck'] as const;
const ENDPOINT = 'worker-endpoint-1';
async function settle(check: () => boolean, what = 'expected state arrived'): Promise<void> {
  for (let turn = 0; turn < 5000; turn += 1) {if (check()) return; await new Promise(resolve => {setImmediate(resolve);});}
  assert.ok(check(), what);
}
/** Each profile's model: a task's first call proposes a hand-off, and the call after the worker's word reports it. */
const delegating = (profile: AssistantProfile, brief = `Synthetic ${profile} brief.`, route: {harness?: string; destination?: string} = {}): ModelProvider => ({name: 'synthetic', model: 'synthetic', turn: input => Promise.resolve<TurnReply>(input.transcript.every(item => item.role === 'owner')
  ? {text: null, calls: [{id: `call-${profile}-${String(input.transcript.length)}`, name: 'delegate_coding', input: {repository: 'agent-device-hub', brief, ...route}}], stop: 'tool', units: 10}
  : {text: `Synthetic ${profile} report.`, calls: [], stop: 'end', units: 10})});
const result = (summary: string): CodingResult => ({outcome: 'tested-candidate', repository: 'agent-device-hub', base: 'a'.repeat(40), head: 'a'.repeat(40), changedFiles: [], checks: [],
  findings: [], limitations: [], summary, sessionId: null, usage: null});

async function world(context: TestContext, options: CompanionsOptions = {}, section: Record<string, unknown> = {}) {
  let now = Date.parse('2026-11-24T18:00:00Z');
  const timers = new Map<number, {due: number; callback: () => void}>(); let timerId = 0;
  const time = {clock: {now: () => now}, scheduler: {after: (delay: number, callback: () => void) => {const id = ++timerId; timers.set(id, {due: now + delay, callback}); return () => {timers.delete(id);};}}};
  const dir = await mkdtemp(join(tmpdir(), 'coding-slots-')), bus = new InProcessBus({now: time.clock.now}), core = bus.connect('bunny/core'), worker = bus.connect('bunny/parts/coding-worker'), gateway = bus.connect('bunny/runtime/gateway');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  // The core's tracked dispatcher forwards a dispatch to the module's coding-run responder, once per request ID.
  const forwarded = new Map<string, string>();
  const dispatched: string[] = [], work: Command<CodingWork>[] = [];
  let heldDispatch: Promise<void> | undefined;
  let refusesDispatch = false;
  const holdDispatch = (): (() => void) => {
    let release = (): void => {};
    heldDispatch = new Promise(resolve => {release = resolve;});
    return release;
  };
  await core.respond<CodingDispatch>('bunny.cmd.coding-dispatch.assistant', async command => {
    dispatched.push(command.data.requestId);
    if (heldDispatch !== undefined) {
      const held = heldDispatch;
      heldDispatch = undefined;
      await held;
    }
    if (refusesDispatch) return errorBody('unavailable');
    const selectionId = command.data.harness === undefined ? undefined : module.inspectCoding()?.selectionId;
    const version = command.data.continuation !== undefined ? '2.3' : selectionId !== undefined ? '2.2' : command.data.harness === undefined ? '2.0' : '2.1';
    const answer = await core.request('bunny.cmd.coding-run.assistant', {type: 'org.bunny.coding.run.requested', subject: 'assistant',
      dataschema: `https://bunny.invalid/events/coding-run/${version}`, data: {...command.data, ...(selectionId === undefined ? {} : {selectionId})}},
      {timeoutMs: 5000, requestId: command.data.requestId, parent: command});
    forwarded.set(command.data.requestId, answer.status);
    return answer.status === 'accepted' ? {status: 'accepted'} : answer.error;
  });
  let nativePreparation: Promise<void> | undefined;
  const holdNativePreparation = () => {
    let release = () => {};
    nativePreparation = new Promise(resolve => {release = resolve;});
    context.after(release);
    return release;
  };
  let refusesStop = false;
  let serialStarts = false;
  let serial = Promise.resolve();
  let releaseStart: (() => void) | undefined;
  await worker.respond<CodingWork>('bunny.cmd.coding-work.*', async command => {
    if (serialStarts && command.data.action === 'start') {
      const pending = serial.then(() => new Promise<void>(resolve => {
        if (!serialStarts) {resolve(); return;}
        work.push(command);
        releaseStart = resolve;
      }));
      serial = pending;
      await pending;
    } else work.push(command);
    if (command.data.action === 'prepare-native-client') {
      const waiting = nativePreparation;
      nativePreparation = undefined;
      await waiting;
    }
    return command.data.action === 'cancel' && refusesStop ? errorBody('unavailable') : {status: 'accepted'};
  });
  const make = () => {
    const module = createCompanionsModule({timeZone: 'America/Chicago', tools: ['delegate_coding'], provider: delegating('bunny'), profileProviders: {reachy: delegating('reachy'), microduck: delegating('microduck')}, ...options});
    return {module, host: new ModuleHarness(module, {bus, stateDir: dir, section, ...time})};
  };
  let {module, host} = make();
  await host.start();
  context.after(async () => {serialStarts = false; releaseStart?.(); await host.stop(); await worker.close(); await gateway.close(); await core.close(); await rm(dir, {recursive: true, force: true});});
  const state = () => module.inspectAssistant() ?? assert.fail('assistant state');
  const task = (profile: AssistantProfile): AssistantTaskSummary | undefined => state().tasks.find(value => value.profile === profile);
  const control = (action: string, extra: Record<string, unknown> = {}): Promise<RequestResult> => {
    const requestId = randomUUID();
    return core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
      dataschema: 'https://bunny.invalid/events/assistant-control/2.0', data: {requestId, action, expectedRevision: state().revision, ...extra}}, {requestId, timeoutMs: 5000});
  };
  const send = async (profile: AssistantProfile, text: string, answer = false, harness?: 'auto' | 'claude-code' | 'codex', destination?: 'mac' | 'pc'): Promise<RequestResult> => {
    const requestId = randomUUID(), current = task(profile);
    const staged = await module.manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId, signal: new AbortController().signal,
      bytes: Buffer.from(JSON.stringify({action: answer ? 'answer' : 'start', profile, expectedRevision: state().revision, text,
        ...(answer ? {taskId: current?.taskId, questionId: current?.questionId, ...(destination === undefined ? {} : {destination}), ...(harness === undefined ? {} : {harness})} : {})}))});
    assert.ok(staged !== undefined && !('error' in staged), JSON.stringify(staged));
    return core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
      dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
  };
  const newConversation = async (profile: AssistantProfile): Promise<RequestResult> => {
    const requestId = randomUUID();
    const staged = await module.manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId, signal: new AbortController().signal,
      bytes: Buffer.from(JSON.stringify({action: 'new-conversation', profile, expectedRevision: state().revision}))});
    assert.ok(staged !== undefined && !('error' in staged));
    return core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
      dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
  };
  const jobInput = async (action: 'stop-coding-job' | 'open-native-terminal', jobId: string, operationId: string): Promise<RequestResult> => {
    const requestId = randomUUID();
    const staged = await module.manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId, signal: new AbortController().signal,
      bytes: Buffer.from(JSON.stringify({action, jobId, operationId}))});
    if (staged === undefined || 'error' in staged) return {status: 'rejected', requestId, error: staged ?? errorBody('unavailable')};
    return core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
      dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
  };
  const stop = (jobId: string, operationId: string) => jobInput('stop-coding-job', jobId, operationId);
  const openNative = (jobId: string, operationId: string) => jobInput('open-native-terminal', jobId, operationId);
  const message = async (jobId: string, operationId: string, text: string, repeat = false): Promise<RequestResult> => {
    const requestId = randomUUID();
    const staged = await module.manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId, signal: new AbortController().signal,
      bytes: Buffer.from(JSON.stringify({action: 'message-coding-job', jobId, operationId, text}))});
    assert.ok(staged !== undefined && !('error' in staged));
    const send = () => core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
      dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
    const reply = await send();
    if (repeat) await send();
    return reply;
  };
  const jobs = async (query: Record<string, string>): Promise<CodingJobPage> => {
    const reply = await module.manifest.content?.('coding-jobs', {query, signal: new AbortController().signal});
    assert.ok(reply !== undefined && !('error' in reply));
    return JSON.parse(Buffer.from(reply.bytes).toString()) as CodingJobPage;
  };
  type SavedMessage = {id: string; taskId: string; role: string; text: string; follows?: string};
  const messages = async (profile: AssistantProfile, conversationId?: string): Promise<SavedMessage[]> => {
    const content = await module.manifest.content?.('conversation', {query: conversationId === undefined ? {profile} : {profile, view: 'recent', conversationId}, signal: new AbortController().signal});
    assert.ok(content !== undefined && !('error' in content), JSON.stringify(content));
    return (JSON.parse(Buffer.from(content.bytes).toString()) as {messages: SavedMessage[]}).messages;
  };
  /** The worker declares itself: a worker from Hub #2028 with three slots (2.2), or an older one that declares none (2.0). */
  const enable = (slots?: number | 'uncapped', harnesses?: CodingHarnessReadiness[]) => worker.request(`bunny.cmd.coding-endpoint.${ENDPOINT}`, {
    type: 'org.bunny.coding.endpoint.requested', subject: ENDPOINT,
    dataschema: `https://bunny.invalid/events/coding-endpoint/${slots === 'uncapped' ? '2.4' : harnesses !== undefined ? '2.3' : slots === undefined ? '2.0' : '2.2'}`,
    data: {requestId: randomUUID(), action: 'enable', ...(slots === 'uncapped' ? {capacity: 'uncapped'} : slots === undefined ? {} : {slots}), ...(harnesses === undefined ? {} : {harnesses})},
  }, {timeoutMs: 5000});
  const lose = () => gateway.publish(`bunny.event.coding-lost.${ENDPOINT}`, {kind: 'occurrence', type: 'org.bunny.coding.endpoint-lost', subject: ENDPOINT,
    dataschema: 'https://bunny.invalid/events/coding-lost/2.0', data: {id: ENDPOINT}});
  const progress = (data: object, version = 'harness' in data ? '2.2' : '2.1') => worker.publish(`bunny.event.coding-progress.${ENDPOINT}`, {kind: 'occurrence', type: 'org.bunny.coding.progress.observed', subject: ENDPOINT,
    dataschema: `https://bunny.invalid/events/coding-progress/${version}`, data});
  const starts = () => work.filter(command => command.data.action === 'start');
  /** A profile's task asks, waits at its approval and is approved. */
  const approved = async (profile: AssistantProfile, harness?: 'auto' | 'claude-code' | 'codex'): Promise<void> => {
    await settle(() => task(profile)?.status === 'waiting' && task(profile)?.questionId !== null && task(profile)?.hasAnswer === false, `${profile} waits for approval`);
    assert.equal((await send(profile, 'approve', true, harness)).status, 'accepted');
  };
  const waitMessages = async (profile: AssistantProfile, pattern: RegExp, conversationId?: string): Promise<SavedMessage[]> => {
    for (let i = 0; i < 500; i += 1) {
      const saved = await messages(profile, conversationId);
      if (saved.some(message => pattern.test(message.text))) return saved;
      await new Promise(resolve => {setImmediate(resolve);});
    }
    return assert.fail(`Missing message ${String(pattern)}`);
  };
  const continueJob = (jobId: string, operationId: string, harness: 'claude-code' | 'codex', requestId = randomUUID()) =>
    core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
      dataschema: 'https://bunny.invalid/events/assistant-control/2.3', data: {requestId, action: 'continue-coding-job', jobId, operationId, harness}}, {requestId, timeoutMs: 5000});
  const jobDetail = async (jobId: string) => {
    const reply = await module.manifest.content?.('coding-job', {query: {jobId}, signal: new AbortController().signal});
    assert.ok(reply !== undefined && !('error' in reply));
    return JSON.parse(Buffer.from(reply.bytes).toString()) as CodingJobDetail;
  };
  return {worker, now: time.clock.now, continueJob, jobDetail, jobs, message, openNative, holdNativePreparation, forwarded, module: () => module, serializeStarts: () => {serialStarts = true;}, acknowledgeStart: () => {
    const release = releaseStart ?? assert.fail('serial responder has a delivered start to acknowledge');
    releaseStart = undefined; release();
  }, database: () => host.moduleDatabase() ?? assert.fail('open database'), refuseStop: () => {refusesStop = true;}, refuseDispatch: () => {refusesDispatch = true;}, task, control, send, stop, holdDispatch, newConversation, messages, waitMessages, enable, lose, progress, starts, work, dispatched, approved, coding: () => module.inspectCoding() ?? assert.fail('coding state'),
    restart: async () => {await host.stop(); ({module, host} = make()); await host.start();}, advance: (ms: number) => {now += ms; for (const [id, timer] of [...timers]) if (timer.due <= now) {timers.delete(id); timer.callback();}}};
}

void test('native continuation respects current job and brief grants and retains only last-observed authority after restart', async context => {
  const permitted = sharing();
  let revoked: ShareQuery['destination'] | undefined, hiddenJob: string | undefined;
  const share = Object.assign((query: ShareQuery) => permitted(query) &&
    !(query.destination === revoked && query.source === 'coding' && query.field === 'brief') &&
    !(query.destination === 'private-conversation' && query.source === 'coding' && query.field === 'details' &&
      hiddenJob !== undefined && query.record === hiddenJob),
  {revokesFields: true, allowsDerived: (query: ShareQuery) => permitted.allowsDerived?.(query) !== false});
  const w = await world(context, {share});
  const readiness: CodingHarnessReadiness = {
    harness: 'claude-code', capabilities: {steering: 'unsupported', resume: 'unsupported', review: true},
    installed: 'yes', signedIn: 'yes', version: '2.1.292', plan: 'max', checkedAtMs: Date.parse('2026-11-24T18:00:00Z'),
    limits: null, limitsObservedAtMs: null,
  };
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.enable('uncapped', [readiness])).status, 'accepted');
  assert.equal((await w.send('bunny', 'Synthetic saved native attempt')).status, 'accepted');
  await w.approved('bunny');
  await settle(() => w.starts().length === 1);
  const operationId = w.starts()[0]?.data.operationId ?? assert.fail('native job start');
  const jobId = `${operationId}-job`, sessionId = 'synthetic-native-attempt';
  await w.progress({operationId, harness: 'claude-code', sessionId, status: 'started', setup: 'ready'}, '2.3');
  await settle(() => w.coding().runs?.some(run => run.sessionId === sessionId) === true);
  await w.progress({operationId, harness: 'claude-code', sessionId, status: 'completed', result: result('Synthetic result.')}, '2.3');
  await w.waitMessages('bunny', /Synthetic result/);
  const observe = (state: 'available' | 'terminal', observedAtMs: number) => w.progress({
    operationId, status: 'native-client', clients: ['terminal'], state, observedAtMs,
  }, '2.6');
  const current = async () => (await w.jobs({jobId})).jobs[0]?.nativeClient;
  const revision = w.coding().revision;
  await observe('available', 10);
  await settle(() => w.coding().revision > revision);
  assert.deepEqual(await current(), {clients: ['terminal'], state: 'available', observedAtMs: 10});

  const savedObservation = async () => (await w.jobDetail(jobId)).attempts.find(item => item.operationId === operationId)?.context?.nativeObservation;
  assert.equal((await savedObservation())?.state, 'available');

  const db = w.database();
  db.prepare('CREATE TEMP TABLE saved_native_attempt AS SELECT * FROM companion_coding_attempts WHERE operation_id=?').run(operationId);
  assert.equal(db.prepare('DELETE FROM companion_coding_attempts WHERE operation_id=?').run(operationId).changes, 1);
  try {
    const card = (await w.jobs({jobId})).jobs[0];
    assert.equal(card?.operationId, operationId, 'the stable job receipt remains readable');
    assert.equal(card?.nativeClient, undefined);
    assert.equal(card?.sessionId, undefined);
    assert.equal(await savedObservation(), undefined);
    const missing = await w.openNative(jobId, operationId);
    assert.equal(missing.status === 'rejected' && missing.error.error.code, 'not-found');
    assert.equal(w.work.length, 1, 'no prepare or launch was sent');
  } finally {
    db.exec('INSERT INTO companion_coding_attempts SELECT * FROM saved_native_attempt; DROP TABLE saved_native_attempt');
  }
  assert.equal((await current())?.state, 'available');
  assert.equal((await savedObservation())?.state, 'available');

  for (const destination of ['private-conversation', 'coding-worker'] as const) {
    revoked = destination;
    assert.equal(await current(), undefined);
    assert.equal(await savedObservation(), undefined);
    const denied = await w.openNative(jobId, operationId);
    assert.equal(denied.status === 'rejected' && denied.error.error.code, 'forbidden');
    assert.equal(w.work.length, 1);
  }

  revoked = undefined;
  hiddenJob = jobId;
  assert.equal(await current(), undefined);
  const hidden = await w.openNative(jobId, operationId);
  assert.equal(hidden.status === 'rejected' && hidden.error.error.code, 'not-found');
  assert.equal(w.work.length, 1);
  hiddenJob = undefined;

  for (const [index, permission] of ['brief', 'job'].entries()) {
    const release = w.holdNativePreparation();
    assert.equal((await w.openNative(jobId, operationId)).status, 'accepted');
    await settle(() => w.work.length === index + 2);
    assert.equal(w.work[index + 1]?.data.action, 'prepare-native-client');
    const preparingRevision = w.coding().revision;
    if (permission === 'brief') revoked = 'coding-worker';
    else hiddenJob = jobId;
    release();
    await settle(() => w.coding().revision > preparingRevision);
    assert.equal(w.work.some(command => command.data.action === 'open-native-terminal'), false);
    revoked = undefined;
    hiddenJob = undefined;
  }

  assert.equal((await current())?.state, 'available');
  assert.equal((await w.openNative(jobId, operationId)).status, 'accepted');
  await settle(() => w.work.length === 5);
  const prepared = w.work[3]?.data, launched = w.work[4]?.data;
  assert.ok(prepared?.action === 'prepare-native-client' && launched?.action === 'open-native-terminal');
  assert.equal(launched.intentId, prepared.requestId);
  assert.equal(launched.operationId, operationId);
  const prompted = w.coding().revision;
  await observe('terminal', 11);
  await settle(() => w.coding().revision > prompted);
  assert.equal((await current())?.state, 'terminal');
  revoked = 'private-conversation';
  await w.restart();
  assert.equal(await current(), undefined);
  assert.equal(await savedObservation(), undefined);
  revoked = undefined;
  assert.deepEqual(await current(), {clients: ['terminal'], state: 'uncertain', observedAtMs: 11});
  assert.equal((await w.openNative(jobId, operationId)).status, 'rejected');
  assert.equal(w.work.length, 5);
});

void test('an attributed background job keeps its first native session and delivers one result to the original exchange', {timeout: 30_000}, async context => {
  const w = await world(context);
  const readiness: CodingHarnessReadiness = {
    harness: 'claude-code', capabilities: {steering: 'unsupported', resume: 'unsupported', review: true},
    installed: 'yes', signedIn: 'yes', version: '2.1.292', plan: 'max', checkedAtMs: Date.parse('2026-11-24T18:00:00Z'),
    limits: null, limitsObservedAtMs: null,
  };
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.enable(3, [readiness])).status, 'accepted');
  assert.deepEqual(w.coding().harnesses, [readiness]);
  assert.equal((await w.send('bunny', 'Synthetic background job with session evidence')).status, 'accepted');
  await w.approved('bunny');
  await settle(() => w.starts().length === 1 && w.task('bunny')?.status === 'succeeded');
  const start = w.starts()[0] ?? assert.fail('worker start');
  const {operationId} = start.data;
  const jobId = `${operationId}-job`;
  const origin = w.task('bunny')?.conversationId ?? assert.fail('originating conversation');
  assert.equal(start.dataschema, 'https://bunny.invalid/events/coding-work/2.1');
  assert.equal('harness' in start.data, false, 'an implicit job keeps the default Claude selection');
  await w.progress({operationId, harness: 'claude-code', status: 'started'});
  await settle(() => w.coding().runs?.some(run => run.operationId === operationId && run.status === 'started') === true);
  await w.progress({operationId, harness: 'claude-code', status: 'started', sessionId: 'native-first'});
  await settle(() => w.coding().runs?.some(run => run.operationId === operationId && run.sessionId === 'native-first') === true);
  await w.progress({operationId, harness: 'claude-code', status: 'started', sessionId: 'native-conflict'});
  assert.equal((await w.newConversation('bunny')).status, 'accepted');
  assert.equal(w.coding().runs?.find(run => run.operationId === operationId)?.sessionId, 'native-first');
  const ended = {operationId, harness: 'claude-code', sessionId: 'native-first', status: 'completed',
    result: {...result('Synthetic attributed result.'), sessionId: 'native-first'}};
  await w.progress(ended);
  await w.progress({...ended, result: result('Synthetic late duplicate.')});
  const original = await w.waitMessages('bunny', /Synthetic attributed result/, origin);
  assert.deepEqual(original.filter(message => message.follows === jobId).map(message => message.id), [`${jobId}-sent`, `${jobId}-result`]);
  assert.ok(!(await w.messages('bunny')).some(message => message.follows === jobId));
  assert.deepEqual(w.dispatched, [operationId]);
});

void test('an uncapped worker starts more jobs from one companion than a page can hold, alongside another companion', {timeout: 30_000}, async context => {
  const w = await world(context);
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.enable('uncapped')).status, 'accepted');
  for (let job = 0; job < 11; job += 1) {
    assert.equal((await w.send('bunny', `Synthetic independent job ${String(job)}`)).status, 'accepted');
    await w.approved('bunny');
    await settle(() => w.starts().length === job + 1);
    await settle(() => w.task('bunny')?.status === 'succeeded');
    assert.equal((await w.newConversation('bunny')).status, 'accepted');
  }
  assert.equal((await w.send('reachy', 'Synthetic concurrent Reachy job')).status, 'accepted');
  await w.approved('reachy');
  await settle(() => w.starts().length === 12);
  assert.equal(w.starts().filter(command => command.data.action === 'start' && command.data.companion === 'bunny').length, 11);
  assert.equal(w.starts().filter(command => command.data.action === 'start' && command.data.companion === 'reachy').length, 1);
  assert.deepEqual(w.coding().counts, {runs: 12, waiting: 0});
  assert.equal(w.coding().runs?.length, 8, 'the state preview stays bounded');
  const page = async (after?: string): Promise<CodingJobPage> => {
    const result = await w.module().manifest.content?.('coding-jobs', {query: after === undefined ? {} : {after}, signal: new AbortController().signal});
    assert.ok(result !== undefined && !('error' in result));
    return JSON.parse(Buffer.from(result.bytes).toString()) as CodingJobPage;
  };
  const first = await page();
  assert.equal(first.jobs.length, 10);
  assert.ok(first.next !== null);
  const second = await page(first.next);
  assert.equal(second.jobs.length, 2);
  assert.equal(second.next, null);
  assert.deepEqual([...first.jobs, ...second.jobs].map(job => job.operationId).sort(), w.starts().map(command => command.data.operationId).sort());
  const job = second.jobs[0] ?? assert.fail('later page job');
  assert.equal((await w.stop(job.jobId, job.operationId)).status, 'accepted');
  await settle(() => w.work.some(command => command.data.action === 'cancel'));
  assert.deepEqual(w.work.filter(command => command.data.action === 'cancel').map(command => command.data.operationId), [job.operationId]);
});

function seedReadyJobs(database: DatabaseSync, operations: string[]): void {
  const jobs = new CodingStore(database), tasks = new AssistantStore(database);
  for (const operationId of operations) {
    const taskId = operationId.slice(0, -'-step-1'.length);
    const task = tasks.newTask('bunny', 'Synthetic restored request.', {provider: 'synthetic', model: 'synthetic', variant: ''});
    tasks.save({...task, id: taskId, status: 'succeeded'});
    const repository = 'agent-device-hub', brief = 'Synthetic restored brief.';
    const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    tasks.saveCall({version: 1, id: operationId, taskId, runId: 'synthetic-run', ordinal: 1, kind: 'tool', status: 'succeeded',
      result: 'Synthetic queued job.', units: 0, reservedUnits: 0, reservedMs: 0, elapsedMs: 0, traceparent,
      action: {questionId: `${taskId}-q0`, description: 'Synthetic coding approval.'},
      codingApproval: {destination: 'coding-worker', repository, briefDigest: createHash('sha256').update(JSON.stringify(brief)).digest('hex')}});
    jobs.create({jobId: `${operationId}-job`, operationId, taskId, repository, brief, conversationId: task.conversationId});
    jobs.wait({operationId, taskId, companion: 'bunny', repository, brief, traceparent});
  }
}

void test('an unpinned restored coding row does not block a verified sibling', {timeout: 30_000}, async context => {
  const w = await world(context);
  const db = w.database(), operations = ['old-unpinned-step-1', 'restored-pinned-step-1'];
  seedReadyJobs(db, operations);
  const old = new CodingStore(db).job('old-unpinned-step-1') ?? assert.fail('old approved job');
  const store = new AssistantStore(db);
  const task = store.task(old.taskId) ?? assert.fail('old task');
  delete task.supervisor;
  store.save(task);
  await w.restart();
  assert.equal((await w.enable('uncapped')).status, 'accepted');
  const saved = await w.waitMessages('bunny', /original supervisor or coding approval could not be verified/);
  assert.ok(saved.some(message => message.id === 'old-unpinned-step-1-job-result' && message.text.includes('Create a new job')));
  assert.doesNotMatch(JSON.stringify(saved), /refused: forbidden/);
  await settle(() => w.starts().length === 1);
  assert.deepEqual(w.dispatched, ['restored-pinned-step-1']);
});

void test('a restored uncapped backlog paces the serial worker acknowledgement without holding active runs', {timeout: 30_000}, async context => {
  const w = await world(context);
  assert.equal((await w.control('enable')).status, 'accepted');
  const restored = Array.from({length: 35}, (_, index) => `restored-${String(index)}-step-1`);
  seedReadyJobs(w.database(), restored);
  await w.restart();
  w.serializeStarts();
  assert.equal((await w.enable('uncapped')).status, 'accepted');
  await settle(() => w.starts().length === 1);
  assert.deepEqual(w.dispatched, restored.slice(0, 1), 'the core reply alone does not release delivery');
  const first = restored[0] ?? assert.fail('restored start');
  await w.progress({operationId: first, status: 'started', setup: 'ready'}, '2.3');
  await settle(() => w.coding().runs?.some(run => run.operationId === first && run.setup === 'ready') === true);
  assert.equal((await w.send('reachy', 'Synthetic sibling approved during the gated acknowledgement')).status, 'accepted');
  await w.approved('reachy');
  await w.waitMessages('reachy', /Coding job .* was queued/);
  assert.deepEqual(w.dispatched, [first], 'an early progress observation does not release the acknowledgement gate');
  for (let index = 0; index < restored.length + 1; index += 1) {
    await settle(() => w.starts().length === index + 1);
    w.acknowledgeStart();
    const operationId = w.starts()[index]?.data.operationId ?? assert.fail('delivered attempt');
    // One acknowledged job never reports setup progress during the drain.
    if (index > 1) await w.progress({operationId, status: 'started', setup: 'ready'}, '2.3');
  }
  await settle(() => w.coding().counts?.runs === 36);
  assert.deepEqual(w.dispatched.slice(0, 35), restored);
  assert.equal(new Set(w.dispatched).size, 36);
  const sibling = w.starts().at(-1)?.data;
  assert.equal(sibling?.action === 'start' && sibling.companion, 'reachy');
  assert.deepEqual(w.coding().counts, {runs: 36, waiting: 0});
  assert.equal(w.coding().runs?.find(run => run.operationId === restored[1])?.status, 'dispatching');
});

for (const failFirstWrite of [false, true]) {
  void test(`a held core dispatch from an old connection cannot start after the same identity returns (initial write failure: ${String(failFirstWrite)})`, {timeout: 30_000}, async context => {
    const w = await world(context);
    const db = w.database(), store = new CodingStore(db);
    let attempts = 0;
    if (failFirstWrite) {
      db.function('fail_stale_dispatch_result', () => {attempts += 1; return attempts === 1 ? 1 : 0;});
      db.exec(`CREATE TEMP TRIGGER fail_stale_dispatch_result BEFORE INSERT ON companion_coding_job_updates
        WHEN NEW.operation_id='stale-dispatch-step-1' AND NEW.kind='result' AND fail_stale_dispatch_result()=1
        BEGIN SELECT RAISE(ABORT,'synthetic disconnect result failure'); END`);
    }
    seedReadyJobs(db, ['stale-dispatch-step-1', 'unassigned-dispatch-step-1']);
    const release = w.holdDispatch();
    context.after(release);
    try {
      assert.equal((await w.enable('uncapped')).status, 'accepted');
      await settle(() => w.dispatched.length === 1);
      await w.lose();
      await settle(() => failFirstWrite ? attempts === 1 : store.resultSaved('stale-dispatch-step-1'));
      assert.equal((await w.enable('uncapped')).status, 'accepted');
      release();
      await settle(() => w.forwarded.has('stale-dispatch-step-1') && w.starts().length === 1);
      assert.equal(w.forwarded.get('stale-dispatch-step-1'), 'rejected');
      if (failFirstWrite) {
        assert.equal(store.resultSaved('stale-dispatch-step-1'), false);
        w.advance(1000);
        await settle(() => store.resultSaved('stale-dispatch-step-1'));
      }
      const row = db.prepare("SELECT text FROM companion_coding_job_updates WHERE operation_id=? AND kind='result'").get('stale-dispatch-step-1');
      assert.match(String(row?.text ?? ''), /worker became unavailable before start was sent/);
      assert.deepEqual(w.dispatched, ['stale-dispatch-step-1', 'unassigned-dispatch-step-1']);
      assert.deepEqual(w.starts().map(message => message.data.operationId), ['unassigned-dispatch-step-1']);
    } finally {release();}
  });
}

void test('a disconnected delivery settles uncertain while its late reply leaves the next delivery held', {timeout: 30_000}, async context => {
  const w = await world(context);
  const operations = ['lost-delivery-step-1', 'next-delivery-step-1', 'last-delivery-step-1'];
  const store = new CodingStore(w.database());
  seedReadyJobs(w.database(), operations);
  w.serializeStarts();
  assert.equal((await w.enable('uncapped')).status, 'accepted');
  await settle(() => w.starts().length === 1);
  await w.lose();
  await settle(() => store.resultSaved('lost-delivery-step-1'));
  assert.equal(store.records('uncertain')[0]?.operationId, 'lost-delivery-step-1');
  assert.equal((await w.enable('uncapped')).status, 'accepted');
  await settle(() => w.dispatched.length === 2);
  w.acknowledgeStart();
  await settle(() => w.starts().length === 2);
  assert.deepEqual(w.dispatched, operations.slice(0, 2), 'the late old reply cannot release the current delivery');
  w.acknowledgeStart();
  await settle(() => w.starts().length === 3);
  w.acknowledgeStart();
  assert.deepEqual(w.starts().map(message => message.data.operationId), operations);
  assert.deepEqual(w.dispatched, operations);
});

void test('three companions hand off at once, each run tagged and each result back in its own conversation; another companion\'s run never refuses an approval', {timeout: 30_000}, async context => {
  const w = await world(context);
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.enable(3)).status, 'accepted');
  // B.U.N.N.Y.'s proposal is bound before Reachy's run starts; its approval afterwards is still accepted.
  assert.equal((await w.send('bunny', 'Synthetic bunny request')).status, 'accepted');
  await settle(() => w.task('bunny')?.status === 'waiting' && w.task('bunny')?.questionId !== null);
  for (const profile of ['reachy', 'microduck'] as const) {assert.equal((await w.send(profile, `Synthetic ${profile} request`)).status, 'accepted'); await w.approved(profile);}
  await settle(() => w.starts().length === 2);
  await w.progress({operationId: w.starts()[0]?.data.operationId, status: 'started'});
  await settle(() => w.coding().runs?.some(run => run.status === 'started') === true);
  await w.approved('bunny');
  await settle(() => w.starts().length === 3, 'B.U.N.N.Y.\'s approval was not refused');
  assert.deepEqual(w.starts().map(command => command.data.action === 'start' ? command.data.companion : undefined), ['reachy', 'microduck', 'bunny']);
  assert.deepEqual(w.coding().runs?.map(run => run.companion), ['reachy', 'microduck', 'bunny']);
  assert.doesNotMatch(JSON.stringify(await w.messages('bunny')), /revision-conflict/);
  // Each result resumes only its own conversation.
  for (const command of w.starts().reverse()) {
    const id = command.data.operationId, companion = command.data.action === 'start' ? command.data.companion ?? 'unknown' : 'unknown';
    if (companion !== 'reachy') await w.progress({operationId: id, status: 'started'});
    await w.progress({operationId: id, status: 'completed', result: result(`Synthetic ${companion} result.`)});
  }
  await settle(() => PROFILES.every(profile => w.task(profile)?.status === 'succeeded'), 'every conversation finished');
  for (const profile of PROFILES) {
    const text = JSON.stringify(await w.waitMessages(profile, new RegExp(`Synthetic ${profile} result`)));
    for (const other of PROFILES.filter(value => value !== profile)) assert.doesNotMatch(text, new RegExp(`Synthetic ${other} result`));
  }
  assert.deepEqual(w.coding().runs, []);
});

void test('with an older worker\'s one slot, an approved hand-off waits busy, a named stop removes it unsent, and a waiting one survives a restart and is sent once', {timeout: 30_000}, async context => {
  const w = await world(context);
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.enable()).status, 'accepted');
  assert.equal((await w.send('bunny', 'Synthetic bunny request')).status, 'accepted'); await w.approved('bunny');
  await settle(() => w.starts().length === 1);
  assert.equal(w.starts()[0]?.dataschema, 'https://bunny.invalid/events/coding-work/2.0', 'an older worker gets the start it knows');
  // Reachy is still offered the hand-off; once approved it waits, and the conversation says the worker is busy.
  assert.equal((await w.send('reachy', 'Synthetic reachy request')).status, 'accepted');
  await settle(() => w.task('reachy')?.status === 'waiting' && w.task('reachy')?.questionId !== null);
  assert.equal(w.module().inspectAssistant()?.tasks.find(entry => entry.profile === 'reachy')?.questionId?.includes('-q'), true, 'an approval, not a refusal');
  await w.approved('reachy');
  await settle(() => w.coding().waiting?.length === 1);
  assert.deepEqual(w.coding().waiting?.map(entry => entry.companion), ['reachy']);
  const waiting = w.coding().waiting?.[0] ?? assert.fail('saved hand-off');
  const waitingText = await w.waitMessages('reachy', /Coding job .* was queued/);
  assert.ok(waitingText.some(message => message.id === `${waiting.operationId}-job`));
  assert.equal(w.dispatched.length, 1, 'nothing left for the waiting hand-off');
  assert.deepEqual(await w.module().stopCodingJob(`${waiting.operationId}-job`, waiting.operationId), {status: 'accepted'});
  await settle(() => w.coding().waiting?.length === 0 && w.task('reachy')?.status === 'succeeded');
  await w.waitMessages('reachy', /Cancelled before dispatch/);
  assert.equal(w.work.length, 1); assert.equal(w.dispatched.length, 1);
  // MicroDuck's approved hand-off waits in its place, across a restart, and is sent once when the slot frees.
  assert.equal((await w.send('microduck', 'Synthetic microduck request')).status, 'accepted'); await w.approved('microduck');
  await settle(() => w.coding().waiting?.length === 1);
  await w.restart();
  // B.U.N.N.Y.'s unanswered run is uncertain now; MicroDuck's never-sent hand-off keeps waiting.
  await settle(() => w.task('bunny')?.status === 'succeeded', 'B.U.N.N.Y. heard its uncertain result');
  assert.match(JSON.stringify(await w.messages('bunny')), /uncertain \(lost\)/);
  assert.deepEqual(w.coding().waiting?.map(entry => entry.companion), ['microduck']);
  assert.equal((await w.enable()).status, 'accepted');
  await settle(() => w.starts().length === 2, 'the waiting hand-off is sent when the slot is free');
  const second = w.starts()[1]?.data; assert.ok(second?.action === 'start'); assert.equal(second.taskId, w.task('microduck')?.taskId);
  assert.equal((await w.enable()).status, 'accepted');
  for (let turn = 0; turn < 50; turn += 1) await new Promise(resolve => {setImmediate(resolve);});
  assert.equal(w.starts().length, 2); assert.equal(w.dispatched.filter(id => id === second.operationId).length, 1, 'sent once');
  await w.progress({operationId: second.operationId, status: 'started'});
  await w.progress({operationId: second.operationId, status: 'completed', result: result('Synthetic microduck result.')});
  await settle(() => w.task('microduck')?.status === 'succeeded');
  const microduck = await w.waitMessages('microduck', /Synthetic microduck result/);
  assert.ok(microduck.some(message => message.follows === `${second.operationId}-job` && message.text.includes('Synthetic microduck result')));
});

void test('a waiting hand-off that the module sent before its waiting line was saved reads "Delegated to" at once', {timeout: 30_000}, async context => {
  // The slot frees and the module sends the hand-off while the engine is still saving its answer: by the time the
  // line is saved, the module already holds the run.
  const sent = new Set<string>();
  const w = await world(context, {coding: () => ({available: true, endpointId: ENDPOINT, revision: 1}),
    delegate: data => {sent.add(data.requestId); return Promise.resolve({status: 'waiting' as const, requestId: data.requestId});},
    handedOff: requestId => sent.has(requestId)});
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.send('reachy', 'Synthetic reachy request')).status, 'accepted'); await w.approved('reachy');
  await settle(() => sent.size === 1 && w.task('reachy')?.questionId?.includes('delegation') === true);
  const text = JSON.stringify(await w.messages('reachy'));
  assert.match(text, /Delegated to the coding worker in agent-device-hub: Synthetic reachy brief\./);
  assert.doesNotMatch(text, /Waiting to delegate/);
});

void test('Conversation answers a Hub question and takes another job while a worker is held', {timeout: 30_000}, async context => {
  const workerModel = delegating('bunny');
  const w = await world(context, {
    provider: {...workerModel, turn: (input, signal) => input.transcript.some(item => item.role === 'owner' && item.text === 'Synthetic Hub question')
      ? Promise.resolve({text: 'Synthetic Hub answer.', calls: [], stop: 'end', units: 10}) : workerModel.turn(input, signal)},
  });
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.enable()).status, 'accepted');
  assert.equal((await w.send('bunny', 'Synthetic first job')).status, 'accepted');
  await w.approved('bunny');
  await settle(() => w.starts().length === 1);
  const first = w.starts()[0]?.data; assert.ok(first?.action === 'start');
  await w.progress({operationId: first.operationId, status: 'started'});
  await settle(() => w.task('bunny')?.status === 'succeeded', 'the turn closes while its worker is still held');
  assert.equal((await w.send('bunny', 'Synthetic Hub question')).status, 'accepted');
  await settle(() => w.task('bunny')?.status === 'succeeded');
  assert.match(JSON.stringify(await w.messages('bunny')), /Synthetic Hub answer/);
  assert.equal((await w.send('bunny', 'Synthetic second job')).status, 'accepted');
  await w.approved('bunny');
  await settle(() => w.task('bunny')?.status === 'succeeded');
  assert.equal(w.starts().length, 1);
  assert.equal(w.coding().waiting?.length, 1);
  const conversation = w.task('bunny')?.conversationId ?? assert.fail('originating conversation');
  assert.equal((await w.newConversation('bunny')).status, 'accepted');
  assert.equal((await w.send('bunny', 'Synthetic Hub question')).status, 'accepted');
  await settle(() => w.task('bunny')?.status === 'succeeded');
  await w.progress({operationId: first.operationId, status: 'completed', result: result('Synthetic original exchange result.')});
  await w.progress({operationId: first.operationId, status: 'completed', result: result('Synthetic duplicate result.')});
  const old = await w.waitMessages('bunny', /Synthetic original exchange result/, conversation);
  assert.ok(old.some(message => message.id === `${first.operationId}-job-result` && message.follows === `${first.operationId}-job`));
  assert.doesNotMatch(JSON.stringify(old), /Synthetic duplicate result/);
  assert.doesNotMatch(JSON.stringify(await w.messages('bunny')), /Synthetic original exchange result/);
  // A process can stop after the transcript commits and before the coordinator acknowledges delivery.
  w.database().prepare("UPDATE companion_coding_job_updates SET delivered=0 WHERE operation_id=? AND kind='result'").run(first.operationId);
  await w.restart();
  const restored = await w.messages('bunny', conversation);
  assert.equal(restored.filter(message => message.id === `${first.operationId}-job-result`).length, 1);
  assert.equal(w.starts().filter(command => command.data.operationId === first.operationId).length, 1);
});


void test('background coding checks queued grants again and filters retained job results after revocation', {timeout: 30_000}, async context => {
  const permitted = sharing();
  let blockBrief = false, hiddenResult: string | undefined;
  const share = Object.assign((query: ShareQuery) => permitted(query) &&
    !(blockBrief && query.destination === 'coding-worker' && query.source === 'coding' && query.field === 'brief') &&
    !(hiddenResult !== undefined && query.destination === 'private-conversation' && query.source === 'coding' &&
      query.field === 'details' && query.record === hiddenResult),
  {revokesFields: true, allowsDerived: (query: ShareQuery) => permitted.allowsDerived?.(query) !== false});
  const w = await world(context, {share});
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.enable()).status, 'accepted');
  assert.equal((await w.send('bunny', 'Synthetic first job')).status, 'accepted');
  await w.approved('bunny');
  await settle(() => w.starts().length === 1);
  const first = w.starts()[0]?.data;
  assert.ok(first?.action === 'start');
  await w.progress({operationId: first.operationId, status: 'started'});
  await settle(() => w.task('bunny')?.status === 'succeeded');
  assert.equal((await w.send('bunny', 'Synthetic queued job')).status, 'accepted');
  await w.approved('bunny');
  await settle(() => w.task('bunny')?.status === 'succeeded' && w.coding().waiting?.length === 1);
  blockBrief = true;
  await w.progress({operationId: first.operationId, status: 'completed', result: result('Synthetic retained outcome.')});
  const messages = await w.waitMessages('bunny', /Synthetic retained outcome/);
  assert.ok(messages.some(message => message.id === `${first.operationId}-job-result`));
  await w.waitMessages('bunny', /refused: forbidden/);
  assert.equal(w.starts().length, 1, 'revocation prevents a second worker dispatch');
  hiddenResult = first.operationId;
  assert.doesNotMatch(JSON.stringify(await w.messages('bunny')), /Synthetic retained outcome/);
  await w.restart();
  assert.doesNotMatch(JSON.stringify(await w.messages('bunny')), /Synthetic retained outcome/);
  assert.equal(w.starts().length, 1);
});

void test('a named stop with no worker confirmation leaves a sibling running', {timeout: 30_000}, async context => {
  const w = await world(context);
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.enable(3)).status, 'accepted');
  for (const profile of ['bunny', 'reachy'] as const) {
    assert.equal((await w.send(profile, `Synthetic ${profile} job`)).status, 'accepted');
    await w.approved(profile);
  }
  await settle(() => w.starts().length === 2);
  const bunny = w.starts().find(command => command.data.action === 'start' && command.data.companion === 'bunny')?.data;
  const reachy = w.starts().find(command => command.data.action === 'start' && command.data.companion === 'reachy')?.data;
  assert.ok(bunny?.action === 'start' && reachy?.action === 'start');
  await w.progress({operationId: bunny.operationId, status: 'started'});
  await w.progress({operationId: reachy.operationId, status: 'started'});
  await settle(() => w.coding().runs?.every(run => run.status === 'started') === true);
  w.refuseStop();
  const wrong = await w.stop(`${bunny.operationId}-job`, reachy.operationId);
  assert.equal(wrong.status, 'rejected');
  assert.equal((await w.stop(`${bunny.operationId}-job`, bunny.operationId)).status, 'accepted');
  await w.waitMessages('bunny', /stop is unconfirmed/);
  assert.deepEqual(w.work.filter(command => command.data.action === 'cancel').map(command => command.data.operationId), [bunny.operationId]);
  assert.equal(w.coding().runs?.find(run => run.operationId === reachy.operationId)?.status, 'started');
  await w.progress({operationId: reachy.operationId, status: 'completed', result: result('Synthetic sibling result.')});
  await w.waitMessages('reachy', /Synthetic sibling result/);
  assert.equal(w.coding().runs?.find(run => run.operationId === bunny.operationId)?.status, 'cancelling');
  await w.progress({operationId: bunny.operationId, status: 'cancelled', reason: 'cancelled', result: null});
  await w.waitMessages('bunny', /cancelled \(cancelled\)/);
});

void test('an earlier saved delegation interrupt and unsent hand-off survive the migration', {timeout: 30_000}, async context => {
  let operationId: string | undefined;
  const options: CompanionsOptions = {
    delegate: data => {
      operationId = data.requestId;
      return Promise.resolve({status: 'waiting', requestId: data.requestId});
    },
  };
  const w = await world(context, options);
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.enable()).status, 'accepted');
  assert.equal((await w.send('bunny', 'Synthetic pre-change job')).status, 'accepted');
  await w.approved('bunny');
  await settle(() => w.task('bunny')?.status === 'waiting' && w.task('bunny')?.questionId?.includes('-delegation-') === true);
  const taskId = w.task('bunny')?.taskId ?? assert.fail('legacy task');
  assert.ok(operationId !== undefined);
  new CodingStore(w.database()).wait({operationId, taskId, companion: 'bunny', repository: 'agent-device-hub', brief: 'Synthetic bunny brief.',
    traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'});
  delete options.delegate;
  await w.restart();
  assert.equal(w.starts().length, 0);
  assert.equal(w.task('bunny')?.status, 'waiting');
  assert.deepEqual(w.coding().waiting, [{operationId, taskId, companion: 'bunny'}]);
  const db = w.database();
  let sentAttempts = 0, resultAttempts = 0, markAttempts = 0;
  db.function('fail_legacy_sent', () => {sentAttempts += 1; return sentAttempts === 1 ? 1 : 0;});
  db.function('fail_legacy_result', () => {resultAttempts += 1; return resultAttempts === 1 ? 1 : 0;});
  db.function('fail_legacy_mark', () => {markAttempts += 1; return markAttempts === 1 ? 1 : 0;});
  db.exec(`CREATE TEMP TRIGGER fail_legacy_sent BEFORE INSERT ON assistant_messages
    WHEN NEW.id LIKE '%-delegation-%-sent' AND fail_legacy_sent()=1 BEGIN SELECT RAISE(ABORT, 'synthetic legacy sent copy failure'); END;
    CREATE TEMP TRIGGER fail_legacy_result BEFORE UPDATE ON assistant_tasks
    WHEN json_extract(NEW.record, '$.question.answer') LIKE '%Synthetic pre-change result%' AND fail_legacy_result()=1
    BEGIN SELECT RAISE(ABORT, 'synthetic legacy result copy failure'); END;
    CREATE TEMP TRIGGER fail_legacy_mark BEFORE UPDATE OF delivered ON companion_coding_job_updates
    WHEN NEW.kind='result' AND fail_legacy_mark()=1 BEGIN SELECT RAISE(ABORT, 'synthetic legacy marker failure'); END`);
  assert.equal((await w.enable()).status, 'accepted');
  await settle(() => sentAttempts === 1);
  await settle(() => w.starts().length === 1);
  assert.equal(w.starts()[0]?.data.operationId, operationId);
  w.advance(1000);
  await w.waitMessages('bunny', /Delegated to the coding worker/);
  await w.progress({operationId, status: 'started'});
  await settle(() => w.coding().active?.status === 'started');
  await w.progress({operationId, status: 'completed', result: result('Synthetic pre-change result.')});
  await settle(() => resultAttempts === 1);
  assert.equal(w.task('bunny')?.hasAnswer, false);
  w.advance(1000);
  await settle(() => markAttempts === 1);
  await w.waitMessages('bunny', /Synthetic pre-change result/);
  await settle(() => w.task('bunny')?.status === 'succeeded');
  w.advance(2000);
  await settle(() => new CodingStore(db).undelivered(operationId).length === 0);
  assert.equal((await w.messages('bunny')).filter(message => message.role === 'tool' && message.text.includes('Synthetic pre-change result')).length, 1);
  assert.deepEqual(w.dispatched, [operationId]);
});


for (const previous of ['sending', 'running'] as const) {
  void test(`recovery of a legacy ${previous} delegation retains uncertainty across a failed conversation write`, {timeout: 30_000}, async context => {
    let operationId: string | undefined;
    const options: CompanionsOptions = {delegate: data => {
      operationId = data.requestId;
      return Promise.resolve({status: 'waiting', requestId: data.requestId});
    }};
    const w = await world(context, options);
    assert.equal((await w.control('enable')).status, 'accepted');
    assert.equal((await w.enable()).status, 'accepted');
    assert.equal((await w.send('bunny', 'Synthetic recovered legacy job')).status, 'accepted');
    await w.approved('bunny');
    await settle(() => w.task('bunny')?.status === 'waiting' && w.task('bunny')?.questionId?.includes('-delegation-') === true);
    const taskId = w.task('bunny')?.taskId ?? assert.fail('legacy task');
    assert.ok(operationId !== undefined);
    const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    const store = new CodingStore(w.database());
    if (previous === 'sending') {
      store.wait({operationId, taskId, companion: 'bunny', repository: 'agent-device-hub', brief: 'Synthetic prior brief.', traceparent});
      store.sending(operationId);
    } else {
      store.accept({operationId, taskId, endpointId: ENDPOINT, traceparent});
      store.started(operationId);
    }
    w.database().exec(`CREATE TRIGGER fail_legacy_recovery BEFORE UPDATE ON assistant_tasks
      WHEN json_extract(NEW.record, '$.question.answer') LIKE 'uncertain (lost)%'
      BEGIN SELECT RAISE(ABORT, 'synthetic recovery copy failure'); END`);
    delete options.delegate;
    await w.restart();
    const reopened = w.database();
    assert.ok(new CodingStore(reopened).resultSaved(operationId));
    assert.equal(w.task('bunny')?.hasAnswer, false);
    reopened.exec('DROP TRIGGER fail_legacy_recovery');
    w.advance(1000);
    await settle(() => w.task('bunny')?.hasAnswer === true);
    assert.equal(w.task('bunny')?.status, 'paused', 'startup delivery keeps the original graph paused');
    assert.equal((await w.enable()).status, 'accepted');
    assert.deepEqual(w.dispatched, []);
    assert.deepEqual(w.starts(), []);
  });
}

void test('a failed terminal commit retries the first evidence without sending another worker command', {timeout: 30_000}, async context => {
  const w = await world(context);
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.enable()).status, 'accepted');
  assert.equal((await w.send('bunny', 'Synthetic persistence job')).status, 'accepted');
  await w.approved('bunny');
  await settle(() => w.starts().length === 1);
  const operationId = w.starts()[0]?.data.operationId ?? assert.fail('attempt');
  const db = w.database();
  await w.progress({operationId, status: 'started'});
  await settle(() => w.coding().active?.status === 'started');
  let failures = 0;
  db.function('fail_first_result', () => {failures += 1; return failures === 1 ? 1 : 0;});
  db.exec(`CREATE TEMP TRIGGER fail_result BEFORE INSERT ON companion_coding_job_updates
    WHEN NEW.kind='result' AND fail_first_result()=1 BEGIN SELECT RAISE(ABORT,'synthetic result insert failure'); END`);
  await w.progress({operationId, status: 'completed', result: result('Synthetic first saved completion.')});
  await settle(() => failures === 1);
  assert.equal(w.coding().active?.operationId, operationId);
  await w.progress({operationId, status: 'failed', reason: 'refused', result: result('Synthetic conflicting later evidence.')});
  w.advance(1000);
  const saved = await w.waitMessages('bunny', /Synthetic first saved completion/);
  assert.doesNotMatch(JSON.stringify(saved), /Synthetic conflicting later evidence/);
  assert.equal(w.starts().length, 1);
  await w.restart();
  assert.equal((await w.messages('bunny')).filter(message => message.id === `${operationId}-job-result`).length, 1);
});

void test('a dispatch refusal survives failed result persistence without resending the attempt', {timeout: 30_000}, async context => {
  const w = await world(context);
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.enable()).status, 'accepted');
  w.refuseDispatch();
  const db = w.database();
  let attempts = 0;
  db.function('fail_refusal_save', () => {attempts += 1; return attempts === 1 ? 1 : 0;});
  db.exec(`CREATE TEMP TRIGGER fail_refusal_save BEFORE INSERT ON companion_coding_job_updates
    WHEN NEW.kind='result' AND fail_refusal_save()=1 BEGIN SELECT RAISE(ABORT,'synthetic refusal insert failure'); END`);
  assert.equal((await w.send('bunny', 'Synthetic refused job')).status, 'accepted');
  await w.approved('bunny');
  await settle(() => attempts === 1);
  const operationId = w.dispatched[0] ?? assert.fail('attempt');
  assert.equal(w.coding().waiting?.[0]?.operationId, operationId);
  w.advance(1000);
  await w.waitMessages('bunny', /failed \(refused: unavailable\)/);
  assert.equal(w.coding().waiting?.length, 0);
  await w.restart();
  assert.equal((await w.enable()).status, 'accepted');
  const saved = (await w.messages('bunny')).filter(message => message.id === `${operationId}-job-result`);
  assert.equal(saved.length, 1);
  assert.match(saved[0]?.text ?? '', /failed \(refused: unavailable\)/);
  assert.deepEqual(w.dispatched, [operationId]);
  assert.equal(w.starts().length, 0);
});

void test('a legacy accepted hand-off is delivered before a fast terminal result after a receipt insert fails', {timeout: 30_000}, async context => {
  let operationId: string | undefined;
  const options: CompanionsOptions = {delegate: data => {
    operationId = data.requestId;
    return Promise.resolve({status: 'waiting', requestId: data.requestId});
  }};
  const w = await world(context, options);
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.enable()).status, 'accepted');
  assert.equal((await w.send('bunny', 'Synthetic pre-upgrade hand-off')).status, 'accepted');
  await w.approved('bunny');
  await settle(() => w.task('bunny')?.status === 'waiting' && w.task('bunny')?.questionId?.includes('-delegation-') === true);
  assert.ok(operationId !== undefined);
  const taskId = w.task('bunny')?.taskId ?? assert.fail('legacy task');
  new CodingStore(w.database()).wait({operationId, taskId, companion: 'bunny', repository: 'agent-device-hub', brief: 'Synthetic bunny brief.',
    traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'});
  delete options.delegate;
  await w.restart();
  const db = w.database();
  let attempts = 0;
  db.function('fail_legacy_sent_save', () => {attempts += 1; return attempts === 1 ? 1 : 0;});
  db.exec(`CREATE TEMP TRIGGER fail_legacy_sent_save BEFORE INSERT ON companion_coding_job_updates
    WHEN NEW.kind='sent' AND fail_legacy_sent_save()=1 BEGIN SELECT RAISE(ABORT, 'synthetic legacy send receipt insert failure'); END`);
  assert.equal((await w.enable()).status, 'accepted');
  await settle(() => attempts === 1 && w.starts().length === 1);
  await w.progress({operationId, status: 'started'});
  await settle(() => w.coding().active?.status === 'started');
  await w.progress({operationId, status: 'completed', result: result('Synthetic fast legacy result.')});
  await w.waitMessages('bunny', /Synthetic fast legacy result/);
  w.advance(1000);
  const receipts = (await w.messages('bunny')).filter(message => message.id.includes('-delegation-') && /-(sent|result)$/.test(message.id));
  assert.deepEqual(receipts.map(message => message.id.split('-').at(-1)), ['sent', 'result']);
  assert.deepEqual(w.dispatched, [operationId]);
});

for (const restarted of [false, true]) {
  void test(`an accepted dispatch survives a failed receipt insert and ${restarted ? 'restart' : 'fast terminal progress'}`, {timeout: 30_000}, async context => {
    const w = await world(context);
    assert.equal((await w.control('enable')).status, 'accepted');
    assert.equal((await w.enable()).status, 'accepted');
    const db = w.database();
    let attempts = 0;
    db.function('fail_sent_save', () => {attempts += 1; return attempts === 1 ? 1 : 0;});
    db.exec(`CREATE TEMP TRIGGER fail_sent_save BEFORE INSERT ON companion_coding_job_updates
      WHEN NEW.kind='sent' AND fail_sent_save()=1 BEGIN SELECT RAISE(ABORT, 'synthetic send receipt insert failure'); END`);
    assert.equal((await w.send('bunny', 'Synthetic accepted dispatch')).status, 'accepted');
    await w.approved('bunny');
    await settle(() => attempts === 1 && w.starts().length === 1);
    const operationId = w.dispatched[0] ?? assert.fail('attempt');
    if (restarted) await w.restart();
    else {
      await w.progress({operationId, status: 'started'});
      await settle(() => w.coding().active?.status === 'started');
      await w.progress({operationId, status: 'completed', result: result('Synthetic fast result.')});
    }
    await w.waitMessages('bunny', restarted ? /uncertain \(lost\)/ : /Synthetic fast result/);
    w.advance(1000);
    const receipts = (await w.messages('bunny')).filter(message => message.id === `${operationId}-job-sent` || message.id === `${operationId}-job-result`);
    assert.deepEqual(receipts.map(message => message.id), [`${operationId}-job-sent`, `${operationId}-job-result`]);
    assert.deepEqual(w.dispatched, [operationId]);
    assert.equal(w.starts().length, 1);
  });
}

for (const sequence of ['restart', 'a repeated stop and a fast terminal result', 'local retry while the job runs'] as const) {
  void test(`a failed stop observation survives ${sequence}`, {timeout: 30_000}, async context => {
    const w = await world(context);
    assert.equal((await w.control('enable')).status, 'accepted');
    assert.equal((await w.enable()).status, 'accepted');
    assert.equal((await w.send('bunny', 'Synthetic stopped dispatch')).status, 'accepted');
    await w.approved('bunny');
    await w.waitMessages('bunny', /accepted the worker dispatch/);
    const operationId = w.dispatched[0] ?? assert.fail('attempt');
    const jobId = `${operationId}-job`;
    await w.progress({operationId, status: 'started'});
    await settle(() => w.coding().active?.status === 'started');
    const db = w.database();
    let attempts = 0;
    db.function('fail_stop_save', () => {attempts += 1; return attempts === 1 ? 1 : 0;});
    db.exec(`CREATE TEMP TRIGGER fail_stop_save BEFORE INSERT ON companion_coding_job_updates
      WHEN NEW.kind='stop-unconfirmed' AND fail_stop_save()=1 BEGIN SELECT RAISE(ABORT, 'synthetic stop receipt insert failure'); END`);
    assert.equal((await w.stop(jobId, operationId)).status, 'accepted');
    await settle(() => attempts === 1);
    assert.equal((await w.stop(jobId, operationId)).status, 'accepted');
    const restarted = sequence === 'restart';
    if (sequence === 'local retry while the job runs') {
      w.advance(1000);
      await w.waitMessages('bunny', /worker accepted the stop request.*unconfirmed/);
      assert.equal(w.coding().active?.status, 'cancelling');
    }
    if (restarted) await w.restart();
    else await w.progress({operationId, status: 'cancelled', reason: 'cancelled', result: result('Synthetic fast stop result.')});
    await w.waitMessages('bunny', restarted ? /uncertain \(lost\)/ : /Synthetic fast stop result/);
    w.advance(1000);
    const receipts = (await w.messages('bunny')).filter(message => message.id === `${jobId}-stop-unconfirmed` || message.id === `${jobId}-result`);
    assert.deepEqual(receipts.map(message => message.id), [`${jobId}-stop-unconfirmed`, `${jobId}-result`]);
    assert.match(receipts[0]?.text ?? '', restarted ? /A stop was requested.*unconfirmed/ : /worker accepted the stop request.*unconfirmed/);
    assert.deepEqual(w.work.filter(command => command.data.action === 'cancel').map(command => command.data.operationId), [operationId]);
    assert.deepEqual(w.dispatched, [operationId]);
  });
}

void test('a saved result retries original-exchange delivery and deduplicates after a failed delivery marker', {timeout: 30_000}, async context => {
  const w = await world(context);
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.enable()).status, 'accepted');
  assert.equal((await w.send('bunny', 'Synthetic result delivery job')).status, 'accepted');
  const conversation = w.task('bunny')?.conversationId ?? assert.fail('originating conversation');
  await w.approved('bunny');
  await settle(() => w.starts().length === 1);
  const operationId = w.starts()[0]?.data.operationId ?? assert.fail('attempt');
  const id = `${operationId}-job-result`;
  await w.waitMessages('bunny', /accepted the worker dispatch/);
  await settle(() => w.task('bunny')?.status === 'succeeded');
  assert.equal((await w.newConversation('bunny')).status, 'accepted');
  const db = w.database();
  const store = new CodingStore(db);
  let insertAttempts = 0, markAttempts = 0;
  db.function('fail_result_copy', () => {insertAttempts += 1; return insertAttempts === 1 ? 1 : 0;});
  db.function('fail_delivery_mark', () => {markAttempts += 1; return markAttempts === 1 ? 1 : 0;});
  db.exec(`CREATE TEMP TRIGGER fail_result_copy BEFORE INSERT ON assistant_messages
    WHEN NEW.id LIKE '%-job-result' AND fail_result_copy()=1 BEGIN SELECT RAISE(ABORT,'synthetic result copy failure'); END;
    CREATE TEMP TRIGGER fail_delivery_mark BEFORE UPDATE OF delivered ON companion_coding_job_updates
    WHEN NEW.kind='result' AND fail_delivery_mark()=1 BEGIN SELECT RAISE(ABORT,'synthetic delivered mark failure'); END`);
  await w.progress({operationId, status: 'started'});
  await settle(() => w.coding().active?.status === 'started');
  await w.progress({operationId, status: 'completed', result: result('Synthetic retried result delivery.')});
  await settle(() => insertAttempts === 1);
  assert.ok(store.resultSaved(operationId));
  assert.ok(!(await w.messages('bunny', conversation)).some(message => message.id === id));
  await w.progress({operationId, status: 'completed', result: result('Synthetic conflicting duplicate.')});
  w.advance(1000);
  await settle(() => markAttempts === 1);
  const saved = await w.waitMessages('bunny', /Synthetic retried result delivery/, conversation);
  assert.equal(saved.filter(message => message.id === id && message.follows === `${operationId}-job`).length, 1);
  assert.ok(!(await w.messages('bunny')).some(message => message.id === id));
  w.advance(2000);
  await settle(() => store.undelivered(operationId).length === 0);
  assert.equal(insertAttempts, 2);
  await w.restart();
  assert.equal((await w.enable()).status, 'accepted');
  assert.equal((await w.messages('bunny', conversation)).filter(message => message.id === id).length, 1);
  assert.deepEqual(w.dispatched, [operationId]);
  assert.equal(w.starts().length, 1);
});

void test('an interrupted dispatch restores the job receipt, reports uncertainty and never resends', {timeout: 30_000}, async context => {
  const w = await world(context);
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.enable()).status, 'accepted');
  const release = w.holdDispatch();
  try {
    assert.equal((await w.send('bunny', 'Synthetic ambiguous job')).status, 'accepted');
    await w.approved('bunny');
    await settle(() => w.dispatched.length === 1);
    const operationId = w.dispatched[0] ?? assert.fail('dispatch');
    const messages = await w.waitMessages('bunny', /Coding job .* was queued/);
    assert.ok(messages.some(message => message.id === `${operationId}-job`));
    assert.equal(w.starts().length, 0);
    await w.restart();
    const restored = await w.waitMessages('bunny', /uncertain \(lost\)/);
    assert.equal(restored.filter(message => message.id === `${operationId}-job`).length, 1);
    assert.ok(restored.some(message => message.id === `${operationId}-job-result` && message.follows === `${operationId}-job`));
    assert.ok(!restored.some(message => message.id === `${operationId}-job-sent`), 'an ambiguous start does not create an accepted receipt');
    assert.equal((await w.enable()).status, 'accepted');
    release();
    for (let turns = 0; turns < 20; turns += 1) await new Promise(resolve => {setImmediate(resolve);});
    assert.deepEqual(w.dispatched, [operationId]);
    assert.equal(w.starts().length, 0);
  } finally {release();}
});


void test('a failed job receipt rolls back job admission and prevents dispatch', {timeout: 30_000}, async context => {
  const w = await world(context);
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.enable()).status, 'accepted');
  assert.equal((await w.send('bunny', 'Synthetic job with failed receipt')).status, 'accepted');
  const db = w.database();
  let attempts = 0;
  db.function('reject_job_receipt', () => {attempts += 1; return 1;});
  db.exec(`CREATE TEMP TRIGGER fail_job_receipt BEFORE INSERT ON assistant_messages
    WHEN NEW.id LIKE '%-job' AND reject_job_receipt()=1 BEGIN SELECT RAISE(ABORT,'synthetic receipt insert failure'); END`);
  await w.approved('bunny');
  await settle(() => attempts === 1 && w.task('bunny')?.status === 'succeeded');
  assert.equal(db.prepare('SELECT job_id FROM companion_coding_jobs').get(), undefined);
  assert.equal(db.prepare('SELECT operation_id FROM companion_coding_waiting').get(), undefined);
  assert.equal(w.dispatched.length, 0);
  assert.doesNotMatch(JSON.stringify(await w.messages('bunny')), /was queued/);
  await w.restart();
  assert.equal((await w.enable()).status, 'accepted');
  assert.equal(w.dispatched.length, 0);
});


void test('Responses hands off to the shared background job without sending private worker results back to OpenAI', {timeout: 30_000}, async context => {
  const sent: string[] = [];
  const provider = new OpenAIProvider({model: OPENAI_MODEL, effort: 'medium', key: 'synthetic', transport: (_url, init) => {
    sent.push(init.body);
    const output = sent.length === 1 ? [{type: 'function_call', id: 'fc_work', call_id: 'call_work', name: 'delegate_coding',
      arguments: JSON.stringify({repository: 'agent-device-hub', brief: 'Write a synthetic fixture.'})}]
      : [{type: 'message', id: 'msg_done', role: 'assistant', status: 'completed', content: [{type: 'output_text', text: 'New request answered.', annotations: []}]}];
    return Promise.resolve(new Response(JSON.stringify({status: 'completed', output,
      usage: {input_tokens: 40, output_tokens: 40, input_tokens_details: {cached_tokens: 0}, output_tokens_details: {reasoning_tokens: 0}}})));
  }});
  const w = await world(context, {provider});
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.enable(3)).status, 'accepted');
  assert.equal((await w.send('bunny', 'Delegate a coding job to write a synthetic fixture in agent-device-hub.')).status, 'accepted');
  await w.approved('bunny');
  await settle(() => w.starts().length === 1 && w.task('bunny')?.status === 'succeeded');
  const origin = w.task('bunny')?.conversationId ?? assert.fail('origin conversation');
  assert.equal(sent.length, 1);
  assert.equal((await w.newConversation('bunny')).status, 'accepted');
  assert.equal((await w.send('bunny', 'New unrelated request.')).status, 'accepted');
  await settle(() => w.task('bunny')?.conversationId !== origin && w.task('bunny')?.status === 'succeeded');
  const operationId = w.starts()[0]?.data.operationId;
  await w.progress({operationId, status: 'started'});
  await w.progress({operationId, status: 'completed', result: result('PRIVATE_WORKER_RESULT')});
  await w.waitMessages('bunny', /PRIVATE_WORKER_RESULT/, origin);
  assert.equal(sent.length, 2);
  const second = JSON.parse(sent[1] ?? '') as {input: unknown};
  assert.deepEqual(second.input, [{role: 'user', content: 'New unrelated request.'}]);
  assert.equal(w.dispatched.length, 1);
});

void test('an uncapped attempt uses observed setup deadlines without timing out a ready sibling', {timeout: 30_000}, async context => {
  const w = await world(context);
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.enable('uncapped')).status, 'accepted');
  for (const profile of ['bunny', 'reachy'] as const) {
    assert.equal((await w.send(profile, 'Synthetic setup-bound job')).status, 'accepted');
    await w.approved(profile);
  }
  await settle(() => w.starts().length === 2);
  const waiting = w.starts()[0]?.data.operationId ?? assert.fail('waiting attempt');
  const ready = w.starts()[1]?.data.operationId ?? assert.fail('ready attempt');
  const setup = async (operationId: string, phase: string): Promise<void> => {
    await w.progress({operationId, status: 'started', setup: phase}, '2.3');
    await new Promise(resolve => {setImmediate(resolve);});
  };
  await setup(waiting, 'waiting');
  await setup(ready, 'ready');
  await settle(() => w.coding().runs?.filter(run => run.setup !== undefined).length === 2);
  for (let repeats = 0; repeats < 3; repeats += 1) {
    w.advance(30_000);
    await setup(waiting, 'waiting');
  }
  assert.equal(w.coding().runs?.length, 2);
  await setup(waiting, 'running');
  await settle(() => w.coding().runs?.find(run => run.operationId === waiting)?.setup === 'running');
  w.advance(260_000);
  await setup(waiting, 'running');
  w.advance(11_000);
  await w.waitMessages('bunny', /uncertain \(timeout\)/);
  assert.equal(w.coding().runs?.find(run => run.operationId === ready)?.setup, 'ready');
  await w.progress({operationId: ready, status: 'completed', result: result('Synthetic ready sibling result.')}, '2.3');
  await w.waitMessages('reachy', /Synthetic ready sibling result/);
});


for (const [origin, destination] of [['codex', 'claude-code'], ['claude-code', 'codex']] as const)
void test(`an owner-approved Auto job runs on ${origin} and explicitly continues on ${destination}`, {timeout: 30_000}, async context => {
  const brief = 'Exact owner-approved brief. ' + 'x'.repeat(4096 - 'Exact owner-approved brief. '.length);
  const inputs: TurnInput[] = [], titlePrompts: string[] = [];
  let denyBrief: 'private-conversation' | 'coding-worker' | undefined;
  const delegate = delegating('bunny', brief);
  const permitted = sharing();
  const share = Object.assign((query: ShareQuery) => permitted(query) && !revoked.some(rule => rule(query)) &&
    !(query.destination === denyBrief && query.source === 'coding' && query.field === 'brief'),
    {revokesFields: true, allowsDerived: (query: ShareQuery) => permitted.allowsDerived?.(query) !== false});
  const revoked: ((query: ShareQuery) => boolean)[] = [];
  const w = await world(context, {share,
    syntheticTitleProvider: {name: 'synthetic', model: 'synthetic', title: prompt => {
      titlePrompts.push(prompt);
      return Promise.resolve({text: 'KEEP', usage: null});
    }},
    provider: {...delegate, turn: (input, signal) => {
      inputs.push(input);
      if (input.transcript.some(item => item.role === 'owner' && item.text === 'Synthetic pre-revocation message')) {
        return Promise.resolve({text: 'Synthetic response based on the continuation.', calls: [], stop: 'end', units: 10});
      }
      if (input.transcript.some(item => item.role === 'owner' && item.text.startsWith('Synthetic replay after '))) {
        return Promise.resolve({text: 'Synthetic replay complete.', calls: [], stop: 'end', units: 10});
      }
      return delegate.turn(input, signal);
    }},
  });
  const claude: CodingHarnessReadiness = {harness: 'claude-code', installed: 'yes', signedIn: 'yes', plan: 'max', version: '2.0',
    limits: null, limitsObservedAtMs: null, checkedAtMs: 1, capabilities: {steering: 'unsupported', resume: 'unsupported', review: true}};
  const codex: CodingHarnessReadiness = {...claude, harness: 'codex', plan: 'plus', capabilities: {...claude.capabilities, steering: 'live'}};
  const exhausted: CodingHarnessReadiness = {...claude, limits: [{window: 'primary', status: 'rejected', resetsAtMs: null, utilization: null}]};
  const initialSession = `native-${origin}`, resumedSession = `native-${destination}`;
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.enable('uncapped', [origin === 'codex' ? exhausted : claude, codex])).status, 'accepted');
  assert.equal((await w.send('bunny', 'Synthetic partially edited coding task')).status, 'accepted');
  await w.approved('bunny');
  await settle(() => w.starts().length === 1);
  const initial = w.starts()[0]?.data;
  assert.ok(initial?.action === 'start' && initial.harness === origin);
  const {operationId} = initial, jobId = `${operationId}-job`;
  if (origin === 'codex') assert.match((await w.jobDetail(jobId)).attempts[0]?.selectionReason ?? '', /Claude Code quota exhausted \(reset unknown\)/);
  assert.equal((await w.continueJob(jobId, operationId, destination)).status, 'rejected');
  await w.progress({operationId, status: 'started', setup: 'ready', harness: origin, sessionId: initialSession}, '2.3');
  await settle(() => w.coding().runs?.some(run => run.sessionId === initialSession && run.status === 'started') === true);
  await w.progress({operationId, status: 'attempt-context', worktreeRef: 'bunny-fixture-partial', branch: null, model: 'fixture-reported-model'}, '2.5');
  if (origin === 'codex') {
    const message = await w.message(jobId, operationId, 'Keep the fixture intact.', true);
    assert.equal(message.status, 'accepted', JSON.stringify(message));
    await settle(() => w.work.filter(command => command.data.action === 'message').length === 1);
    await w.progress({operationId, messageId: message.requestId, sessionId: 'wrong-session', status: 'message-observed'}, '2.5');
    assert.equal((await w.jobs({jobId})).jobs[0]?.messages?.[0]?.observed, false);
    await w.progress({operationId, messageId: message.requestId, sessionId: initialSession, status: 'message-observed'}, '2.5');
    await settle(() => w.database().prepare('SELECT observed FROM companion_coding_job_messages WHERE message_id=?').get(message.requestId)?.observed === 1);
    assert.equal((await w.jobs({jobId})).jobs[0]?.messages?.[0]?.observed, true);
  } else {
    const unsupported = await w.message(jobId, operationId, 'Never message this unsupported harness.');
    assert.equal(unsupported.status, 'rejected');
    if (unsupported.status === 'rejected') assert.equal(unsupported.error.error.code, 'unsupported-capability');
    assert.equal(w.work.filter(command => command.data.action === 'message').length, 0);
  }
  assert.equal((await w.stop(jobId, operationId)).status, 'accepted');
  const head = 'a'.repeat(40);
  const stopped = {...result('Synthetic partial work.'), head, changedFiles: ['partial.txt', '/synthetic/absolute', 'C:/synthetic/absolute'], checks: [{name: 'git diff', status: 'passed'}]};
  const handoffToken = randomUUID();
  await w.progress({operationId, status: 'cancelled', reason: 'cancelled', harness: origin, sessionId: initialSession, result: stopped, handoffToken}, '2.4');
  await w.waitMessages('bunny', /Synthetic partial work/);
  assert.equal((await w.enable('uncapped', [claude, codex])).status, 'accepted');
  const ready = await w.jobDetail(jobId);
  assert.deepEqual(ready.continuation, {fromOperationId: operationId, harness: destination, head, changedFiles: ['partial.txt']});
  assert.equal(ready.continuationReason, undefined);
  for (const destinationGrant of ['private-conversation', 'coding-worker'] as const) {
    denyBrief = destinationGrant;
    const denied = await w.jobDetail(jobId);
    assert.equal(denied.continuation, null);
    assert.match(denied.continuationReason ?? '', /brief sharing is not permitted/);
    const refused = await w.continueJob(jobId, operationId, destination);
    assert.equal(refused.status, 'rejected');
    if (refused.status === 'rejected') assert.equal(refused.error.error.code, 'forbidden');
    assert.deepEqual((await w.jobDetail(jobId)).attempts.map(attempt => attempt.operationId), [operationId]);
    assert.equal(w.starts().length, 1);
  }
  denyBrief = undefined;
  assert.deepEqual((await w.jobDetail(jobId)).continuation, ready.continuation);

  const requestId = randomUUID();
  assert.equal((await w.continueJob(jobId, operationId, destination, requestId)).status, 'accepted');
  assert.equal((await w.continueJob(jobId, operationId, destination, requestId)).status, 'accepted');
  await settle(() => w.starts().length === 2);
  const resumed = w.starts()[1]?.data;
  assert.ok(resumed?.action === 'start' && resumed.harness === destination);
  assert.deepEqual(resumed.continuation, {fromOperationId: operationId, token: handoffToken});
  assert.equal(resumed.brief, brief);
  assert.doesNotMatch(resumed.brief, /native-|Synthetic partial work/);
  assert.equal((await w.jobDetail(jobId)).activeOperationId, resumed.operationId);
  assert.equal((await w.jobs({jobId})).jobs[0]?.operationId, resumed.operationId);
  const stale = await w.message(jobId, operationId, 'Never reach a replacement attempt.');
  assert.equal(stale.status, 'rejected');
  if (stale.status === 'rejected') assert.equal(stale.error.error.code, 'revision-conflict');
  assert.deepEqual((await w.jobDetail(jobId)).attempts[0]?.context, {
    worktreeRef: 'bunny-fixture-partial', branch: null, model: 'fixture-reported-model',
  });
  assert.equal((await w.continueJob(jobId, operationId, destination)).status, 'rejected');
  await w.progress({operationId: resumed.operationId, status: 'started', setup: 'ready', harness: destination, sessionId: resumedSession}, '2.3');
  const scope = (query: ShareQuery) => query.destination === 'private-conversation' &&
    query.source === 'coding' && query.field === 'details' && query.record === jobId;
  const db = w.database();
  const removeAttempt = () =>
    assert.equal(db.prepare('DELETE FROM companion_coding_attempts WHERE operation_id=?').run(resumed.operationId).changes, 1);
  const assertHiddenRun = () => {
    const state = w.coding();
    assert.deepEqual(state.runs, []);
    assert.equal(state.active, null);
    assert.equal(state.counts?.runs, 0);
    assert.ok(!JSON.stringify(state).includes(resumedSession));
  };
  await settle(() => w.coding().runs?.some(run => run.sessionId === resumedSession) === true);
  revoked.push(scope);
  assertHiddenRun();
  db.exec('SAVEPOINT missing_attempt');
  try {
    removeAttempt();
    assertHiddenRun();
  } finally {
    db.exec('ROLLBACK TO missing_attempt; RELEASE missing_attempt');
  }
  assertHiddenRun();
  revoked.pop();
  assert.equal(w.coding().runs?.[0]?.sessionId, resumedSession);

  const deniesAttempt = (query: ShareQuery) => query.source === 'coding' && query.field === 'details' && query.record === resumed.operationId;
  revoked.push(query => deniesAttempt(query) && query.purpose === 'title');
  await w.progress({operationId: resumed.operationId, status: 'completed', harness: destination,
    result: {...result('Synthetic continued work.'), head, changedFiles: ['partial.txt'], checks: [{name: 'unit test', status: 'passed'}]}}, '2.3');
  await w.waitMessages('bunny', /Synthetic continued work/);
  const detail = await w.jobDetail(jobId);
  assert.equal(detail.activeOperationId, null);
  assert.equal(detail.continuation, null);
  assert.match(detail.continuationReason ?? '', /previous attempt completed without a partial result/);
  assert.equal((await w.continueJob(jobId, resumed.operationId, origin)).status, 'rejected');
  assert.equal(w.starts().length, 2);
  assert.deepEqual(detail.attempts.map(attempt => [attempt.operationId, attempt.harness, attempt.sessionId, attempt.status, attempt.result?.checks[0]?.name]), [
    [operationId, origin, initialSession, 'cancelled', 'git diff'],
    [resumed.operationId, destination, resumedSession, 'completed', 'unit test'],
  ]);
  const assertCard = async (): Promise<void> => {
    const card = (await w.jobs({jobId, scope: 'all'})).jobs[0];
    assert.deepEqual([card?.operationId, card?.status, card?.harness, card?.sessionId],
      [resumed.operationId, 'completed', destination, resumedSession]);
  };
  await assertCard();
  await w.restart();
  await assertCard();
  assert.doesNotMatch(JSON.stringify(detail), new RegExp(handoffToken));

  const conversation = w.task('bunny')?.conversationId ?? assert.fail('saved job conversation');
  const resultText = /Synthetic continued work/u, originalText = /Synthetic partial work/u;
  assert.equal((await w.send('bunny', 'Synthetic pre-revocation message')).status, 'accepted');
  await w.waitMessages('bunny', /Synthetic response based on the continuation/u, conversation);
  assert.match(JSON.stringify(inputs.at(-1)), resultText, 'the current model can receive the granted attempt');
  await settle(() => titlePrompts.some(prompt => prompt.includes('Synthetic pre-revocation message')));
  assert.match(titlePrompts.join('\n'), /hand-off's result arrived: cancelled/u);
  assert.doesNotMatch(titlePrompts.join('\n'), /hand-off's result arrived: completed|Synthetic continued work/u);
  revoked.pop();
  for (const [source, field, record] of [
    ['coding', 'repository', 'agent-device-hub'],
    ['conversation', 'details', initial.taskId],
    ['coding', 'details', jobId],
    ['coding', 'details', operationId],
    ['coding', 'details', resumed.operationId],
  ] as const) {
    revoked.push(query => query.source === source && query.field === field && query.record === record);
    const recent = JSON.stringify(await w.messages('bunny', conversation));
    assert.doesNotMatch(recent, resultText, `revoked ${source}/${field} in recent Conversation`);
    assert.doesNotMatch(JSON.stringify(await w.messages('bunny')), resultText);
    const denied = await w.module().manifest.content?.('coding-job', {query: {jobId}, signal: new AbortController().signal});
    assert.deepEqual(denied, errorBody('not-found'));
    assert.deepEqual((await w.jobs({jobId, scope: 'all'})).jobs, []);
    if (record === resumed.operationId) assert.match(recent, originalText, 'the first attempt keeps its own grant');
    revoked.pop();
  }

  revoked.push(query => deniesAttempt(query) && query.destination === 'private-conversation');
  await w.restart();
  const restarted = JSON.stringify(await w.messages('bunny', conversation));
  assert.doesNotMatch(restarted, resultText);
  assert.doesNotMatch(restarted, /Synthetic response based on the continuation/u);
  revoked.pop();
  const promptAfterRestart = async (pattern: RegExp, kept: RegExp, label: string) => {
    await w.restart();
    const message = `Synthetic replay after ${label}`;
    assert.equal((await w.send('bunny', message)).status, 'accepted');
    await settle(() => inputs.some(input => input.transcript.some(item => item.role === 'owner' && item.text === message)), label);
    const next = inputs.find(input => input.transcript.some(item => item.role === 'owner' && item.text === message));
    assert.doesNotMatch(JSON.stringify(next), pattern);
    assert.doesNotMatch(JSON.stringify(next), /Synthetic response based on the continuation/u);
    assert.match(JSON.stringify(next), kept);
    await settle(() => w.task('bunny')?.status === 'succeeded', label);
  };
  for (const purpose of ['read', 'prompt'] as const) {
    revoked.push(query => query.destination === 'synthetic' && query.purpose === purpose &&
      query.source === 'conversation' && query.field === 'text' && query.record === `${resumed.operationId}-result`);
    assert.match(JSON.stringify(await w.messages('bunny', conversation)), resultText, 'the private destination still has its own grant');
    await promptAfterRestart(resultText, originalText, `the continuation message lost ${purpose}`);
    revoked.pop();
  }
  revoked.push(query => query.destination === 'synthetic' && query.purpose === 'read' &&
    query.source === 'conversation' && query.field === 'text' && query.record === `${jobId}-result`);
  await promptAfterRestart(originalText, resultText, 'the original result lost read');
  revoked.pop();
  for (const purpose of ['read', 'prompt'] as const) {
    revoked.push(query => deniesAttempt(query) && query.destination === 'synthetic' && query.purpose === purpose);
    await promptAfterRestart(resultText, originalText, `the continuation attempt lost ${purpose}`);
    revoked.pop();
  }

  // The saved association is required even if all grants currently allow the attempt.
  assert.equal(w.database().prepare("DELETE FROM companion_coding_job_updates WHERE operation_id=? AND kind='result'").run(resumed.operationId).changes, 1);
  const missingSource = /Synthetic continued work|Synthetic response based on the continuation/u;
  assert.doesNotMatch(JSON.stringify(await w.messages('bunny', conversation)), missingSource);
  await promptAfterRestart(resultText, originalText, 'the continuation update disappeared');
  share.revokesFields = false;
  assert.doesNotMatch(JSON.stringify(await w.messages('bunny', conversation)), missingSource);

  // An unsent wait survives restart even when its saved attempt is unavailable.
  const restartedDb = w.database();
  new CodingStore(restartedDb).wait({operationId: resumed.operationId, taskId: initial.taskId, companion: 'bunny',
    repository: initial.repository, brief, traceparent: w.starts()[1]?.traceparent ?? assert.fail('second dispatch trace')});
  assert.equal(restartedDb.prepare('DELETE FROM companion_coding_attempts WHERE operation_id=?').run(resumed.operationId).changes, 1);
  revoked.push(scope);
  await w.restart();
  assert.ok(w.database().prepare('SELECT 1 FROM companion_coding_waiting WHERE operation_id=?').get(resumed.operationId));
  const state = w.coding();
  assert.deepEqual(state.waiting, []);
  assert.equal(state.counts?.waiting ?? 0, 0);
  assert.ok(!JSON.stringify(state).includes(resumed.operationId));
});


void test('Jobs read grants filter discovery, detail and live counts before projecting names', {timeout: 30_000}, async context => {
  const policy = sharing();
  let hiddenOperation: string | undefined, hideBrief = false;
  const share = Object.assign((query: ShareQuery) => policy(query) &&
    !(query.destination === 'private-conversation' && query.source === 'coding' &&
      (query.record === hiddenOperation && hiddenOperation !== undefined || hideBrief && query.field === 'brief')),
    {revokesFields: true, allowsDerived: (query: ShareQuery) => policy.allowsDerived?.(query) !== false});
  const w = await world(context, {share});
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.enable('uncapped')).status, 'accepted');
  for (const profile of ['bunny', 'reachy'] as const) {
    assert.equal((await w.send(profile, 'Synthetic private job')).status, 'accepted');
    await w.approved(profile);
  }
  await settle(() => w.starts().length === 2);
  const first = w.starts()[0]?.data.operationId ?? assert.fail('first operation');
  const second = w.starts()[1]?.data.operationId ?? assert.fail('second operation');
  assert.equal((await w.jobs({scope: 'all'})).jobs.length, 2);
  hiddenOperation = first;
  hideBrief = true;
  const listed = await w.jobs({scope: 'all'});
  assert.deepEqual(listed.jobs.map(job => [job.operationId, job.label]), [[second, undefined]]);
  assert.equal(listed.next, null);
  assert.equal(w.coding().counts?.runs, 1);
  assert.deepEqual((await w.jobs({target: 'Synthetic reachy brief'})).jobs, []);
  assert.deepEqual((await w.jobs({jobId: `${first}-job`})).jobs, []);
  const restricted = await w.module().manifest.content?.('coding-job', {query: {jobId: `${first}-job`}, signal: new AbortController().signal});
  assert.ok(restricted !== undefined && 'error' in restricted && restricted.error.code === 'not-found');
});

for (const scenario of ['codex-exhausted', 'claude-pinned', 'both-exhausted'] as const) {
  void test(`owner-approved harness selection preserves quota refusals (${scenario})`, {timeout: 30_000}, async context => {
    const w = await world(context);
    const healthy: CodingHarnessReadiness = {harness: 'claude-code', installed: 'yes', signedIn: 'yes', plan: 'max', version: '2.0',
      limits: null, limitsObservedAtMs: null, checkedAtMs: 1, capabilities: {steering: 'unsupported', resume: 'unsupported', review: true}};
    const blocked = (harness: string): CodingHarnessReadiness => ({...healthy, harness,
      limits: [{window: 'primary', status: 'rejected', resetsAtMs: null, utilization: null}]});
    const codex = scenario === 'claude-pinned' ? {...healthy, harness: 'codex'} : blocked('codex');
    assert.equal((await w.control('enable')).status, 'accepted');
    assert.equal((await w.enable('uncapped', [scenario === 'codex-exhausted' ? healthy : blocked('claude-code'), codex])).status, 'accepted');
    assert.equal((await w.send('bunny', 'Synthetic quota selection request.')).status, 'accepted');
    await w.approved('bunny', scenario === 'claude-pinned' ? 'claude-code' : 'auto');
    if (scenario === 'codex-exhausted') {
      await settle(() => w.starts().length === 1);
      const work = w.starts()[0]?.data;
      assert.ok(work?.action === 'start' && work.harness === 'claude-code');
      return;
    }
    await w.waitMessages('bunny', /Claude Code quota exhausted/);
    assert.deepEqual(w.dispatched, []);
    assert.deepEqual(w.starts(), []);
  });
}


for (const originalGrant of ['granted', 'revoked'] as const) {
  void test(`a Responses-approved cross-harness continuation rechecks the ${originalGrant} originating request`, {timeout: 30_000}, async context => {
    const requests: string[] = [];
    const brief = 'Write a synthetic continuation fixture.';
    const provider = new OpenAIProvider({model: OPENAI_MODEL, effort: 'medium', key: 'synthetic', transport: (_url, init) => {
      requests.push(init.body);
      const output = requests.length === 1
        ? [{type: 'function_call', id: 'fc_origin', call_id: 'call_origin', name: 'delegate_coding',
          arguments: JSON.stringify({repository: 'agent-device-hub', brief})}]
        : [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: 'Synthetic Responses follow-up complete.'}]}];
      return Promise.resolve(new Response(JSON.stringify({status: 'completed', output, usage: {input_tokens: 30, output_tokens: 10}})));
    }});
    const ordinary = sharing();
    let revokedRequest: string | undefined;
    const share = Object.assign((query: ShareQuery) => ordinary(query) && !(revokedRequest !== undefined &&
      query.destination === 'external-model' && query.field === 'request' && query.record === revokedRequest),
    {revokesFields: true, allowsDerived: (query: ShareQuery) => ordinary.allowsDerived?.(query) !== false});
    const w = await world(context, {provider, share});
    const claude: CodingHarnessReadiness = {harness: 'claude-code', installed: 'yes', signedIn: 'yes', plan: 'max', version: '2.0',
      limits: null, limitsObservedAtMs: null, checkedAtMs: 1, capabilities: {steering: 'unsupported', resume: 'unsupported', review: true}};
    const codex: CodingHarnessReadiness = {...claude, harness: 'codex', plan: 'plus'};
    assert.equal((await w.control('enable')).status, 'accepted');
    assert.equal((await w.enable('uncapped', [claude, codex])).status, 'accepted');
    assert.equal((await w.send('bunny', 'Delegate a synthetic coding fixture.')).status, 'accepted');
    await w.approved('bunny', 'claude-code');
    await settle(() => w.starts().length === 1 && w.task('bunny')?.status === 'succeeded');
    const first = w.starts()[0]?.data;
    assert.ok(first?.action === 'start' && first.harness === 'claude-code');
    const {operationId, taskId} = first, jobId = `${operationId}-job`;
    const sessionId = 'synthetic-claude-session', handoffToken = randomUUID();
    await w.progress({operationId, status: 'started', setup: 'ready', harness: 'claude-code', sessionId}, '2.3');
    await settle(() => w.coding().runs?.some(run => run.sessionId === sessionId) === true);
    assert.equal((await w.stop(jobId, operationId)).status, 'accepted');
    await w.progress({operationId, status: 'cancelled', reason: 'cancelled', harness: 'claude-code', sessionId, handoffToken,
      result: {...result('Private synthetic source result.'), changedFiles: ['fixture.txt']}}, '2.4');
    await w.waitMessages('bunny', /Private synthetic source result/u);
    if (originalGrant === 'revoked') revokedRequest = `${taskId}-prompt`;
    const detail = await w.jobDetail(jobId);
    const continuation = await w.continueJob(jobId, operationId, 'codex');
    if (originalGrant === 'granted') {
      assert.equal(detail.continuation?.harness, 'codex');
      assert.equal(continuation.status, 'accepted');
      await settle(() => w.starts().length === 2);
      const resumed = w.starts()[1]?.data;
      assert.ok(resumed?.action === 'start' && resumed.harness === 'codex');
      assert.equal(resumed.brief, brief);
      await w.progress({operationId: resumed.operationId, status: 'completed', harness: 'codex', result: result('Private synthetic continuation result.')}, '2.3');
      await w.waitMessages('bunny', /Private synthetic continuation result/u);
    } else {
      assert.equal(detail.continuation, null);
      assert.equal(continuation.status === 'rejected' && continuation.error.error.code, 'forbidden');
      assert.equal((await w.jobDetail(jobId)).attempts.length, 1);
      assert.equal(w.starts().length, 1);
      assert.equal(w.dispatched.length, 1);
    }
    assert.equal(requests.length, 1, 'continuation does not rerun the original supervisor');
    await w.restart();
    assert.equal((await w.send('bunny', 'Check another synthetic question.')).status, 'accepted');
    await settle(() => requests.length === 2 && w.task('bunny')?.status === 'succeeded');
    assert.match(requests[1] ?? '', /Check another synthetic question/u);
    assert.doesNotMatch(requests[1] ?? '', /Private synthetic (source|continuation) result|synthetic-claude-session|fixture\.txt/u);
    assert.ok(!(requests[1] ?? '').includes(handoffToken));
  });
}

for (const restoredGrant of ['granted', 'worker denied', 'source denied', 'approval missing', 'approval mismatched'] as const) {
void test(`a restored Responses coding job with sharing ${restoredGrant} keeps its supervisor pin without a model turn`, {timeout: 30_000}, async context => {
  let denied: 'worker denied' | 'source denied' | undefined;
  const ordinary = sharing();
  const share = Object.assign((query: ShareQuery) => ordinary(query) &&
    !(denied === 'worker denied' && query.destination === 'coding-worker' && query.source === 'coding' && query.field === 'brief') &&
    !(denied === 'source denied' && query.destination === 'external-model' && query.source === 'conversation' && query.field === 'request'),
  {revokesFields: true, allowsDerived: (query: ShareQuery) => ordinary.allowsDerived?.(query) !== false});
  const openAIRequests: string[] = [];
  const provider = new OpenAIProvider({model: OPENAI_MODEL, effort: 'medium', key: 'synthetic', transport: (_url, init) => {
    openAIRequests.push(init.body);
    return Promise.resolve(new Response(JSON.stringify({
      status: 'completed', output: [{type: 'function_call', id: 'fc_restored', call_id: 'call_restored',
        name: 'delegate_coding', arguments: JSON.stringify({repository: 'agent-device-hub', brief: 'Write a synthetic fixture.'})}],
      usage: {input_tokens: 40, output_tokens: 40},
    })));
  }});
  const options: CompanionsOptions = {provider, share};
  const w = await world(context, options);
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.enable()).status, 'accepted');
  assert.equal((await w.send('bunny', 'Delegate the initial synthetic coding task.')).status, 'accepted');
  await w.approved('bunny');
  await settle(() => w.starts().length === 1 && w.task('bunny')?.status === 'succeeded');
  assert.equal((await w.send('bunny', 'Delegate a second synthetic coding task.')).status, 'accepted');
  await w.approved('bunny');
  await settle(() => w.coding().waiting?.length === 1 && w.task('bunny')?.status === 'succeeded');
  const waiting = w.coding().waiting?.at(0) ?? assert.fail('expected waiting approved job');
  assert.equal(openAIRequests.length, 2);
  assert.equal(new AssistantStore(w.database()).task(waiting.taskId)?.supervisor?.provider, 'openai');
  if (restoredGrant === 'worker denied' || restoredGrant === 'source denied') denied = restoredGrant;
  if (restoredGrant === 'approval missing' || restoredGrant === 'approval mismatched') {
    const store = new AssistantStore(w.database());
    const approval = store.call(waiting.operationId) ?? assert.fail('saved approval call');
    if (restoredGrant === 'approval missing') delete approval.codingApproval;
    else approval.ordinal += 1;
    store.saveCall(approval);
  }
  options.provider = {name: 'synthetic', model: 'synthetic', turn: () => assert.fail('recovery does not switch supervisors')};
  await w.restart();
  assert.equal(new AssistantStore(w.database()).task(waiting.taskId)?.supervisor?.provider, 'openai');
  assert.equal((await w.enable('uncapped')).status, 'accepted');
  if (restoredGrant === 'granted') {
    await settle(() => w.starts().length === 2);
    const continued = w.starts().at(-1)?.data;
    assert.ok(continued?.action === 'start');
    assert.equal(continued.taskId, waiting.taskId);
    assert.equal(continued.operationId, waiting.operationId);
  } else {
    if (restoredGrant === 'approval missing' || restoredGrant === 'approval mismatched') {
      const messages = await w.waitMessages('bunny', /The original supervisor or coding approval could not be verified/);
      assert.ok(messages.some(message => message.text === 'Delegate a second synthetic coding task.'));
    } else await w.waitMessages('bunny', /refused: forbidden/);
    assert.equal(w.dispatched.length, 1, 'the saved approval and grants are rechecked before dispatch');
    assert.equal(w.starts().length, 1);
  }
  assert.equal(openAIRequests.length, 2, 'recovery did not rerun the original supervisor');
});
}

for (const revoked of ['model input', 'derived input', 'private read'] as const) {
  void test(`a recovered job refuses a revoked ${revoked} grant for its model-disclosed repository`, {timeout: 30_000}, async context => {
    let revoke = false;
    const ordinary = sharing();
    const sameRepository = (query: ShareQuery) => query.source === 'coding' && query.field === 'repository' && query.record === 'agent-device-hub';
    const share = Object.assign((query: ShareQuery) => ordinary(query) && !(revoke && sameRepository(query) &&
      (revoked === 'model input' && query.destination === 'synthetic' && query.purpose === 'prompt' ||
       revoked === 'private read' && query.destination === 'private-conversation' && query.purpose === 'read')),
    {revokesFields: true, allowsDerived: (query: ShareQuery) => !(revoke && revoked === 'derived input' && sameRepository(query))});
    const w = await world(context, {share});
    assert.equal((await w.control('enable')).status, 'accepted');
    assert.equal((await w.enable()).status, 'accepted');
    for (const request of ['first', 'second']) {
      assert.equal((await w.send('bunny', `Delegate the ${request} synthetic coding task.`)).status, 'accepted');
      await w.approved('bunny');
      await settle(() => w.task('bunny')?.status === 'succeeded');
    }
    const waiting = w.coding().waiting?.at(0) ?? assert.fail('expected waiting approved job');
    const store = new AssistantStore(w.database());
    const model = store.calls(waiting.taskId).find(call => call.kind === 'model') ?? assert.fail('saved model call');
    const approval = store.call(waiting.operationId) ?? assert.fail('saved approval call');
    assert.equal(approval.kind, 'tool');
    assert.notEqual(model.id, approval.id);
    assert.equal(model.disclosures?.some(field => field.source === 'coding' && field.field === 'repository' && field.record === 'agent-device-hub'), true,
      'the earlier job receipt disclosed the repository to the supervisor');
    revoke = true;
    await w.restart();
    assert.equal((await w.enable('uncapped')).status, 'accepted');
    await settle(() => w.starts().length > 1 || w.coding().waiting?.length !== 1);
    assert.equal(w.dispatched.length, 1, 'revoked model data must not reach the dispatcher');
    assert.equal(w.starts().length, 1, 'the recovered worker command must not start');
  });
}

void test('local clarification choices do not become prior supervisor disclosures on an approved Responses hand-off', {timeout: 30_000}, async context => {
  const bodies: string[] = [];
  const replies = [
    {name: 'set_wemo_power', args: {device: 'Fixture plug', on: false}},
    {name: 'delegate_coding', args: {repository: 'agent-device-hub', brief: 'Add a synthetic fixture.'}},
  ];
  const provider = new OpenAIProvider({model: OPENAI_MODEL, effort: 'medium', key: 'synthetic', transport: (_url, init) => {
    bodies.push(init.body);
    const reply = replies.shift();
    const output = reply === undefined
      ? [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: 'Finished.'}]}]
      : [{type: 'function_call', id: `fc_${bodies.length}`, call_id: `call_${bodies.length}`, name: reply.name, arguments: JSON.stringify(reply.args)}];
    return Promise.resolve(new Response(JSON.stringify({status: 'completed', output, usage: {input_tokens: 20, output_tokens: 8}})));
  }});
  const ids = ['fixture-plug-one', 'fixture-plug-two'];
  const unknown = {status: 'unknown'} as const;
  const plugs = ids.map((id): DeviceRecord => ({id, label: 'Fixture plug', kind: 'wemo', revision: 1, configurationRevision: 1,
    generation: {epoch: 'fixture-epoch', sequence: 0}, availability: 'available',
    capabilities: {power: {supported: true}, brightness: {supported: false}, modes: {supported: false}, media: {supported: false},
      moments: {supported: false}, preview: {supported: false}, scenes: {supported: false}, zones: {supported: false}},
    desired: {power: unknown, brightness: unknown, mode: unknown}, observed: unknown, pending: 0, pendingKinds: [],
    lastOutcome: unknown, lastTransmission: unknown, externalControl: unknown}));
  const w = await world(context, {provider, tools: ['set_wemo_power', 'delegate_coding'],
    devices: owner => owner === 'bunny/modules/wemo' ? plugs : []});
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.enable('uncapped')).status, 'accepted');
  assert.equal((await w.send('bunny', 'List all Wemo plugs.')).status, 'accepted');
  const store = new AssistantStore(w.database());
  const id = w.task('bunny')?.taskId ?? assert.fail('saved task');
  await settle(() => store.task(id)?.question?.kind === 'clarification');
  assert.deepEqual(store.task(id)?.clarificationDevices, ids);
  assert.equal((await w.send('bunny', 'Instead, delegate a synthetic coding fixture.', true)).status, 'accepted');
  await settle(() => store.task(id)?.question?.kind === 'approval');
  await w.approved('bunny');
  await settle(() => w.starts().length === 1 && w.task('bunny')?.status === 'succeeded');
  assert.equal(bodies.length, 2);
  for (const body of bodies) for (const device of ids) assert.ok(!body.includes(device));
  assert.ok(store.calls(id).filter(call => call.kind === 'model').every(call => call.disclosures?.every(field => field.source !== 'devices') === true));
});

for (const contradiction of [false,true]) {
  void test(`owner route survives a supervisor's ${contradiction ? 'conflicting' : 'omitted'} destination and harness`, async t => {
    const provider = delegating('bunny','Synthetic owner route.',contradiction ? {harness:'claude-code',destination:'mac'} : {});
    const w = await world(t,{provider});
    const health: CodingHarnessReadiness = {harness:'claude-code',installed:'yes',signedIn:'yes',plan:'max',version:'fixture',limits:null,
      limitsObservedAtMs:null,checkedAtMs:1,capabilities:{steering:'live',resume:'saved-session',review:true}};
    await w.enable('uncapped',[health,{...health,harness:'codex'}]);
    await w.control('enable');
    await w.send('bunny','Use Codex on the PC to check the synthetic repository.');
    await settle(()=>w.task('bunny')?.hasAnswer===false && w.task('bunny')?.questionId!=null);
    const current = w.task('bunny') ?? assert.fail('task');
    const proposal = new AssistantStore(w.database()).task(current.taskId)?.question?.proposal;
    assert.ok(proposal?.family==='coding-dispatch');
    assert.equal(proposal.data.harness,'codex'); assert.equal(proposal.data.destination,'pc');
    if (contradiction) {
      await w.send('bunny','approve',true,'claude-code','mac');
      await settle(()=>w.starts().length===1);
      const start = w.starts()[0]?.data; assert.ok(start?.action==='start');
      assert.equal(start.harness,'claude-code');
    } else {
      await w.send('bunny','approve',true);
      await w.waitMessages('bunny',/No connected pc worker|eligible alternatives/iu);
      assert.equal(w.starts().length,0);
    }
  });
}

void test('Conversation resolves its saved owner request against the designated installed operator before dispatch', async t => {
  const revision='a'.repeat(40);
  const w=await world(t,{}, {codingResources:[{kind:'installation',id:'bunny-runtime',destinations:['mac']}]});
  const harness: CodingHarnessReadiness={harness:'claude-code',installed:'yes',signedIn:'yes',plan:'max',version:'fixture',limits:null,
    limitsObservedAtMs:null,checkedAtMs:w.now(),capabilities:{steering:'live',resume:'saved-session',review:true}};
  await w.worker.request(`bunny.cmd.coding-endpoint.${ENDPOINT}`,{type:'org.bunny.coding.endpoint.requested',subject:ENDPOINT,
    dataschema:'https://bunny.invalid/events/coding-endpoint/2.5',data:{requestId:randomUUID(),action:'enable',capacity:'uncapped',harnesses:[harness],
      worker:{os:'macos',repositories:[{name:'agent-device-hub',revision}],toolchains:['node24'],pressure:'normal',testSlots:4}}},{timeoutMs:5000});
  await w.control('enable');
  await w.send('bunny','Run the installed Mac operation and write the result to a file.');
  await settle(()=>w.task('bunny')?.questionId!=null);
  const id=w.task('bunny')?.taskId??assert.fail('task');
  const proposal=new AssistantStore(w.database()).task(id)?.question?.proposal;
  assert.ok(proposal?.family==='coding-dispatch');
  assert.deepEqual(proposal.data.requirements,{resource:{kind:'installation',id:'bunny-runtime'}});
  await w.approved('bunny');
  await settle(()=>w.starts().length===1);
  const start=w.starts()[0]?.data;assert.ok(start?.action==='start');
  assert.equal(start.revision,revision);
  assert.equal(w.starts()[0]?.subject,ENDPOINT);
});

void test('the established Mac accepts an ordinary test task without claiming enrolled capabilities', async context => {
  const w = await world(context);
  const harness: CodingHarnessReadiness = {harness: 'claude-code', installed: 'yes', signedIn: 'yes', plan: 'max', version: 'fixture',
    limits: null, limitsObservedAtMs: null, checkedAtMs: w.now(), capabilities: {steering: 'live', resume: 'saved-session', review: true}};
  await w.enable('uncapped', [harness]);
  await w.control('enable');
  await w.send('bunny', 'Run the tests.');
  await w.approved('bunny');
  await settle(() => w.starts().length === 1);
  assert.equal(w.starts()[0]?.subject, ENDPOINT);
});
