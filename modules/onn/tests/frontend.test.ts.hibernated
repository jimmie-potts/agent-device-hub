import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {build} from 'esbuild';
import type {FrontendCommand} from '@jimmie-potts/sdk/frontend';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {OnnState} from '../src/contracts.js';
import {onnAction, onnAppLabel, onnAvailability, onnFeedback, onnRecordOrder, validOnnText} from '../src/frontend/onn-card-data.js';

void test('Soft keys ONN page keeps a disabled reusable card while observations are unknown', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'onn-card-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const entry = join(directory, 'view.mjs');
  await build({stdin: {contents: `
    import {createElement} from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
    import {frontend} from './modules/onn/src/frontend/index.tsx';
    const ui={Select:()=>createElement('select'),Facts:()=>createElement('dl'),Badge:({children})=>createElement('span',null,children),InfoTip:()=>null};
    const context={module:'onn',connected:false,control:false,operations:[],operationsLive:false,api:{},ui};
    const Component=frontend.pages.find(page=>page.id==='controls').Component;
    process.stdout.write(renderToStaticMarkup(createElement(Component,{context})));
  `, resolveDir: process.cwd(), loader: 'js'}, bundle: true, platform: 'node', format: 'esm', outfile: entry,
  loader: {'.css': 'empty'}, banner: {js: "import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"}});
  const {stdout} = await promisify(execFile)(process.execPath, [entry]);
  assert.match(stdout, /aria-label="ONN controls"/);
  assert.match(stdout, /aria-label="Illustration of a television and ONN streaming box"/);
  assert.match(stdout, /role="tab"[^>]*>Remote<\/button>/);
  assert.match(stdout, /role="tab"[^>]*>Apps<\/button>/);
  assert.match(stdout, /aria-label="Up"[^>]*disabled=""/);
  assert.match(stdout, /href="#\/module\/onn\/history"/);
  assert.doesNotMatch(stdout, /Connection:|Desired power|No command sent from this page/);
});

const state: OnnState = {id: 'onn', revision: 3, configurationRevision: 2, generation: {epoch: 'onn-epoch', sequence: 4}, connection: 'available',
  currentApp: {status: 'known', value: 'youtube', observedAtMs: 1000},
  controls: {keys: ['up', 'down', 'left', 'right', 'select', 'back', 'home', 'play-pause'], apps: ['youtube', 'stremio'],
    text: {maximum: 256, alphabet: 'ascii-letters-digits-space-dot-underscore-hyphen'}}};
const context = {module: 'onn', connected: true, control: true, operationsLive: true};

void test('Soft keys dispatch carries current guards and refuses stale, forbidden, unsupported or mismatched actions', () => {
  const intent = {kind: 'key', value: 'up'} as const;
  assert.deepEqual(onnAction(state, context, true, false, intent, 'request-1', 'onn'), {family: 'onn-key-press', target: 'onn', requestId: 'request-1',
    data: {key: 'up', expectedConfigurationRevision: 2, expectedGeneration: state.generation}});
  for (const ctx of [{...context, control: false}, {...context, connected: false}, {...context, operationsLive: false}, {...context, module: 'other'}]) {
    assert.equal(onnAction(state, ctx, true, false, intent, 'request-1', 'onn'), undefined);
  }
  assert.equal(onnAction(state, context, false, false, intent, 'request-1'), undefined);
  assert.equal(onnAction(state, context, true, true, intent, 'request-1'), undefined);
  assert.equal(onnAction(state, context, true, false, intent, 'request-1', 'other'), undefined);
  assert.equal(onnAction({...state, connection: 'unavailable'}, context, true, false, intent, 'request-1'), undefined);
  assert.equal(onnAction({...state, controls: {...state.controls, keys: []}}, context, true, false, intent, 'request-1'), undefined);
  assert.equal(onnAction({...state, controls: {...state.controls, apps: []}}, context, true, false, {kind: 'app', value: 'youtube'}, 'request-1'), undefined);
  for (const text of ['', 'emoji 😊', 'a'.repeat(257), 'line\nbreak', 'shell&input']) {
    assert.equal(validOnnText(text), false);assert.equal(onnAction(state, context, true, false, {kind: 'text', value: text}, 'request-1'), undefined);
  }
  assert.equal(onnAction(state, context, true, false, {kind: 'text', value: 'A safe.input_1-2'}, 'request-1')?.family, 'onn-text');
  assert.equal(onnAction(state, context, true, false, {kind: 'app', value: 'stremio'}, 'request-1')?.family, 'onn-app-open');
});

void test('app labels use captured evidence and its original freshness, including future and missing observations', () => {
  assert.equal(onnAppLabel(state, true, 15999), 'YouTube');
  assert.equal(onnAppLabel(state, true, 16000), 'App unknown');
  assert.equal(onnAppLabel(state, true, 999), 'App unknown');
  assert.equal(onnAppLabel(state, false, 1000), 'App unknown');
  assert.equal(onnAppLabel({...state, currentApp: {status: 'unknown'}}, true, 1000), 'App unknown');
  assert.equal(onnAvailability(state, true, true, 'other'), 'unknown');
  assert.equal(onnAvailability(state, false, true), 'stale');
  assert.equal(onnRecordOrder(state, {...state, revision: 2}), 'ignore');
  assert.equal(onnRecordOrder(state, {...state, connection: 'unavailable'}), 'conflict');
  assert.equal(onnRecordOrder(state, {...state, id: 'other', revision: 4}), 'conflict');
  assert.equal(onnRecordOrder(undefined, state, 'other'), 'conflict');
  assert.equal(onnRecordOrder(state, {...state, revision: 4}), 'accept');
});

void test('quiet feedback distinguishes transmission, observation and uncertainty without inventing retired evidence', () => {
  const command: FrontendCommand = {text: 'Full safe request evidence.', locked: false, requestId: 'request-1', run: async () => {}};
  const operation: OperationRecord = {id: 'op-1', revision: 1, requestId: 'request-1', kind: 'device', family: 'onn-key-press', command: 'onn-key-press', target: 'onn',
    requestedBy: 'bunny/parts/dashboard', status: 'completed', result: 'succeeded', evidence: 'transmitted', sentAtMs: 1, updatedAtMs: 2, deadlineAtMs: 100};
  assert.equal(onnFeedback(command, [operation], 'onn').label, 'Sent to ONN');
  for (const record of [operation, {...operation, status: 'accepted'}, {...operation, status: 'uncertain'}] as OperationRecord[]) {
    assert.equal(onnFeedback(command, [record], 'onn').detail, command.text, 'compact feedback preserves the full safe evidence verbatim');
  }
  assert.equal(onnFeedback(command, [{...operation, evidence: 'observed'}], 'onn').label, 'Observed');
  assert.equal(onnFeedback(command, [{...operation, status: 'accepted'}], 'onn').label, 'Accepted');
  assert.equal(onnFeedback(command, [{...operation, status: 'uncertain'}], 'onn').attention, true);
  assert.equal(onnFeedback(command, [], 'onn').label, 'Check request');
  assert.equal(onnFeedback(command, [], 'onn').detail, command.text, 'retired operation evidence remains inspectable');
  assert.equal(onnFeedback(command, [operation], 'other').label, 'Check request');
  assert.equal(onnFeedback({...command, text: 'No command sent from this page.', requestId: undefined}, [], 'onn').label, '');
  assert.equal(onnFeedback({...command, text: 'Uncertain result. It was not sent again.', locked: true}, [], 'onn').attention, true);
});

void test('the ONN frontend bundles scoped presentation without its backend, ADB or state store', async () => {
  const result = await build({entryPoints: ['modules/onn/src/frontend/index.tsx'], bundle: true, platform: 'browser', format: 'esm', outfile: 'onn-browser.js', write: false, metafile: true});
  assert.ok(result.outputFiles.some(file => file.path.endsWith('.css')));
  assert.equal(Object.keys(result.metafile.inputs).some(path => /modules\/onn\/src\/(module|transport|store|history|metadata)\.ts$/.test(path)), false);
  assert.equal(Object.keys(result.metafile.inputs).some(path => path.includes('@yume-chan') || path.includes('ajv')), false);
});
