// Hub #1585: each routine time read in the viewer's zone beside the Hub time. Derived text only; nothing is sent.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import test, {after} from 'node:test';
import {build} from 'esbuild';
import {createElement, type ComponentType} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Node's native TS runner cannot import TSX. Bundle the editor as browser code with the renderer's React instance.
const directory = await mkdtemp(join(tmpdir(), '1585ui-'));
after(() => rm(directory, {recursive: true, force: true}));
const output = join(directory, 'routines.cjs');
const require = createRequire(import.meta.url);
const react = require.resolve('react'), jsxRuntime = require.resolve('react/jsx-runtime');
await build({entryPoints: [fileURLToPath(new URL('../src/routines.tsx', import.meta.url))],
  bundle: true, platform: 'browser', format: 'cjs', outfile: output, logLevel: 'silent',
  alias: {react, 'react/jsx-runtime': jsxRuntime}, external: [react, jsxRuntime]});
type Saved = {id: string; name: string; days: number[]; time: string; enabled: boolean; definitionId: string; createdAtMs: number; updatedAtMs: number;
  actions: {target: string; family: string; data: Record<string, unknown>}[]; next?: {atMs: number}};
type Editor = {routines: Saved[]; timeZone: string; devices: never[]; available: boolean; mutate: () => Promise<void>; localZone?: string};
const page = require(output) as {
  nextHubOccurrence(days: number[], time: string, zone: string, afterMs: number): number | undefined;
  localEquivalent(atMs: number, hubZone: string, localZone: string): string | undefined;
  distinctZone(hubZone: string, localZone: string): string | undefined;
  RoutinesEditor: ComponentType<Editor>;
};
const at = (iso: string): number => Date.parse(iso);
const CHICAGO = 'America/Chicago';

void test('a Hub-clock time reads in the viewer zone, naming the weekday when the dates differ', () => {
  assert.equal(page.localEquivalent(at('2026-11-09T17:00:00Z'), 'UTC', CHICAGO), '11:00 your time (America/Chicago)');
  assert.equal(page.localEquivalent(at('2026-11-10T05:00:00Z'), 'UTC', CHICAGO), 'Mon 23:00 your time (America/Chicago)', 'Tuesday 05:00 UTC is Monday evening in Chicago');
  assert.equal(page.localEquivalent(at('2026-07-06T17:00:00Z'), 'UTC', CHICAGO), '12:00 your time (America/Chicago)', 'the planned instant carries its own daylight-saving offset');
  assert.equal(page.localEquivalent(at('2026-11-09T17:00:00Z'), CHICAGO, 'Asia/Tokyo'), 'Tue 02:00 your time (Asia/Tokyo)');
});

void test('matching or unknown zones add nothing', () => {
  assert.equal(page.distinctZone('UTC', 'UTC'), undefined);
  assert.equal(page.localEquivalent(at('2026-11-09T17:00:00Z'), CHICAGO, CHICAGO), undefined);
  assert.equal(page.localEquivalent(at('2026-11-09T17:00:00Z'), 'loading', CHICAGO), undefined, 'the placeholder before the first read is not a zone');
  assert.equal(page.distinctZone('UTC', 'Not/AZone'), undefined);
  assert.equal(page.distinctZone('UTC', CHICAGO), CHICAGO);
});

void test('the next occurrence follows the core rule: strictly future, on the chosen Hub weekdays', () => {
  const monday = at('2026-11-09T00:00:00Z');
  assert.equal(page.nextHubOccurrence([1], '17:00', 'UTC', monday), at('2026-11-09T17:00:00Z'));
  assert.equal(page.nextHubOccurrence([1], '17:00', 'UTC', at('2026-11-09T17:00:00Z')), at('2026-11-16T17:00:00Z'), 'right at the minute selects next week');
  assert.equal(page.nextHubOccurrence([2, 4], '05:00', 'UTC', monday), at('2026-11-10T05:00:00Z'));
  assert.equal(page.nextHubOccurrence([1], '17:00', CHICAGO, monday), at('2026-11-09T23:00:00Z'), 'Monday 00:00 UTC is still Sunday in Chicago');
  assert.equal(page.nextHubOccurrence([1], '7:00', 'UTC', monday), undefined, 'an incomplete time has no reading');
  assert.equal(page.nextHubOccurrence([], '07:00', 'UTC', monday), undefined);
});

void test('the browser reading equals the core nextOccurrence on a host in the Hub zone, across clock changes', () => {
  // The core resolves a weekly time with the host clock; run it under TZ so a skipped or repeated hour resolves the same way.
  const cases = [
    {days: [0], time: '02:30', afterMs: at('2026-03-07T12:00:00Z')}, // skipped hour, spring forward on 2026-03-08
    {days: [0], time: '01:30', afterMs: at('2026-10-31T12:00:00Z')}, // repeated hour, fall back on 2026-11-01
    {days: [1, 3, 5], time: '23:45', afterMs: at('2026-11-09T05:00:00Z')},
    {days: [6], time: '00:00', afterMs: at('2026-12-31T20:00:00Z')},
  ];
  const core = new URL('../../dist/src/core/power-schedules.js', import.meta.url).href;
  const script = `const {nextOccurrence}=await import(${JSON.stringify(core)});
    process.stdout.write(JSON.stringify(${JSON.stringify(cases)}.map(item=>nextOccurrence(item,item.afterMs).atMs)));`;
  const expected = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {env: {...process.env, TZ: CHICAGO}, encoding: 'utf8'})) as number[];
  assert.deepEqual(cases.map(item => page.nextHubOccurrence(item.days, item.time, CHICAGO, item.afterMs)), expected);
});

const saved = (overrides: Partial<Saved>): Saved => ({id: 'evening', name: 'Evening', days: [1], time: '17:00', enabled: true, definitionId: 'definition-1',
  createdAtMs: 1, updatedAtMs: 1, actions: [{target: 'wall', family: 'power-set', data: {on: true}}], ...overrides});
const render = (props: Partial<Editor>): string => renderToStaticMarkup(createElement(page.RoutinesEditor,
  {routines: [], timeZone: 'UTC', devices: [], available: false, mutate: () => Promise.resolve(), ...props}));

void test('cards, next-run lines and the draft time show the viewer reading when the zones differ', context => {
  context.mock.timers.enable({apis: ['Date'], now: at('2026-11-09T00:00:00Z')});
  const html = render({localZone: CHICAGO, routines: [
    saved({next: {atMs: at('2026-11-09T17:00:00Z')}}),
    saved({id: 'late', name: 'Late', days: [2], time: '05:00', enabled: false}),
  ]});
  assert.match(html, /Monday · 17:00 · 11:00 your time \(America\/Chicago\)/);
  assert.match(html, /Tuesday · 05:00 · Mon 23:00 your time \(America\/Chicago\)/, 'a disabled routine shows its next occurrence with the day shift');
  assert.match(html, /\(UTC\) · [^<]+\(America\/Chicago\)/, 'the next-run line names both zones');
  assert.match(html, /Hub time · UTC · your time \(America\/Chicago\) is shown for each routine&#x27;s next occurrence/);
  // The fresh draft is weekdays at 07:00 on the Hub clock.
  assert.match(html, /<input type="time" required="" aria-describedby="([^"]+)" value="07:00"\/><\/label><p class="hint" id="\1">07:00 Hub time is 01:00 your time \(America\/Chicago\) at the next occurrence\.<\/p>/);
});

void test('matching zones keep only the Hub time hint', context => {
  context.mock.timers.enable({apis: ['Date'], now: at('2026-11-09T00:00:00Z')});
  const html = render({localZone: 'UTC', routines: [saved({next: {atMs: at('2026-11-09T17:00:00Z')}}), saved({id: 'late', enabled: false})]});
  assert.doesNotMatch(html, /your time/);
  assert.doesNotMatch(html, /aria-describedby/);
  assert.match(html, /<p class="hint">Hub time · UTC<\/p>/);
  assert.match(html, /\(UTC\)<\/dd>/, 'the next-run line names the Hub zone once');
});
