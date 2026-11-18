// Conversations in the rail (Hub #1890): one link for each chat profile on every page, and a marker when a
// conversation needs the owner's answer. The first part mounts the companions frontend's rail group with state changes
// and saved-question reads that a healthy runtime cannot manufacture. The second part is the real dashboard and runtime.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium, type Browser, type Page} from 'playwright';
import {feed, startWorld} from './harness.ts';
import {chooseConversation, conversationLink, destinationLink, openDeviceMenu, routeCatalog, showRail, type CatalogModule} from './navigation-helpers.ts';

type Row = {name: string; current: boolean; marked: boolean};
const NAMES = ['B.U.N.N.Y.', 'Reachy Demo', 'MicroDuck Demo'];
const rows = (page: Page): Promise<Row[]> => page.getByRole('navigation', {name: 'Conversations', exact: true}).getByRole('link').evaluateAll(links => links.map(link => ({
  name: [...link.querySelectorAll('.rail-text > *')].map(part => part.textContent).join(' '), current: link.getAttribute('aria-current') === 'page',
  marked: link.querySelector('.rail-attention') !== null})));
const plain = (names: readonly string[] = NAMES): Row[] => names.map(name => ({name, current: false, marked: false}));

/** The rail group alone, with the Conversation page beside it when a step asks for it. */
async function railGroupFixture(browser: Browser): Promise<void> {
  const bundle = await build({stdin: {contents: `
    import React, {useEffect} from 'react'; import {createRoot} from 'react-dom/client';
    import {ConversationRail, useConversationWaiting} from '../../../../modules/companions/src/frontend/conversation-rail-group.tsx';
    import {AssistantPage} from '../../../../modules/companions/src/frontend/assistant.tsx';
    import {Command} from '../src/command-control.tsx';
    import {Facts, Select} from '../src/ui.tsx';
    import '../src/skins/quiet-glass.css';
    const fixture = window.railFixture = {reads: [], commands: [], speech: 0, failReads: 0, stale: false};
    const state = {id: 'assistant', revision: 1, enabled: true, available: true, provider: 'synthetic', model: 'synthetic', tools: [], tasks: []};
    const tasks = {}, questions = {};
    const listeners = new Set(), restarts = new Set();
    const emit = change => {for (const listener of [...listeners]) listener(change);};
    const copyOf = () => ({...state, tasks: Object.values(tasks)});
    const publish = () => {state.revision += 1; emit({type: 'updated', message: {data: copyOf()}});};
    fixture.ask = (profile, id, kind) => {
      questions[profile] = {id, text: 'Synthetic question ' + id, answer: null, kind,
        proposal: kind === 'approval' ? {family: 'mode-set', target: 'hub', data: {mode: 'quiet'}, expectedRevision: 2} : null};
      tasks[profile] = {taskId: 'task-' + profile, conversationId: 'conversation-' + profile, profile, status: 'waiting', runId: null, questionId: id,
        hasAnswer: false, code: null, modelCalls: 1, toolCalls: 0, questions: 1, activeMs: 0, usageUnits: null, reservedUnits: 0};
      publish();
    };
    fixture.touch = publish;
    fixture.patch = (profile, change) => {tasks[profile] = {...tasks[profile], ...change}; publish();};
    fixture.available = value => {state.available = value; publish();};
    fixture.remove = () => {emit({type: 'removed', entity: {id: 'assistant'}});};
    fixture.fail = () => {emit({type: 'failed', error: {code: 'unavailable'}});};
    fixture.restart = () => {for (const restarted of [...restarts]) restarted();};
    fixture.resync = () => {emit({type: 'synced'});};
    const accepted = action => {fixture.commands.push(action); return Promise.resolve({status: 'accepted', requestId: action.requestId});};
    const api = {
      speech: {open: async () => {fixture.speech += 1; throw new Error('no synthetic speech endpoint');}},
      read: async path => {
        const url = new URL(path, location.href), profile = url.searchParams.get('profile');
        // The page also reads content that is not a conversation; only history reads are counted and failed.
        if (profile === null) return {};
        fixture.reads.push(profile);
        if (fixture.failReads > 0) {fixture.failReads -= 1; throw new Error('synthetic read failure');}
        const task = tasks[profile], question = questions[profile];
        if (task === undefined) return {version: 2, profile, conversationId: null, older: null, currentTask: null, messages: []};
        return {version: 2, profile, conversationId: task.conversationId, older: null,
          currentTask: {taskId: task.taskId, question: question === undefined ? null : fixture.stale ? {...question, id: 'an-earlier-question'} : question},
          messages: [{id: 'saved-' + profile, seq: 1, taskId: task.taskId, role: 'owner', text: 'Synthetic saved message for ' + profile, atMs: 1}]};
      },
      sync: async (families, callback, options) => {
        if (!families.includes('assistant-state')) return {status: 'rejected'};
        listeners.add(callback);
        if (options?.onRestarted !== undefined) restarts.add(options.onRestarted);
        return {status: 'synced', copy: {states: () => [{data: copyOf()}], close: async () => {listeners.delete(callback); restarts.delete(options?.onRestarted);}}};
      },
      command: accepted, upload: accepted,
    };
    const shown = {page: false, rail: true, connected: true, tick: 0};
    let flushed = () => {};
    function Probe({tick}) {
      const waiting = useConversationWaiting();
      // Runs after the rail group's own effects in the same commit, so a read the group starts has been counted.
      useEffect(() => {flushed();}, [tick]);
      return React.createElement('output', {id: 'waiting-elsewhere'}, String(waiting));
    }
    const root = createRoot(document.getElementById('root'));
    const context = () => ({module: 'companions', api, ui: {Command, Facts, Select}, connected: shown.connected, control: true, operations: [], operationsLive: true});
    const render = () => {root.render(React.createElement(React.Fragment, null,
      shown.rail ? React.createElement('aside', null, React.createElement(ConversationRail, {context: {...context(), control: false, operationsLive: false}})) : null,
      React.createElement(Probe, {tick: shown.tick}),
      shown.page ? React.createElement('main', null, React.createElement(AssistantPage, {context: context()})) : null));};
    fixture.page = value => {shown.page = value; render();};
    fixture.rail = value => {shown.rail = value; render();};
    fixture.connected = value => {shown.connected = value; render();};
    fixture.settle = () => new Promise(resolve => {flushed = resolve; shown.tick += 1; render();});
    render();
  `, resolveDir: fileURLToPath(new URL('.', import.meta.url)), sourcefile: 'conversation-rail-entry.js'},
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, outdir: '.'});
  const context = await browser.newContext();
  try {
    const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))?.text ?? assert.fail('conversation rail bundle');
    const style = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? assert.fail('conversation rail stylesheet');
    await context.route('https://conversation-rail.invalid/**', route => {
      switch (new URL(route.request().url()).pathname) {
        case '/bundle.js': return route.fulfill({contentType: 'text/javascript', body: script});
        case '/bundle.css': return route.fulfill({contentType: 'text/css', body: style});
        default: return route.fulfill({contentType: 'text/html', body: '<!doctype html><html lang="en"><title>Synthetic conversation rail</title><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script type="module" src="/bundle.js"></script></html>'});
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    // The page's clock is held, so a step can show that nothing here reads on a timer.
    await page.clock.install();
    await page.goto('https://conversation-rail.invalid/');
    type Fixture = {reads: string[]; commands: unknown[]; speech: number; failReads: number; stale: boolean;
      ask(profile: string, id: string, kind: string): void; touch(): void; patch(profile: string, change: object): void; available(value: boolean): void;
      remove(): void; fail(): void; restart(): void; resync(): void; page(value: boolean): void; rail(value: boolean): void; connected(value: boolean): void; settle(): Promise<void>};
    const call = async (run: (fixture: Fixture) => void): Promise<void> => {
      await page.evaluate(`(${run.toString()})(window.railFixture)`);
      await page.evaluate(() => (window as unknown as {railFixture: Fixture}).railFixture.settle());
    };
    const reads = (): Promise<string[]> => page.evaluate(() => (window as unknown as {railFixture: Fixture}).railFixture.reads);
    const elsewhere = async (): Promise<boolean> => await page.locator('#waiting-elsewhere').innerText() === 'true';
    // This page has no shell stylesheet, so the dot has no size: it is looked for in the document, not on the screen.
    const marked = (profile: string) => page.locator(`aside a[data-profile="${profile}"] .rail-attention`);
    const mark = (names: readonly string[], ...which: number[]): Row[] => names.map((name, index) => ({name, current: false, marked: which.includes(index)}));
    const waitingNames = ['B.U.N.N.Y. Needs your answer', 'Reachy Demo', 'MicroDuck Demo'];

    await page.getByRole('navigation', {name: 'Conversations', exact: true}).waitFor();
    await call(() => {});
    assert.deepEqual(await rows(page), plain(), 'three profiles, both demos labelled, none open and none marked');
    assert.deepEqual([await reads(), await elsewhere()], [[], false], 'a conversation with no question is not read');

    // A clarification needs the owner: the group reads that profile's recent history once to learn the question's kind.
    await call(fixture => {fixture.ask('bunny', 'q1', 'clarification');});
    await marked('bunny').waitFor({state: 'attached'});
    assert.deepEqual(await rows(page), mark(waitingNames, 0));
    assert.deepEqual([await reads(), await elsewhere()], [['bunny'], true]);
    await call(fixture => {fixture.touch();});
    await page.clock.runFor(120_000);
    await call(() => {});
    assert.deepEqual(await reads(), ['bunny'], 'a kind that is known is not read again, on a state change or on a timer');
    // An answer that is saved, a running task and a finished one need nothing from the owner.
    for (const change of [{hasAnswer: true}, {hasAnswer: false, status: 'running'}, {status: 'succeeded', questionId: null}]) {
      await page.evaluate(patch => {(window as unknown as {railFixture: Fixture}).railFixture.patch('bunny', patch);}, change);
      await marked('bunny').waitFor({state: 'detached'});
      assert.deepEqual([await rows(page), await elsewhere()], [plain(), false], JSON.stringify(change));
    }
    assert.deepEqual(await reads(), ['bunny']);
    // A paused task with an unanswered question still needs the answer.
    await call(fixture => {fixture.patch('bunny', {status: 'paused', questionId: 'q1', hasAnswer: false});});
    await marked('bunny').waitFor({state: 'attached'});
    assert.deepEqual(await reads(), ['bunny'], 'the same question keeps its known kind');

    // A wait on the coding worker shows no marker. An approval does.
    await call(fixture => {fixture.ask('bunny', 'q2', 'delegation');});
    await page.waitForFunction(() => (window as unknown as {railFixture: Fixture}).railFixture.reads.length === 2);
    await call(() => {});
    assert.deepEqual([await rows(page), await reads(), await elsewhere()], [plain(), ['bunny', 'bunny'], false], 'delegated work asks nothing of the owner');
    await call(fixture => {fixture.ask('bunny', 'q3', 'approval');});
    await marked('bunny').waitFor({state: 'attached'});
    assert.deepEqual(await reads(), ['bunny', 'bunny', 'bunny'], 'each new question is read once');

    // Without a live state copy there is no marker, and the rows stay links. A copy that is live again brings it back
    // without another read.
    const lost: [string, (fixture: Fixture) => void, (fixture: Fixture) => void][] = [
      ['removed', fixture => {fixture.remove();}, fixture => {fixture.touch();}],
      ['failed', fixture => {fixture.fail();}, fixture => {fixture.resync();}],
      ['restarted', fixture => {fixture.restart();}, fixture => {fixture.resync();}],
      ['unavailable', fixture => {fixture.available(false);}, fixture => {fixture.available(true);}],
      ['disconnected', fixture => {fixture.connected(false);}, fixture => {fixture.connected(true);}],
    ];
    for (const [name, lose, recover] of lost) {
      await call(lose);
      await marked('bunny').waitFor({state: 'detached'});
      assert.deepEqual([await rows(page), await elsewhere()], [plain(), false], `${name}: nothing is claimed from a copy that is not live`);
      assert.equal(await page.locator('aside a[data-profile="bunny"]').getAttribute('href'), '#/module/companions/assistant', `${name}: the row is still a link`);
      await call(recover);
      await marked('bunny').waitFor({state: 'attached'});
    }
    assert.deepEqual(await reads(), ['bunny', 'bunny', 'bunny'], 'a recovered copy with a known question reads nothing');

    // A read that fails leaves the question unclaimed. It is made again when the state copy next changes, never on a timer.
    await call(fixture => {fixture.failReads = 1; fixture.ask('reachy', 'q4', 'clarification');});
    await page.waitForFunction(() => (window as unknown as {railFixture: Fixture}).railFixture.reads.length === 4);
    await call(() => {});
    await page.clock.runFor(120_000);
    await call(() => {});
    assert.deepEqual([await marked('reachy').count(), await reads()], [0, ['bunny', 'bunny', 'bunny', 'reachy']], 'a failed read claims nothing and is not repeated on a timer');
    await call(fixture => {fixture.touch();});
    await marked('reachy').waitFor({state: 'attached'});
    assert.deepEqual(await reads(), ['bunny', 'bunny', 'bunny', 'reachy', 'reachy'], 'the next state change reads it again');
    assert.deepEqual(await rows(page), [{name: 'B.U.N.N.Y. Needs your answer', current: false, marked: true}, {name: 'Reachy Demo Needs your answer', current: false, marked: true}, {name: 'MicroDuck Demo', current: false, marked: false}],
      'a waiting demo keeps its Demo label');
    // Saved history that holds another question says nothing about this one.
    await call(fixture => {fixture.stale = true; fixture.ask('microduck', 'q5', 'clarification');});
    await page.waitForFunction(() => (window as unknown as {railFixture: Fixture}).railFixture.reads.length === 6);
    await call(() => {});
    await page.clock.runFor(120_000);
    await call(() => {});
    assert.deepEqual([await marked('microduck').count(), (await reads()).length], [0, 6], 'an earlier question is not taken for the pending one, and is not read in a loop');
    await call(fixture => {fixture.stale = false; fixture.touch();});
    await marked('microduck').waitFor({state: 'attached'});
    assert.equal((await reads()).length, 7);

    // The open Conversation page reads its own profile's history and shares the kind, so the group does not read it too.
    await call(fixture => {fixture.patch('reachy', {status: 'succeeded', questionId: null}); fixture.patch('microduck', {status: 'succeeded', questionId: null}); fixture.patch('bunny', {status: 'succeeded', questionId: null});});
    await marked('bunny').waitFor({state: 'detached'});
    await call(fixture => {fixture.page(true);});
    await page.getByRole('region', {name: 'B.U.N.N.Y. conversation', exact: true}).getByText('Synthetic saved message for bunny', {exact: true}).waitFor();
    assert.deepEqual((await rows(page)).map(row => row.current), [true, false, false], 'the open conversation is marked in the rail');
    const before = (await reads()).length;
    await call(fixture => {fixture.ask('bunny', 'q6', 'clarification');});
    await marked('bunny').waitFor({state: 'attached'});
    await call(() => {});
    assert.equal((await reads()).length, before + 1, 'one read of the open profile: the page\'s own');
    assert.equal(await elsewhere(), false, 'the open conversation shows its own question; nothing waits elsewhere');
    // A question in another profile is read by the group, and waits elsewhere.
    await call(fixture => {fixture.patch('bunny', {status: 'succeeded', questionId: null});});
    await marked('bunny').waitFor({state: 'detached'});
    const beforeOther = (await reads()).filter(profile => profile === 'reachy').length;
    await call(fixture => {fixture.ask('reachy', 'q7', 'approval');});
    await marked('reachy').waitFor({state: 'attached'});
    assert.deepEqual([(await reads()).filter(profile => profile === 'reachy').length, await elsewhere()], [beforeOther + 1, true]);

    // A row chooses its profile for the page without leaving it. A modified click chooses nothing here.
    const heading = page.locator('.conversation-header h2');
    await page.locator('aside a[data-profile="reachy"]').click();
    await heading.getByText('Reachy', {exact: true}).waitFor();
    await page.getByRole('region', {name: 'B.U.N.N.Y. conversation', exact: true}).getByText('Synthetic saved message for reachy', {exact: true}).waitFor();
    assert.deepEqual([(await rows(page)).map(row => row.current), await elsewhere(), new URL(page.url()).hash], [[false, true, false], false, '#/module/companions/assistant']);
    await page.locator('aside a[data-profile="microduck"]').dispatchEvent('click', {button: 0, metaKey: true, bubbles: true, cancelable: true});
    await call(() => {});
    assert.equal(await heading.innerText(), 'Reachy', 'a modified click leaves the open conversation as it is');
    // Leaving the page keeps the chosen profile for the next visit, and marks no row open.
    await call(fixture => {fixture.page(false);});
    assert.deepEqual([(await rows(page)).map(row => row.current), await elsewhere()], [[false, false, false], true]);
    await call(fixture => {fixture.page(true);});
    await heading.getByText('Reachy', {exact: true}).waitFor();
    assert.deepEqual(await page.evaluate(() => {const fixture = (window as unknown as {railFixture: Fixture}).railFixture; return [fixture.commands.length, fixture.speech];}), [0, 0],
      'the group and choosing a profile send no command and open no speech endpoint');
    // A failed read is made again without a state change in two cases, and in no other: when the state copy is live
    // again, and when the open Conversation page stops showing that profile.
    await call(fixture => {fixture.page(false);});
    const readsOf = async (profile: string): Promise<number> => (await reads()).filter(read => read === profile).length;
    const readsReach = (profile: string, count: number) => page.waitForFunction(([name, wanted]) =>
      (window as unknown as {railFixture: Fixture}).railFixture.reads.filter(read => read === name).length === wanted, [profile, count] as const);
    const duckReads = await readsOf('microduck');
    await call(fixture => {fixture.failReads = 1; fixture.ask('microduck', 'q8', 'clarification');});
    await readsReach('microduck', duckReads + 1);
    await call(() => {});
    assert.equal(await marked('microduck').count(), 0, 'the failed read claims nothing');
    await call(fixture => {fixture.fail();});
    await call(fixture => {fixture.resync();});
    await marked('microduck').waitFor({state: 'attached'});
    assert.equal(await readsOf('microduck'), duckReads + 2, 'a copy that is live again reads the question once more');
    await page.locator('aside a[data-profile="bunny"]').click();
    const bunnyReads = await readsOf('bunny');
    await call(fixture => {fixture.failReads = 2; fixture.ask('bunny', 'q9', 'clarification');});
    await readsReach('bunny', bunnyReads + 1);
    await call(fixture => {fixture.page(true);});
    await readsReach('bunny', bunnyReads + 2);
    await call(() => {});
    await page.clock.runFor(120_000);
    await call(() => {});
    assert.deepEqual([await marked('bunny').count(), await readsOf('bunny')], [0, bunnyReads + 2], 'the group and then the open page failed to read the question: nothing is claimed and nothing is read again');
    await page.locator('aside a[data-profile="reachy"]').click();
    await marked('bunny').waitFor({state: 'attached'});
    assert.equal(await readsOf('bunny'), bunnyReads + 3, 'when the page stops showing the profile the group reads its question once more');
    // A group that is taken out of the rail takes its claim with it: nothing is said to wait without it.
    await call(fixture => {fixture.page(false);});
    assert.equal(await elsewhere(), true);
    await call(fixture => {fixture.rail(false);});
    assert.equal(await elsewhere(), false, 'without the group nothing is claimed to wait');
  } finally {
    await context.close();
  }
}

/** The real dashboard: the group in the rail on every page, the marker, the phone menu button and the catalog. */
async function railInDashboard(browser: Browser): Promise<void> {
  const world = await startWorld({devices: true, pixooPages: true, companions: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    const historyReads: string[] = [], posts: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname === '/modules/companions/content/conversation') historyReads.push(url.searchParams.get('profile') ?? '');
      if (request.method() === 'POST' && /^\/api\/sdk\/v1\/(request|respond|upload|publish)$/.test(url.pathname)) posts.push(url.pathname);
    });
    await page.goto(`${world.url}/#/`);
    await feed(page, 'connected');
    const conversations = page.getByRole('navigation', {name: 'Conversations', exact: true});
    await conversations.waitFor();
    const assistant = page.getByRole('region', {name: 'B.U.N.N.Y. conversation', exact: true});
    const header = assistant.locator('.conversation-header');
    const message = assistant.getByRole('textbox', {name: 'Message', exact: true});
    const menuButton = page.getByRole('button', {name: 'Open navigation', exact: true});
    const marked = (profile: string) => conversations.locator(`a[data-profile="${profile}"] .rail-attention`);
    assert.deepEqual(await rows(page), plain(), 'on Home the rail lists the three conversations, none open');
    // The group sits in the rail's bottom group: after the pinned pages and above Settings.
    assert.deepEqual(await page.locator('.shell>aside').evaluate(rail => [...rail.children].map(child => child.className.split(' ')[0])),
      ['rail-head', 'secondary', 'primary-navigation', 'rail-pins', 'rail-conversations', 'sidebar-foot']);
    assert.deepEqual(historyReads, [], 'with no question pending the rail reads no history');
    // In a window too short for the rail it scrolls with the page. Its parts stay together at the top: the
    // conversations and the foot are directly under the pinned pages, not at the end of a long page.
    await page.setViewportSize({width: 1280, height: 600});
    await page.waitForFunction(() => document.querySelector('.shell')?.hasAttribute('data-rail-short') === true);
    assert.deepEqual(await page.locator('.shell>aside').evaluate(rail => {
      const gap = Number.parseFloat(getComputedStyle(rail).rowGap), total = document.documentElement.scrollHeight;
      const [pins, group, foot] = ['.rail-pins', '.rail-conversations', '.sidebar-foot'].map(part => rail.querySelector(part)?.getBoundingClientRect());
      if (pins === undefined || group === undefined || foot === undefined) throw new Error('The rail has its pinned pages, its conversations and a foot.');
      return {position: getComputedStyle(rail).position, tallerPage: total > innerHeight + 100, together: Math.abs(group.top - pins.bottom - gap) <= 1 && Math.abs(foot.top - group.bottom - gap) <= 1,
        footAtPageEnd: total - (foot.bottom + scrollY) < 40};
    }), {position: 'static', tallerPage: true, together: true, footAtPageEnd: false}, 'a short window keeps the conversations and the foot directly under the pinned pages');
    await page.setViewportSize({width: 1440, height: 1000});
    await page.waitForFunction(() => document.querySelector('.shell')?.hasAttribute('data-rail-short') === false);
    // A row is as wide as the rail and no wider. The name and the Demo label share a line where they fit; with a font
    // too wide for one line the label moves under the name inside the row, and neither is cut. Which of the two a row
    // shows depends on the computer's fonts: the Linux container's are wider than a Mac's, and "MicroDuck" with its
    // label does not fit one line there. So `lines` is what each row shows and `room` what its own widths call for.
    // `room` uses the width of the name's and the label's own text, not of their laid-out boxes, so a style that
    // stretched the label onto a line of its own would not pass for a label with no room.
    const fit = (): Promise<{inRail: boolean; whole: boolean; lines: number[]; room: number[]}> => conversations.evaluate(group => {
      const inside = group.getBoundingClientRect(), links = [...group.querySelectorAll('a')];
      const written = (element: Element | null): number => {
        if (element === null) return 0;
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getBoundingClientRect().width;
      };
      const parts = links.map(link => ({row: link.getBoundingClientRect(), text: link.querySelector('.rail-text'), name: link.querySelector('.rail-text > span')?.getBoundingClientRect(),
        tag: link.querySelector('.rail-tag')?.getBoundingClientRect(), nameText: written(link.querySelector('.rail-text > span')), tagText: written(link.querySelector('.rail-tag'))}));
      return {inRail: links.every(link => link.getBoundingClientRect().right <= inside.right + 0.5 && link.getBoundingClientRect().width <= inside.width + 0.5),
        whole: links.every(link => link.scrollWidth <= link.clientWidth + 1 && [...link.querySelectorAll('.rail-text > *')].every(part => part.scrollWidth <= part.clientWidth + 1 || getComputedStyle(part).position === 'absolute')),
        lines: parts.map(({row, name, tag}) => name === undefined ? 0 : tag === undefined ? 1 : tag.top >= name.bottom - 2 && tag.bottom <= row.bottom ? 2 : tag.left >= name.right ? 1 : 0),
        room: parts.map(({text, name, tag, nameText, tagText}) => {
          if (text === null || name === undefined) return 0;
          return tag === undefined || nameText + Number.parseFloat(getComputedStyle(text).columnGap) + tagText <= text.getBoundingClientRect().width + 0.01 ? 1 : 2;
        })};
    });
    const natural = await fit();
    assert.deepEqual([natural.inRail, natural.whole, natural.lines, natural.lines[0]], [true, true, natural.room, 1],
      `each conversation row fits the rail, on one line where its name and label have the room: ${JSON.stringify(natural)}`);
    // The page's content security policy refuses an added stylesheet, so the wider font is set on the rows themselves.
    const fontSize = (size: string): Promise<void> => conversations.evaluate((group, value) => {for (const link of group.querySelectorAll('a')) link.style.fontSize = value;}, size);
    await fontSize('1.3rem');
    const wider = await fit();
    assert.deepEqual([wider.inRail, wider.whole, wider.lines, wider.lines[0], wider.lines[2]], [true, true, wider.room, 1, 2],
      `with a wider font the longest name's Demo label moves under it and nothing is cut: ${JSON.stringify(wider)}`);
    await fontSize('');

    // From Home, Rooms and a device page, one click opens that profile with its own history.
    await (await conversationLink(page, 'reachy')).click();
    await header.getByRole('heading', {name: 'Reachy', exact: true}).waitFor();
    assert.equal(await header.locator('.conversation-demo-tag').innerText(), 'Demo');
    assert.equal(new URL(page.url()).hash, '#/module/companions/assistant');
    assert.deepEqual((await rows(page)).map(row => row.current), [false, true, false]);
    await assistant.getByRole('button', {name: 'Enable conversation', exact: true}).click();
    await assistant.getByRole('heading', {name: 'What’s on your mind?', exact: true}).waitFor();
    await message.fill('Synthetic Reachy fixture');
    await assistant.getByRole('button', {name: 'Send', exact: true}).click();
    const answer = assistant.getByRole('textbox', {name: 'Answer', exact: true});
    await answer.fill('Reachy answer');
    await assistant.getByRole('button', {name: 'Answer', exact: true}).click();
    const transcript = assistant.getByRole('list', {name: 'Saved conversation messages'});
    await transcript.getByText(/Synthetic result: Reachy answer/).waitFor();
    await assistant.getByText('Task completed', {exact: true}).waitFor();
    await (await destinationLink(page, 'Rooms')).click();
    await page.getByRole('region', {name: 'Rooms', exact: true}).waitFor();
    assert.deepEqual(await rows(page), plain(), 'on Rooms no conversation is open');
    await (await conversationLink(page, 'microduck')).click();
    await header.getByRole('heading', {name: 'MicroDuck', exact: true}).waitFor();
    await assistant.getByRole('heading', {name: 'What’s on your mind?', exact: true}).waitFor();
    assert.equal(await assistant.locator('[data-message]').count(), 0, 'MicroDuck has its own, empty history');
    const devicePage = (await openDeviceMenu(page)).locator('a[href^="#/component/"]').first();
    const deviceAddress = await devicePage.getAttribute('href');
    await devicePage.click();
    await page.waitForFunction(address => location.hash === address, deviceAddress);
    await assistant.waitFor({state: 'detached'});
    await (await conversationLink(page, 'reachy')).click();
    await transcript.getByText(/Synthetic result: Reachy answer/).waitFor();
    assert.equal(await message.inputValue(), '', 'a draft does not outlive the page, as before');
    await (await conversationLink(page, 'bunny')).click();
    await header.getByRole('heading', {name: 'B.U.N.N.Y.', exact: true}).waitFor();
    assert.equal(await assistant.locator('[data-message]').count(), 0, 'B.U.N.N.Y. has its own history');

    // A question that needs the owner marks its row on every page. The phone's menu button is marked when the question
    // is not in the open conversation.
    await message.fill('Synthetic rail fixture');
    await assistant.getByRole('button', {name: 'Send', exact: true}).click();
    await answer.waitFor();
    await marked('bunny').waitFor();
    assert.deepEqual(await rows(page), [{name: 'B.U.N.N.Y. Needs your answer', current: true, marked: true}, ...plain().slice(1)]);
    assert.deepEqual([(await conversations.locator('a[data-profile="bunny"] .rail-need').boundingBox())?.width ?? 0, (await fit()).inRail, (await fit()).whole], [1, true, true],
      'in the full rail the need is the dot and the row\'s name; its words take no room in the row');
    await answer.fill('Held answer');
    const phoneMark = async (): Promise<[string | null, number]> => [await menuButton.getAttribute('aria-description'), await menuButton.locator('.rail-attention').count()];
    await page.setViewportSize({width: 390, height: 844});
    await menuButton.waitFor();
    assert.deepEqual(await phoneMark(), [null, 0], 'the open conversation shows its own question, so the menu button is not marked');
    await chooseConversation(page, 'reachy');
    assert.deepEqual(await phoneMark(), ['A conversation needs your answer', 1], 'with another conversation open the menu button is marked');
    await showRail(page);
    await marked('bunny').waitFor();
    const drawerRow = await (await conversationLink(page, 'bunny')).boundingBox();
    assert.ok(drawerRow !== null && drawerRow.height >= 44, 'a conversation row is a full touch target in the drawer');
    await (await conversationLink(page, 'bunny')).click();
    await page.locator('.shell>aside').waitFor({state: 'hidden'});
    assert.equal(await menuButton.evaluate(button => button === document.activeElement), true, 'choosing in the drawer closes it and returns focus to its button');
    assert.equal(await answer.inputValue(), 'Held answer', 'the answer draft is kept while the page stays open');
    await (await destinationLink(page, 'Home')).click();
    await page.getByRole('region', {name: 'Home', exact: true}).waitFor();
    assert.deepEqual(await phoneMark(), ['A conversation needs your answer', 1], 'on another page the menu button is marked');
    await page.setViewportSize({width: 1440, height: 1000});
    await marked('bunny').waitFor();
    assert.deepEqual(await rows(page), [{name: 'B.U.N.N.Y. Needs your answer', current: false, marked: true}, ...plain().slice(1)], 'the marker is in the rail on Home');
    // The icon rail shows the profile, its Demo label and the need beside the tile on keyboard focus.
    await page.setViewportSize({width: 1024, height: 800});
    await (await conversationLink(page, 'bunny')).focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    const tip = conversations.locator('a[data-profile="bunny"] .rail-text');
    await page.waitForFunction(element => element !== null && getComputedStyle(element).opacity === '1', await tip.elementHandle());
    const [tile, tipBox, need] = await Promise.all([conversations.locator('a[data-profile="bunny"] .rail-mono').boundingBox(), tip.boundingBox(), tip.locator('.rail-need').boundingBox()]);
    assert.ok(tile !== null && tipBox !== null && need !== null && tipBox.x >= tile.x + tile.width && need.width > 40 && need.x + need.width <= tipBox.x + tipBox.width + 1
      && tipBox.height < 36 && need.y >= tipBox.y && need.y + need.height <= tipBox.y + tipBox.height + 1,
    `the icon rail names the conversation and its need beside the tile, on one line: ${JSON.stringify({tile, tipBox, need})}`);
    await page.setViewportSize({width: 1440, height: 1000});

    // A page loaded on Home knows nothing yet: the rail reads the waiting profile's history once and marks it.
    historyReads.length = 0;
    await page.reload();
    await feed(page, 'connected');
    await marked('bunny').waitFor();
    assert.deepEqual(historyReads, ['bunny'], 'one read tells the question\'s kind');
    await (await destinationLink(page, 'Rooms')).click();
    await page.getByRole('region', {name: 'Rooms', exact: true}).waitFor();
    await marked('bunny').waitFor();
    assert.deepEqual(historyReads, ['bunny'], 'another page reads nothing more');
    // When the read fails the marker is absent, never asserted. Opening the conversation shows the question itself.
    await page.route('**/modules/companions/content/conversation?profile=bunny&view=recent', route => route.fulfill({status: 503, json: {}}), {times: 1});
    historyReads.length = 0;
    const failed = page.waitForResponse(response => response.url().includes('/content/conversation?profile=bunny') && response.status() === 503);
    await page.reload();
    await feed(page, 'connected');
    await failed;
    await conversations.waitFor();
    assert.deepEqual([await rows(page), historyReads], [plain(), ['bunny']], 'a failed read claims nothing');
    await (await conversationLink(page, 'bunny')).click();
    await answer.waitFor();
    await marked('bunny').waitFor();
    assert.equal(await answer.inputValue(), '', 'a reload starts a new page session without the old draft');
    // Answering clears the marker everywhere.
    await answer.fill('Short answer');
    await assistant.getByRole('button', {name: 'Answer', exact: true}).click();
    await transcript.getByText(/Synthetic result: Short answer/).waitFor();
    await marked('bunny').waitFor({state: 'detached'});
    assert.deepEqual(await rows(page), [{name: 'B.U.N.N.Y.', current: true, marked: false}, ...plain().slice(1)]);

    // The group is shown only while the catalog declares the Conversation page of a running companions module.
    const catalog = await routeCatalog(page);
    for (const [reason, change] of [
      ['a stopped module', (module: CatalogModule) => ({...module, state: 'stopped'})],
      ['no Conversation page', (module: CatalogModule) => ({...module, pages: module.pages.filter(entry => entry.id !== 'assistant')})],
    ] as const) {
      catalog(module => module.name === 'companions' ? change(module) : module);
      await page.goto(`${world.url}/#/devices`);
      await page.reload();
      await feed(page, 'connected');
      await page.getByRole('heading', {name: 'Devices', level: 1, exact: true}).waitFor();
      await page.locator('.rail-pins .rail-label').waitFor({state: 'attached'});
      // The page has read this catalog: its directory lists another module's page. A page with no catalog at all
      // would show no conversation group either, and would not show this.
      await page.getByRole('link', {name: 'LIFX', exact: true}).waitFor();
      assert.equal(await conversations.count(), 0, `${reason}: the rail has no conversation group`);
      assert.equal(await page.locator('.rail-conversations').count(), 0, `${reason}: and leaves no empty group behind`);
    }
    // With the real catalog again the group is back.
    catalog();
    await page.reload();
    await feed(page, 'connected');
    await conversations.waitFor();
    assert.deepEqual(await rows(page), plain(), 'with the Conversation page declared again the rail lists the conversations');
    assert.deepEqual(posts.filter(path => path !== '/api/sdk/v1/upload' && path !== '/api/sdk/v1/request'), [], 'the rail registers no endpoint and publishes nothing');
  } finally {
    await context.close();
    await world.close();
  }
}

export async function conversationRailJourney(browser: Browser): Promise<void> {
  await railGroupFixture(browser);
  await railInDashboard(browser);
  process.stdout.write('Conversation rail browser: profiles opened from Home, Rooms and a device page, the waiting marker and its absence without live state or a known question, the phone menu button and the catalog passed.\n');
}

if (import.meta.main) {
  const browser = await chromium.launch({headless: true});
  try {await conversationRailJourney(browser);}
  finally {await browser.close();}
}
