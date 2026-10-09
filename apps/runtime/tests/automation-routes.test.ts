import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {AutomationError, createAutomation, DEFAULT_INTERRUPT_SET, DEFAULT_SETTINGS, type Rule} from '../src/core/automation.js';
import {AutomationStore} from '../src/core/automation-store.js';
import {automationRoute, type AutomationAnswer} from '../src/gateway/automation-routes.js';

const rule = {name: 'Turn complete', kind: 'event', trigger: {source: 'core', kind: 'turn-ended'},
  action: {mood: 'celebrate', priorityClass: 'event', durationMs: 1000, targets: ['lines']}};
function world() {
  const database = new DatabaseSync(':memory:');
  const store = new AutomationStore(database, () => {}, {settings: DEFAULT_SETTINGS, interruptSet: [...DEFAULT_INTERRUPT_SET]});
  const controls = createAutomation({store, routed: () => ['lines'], targets: () => Promise.resolve({presentation: 'quiet', alert: 'none'}),
    clock: () => 1700000000000, monotonic: () => 1700000000000, active: () => true});
  const bounds: number[] = [], sequence: string[] = [];
  const call = (method: string, path: string, input: unknown = {}, authorize: () => void = () => { sequence.push('authorize'); }) =>
    automationRoute(controls, {method, url: new URL(`/api/v2/automation/${path}`, 'http://runtime.invalid'),
      body: maximum => { bounds.push(maximum); sequence.push('body'); return Promise.resolve(input); }, authorize});
  return {controls, bounds, sequence, call, close: async () => { await controls.close(); database.close(); }};
}
function body<T extends object>(answer: AutomationAnswer | undefined, status = 200): T {
  assert.ok(answer); assert.equal(answer.status, status);
  assert.equal((answer.body as {schema?: string}).schema, 'automation/2.0');
  return answer.body as T;
}

void test('rule CRUD keeps owner enabling explicit, preserves enabled on update, and bounds each write', async context => {
  const w = world(); context.after(() => w.close());
  const created = body<Rule>(await w.call('POST', 'rules', rule), 201);
  assert.equal(created.enabled, false);
  assert.deepEqual(w.bounds, [8192]); assert.deepEqual(w.sequence, ['body', 'authorize']);
  assert.equal(body<{rules: Rule[]}>(await w.call('GET', 'rules')).rules[0]?.id, created.id);
  assert.equal(body<Rule>(await w.call('GET', `rules/${created.id}`)).name, rule.name);
  assert.equal(body<Rule>(await w.call('POST', `rules/${created.id}/enable`)).enabled, true);
  assert.equal(body<Rule>(await w.call('PUT', `rules/${created.id}`, {...rule, name: 'Changed'})).enabled, true);
  assert.equal(body<Rule>(await w.call('POST', `rules/${created.id}/disable`)).enabled, false);
  assert.deepEqual(w.bounds, [8192, 16, 8192, 16]);
  const before = w.sequence.length;
  assert.equal(body<{deleted: boolean}>(await w.call('DELETE', `rules/${created.id}`)).deleted, true);
  assert.deepEqual(w.sequence.slice(before), ['authorize']);
  assert.deepEqual(w.controls.rules(), []);
});

void test('settings and interrupt set round-trip; log uses bounded descending pagination', async context => {
  const w = world(); context.after(() => w.close());
  assert.deepEqual(body<{kinds: string[]}>(await w.call('GET', 'interrupt-set')).kinds, [...DEFAULT_INTERRUPT_SET].sort());
  assert.deepEqual(body<{kinds: string[]}>(await w.call('PUT', 'interrupt-set', {kinds: ['turn-ended']})).kinds, ['turn-ended']);
  const settings = {...DEFAULT_SETTINGS, noFlourishes: true};
  const written = body<{noFlourishes: boolean}>(await w.call('PUT', 'settings', settings));
  assert.equal(written.noFlourishes, true);
  assert.deepEqual(await w.call('GET', 'settings'), {status: 200, body: {schema: 'automation/2.0', ...settings}});
  assert.deepEqual(w.bounds, [8192, 1024]);
  w.controls.create({...rule, enabled: true}, true);
  for (const id of ['one', 'two']) w.controls.submit({id, source: 'core', kind: 'turn-ended', delivery: 'live'});
  await w.controls.settled();
  const first = body<{entries: {seq: number}[]; next: number}>(await w.call('GET', 'log?limit=1'));
  assert.equal(first.entries.length, 1); assert.equal(first.next, first.entries[0]?.seq);
  const second = body<{entries: {seq: number}[]}>(await w.call('GET', `log?limit=1&before=${first.next}`));
  assert.equal(second.entries.length, 1); assert.ok((second.entries[0]?.seq ?? 0) < first.next);
});

void test('invalid paths, input and queries fail without mutation and legacy errors use shared safe bodies', async context => {
  const w = world(); context.after(() => w.close());
  for (const [method, path, input] of [
    ['POST', 'rules', {...rule, action: {...rule.action, targets: ['unknown']}}],
    ['PUT', 'settings', {quietHours: 'bad'}], ['PUT', 'interrupt-set', {kinds: ['INVALID']}],
    ['GET', 'rules?extra=1', {}], ['GET', 'log?limit=501', {}], ['GET', 'log?limit=0', {}],
    ['GET', 'log?limit=1&limit=2', {}], ['GET', 'log?before=9007199254740992', {}], ['GET', 'log?extra=1', {}],
  ] as const) {
    assert.deepEqual(await w.call(method, path, input), {status: 400, body: {error: {code: 'invalid-request', retryable: false}}});
  }
  assert.deepEqual(await w.call('GET', 'rules/missing'), {status: 404, body: {error: {code: 'not-found', retryable: false}}});
  assert.deepEqual(w.controls.rules(), []);
  assert.equal(await w.call('PATCH', 'rules'), undefined);
  assert.equal(await w.call('GET', 'unknown'), undefined);
  assert.equal(await automationRoute(w.controls, {method: 'GET', url: new URL('http://runtime.invalid/other/rules'),
    body: () => Promise.resolve({}), authorize: () => {}}), undefined);
});

void test('authorization is rechecked after bodies and before bodyless DELETE; unexpected errors escape', async context => {
  const w = world(); context.after(() => w.close());
  const revoked = () => { throw new AutomationError('forbidden', 403); };
  assert.deepEqual(await w.call('POST', 'rules', rule, revoked), {status: 403, body: {error: {code: 'forbidden', retryable: false}}});
  assert.deepEqual(w.sequence, ['body']); assert.deepEqual(w.controls.rules(), []);
  const created = w.controls.create(rule, true);
  assert.deepEqual(await w.call('DELETE', `rules/${created.id}`, {}, revoked), {status: 403, body: {error: {code: 'forbidden', retryable: false}}});
  assert.equal(w.controls.rule(created.id).id, created.id);
  const fault = new Error('private exception text must not become a route result');
  await assert.rejects(w.call('PUT', 'settings', DEFAULT_SETTINGS, () => { throw fault; }), error => error === fault);
  assert.equal(w.controls.rule(created.id).id, created.id);
  const busy = () => { throw new AutomationError('capacity', 429); };
  assert.deepEqual(await w.call('DELETE', `rules/${created.id}`, {}, busy), {status: 429, body: {error: {code: 'capacity', retryable: true}}});
});
