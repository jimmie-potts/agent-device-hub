// The Volcano card's browser journey (Hub #616), on synthetic data only: the real module and store over a simulated feed,
// then the card's states over fixed documents. Nothing here reaches an installation, a radio or a device. The world runs
// on a clock the journey moves (Hub #1708, #1712): the feed's history is spaced by advancing it, never by real waiting.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium, type Page} from 'playwright';
import {changes, feed, startWorld} from './harness.ts';
import {worldClock} from './world-clock.ts';

const TABS = ['Now', 'Timeline', 'Sessions', 'Totals', 'Gaps'];
const browser = await chromium.launch({headless: true});
const frame = (page: Page): Promise<void> => page.evaluate(() => new Promise<void>(resolve => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); }));

async function journey(): Promise<void> {
  const clock = worldClock();
  const world = await startWorld({volcano: true, clock});
  try {
    const context = await browser.newContext({viewport: {width: 1280, height: 1000}, reducedMotion: 'reduce'});
    const errors: string[] = [];
    context.on('weberror', error => { errors.push(error.error().message); });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000); await clock.install(page);
    const sent = changes(page);
    // Each snapshot is stamped on the world's clock when its action applies; the module's 5 s heartbeat fires on it too.
    for (const action of ['heater-on', 'tick', 'pump-on', 'pump-off', 'heater-off', 'heater-on'] as const) {
      world.volcanoAction(action);
      await clock.advance(1100);
    }

    await page.goto(`${world.url}/#/`); await feed(page, 'connected');
    const card = page.locator('[data-volcano-card]');
    // The wide Home grid (#1672) shows the generic compact face; Home in one column keeps the full card.
    assert.equal(await page.locator('[data-home-card="device:bunny/modules/volcano:volcano"] a.home-compact-open').getAttribute('href'), '#/component/volcano');
    await page.setViewportSize({width: 560, height: 1000});
    await card.waitFor();
    assert.equal(await card.count(), 1, 'Home shows one Volcano card');
    assert.equal(await page.locator('[data-home-card="device:bunny/modules/volcano:volcano"]').count(), 1);
    await card.getByText('Heating', {exact: true}).waitFor();
    await card.getByRole('tab', {name: 'Sessions', exact: true}).click();
    await card.locator('li[data-kind=session]').first().waitFor();
    assert.deepEqual(sent, [], 'opening Home and a tab sends no command');

    await page.goto(`${world.url}/#/devices`); await feed(page, 'connected');
    await page.getByRole('button', {name: 'Other', exact: true}).click();
    await page.getByRole('link', {name: 'Volcano', exact: true}).first().click();
    await card.waitFor();
    assert.equal(await card.count(), 1, 'the selected device uses the same card');
    assert.match(new URL(page.url()).hash, /component\/volcano/u);

    // On the wide Home grid (#1672) every saved width shows the Volcano as a Small square with the generic face.
    await page.setViewportSize({width: 1280, height: 1000});
    await page.goto(`${world.url}/#/`); await feed(page, 'connected');
    const placement = page.locator('[data-home-card="device:bunny/modules/volcano:volcano"]');
    const save = (size: 'small' | 'medium' | 'large' | undefined): Promise<number> => page.evaluate(async size => {
      const data = await (await fetch('/api/v2/snapshot?families=home-layout&owner=bunny/core')).json() as {records: {'home-layout': {revision: number}[]}};
      const record = data.records['home-layout'][0]; if (record === undefined) throw new Error('home-record');
      const placed = size === undefined ? [] : [{widget: 'device:bunny/modules/volcano:volcano', size, hidden: false}];
      return (await fetch('/api/v2/commands/home-layout-set', {method: 'POST', headers: {'content-type': 'application/json', 'bunny-request': '1'}, body: JSON.stringify({target: 'home', requestId: crypto.randomUUID(), data: {expectedRevision: record.revision, layouts: {desktop: placed, phone: placed}}})})).status;
    }, size);
    for (const size of ['small', 'medium', 'large'] as const) {
      // An empty layout first takes the Volcano off Home, so its return shows that the page applied this size's save.
      assert.equal(await save(undefined), 200, `emptying Home before ${size}`);
      await placement.waitFor({state: 'detached'});
      assert.equal(await save(size), 200, `saving ${size}`);
      await placement.waitFor();
      assert.equal(await placement.getAttribute('data-home-shape'), 'square', `${size} shows a Small square`);
      assert.equal(await card.count(), 0, 'the compact face mounts no Volcano reader');
    }
    await page.goto(`${world.url}/#/component/volcano`); await feed(page, 'connected'); await card.waitFor();
    sent.length = 0;

    const shots = process.env.DASHBOARD_RECEIPTS;
    if (shots !== undefined) await mkdir(shots, {recursive: true});
    for (const colorScheme of ['light', 'dark'] as const) for (const width of [1440, 736, 390, 320]) {
      await page.emulateMedia({colorScheme, reducedMotion: 'reduce'});
      await page.setViewportSize({width, height: 1000}); await frame(page);
      await card.locator('.volcano-art').evaluate(element => { (window as unknown as {volcanoArt: Element}).volcanoArt = element; });
      const before = await card.boundingBox(); assert.ok(before !== null);
      for (const tab of TABS) {
        await card.getByRole('tab', {name: tab, exact: true}).click();
        assert.equal((await card.boundingBox())?.height, before.height, `${width} ${tab}: the card keeps its height`);
        assert.equal(await card.locator('.volcano-art').evaluate(element => element === (window as unknown as {volcanoArt: Element}).volcanoArt), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width} ${tab}: no page scroll`);
        const outside = await card.evaluate(element => {
          const bounds = element.getBoundingClientRect();
          return [...element.querySelectorAll('[role="tab"],[role="tabpanel"]')].filter(node => node.getClientRects().length > 0).some(node => {
            const item = node.getBoundingClientRect(); return item.left < bounds.left - 1 || item.right > bounds.right + 1 || item.bottom > bounds.bottom + 1;
          });
        });
        assert.equal(outside, false, `${width} ${tab}: stays inside the card`);
        const clipped = await card.getByRole('tab', {name: tab, exact: true}).evaluate(node => node.scrollWidth > node.clientWidth + 1);
        assert.equal(clipped, false, `${width} ${tab}: the label fits`);
        if (shots !== undefined && width === 390) await card.screenshot({path: join(shots, `volcano-${colorScheme}-${tab.toLowerCase()}.png`)});
      }
    }
    await page.emulateMedia({colorScheme: 'light', reducedMotion: 'reduce'}); await page.setViewportSize({width: 1280, height: 1000});
    assert.deepEqual(sent, [], 'switching tabs at every size sends no command');

    const now = card.getByRole('tab', {name: 'Now', exact: true});
    await now.click(); await now.press('ArrowRight');
    assert.equal(await card.getByRole('tab', {name: 'Timeline', exact: true}).evaluate(element => element === document.activeElement), true, 'arrow keys move between tabs');
    await card.getByRole('tab', {name: 'Timeline', exact: true}).press('End');
    assert.equal(await card.getByRole('tab', {name: 'Gaps', exact: true}).getAttribute('aria-selected'), 'true');
    await card.getByRole('tab', {name: 'Gaps', exact: true}).press('Home');
    assert.equal(await now.getAttribute('aria-selected'), 'true');
    assert.equal(await card.getByRole('button', {name: /heat|pump|start|stop|release|delete/iu}).count(), 0, 'no control reaches the device, and no delete');

    // The threshold: a preview changes nothing, and a save is the only command. Stored facts do not move.
    const facts = await world.volcanoRead('timeline?limit=200');
    assert.equal(facts.status, 200);
    await card.getByRole('tab', {name: 'Gaps', exact: true}).click();
    const input = card.getByLabel('Session gap (1 to 240 min)');
    assert.equal(await input.inputValue(), '15');
    await input.fill('999');
    await card.getByText('Enter a whole number of minutes from 1 to 240.', {exact: true}).waitFor();
    assert.equal(await card.getByRole('button', {name: 'Save', exact: true}).isDisabled(), true);
    assert.equal(await card.getByRole('button', {name: 'Preview', exact: true}).isDisabled(), true);
    await input.fill('1');
    await card.getByRole('button', {name: 'Preview', exact: true}).click();
    await card.getByRole('region', {name: 'Regroup preview'}).getByText(/^At 1 min: 1 session\. Saved threshold: 1 session\. Nothing is stored/u).waitFor();
    assert.deepEqual(sent, [], 'a preview sends no command');
    assert.equal(((await world.volcanoRead('status')).body as {gapMinutes: number}).gapMinutes, 15, 'a preview changes no setting');
    await input.fill('30');
    await card.getByRole('button', {name: 'Save', exact: true}).click();
    await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-volcano-card] .volcano-note[role=status]') !== null);
    // The module saves the threshold and its outcome in one transaction, so it is stored when the outcome shows, before
    // the clock moves on.
    await card.getByText('Completed: succeeded. The module observed the result.', {exact: true}).waitFor();
    assert.equal(((await world.volcanoRead('status')).body as {gapMinutes: number}).gapMinutes, 30, 'the threshold is stored with its outcome');
    // Half a second more on the page's and the runtime's timers, then two frames, sends nothing else.
    await clock.advance(500); await frame(page);
    assert.deepEqual(sent, ['/api/v2/commands/volcano-session-gap'], 'the save is one command on the threshold family');
    await card.getByRole('tab', {name: 'Sessions', exact: true}).click();
    await card.getByText('Heater activity, grouped when less than 30 min apart. Not consumption or dose. Times are local to this browser.', {exact: true}).waitFor();
    await card.locator('li[data-kind=session]').first().waitFor();
    const after = await world.volcanoRead('timeline?limit=200');
    assert.deepEqual((after.body as {facts: unknown[]}).facts.slice(0, (facts.body as {facts: unknown[]}).facts.length), (facts.body as {facts: unknown[]}).facts, 'the threshold rewrites no fact');

    // A reload sends nothing, and an unauthenticated read gets nothing.
    sent.length = 0;
    await page.reload(); await feed(page, 'connected'); await card.waitFor();
    await card.getByText('Heating', {exact: true}).waitFor();
    assert.deepEqual(sent, [], 'a reload resends nothing');
    assert.equal(await world.volcanoReadAnonymous('sessions'), 401);

    // Losing the device reads as unknown, never off.
    world.volcanoAction('offline');
    await card.getByText('Unavailable', {exact: true}).waitFor();
    await card.getByRole('tab', {name: 'Now', exact: true}).click();
    assert.equal(await card.locator('.volcano-now').getByText('Off', {exact: true}).count(), 0);
    await card.getByRole('button', {name: 'Volcano status', exact: true}).click();
    await card.getByText(/The heater and pump are unknown, not off\./u).waitFor();
    await card.getByRole('button', {name: 'Volcano status', exact: true}).press('Escape');
    assert.equal(await card.getByRole('button', {name: 'Volcano status', exact: true}).evaluate(element => element === document.activeElement), true);
    assert.deepEqual(sent, [], 'an unavailable device gets no command');
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await world.close();
  }
}

// The card's states over fixed documents, for what a short synthetic run cannot produce.
const PROBE = `
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {flushSync} from 'react-dom';
  import {VolcanoWidget} from '../../../../modules/volcano/src/frontend/index.tsx';
  const root = createRoot(document.getElementById('root'));
  const state = {reads: {}, commands: [], paths: [], held: [], changed: undefined};
  function message(doc) {
    return {source: 'bunny/modules/volcano', kind: 'state', type: 'org.bunny.volcano-status.updated', dataschema: 'https://bunny.invalid/events/volcano-status/2.0', subject: doc.id, data: doc};
  }
  window.volcanoProbe = {
    mount({doc, reads, connected = true, control = true}) {
      state.reads = reads; state.paths = []; state.commands = []; state.held = [];
      const api = {
        read(path) {
          state.paths.push(path);
          const full = path.slice('/modules/volcano/content/'.length), name = full.split('?')[0];
          const value = reads[full] ?? reads[name];
          if (value?.defer === true) return new Promise(resolve => {state.held.push(resolve);});
          if (value === undefined || value.refuse !== undefined) return Promise.reject({body: {error: {code: value === undefined ? 'unavailable' : value.refuse}}});
          return Promise.resolve(value);
        },
        sync(families, changed) {
          state.changed = changed;
          if (doc === undefined) return Promise.resolve({status: 'rejected', error: {error: {code: 'forbidden'}}});
          return Promise.resolve({status: 'synced', copy: {states: () => [message(doc)], close: async () => {}}});
        },
        command() {throw new Error('Unexpected direct command');}, upload() {throw new Error('Unexpected upload');}, image() {throw new Error('Unexpected image');},
      };
      const Command = ({children}) => children({text: '', locked: false, requestId: undefined, run: async action => {state.commands.push(action);}});
      flushSync(() => root.render(null));
      flushSync(() => root.render(React.createElement(VolcanoWidget, {key: Math.random(), expectedTarget: 'volcano', context: {module: 'volcano', api, ui: {Command}, connected, control, operations: [], operationsLive: true}})));
    },
    fail() {state.changed?.({type: 'failed', error: {error: {code: 'unavailable'}}});},
    update(doc) {state.changed?.({type: 'updated', entity: {family: 'volcano-status', id: doc.id}, message: message(doc)});},
    release(index, value) {state.held[index](value);},
    commands: () => state.commands,
    paths: () => state.paths,
  };
`;
const NOW = Date.now(), MIN = 60_000;
const base = {id: 'volcano', revision: 3};
const status = (over: object = {}): object => ({schema: 'volcano-status/2.0', ...base, configurationRevision: 2, availability: 'available', link: 'connected', observedAtMs: NOW - 5000, receivedAtMs: NOW - 5000, heater: 'on', pump: 'off', status1: 1571, currentDeciC: 1850, targetDeciC: 1900, heatingCounterMinutes: 725, displayFahrenheit: true, gapMinutes: 15, recording: 'ok', ...over});
const stamp = (seq: number, at: number): object => ({seq, observedAtMs: at, receivedAtMs: at});
const span = (over: object = {}): object => ({startAtMs: NOW - 60 * MIN, startedBeforeObservation: false, endAtMs: NOW - 35 * MIN, endedUnobservedBy: null, lastObservedOnAtMs: NOW - 35 * MIN, open: false, observedHeatingMs: 25 * MIN, creditedMinutes: 0, pumpRuns: 1, ...over});
const stretch = (over: object = {}): object => ({...span(), unobserved: [], omittedUnobserved: 0, ...over});
const session = (over: object = {}, stretches: object[] = [stretch()]): object => ({...span(), discontinuities: 0, stretches, omittedStretches: 0, unobservedBetween: 0, ...over});
const empty = {
  timeline: {schema: 'volcano-timeline/2.0', ...base, facts: [], next: null}, sessions: {schema: 'volcano-sessions/2.0', ...base, gapMinutes: 15, preview: false, sessions: [], next: null},
  totals: {schema: 'volcano-totals/2.0', ...base, zone: 'UTC', gapMinutes: 15, days: [], next: null}, gaps: {schema: 'volcano-gaps/2.0', ...base, gapMinutes: 15, buckets: []},
};

async function states(): Promise<void> {
  const bundle = await build({
    stdin: {resolveDir: fileURLToPath(new URL('.', import.meta.url)), sourcefile: 'volcano-probe.js', contents: PROBE},
    bundle: true, write: false, format: 'iife', platform: 'browser', outdir: '/probe', jsx: 'automatic', loader: {'.tsx': 'tsx', '.ts': 'ts', '.css': 'css'}, define: {'process.env.NODE_ENV': '"development"'},
  });
  const code = bundle.outputFiles.find(file => file.path.endsWith('.js'))?.text, style = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text;
  assert.ok(code !== undefined && style !== undefined);
  const context = await browser.newContext({viewport: {width: 480, height: 900}, reducedMotion: 'reduce'});
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const failures: string[] = [];
  page.on('pageerror', error => { failures.push(error.message); });
  // Not a blank page: a command's request ID needs a secure context, as the dashboard has.
  await page.route('http://localhost:9/', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>probe</title><main id="root"></main>'}));
  await page.goto('http://localhost:9/');
  await page.addStyleTag({content: style}); await page.addScriptTag({content: code});
  const mount = async (value: {doc?: object; reads?: object; connected?: boolean; control?: boolean}): Promise<void> => {
    await page.evaluate(input => { (window as unknown as {volcanoProbe: {mount(input: unknown): void}}).volcanoProbe.mount(input); }, {reads: empty, ...value});
    await frame(page);
  };
  const card = page.locator('[data-volcano-card]');
  const paths = (target: Page): Promise<string[]> => target.evaluate(() => (window as unknown as {volcanoProbe: {paths(): string[]}}).volcanoProbe.paths());
  const update = (target: Page, doc: object): Promise<void> => target.evaluate(value => { (window as unknown as {volcanoProbe: {update(doc: unknown): void}}).volcanoProbe.update(value); }, doc);
  const tab = async (name: string): Promise<void> => { await card.getByRole('tab', {name, exact: true}).click(); };

  // Fresh.
  await mount({doc: status()});
  await card.getByText('Heating', {exact: true}).waitFor();
  await card.getByText('365 °F', {exact: true}).waitFor();
  await card.getByText('374 °F', {exact: true}).waitFor();
  await card.getByText('12 h 5 min', {exact: true}).waitFor();
  const reads = await page.evaluate(() => (window as unknown as {volcanoProbe: {paths(): string[]}}).volcanoProbe.paths());
  await tab('Timeline'); await tab('Sessions'); await tab('Totals'); await tab('Gaps');
  assert.deepEqual(await page.evaluate(() => (window as unknown as {volcanoProbe: {paths(): string[]}}).volcanoProbe.paths()), reads, 'switching tabs issues no read');
  assert.equal(reads.some(path => path.startsWith('/modules/volcano/content/totals?zone=')), true);

  // No history: nothing reads as zero use.
  await tab('Timeline'); await card.getByText(/Nothing recorded for this day\. That is not evidence of no use/u).waitFor();
  await tab('Sessions'); await card.getByText('No sessions recorded yet.', {exact: true}).waitFor();
  await tab('Totals'); await card.getByText('No days recorded yet.', {exact: true}).waitFor();
  await tab('Gaps'); await card.getByText('No separations between heating stretches yet.', {exact: true}).waitFor();
  assert.equal(await card.getByText(/\b0 min\b/u).count(), 0, 'no history is not a zero');

  // Stale: the stream failed after a reading, and a value it had says nothing now.
  await mount({doc: status({heater: 'off'})});
  await card.getByText('Heater off', {exact: true}).waitFor();
  await page.evaluate(() => { (window as unknown as {volcanoProbe: {fail(): void}}).volcanoProbe.fail(); });
  await card.getByText('Stale', {exact: true}).waitFor();
  assert.equal(await card.locator('.volcano-now dd', {hasText: /^Off$/u}).count(), 0);
  await card.locator('.volcano-now').getByText('Unknown', {exact: true}).first().waitFor();

  // Unavailable, including no state at all and a refused stream.
  await mount({doc: status({availability: 'unavailable', link: 'stale', heater: 'unknown', pump: 'unknown', currentDeciC: null, targetDeciC: null, heatingCounterMinutes: null})});
  await card.getByText('Unavailable', {exact: true}).waitFor();
  await card.getByRole('button', {name: 'Volcano status', exact: true}).click();
  await card.getByText(/The collector has stopped reporting\. The heater and pump are unknown, not off\./u).waitFor();
  await mount({connected: true});
  await card.getByText('Unavailable', {exact: true}).waitFor();
  await card.getByRole('button', {name: 'Volcano status', exact: true}).click();
  await card.getByText('Volcano read refused: forbidden.', {exact: true}).waitFor();
  assert.deepEqual(await page.evaluate(() => (window as unknown as {volcanoProbe: {paths(): string[]}}).volcanoProbe.paths()), [], 'a refused status reads no history');
  await mount({connected: false});
  await card.getByText('Unavailable', {exact: true}).waitFor();

  // Refused history shows as unavailable, never as an empty or zero history.
  await mount({doc: status(), reads: {timeline: {refuse: 'forbidden'}, sessions: {refuse: 'forbidden'}, totals: {refuse: 'forbidden'}, gaps: {refuse: 'forbidden'}}});
  await tab('Sessions'); await card.getByText('The session list is unavailable: forbidden.', {exact: true}).waitFor();
  await tab('Totals'); await card.getByText('The daily totals are unavailable: forbidden.', {exact: true}).waitFor();
  await tab('Gaps'); await card.getByText('The gap distribution is unavailable: forbidden.', {exact: true}).waitFor();
  await tab('Timeline'); await card.getByText('The timeline is unavailable: forbidden.', {exact: true}).waitFor();
  assert.equal(await card.getByText('No sessions recorded yet.').count(), 0);
  // A document that fails its check is refused the same way.
  await mount({doc: status(), reads: {...empty, sessions: {...empty.sessions, dose: 1}}});
  await tab('Sessions'); await card.getByText('The session list is unavailable: invalid-message.', {exact: true}).waitFor();

  // Partial session, counter discontinuity and a recovered gap.
  const gap = {...stamp(3, NOW - 40 * MIN), kind: 'gap', fromMs: NOW - 50 * MIN, toMs: NOW - 40 * MIN, heaterBefore: 'on', heaterAfter: 'on', creditedMinutes: 7};
  const timeline = [{...stamp(1, NOW - 60 * MIN), kind: 'heater', on: true, status1: 32, edge: 'first-observation'}, gap,
    {...stamp(4, NOW - 39 * MIN), kind: 'discontinuity', reason: 'counter-decrease', lastReadingAtMs: NOW - 50 * MIN}, {...stamp(5, NOW - 35 * MIN), kind: 'heater', on: false, status1: 0, edge: 'observed'}];
  const crossed = stretch({startedBeforeObservation: true, endAtMs: null, endedUnobservedBy: NOW - 35 * MIN, creditedMinutes: 7, observedHeatingMs: 15 * MIN, unobserved: [{fromMs: NOW - 50 * MIN, toMs: NOW - 40 * MIN, creditedMinutes: 7}]});
  await mount({doc: status(), reads: {
    ...empty, timeline: {...empty.timeline, facts: timeline},
    sessions: {...empty.sessions, sessions: [session({startedBeforeObservation: true, endAtMs: null, endedUnobservedBy: NOW - 35 * MIN, creditedMinutes: 7, observedHeatingMs: 15 * MIN, discontinuities: 1}, [crossed])]},
    totals: {...empty.totals, days: [{date: '2026-11-04', observedHeatingMs: 15 * MIN, creditedMinutes: 7, stretches: 1, sessions: 1, pumpRuns: 1}]},
    gaps: {...empty.gaps, buckets: [{fromMinutes: 0, toMinutes: 5, count: 0, uncertain: 0}, {fromMinutes: 15, toMinutes: 30, count: 3, uncertain: 1}]},
  }});
  await tab('Timeline');
  await card.locator('li[data-kind=gap]').getByText(/Heater on before, on after; counter gained 7 min\./u).waitFor();
  await card.locator('li[data-kind=discontinuity]').getByText('No counter credit is counted across this.', {exact: true}).waitFor();
  const heating = await card.locator('li[data-kind=heating]').first().innerText();
  assert.match(heating, /may have started earlier/u); assert.doesNotMatch(heating, /\b\d+ min\b/u, 'no duration through the unobserved interval');
  await tab('Sessions');
  const row = card.locator('li[data-kind=session]');
  assert.equal(await row.getAttribute('data-partial'), 'true');
  await row.getByText(/^First seen on /u).waitFor();
  await row.getByText(/^End not seen: last on .*, off by /u).waitFor();
  assert.deepEqual(await row.locator('.volcano-facts > div').evaluateAll(nodes => nodes.map(node => node.textContent)), ['Observed heating15 min', 'Stretches1', 'Pump runs1', 'Unobserved intervals1', 'Counter credit7 min', 'Discontinuities1']);
  await tab('Totals'); await card.getByText('15 min observed · 7 min credited · 1 session · 1 pump run', {exact: true}).waitFor();
  await tab('Gaps');
  assert.equal(await card.locator('.volcano-buckets > li').count(), 1, 'an empty bucket is not drawn');
  await card.getByText('3 (1 uncertain)', {exact: true}).waitFor();
  assert.equal(await card.locator('.volcano-buckets > li').getAttribute('data-threshold'), 'true');

  // Unknown credit and a gap between stretches, on the session as the module sends them.
  await mount({doc: status(), reads: {...empty, sessions: {...empty.sessions, sessions: [session({unobservedBetween: 1}, [stretch(), stretch({startAtMs: NOW - 30 * MIN, unobserved: [{fromMs: NOW - 29 * MIN, toMs: NOW - 28 * MIN, creditedMinutes: null}]})])]}}});
  await tab('Sessions');
  assert.deepEqual(await card.locator('li[data-kind=session] .volcano-facts > div').evaluateAll(nodes => nodes.map(node => node.textContent)), ['Observed heating25 min', 'Stretches2', 'Pump runs1', 'Unobserved intervals2', 'Counter creditUnknown']);
  await card.getByText('Incomplete evidence: the heater may have run at times not observed here.', {exact: true}).waitFor();

  // The same open session: being watched it is simply running, and with the feed lost it may be running unseen.
  const open = {...empty.sessions, sessions: [session({endAtMs: null, open: true}, [stretch({endAtMs: null, open: true})])]};
  await mount({doc: status(), reads: {...empty, sessions: open}});
  await tab('Sessions');
  await card.getByText(/^No end seen yet/u).waitFor();
  assert.equal(await card.getByText(/Incomplete evidence/u).count(), 0);
  await mount({doc: status({availability: 'unavailable', link: 'disconnected', heater: 'unknown', pump: 'unknown', currentDeciC: null, targetDeciC: null, heatingCounterMinutes: null}), reads: {...empty, sessions: open}});
  await tab('Sessions');
  await card.getByText(/Incomplete evidence/u).waitFor();

  // A preview asks for the threshold it names, and shows that grouping beside the saved one.
  const saved = {...empty.sessions, sessions: [session(), session({startAtMs: NOW - 90 * MIN})]};
  await mount({doc: status(), reads: {...empty, sessions: saved, 'sessions?limit=25&gapMinutes=30': {...empty.sessions, gapMinutes: 30, preview: true, sessions: [session({}, [stretch(), stretch()])]}}});
  await tab('Gaps');
  await card.getByLabel('Session gap (1 to 240 min)').fill('30');
  await card.getByRole('button', {name: 'Preview', exact: true}).click();
  await card.getByRole('region', {name: 'Regroup preview'}).getByText('At 30 min: 1 session. Saved threshold: 2 sessions. Nothing is stored by a preview.', {exact: true}).waitFor();
  await card.getByRole('region', {name: 'Regroup preview'}).getByText('2 stretches', {exact: true}).waitFor();
  assert.equal((await paths(page)).includes('/modules/volcano/content/sessions?limit=25&gapMinutes=30'), true);
  // An answer for another threshold is refused, not shown as this preview.
  await mount({doc: status(), reads: {...empty, sessions: saved, 'sessions?limit=25&gapMinutes=30': saved}});
  await tab('Gaps');
  await card.getByLabel('Session gap (1 to 240 min)').fill('30');
  await card.getByRole('button', {name: 'Preview', exact: true}).click();
  await card.getByText('The preview is unavailable: invalid-message.', {exact: true}).waitFor();

  // Paging: each pager moves its own read, a saved threshold starts the sessions over, and the day buttons move the window.
  await mount({doc: status(), reads: {...empty, sessions: {...saved, next: '15:30'}, timeline: {...empty.timeline, next: '100-3'}}});
  await tab('Sessions');
  const sessionsPanel = card.locator('[role=tabpanel]:not([hidden])');
  await sessionsPanel.getByRole('button', {name: 'Older', exact: true}).click();
  await page.waitForFunction(() => (window as unknown as {volcanoProbe: {paths(): string[]}}).volcanoProbe.paths().some(path => path.includes('sessions?limit=25&cursor=15%3A30')));
  assert.equal(await sessionsPanel.getByRole('button', {name: 'Newer', exact: true}).isEnabled(), true);
  await update(page, status({revision: 4, configurationRevision: 3, gapMinutes: 30}));
  await frame(page);
  assert.equal(await sessionsPanel.getByRole('button', {name: 'Newer', exact: true}).isDisabled(), true, 'a cursor counts under one threshold, so the save starts over');
  assert.equal((await paths(page)).filter(path => path.includes('sessions?')).at(-1)?.includes('cursor='), false);
  await tab('Timeline');
  const firstDay = (await paths(page)).find(path => path.includes('timeline?'));
  await card.getByRole('button', {name: 'Later', exact: true}).click();
  await page.waitForFunction(() => (window as unknown as {volcanoProbe: {paths(): string[]}}).volcanoProbe.paths().some(path => path.includes('timeline?') && path.includes('cursor=100-3')));
  await card.getByText('Nothing more for this day.', {exact: true}).waitFor();
  assert.equal(await card.getByText(/Nothing recorded for this day/u).count(), 0, 'a later empty page does not unsay the page before it');
  await card.getByRole('button', {name: 'Previous day', exact: true}).click();
  await frame(page);
  const previousDay = (await paths(page)).filter(path => path.includes('timeline?')).at(-1);
  assert.notEqual(previousDay?.split('&limit')[0], firstDay?.split('&limit')[0], 'the previous day reads another window');
  assert.equal(previousDay?.includes('cursor='), false, 'and starts at its first page');

  // A slow answer that a newer read has overtaken is dropped.
  await mount({doc: status(), reads: {...empty, sessions: {defer: true}}});
  await tab('Sessions');
  await update(page, status({revision: 4, configurationRevision: 3, gapMinutes: 30}));
  await frame(page);
  await page.evaluate(value => { (window as unknown as {volcanoProbe: {release(index: number, value: unknown): void}}).volcanoProbe.release(1, value); }, {...empty.sessions, gapMinutes: 30, sessions: [session({startAtMs: NOW - 200 * MIN})]});
  await card.locator('li[data-kind=session]').waitFor();
  const newest = await card.locator('li[data-kind=session] .volcano-row-title').innerText();
  await page.evaluate(value => { (window as unknown as {volcanoProbe: {release(index: number, value: unknown): void}}).volcanoProbe.release(0, value); }, {...empty.sessions, sessions: [session({startAtMs: NOW - 2 * 1440 * MIN})]});
  await frame(page);
  assert.equal(await card.locator('li[data-kind=session] .volcano-row-title').innerText(), newest, 'the older answer does not replace the newer one');

  // A status arriving after the stream failed makes the card live again, rather than leaving it stale.
  await page.evaluate(() => { (window as unknown as {volcanoProbe: {fail(): void}}).volcanoProbe.fail(); });
  await card.getByText('Stale', {exact: true}).waitFor();
  await update(page, status({revision: 9}));
  await card.getByText('Heating', {exact: true}).waitFor();

  // The save carries the revision it was made against, once. Without control it cannot be sent.
  await mount({doc: status()});
  await tab('Gaps');
  await card.getByLabel('Session gap (1 to 240 min)').fill('30');
  await card.getByRole('button', {name: 'Save', exact: true}).click();
  const sent = await page.evaluate(() => (window as unknown as {volcanoProbe: {commands(): {family: string; target: string; data: unknown}[]}}).volcanoProbe.commands());
  assert.equal(sent.length, 1); assert.equal(sent[0]?.family, 'volcano-session-gap'); assert.equal(sent[0]?.target, 'volcano');
  assert.deepEqual(sent[0]?.data, {gapMinutes: 30, expectedConfigurationRevision: 2});
  await mount({doc: status(), control: false});
  await tab('Gaps');
  await card.getByLabel('Session gap (1 to 240 min)').fill('30');
  assert.equal(await card.getByRole('button', {name: 'Save', exact: true}).isDisabled(), true);
  await card.getByText('Saving needs control access. Previews still work.', {exact: true}).waitFor();
  assert.deepEqual(failures, []);

  // History reads follow a new revision at most every 30 s, and never on a timer of their own.
  const held = await context.newPage();
  await held.clock.install({time: NOW});
  await held.route('http://localhost:9/', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>probe</title><main id="root"></main>'}));
  await held.goto('http://localhost:9/');
  await held.addStyleTag({content: style}); await held.addScriptTag({content: code});
  const gapReads = async (): Promise<number> => (await paths(held)).filter(path => path.endsWith('/gaps')).length;
  await held.evaluate(input => { (window as unknown as {volcanoProbe: {mount(input: unknown): void}}).volcanoProbe.mount(input); }, {doc: status(), reads: empty});
  await held.clock.runFor(50);
  assert.equal(await gapReads(), 1, 'one read when the card mounts, not one for each key on the way');
  await held.clock.runFor(120_000);
  assert.equal(await gapReads(), 1, 'an idle card reads nothing');
  await update(held, status({revision: 4}));
  await held.clock.runFor(50);
  assert.equal(await gapReads(), 2, 'a revision after a quiet spell reads at once');
  await update(held, status({revision: 5})); await held.clock.runFor(50); await update(held, status({revision: 6})); await held.clock.runFor(29_000);
  assert.equal(await gapReads(), 2, 'revisions inside the spacing wait');
  await held.clock.runFor(1500);
  assert.equal(await gapReads(), 3, 'then the latest one reads, once');
  await update(held, status({revision: 7, configurationRevision: 3, gapMinutes: 30})); await held.clock.runFor(50);
  assert.equal(await gapReads(), 4, 'a threshold change does not wait');
  await context.close();
}

try {
  await states();
  await journey();
} finally {
  await browser.close();
}
