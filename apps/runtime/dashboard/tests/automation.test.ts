import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import test, {after} from 'node:test';
import {build} from 'esbuild';
import {createElement, type ComponentType} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {DashboardState} from '../src/connection.ts';
import {parseRuleInput} from '../../dist/src/core/automation.js';

// Node's native TS runner cannot import TSX. Bundle the page as browser code, keeping the built core validator outside it.
const directory = await mkdtemp(join(tmpdir(), '925ui-'));
after(() => rm(directory, {recursive: true, force: true}));
const output = join(directory, 'automation.cjs');
const require = createRequire(import.meta.url);
// The Node renderer and browser component must share the same React instance.
const react = require.resolve('react'), jsxRuntime = require.resolve('react/jsx-runtime');
await build({stdin: {contents: `
  export * from './src/automation.tsx';
`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), sourcefile: 'automation-test.ts'},
  bundle: true, platform: 'browser', format: 'cjs', outfile: output, logLevel: 'silent',
  alias: {react, 'react/jsx-runtime': jsxRuntime}, external: [react, jsxRuntime]});
type Page = {
  automationRuleInput(draft: typeof rule, creating: boolean): typeof rule;
  automationOutcome(entry: {requestId?: string; target: string}, operations: readonly OperationRecord[], live: boolean): string;
  automationRequest(path: string, method?: string, body?: object): Promise<Record<string, unknown>>;
  readAutomation(signal: AbortSignal): Promise<{settings: Record<string, unknown>}>;
  AutomationPage: ComponentType<{connection: {subscribe(listener: () => void): () => void; getState(): DashboardState}; live: boolean; control: boolean}>;
};
const page = require(output) as Page;
const rule = {name: 'Finished turn', kind: 'event' as const, enabled: true,
  trigger: {source: 'core', kind: 'turn-ended', alias: 'selected'},
  action: {mood: 'celebrate', priorityClass: 'event' as const, durationMs: 1000, palette: ['#123456'], targets: ['wall']}};

void test('creation is disabled until explicit enable; editing retains the definition without changing enabled', () => {
  const created = page.automationRuleInput(rule, true), edited = page.automationRuleInput(rule, false);
  assert.equal(created.enabled, false); assert.equal(Object.hasOwn(edited, 'enabled'), false);
  assert.deepEqual(edited.trigger, rule.trigger); assert.deepEqual(edited.action, rule.action);
  assert.deepEqual(parseRuleInput(created, ['wall'], true), created);
  assert.deepEqual(parseRuleInput(edited, ['wall'], false), edited);
  const configured = {...rule, trigger: {source: 'github', kind: 'pull-request.merged', alias: 'repo-one'}, action: {...rule.action, palette: ['#123456', '#abcdef']}};
  const preserved = page.automationRuleInput(configured, false);
  assert.deepEqual(preserved.trigger, configured.trigger); assert.deepEqual(preserved.action, configured.action);
  created.action.targets.push('other'); assert.deepEqual(rule.action.targets, ['wall']);
});

void test('every explicit mutation sends once with same-origin credentials and the write header, DELETE included', async context => {
  const sent: {path: string; init: RequestInit | undefined}[] = [];
  context.mock.method(globalThis, 'fetch', (path: string, init?: RequestInit) => {
    sent.push({path, init});
    const result = init?.method === 'GET' ? {rules: []} : init?.method === 'DELETE' ? {deleted: true, id: 'rule-1'}
      : {...rule, id: 'rule-1', enabled: path.endsWith('/enable')};
    return Promise.resolve(new Response(JSON.stringify({schema: 'automation/2.0', ...result}), {status: 200}));
  });
  await page.automationRequest('rules');
  await page.automationRequest('rules', 'POST', page.automationRuleInput(rule, true));
  await page.automationRequest('rules/rule-1', 'PUT', page.automationRuleInput(rule, false));
  await page.automationRequest('rules/rule-1/enable', 'POST', {});
  await page.automationRequest('rules/rule-1/disable', 'POST', {});
  await page.automationRequest('rules/rule-1', 'DELETE');
  assert.equal(sent.length, 6);
  for (const [index, call] of sent.entries()) {
    assert.ok(call.path.startsWith('/api/v2/automation/'));
    assert.equal(call.init?.credentials, 'same-origin'); assert.equal(call.init?.redirect, 'error');
    assert.equal(call.init?.cache, 'no-store');
    assert.equal(new Headers(call.init?.headers).get('bunny-request'), index === 0 ? null : '1');
  }
});

void test('lost and malformed mutation replies are uncertain and never retried; safe refusals stay distinct', async context => {
  let calls = 0;
  context.mock.method(globalThis, 'fetch', () => { calls += 1; return Promise.reject(new Error('synthetic network loss')); });
  await assert.rejects(page.automationRequest('rules', 'POST', rule), /Refresh.*before another attempt/);
  assert.equal(calls, 1);
  context.mock.method(globalThis, 'fetch', () => Promise.resolve(new Response('{}', {status: 200})));
  await assert.rejects(page.automationRequest('rules/rule-1', 'DELETE'), /Refresh.*before another attempt/);
  context.mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(JSON.stringify({schema: 'automation/2.0'}), {status: 200})));
  await assert.rejects(page.automationRequest('rules', 'POST', rule), /Refresh.*before another attempt/);
  context.mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(JSON.stringify({error: {code: 'internal', retryable: false}}), {status: 500})));
  await assert.rejects(page.automationRequest('rules', 'POST', rule), /Refresh.*before another attempt/);
  context.mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(JSON.stringify({error: {code: 'forbidden', retryable: false, detail: 'private detail'}}), {status: 403})));
  await assert.rejects(page.automationRequest('rules', 'POST', rule), error => error instanceof Error && error.message.includes('forbidden') && !error.message.includes('private detail'));
});

void test('admission is distinct from current operation outcomes; stale or unrelated evidence never claims completion', () => {
  const entry = {requestId: 'req-one', target: 'wall', receipt: {status: 'accepted', requestId: 'req-one'}};
  const operation = {requestId: 'req-one', target: 'wall', family: 'moment-play', requestedBy: 'bunny/core', status: 'accepted'} as OperationRecord;
  assert.match(page.automationOutcome(entry, [operation], true), /awaiting completion/);
  assert.match(page.automationOutcome(entry, [{...operation, status: 'completed', result: 'succeeded', evidence: 'transmitted'}], true), /succeeded.*transmitted/);
  assert.match(page.automationOutcome(entry, [{...operation, status: 'uncertain', result: 'uncertain', evidence: 'none'}], true), /uncertain/);
  assert.match(page.automationOutcome(entry, [{...operation, target: 'other', status: 'completed', result: 'succeeded'}], true), /No current operation/);
  assert.match(page.automationOutcome(entry, [operation], false), /stale/);
});

void test('settings readback removes the response envelope before an explicit settings replacement', async context => {
  const settings = {noFlourishes: false, quietHours: {enabled: false, start: '22:00', end: '07:00', timeZone: null},
    budgets: {perAgentTask: 1, perAgentHour: 2, globalHour: 6, deviceSpacingMs: 300000}};
  const writes: unknown[] = [];
  context.mock.method(globalThis, 'fetch', (path: string, init?: RequestInit) => {
    if (init?.method !== 'GET') { assert.equal(typeof init?.body, 'string'); writes.push(JSON.parse(init?.body as string) as unknown); }
    const value = path.endsWith('/rules') ? {rules: []} : path.endsWith('/settings') ? settings
      : path.endsWith('/interrupt-set') ? {kinds: ['turn-ended']} : {entries: []};
    return Promise.resolve(new Response(JSON.stringify({schema: 'automation/2.0', ...value}), {status: 200}));
  });
  const snapshot = await page.readAutomation(new AbortController().signal);
  assert.deepEqual(snapshot.settings, settings); assert.equal(writes.length, 0);
  await page.automationRequest('settings', 'PUT', snapshot.settings);
  assert.deepEqual(writes, [settings]);
});

void test('read-only server markup has a labelled Automation page and disabled forms; render sends nothing', context => {
  let calls = 0;
  context.mock.method(globalThis, 'fetch', () => { calls += 1; throw new Error('render must not fetch'); });
  const state: DashboardState = {feed: 'connected', sessions: {synced: true, records: [], revision: 1, syncs: 1, changedAtMs: 1, refused: undefined},
    runtime: {modules: [], control: false, copies: [], catalogFailed: false}};
  const html = renderToStaticMarkup(createElement(page.AutomationPage,
    {connection: {subscribe: () => () => {}, getState: () => state}, live: true, control: false}));
  assert.match(html, /aria-label="Automation"/); assert.match(html, /<h1>Automation<\/h1>/);
  assert.match(html, /read-only/); assert.match(html, /fieldset disabled/);
  for (const label of ['Rule name', 'Occurrence', 'Quiet hours start', 'Per agent task', 'Interrupt kinds']) assert.ok(html.includes(label), label);
  assert.equal(calls, 0);
});
