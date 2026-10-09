import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {build} from 'esbuild';
import {InProcessBus, SdkError} from '@jimmie-potts/sdk';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {APPS, CATEGORIES, appCategory, emptyTotals} from '@jimmie-potts/wispr-contracts';
import {readWispr, numericCsv, compatibleFilters, metrics, numericSelection, errorCode, type Status} from '../src/frontend/wispr-data.js';
import {createWisprModule} from '../src/module.js';
import {addLanguage, world} from './support.js';

const selection = {period: 'today', app: 'all', category: 'all'} as const;
const status = {
  schema: 'wispr-analytics/2.0', sourceId: 'dictation', namespace: 'n', generation: 'g', revision: 1,
  timezone: 'America/New_York', generatedAt: '2026-10-02T16:00:00.000Z', lastSuccessAt: '2026-10-02T16:00:00.000Z',
  latestSourceDate: '2026-10-02', freshness: 'fresh', ageMs: 0, reason: null,
  coverage: {captured: {from: '2026-10-02', to: '2026-10-02'}},
  data: {availability: 'ok', textAllowed: true, presets: [{key: 'today', from: '2026-10-02', to: '2026-10-02',
    asOf: '2026-10-02T16:00:00.000Z', validUntil: '2026-10-03T04:00:00.000Z'}]},
};

void test('the module browser source entry bundles React and scoped CSS without Node reader code', async () => {
  const result = await build({entryPoints: ['modules/wispr/src/frontend/index.tsx'], bundle: true, platform: 'browser',
    format: 'esm', outfile: 'wispr-frontend.js', write: false, metafile: true});
  assert.ok(result.outputFiles.some(file => file.path.endsWith('.js')));
  assert.ok(result.outputFiles.some(file => file.path.endsWith('.css')));
  assert.equal(Object.keys(result.metafile.inputs).some(path => /modules\/wispr\/src\/(module|wispr-worker|wispr-file)\./.test(path)), false);
  assert.equal(Object.keys(result.metafile.inputs).some(path => path.includes('wispr-contracts')), false);
});

void test('a fresh page mount after leaving retains the module session filter selection', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'wispr-page-unit-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const entry = join(dir, 'view.mjs');
  await build({stdin: {contents: `
    import {createElement} from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
    import {WisprPage} from './modules/wispr/src/frontend/wispr.tsx';
    import {rememberSelection} from './modules/wispr/src/frontend/wispr-data.ts';
    function render(){return renderToStaticMarkup(createElement(WisprPage,{context:{connected:false,api:{},ui:{}}}));}
    const initial=render();rememberSelection({period:'today',app:'slack',category:'messaging'});
    process.stdout.write(JSON.stringify({initial,reentered:render()}));
  `, resolveDir: process.cwd(), loader: 'js'}, bundle: true, platform: 'node', format: 'esm', outfile: entry, loader: {'.css': 'empty'},
  banner: {js: "import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"}});
  const {stdout} = await promisify(execFile)(process.execPath, [entry]);
  const {initial, reentered} = JSON.parse(stdout) as {initial: string; reentered: string};
  assert.match(initial, /value="7d" selected=""/);
  assert.match(reentered, /value="today" selected=""/);
  assert.match(reentered, /value="slack" selected=""/);
  assert.match(reentered, /value="messaging" selected=""/);
});

void test('module frontend reads actual synthetic numeric data without requesting language and exports numeric CSV', async t => {
  const fixture = await world(t, true); addLanguage(fixture.snapshot); await fixture.publish(fixture.snapshot, true);
  const module = createWisprModule();
  const harness = new ModuleHarness(module, {bus: new InProcessBus(), stateDir: fixture.directory,
    section: fixture.config, clock: {now: fixture.now}});
  t.after(() => harness.stop()); await harness.start();
  const calls: string[] = [];
  const api = {read: async (path: string): Promise<unknown> => {
    calls.push(path); const url = new URL(path, 'http://synthetic.invalid');
    assert.match(url.pathname, /^\/modules\/wispr\/content\/(status|export|summary)$/);
    const result = await module.read(url.pathname.split('/').at(-1) ?? '', url.search.slice(1));
    assert.ok(!('error' in result)); return JSON.parse(Buffer.from(result.bytes).toString()) as unknown;
  }};
  const read = await readWispr(api, undefined, selection, false, new AbortController().signal);
  assert.equal(read.numeric?.data.totals.words, 120); assert.deepEqual(read.language, {});
  assert.equal(calls.length, 3); assert.equal(calls.some(path => path.includes('language') || path.includes('includeText')), false);
  assert.ok(read.numeric!==undefined); const csv = numericCsv(read.numeric);
  assert.match(csv, /"data.totals.words","120"/); assert.equal(csv.includes('SUM'), false);
  assert.deepEqual(harness.sent, []);
});

void test('final status opt-out or stale refusal retires already received language while preserving numeric freshness', async () => {
  for (const optOut of [true, false]) {
    let reads = 0;
    const api = {read: (path: string): Promise<unknown> => Promise.resolve(path.endsWith('/status')
      ? {...status, ...( ++reads === 2 ? {freshness: 'stale', reason: optOut ? null : 'snapshot-unavailable', ageMs: 99,
        data: {...status.data, textAllowed: !optOut}} : {})}
      : path.includes('/language') ? {...status, data: {availability: 'available', table: {words: [{text: 'SYNTHETIC_TEXT_CANARY'}]}}}
        : {...status, data: {totals: emptyTotals(), dictionary: {filtered: false}}})};
    const read = await readWispr(api, 'dictation', selection, true, new AbortController().signal);
    assert.deepEqual(read.language, {}); assert.equal(JSON.stringify(read).includes('CANARY'), false);
    assert.equal(read.numeric?.freshness, 'stale'); assert.equal(read.numeric?.ageMs, 99);
  }
});

void test('mixed identity and retired source schema cannot commit a frontend read', async () => {
  const changed = {read: (path: string): Promise<unknown> => Promise.resolve(path.endsWith('/status') ? status : {...status, generation: 'replacement', data: {}})};
  await assert.rejects(readWispr(changed, 'dictation', selection, false, new AbortController().signal), /snapshot-changed/);
  const legacy = {read: (): Promise<unknown> => Promise.resolve({...status, schema: undefined, apiVersion: '1.0'})};
  await assert.rejects(readWispr(legacy, 'dictation', selection, false, new AbortController().signal), /unsupported-snapshot/);
});

void test('local cancellation fences a resolved read before page state or export can commit', async () => {
  const stop = new AbortController();
  const api = {read: (): Promise<unknown> => {stop.abort(); return Promise.resolve(status);}};
  await assert.rejects(readWispr(api, 'dictation', selection, false, stop.signal), /request-cancelled/);
});

void test('numeric metrics and CSV preserve missing observations and formula escaping', () => {
  const value = metrics({...emptyTotals(), dictations: 2, words: 100, recordingSamples: 1, recordingSeconds: 20});
  assert.equal(value.speech, null); assert.equal(value.wpm, null); assert.equal(value.length, 50); assert.equal(value.recording, 1 / 3);
  assert.match(numericCsv({label: '=1+1', missing: null}), /"label","'=1\+1"/);
  assert.match(numericCsv({missing: null}), /"missing",""/);
});

void test('frontend app/category selection agrees with the existing producer contract', () => {
  for (const app of ['all' as const, ...APPS]) for (const category of ['all' as const, ...CATEGORIES]) {
    assert.equal(compatibleFilters(app, category), app === 'all' || category === 'all' || appCategory(app) === category);
  }
});

void test('preset queries intersect captured dates and preserve empty coverage without invented zero totals', async () => {
  const observed = {...status, coverage: {captured: {from: '2026-10-01', to: '2026-10-02'}},
    data: {...status.data, presets: [{...status.data.presets[0], key: '7d', from: '2026-09-26'}]}} as Status;
  const selected = numericSelection(observed, {period: '7d', app: 'slack', category: 'messaging'});
  assert.equal(selected.query, 'from=2026-10-01&to=2026-10-02&app=slack&category=messaging');
  assert.equal(selected.partial, true);
  const empty = {...status, coverage: {captured: {from: null, to: null}}};
  const dictionary = {activeEntries: 3, filtered: false}; const calls: string[] = [];
  const api = {read: (path: string): Promise<unknown> => {
    calls.push(path); return Promise.resolve(path.endsWith('/status') ? empty : {...empty, data: {dictionary}});
  }};
  const read = await readWispr(api, undefined, selection, false, new AbortController().signal);
  assert.equal(read.numeric, undefined); assert.deepEqual(read.dictionary, dictionary);
  assert.deepEqual(calls, ['/modules/wispr/content/status', '/modules/wispr/content/summary', '/modules/wispr/content/status']);
});

void test('access refusals stay visible and stop the frontend sequence before any language read', async () => {
  const refusal = new SdkError(errorBody('forbidden')); let calls = 0;
  const api = {read: (): Promise<unknown> => {calls++; return Promise.reject(refusal);}};
  await assert.rejects(readWispr(api, undefined, selection, true, new AbortController().signal), error => error === refusal);
  assert.equal(calls, 1); assert.equal(errorCode(refusal), 'forbidden'); assert.equal(errorCode(new Error('synthetic private diagnostic')), 'unavailable');
});
