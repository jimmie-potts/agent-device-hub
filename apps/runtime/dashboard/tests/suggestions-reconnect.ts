import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import type {BrowserContext} from 'playwright';

/** Actual Reachy component: core reconnects before its replacement settings copy. */
export async function suggestionsReconnectJourney(context: BrowserContext): Promise<void> {
  const bundle = await build({stdin: {contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
    import {frontend} from '../../../../modules/companions/src/frontend/index.tsx';
    const Component = frontend.pages.find(page => page.id === 'reachy').Component;
    const session = {id: 'synthetic-session', revision: 2, generation: 1,
      identity: {provider: 'codex', client: 'cli', hostId: 'synthetic-host', sourceId: 'synthetic-source', sessionId: 'synthetic-native-session'},
      parent: {status: 'unknown'}, turn: {status: 'known', id: 'turn-1'}, activity: 'idle', attention: [], notices: [], read: 'unknown',
      unavailable: [], ordering: {status: 'unknown'}, observedAtMs: Date.now(), lastEvidenceAtMs: Date.now(),
      freshness: 'current', restartUncertain: false, children: {active: 0, uncertain: 0}};
    const state = {id: 'reachy', revision: 1, settings: {enabled: true, muted: [], snoozedUntilMs: 0, timeZone: 'UTC'},
      presentation: null, decision: 'settings-saved', availability: 'available'};
    const fixture = window.fixture = {calls: 0, copied: [], closed: 0};
    const result = data => ({status: 'synced', copy: {states: () => [{data}], close: async () => {fixture.closed++;}}});
    const api = {sync: async (_families, callback) => {
      fixture.calls++; fixture.update = callback;
      if (fixture.calls === 1) return result(state);
      return new Promise(resolve => {fixture.finish = enabled => resolve(result({...state, revision: fixture.calls,
        settings: {...state.settings, enabled}}));});
    }};
    const ui = {Facts: () => null, Badge: ({children}) => React.createElement('span', null, children),
      Command: ({children}) => children({locked: false, text: '', run: () => {}})};
    const root = createRoot(document.getElementById('root'));
    fixture.render = connected => flushSync(() => root.render(React.createElement(Component, {context: {api, ui, connected, control: true,
      core: {sessions: [session], sessionsLive: connected, mode: 'work', modeLive: connected}}})));
    fixture.earlyUpdate = () => fixture.update({type: 'updated', message: {data: state}});
    Object.defineProperty(navigator, 'clipboard', {value: {writeText: async text => {fixture.copied.push(text);}}});
    fixture.render(true);
  `, resolveDir: fileURLToPath(new URL('.', import.meta.url)), sourcefile: 'suggestions-reconnect-entry.js'},
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent'});
  const page = await context.newPage();
  try {
    await page.route('http://suggestions-fixture.invalid/**', route => route.fulfill(new URL(route.request().url()).pathname === '/bundle.js'
      ? {contentType: 'text/javascript', body: bundle.outputFiles[0]?.text ?? ''}
      : {contentType: 'text/html', body: '<!doctype html><html lang="en"><title>Synthetic settings recovery</title><div id="root"></div><script type="module" src="/bundle.js"></script></html>'}));
    await page.goto('http://suggestions-fixture.invalid/');
    const form = page.getByRole('region', {name: 'Coding suggestions', exact: true});
    const inspect = form.getByRole('button', {name: 'Inspect coding suggestion', exact: true});
    const card = form.getByRole('article', {name: 'Coding suggestion', exact: true});
    await inspect.waitFor();
    await page.evaluate('window.fixture.render(false)');
    await form.getByText(/Coding suggestions unavailable/).waitFor();
    await page.evaluate('window.fixture.render(true)');
    await page.waitForFunction('window.fixture.calls === 2');
    assert.equal(await inspect.isDisabled(), true, 'core live does not make retained Reachy settings current');
    await page.evaluate('window.fixture.earlyUpdate()');
    assert.equal(await inspect.isDisabled(), true, 'an update before sync completion does not establish a current copy');
    assert.equal(await card.count(), 0);
    assert.equal(await page.evaluate('window.fixture.copied.length'), 0);
    await page.evaluate('window.fixture.finish(false)');
    await page.getByRole('button', {name: 'Enable Reachy text cards', exact: true}).waitFor();
    const fill = async (): Promise<void> => {
    await form.getByRole('combobox', {name: 'Coding session', exact: true}).selectOption('synthetic-session');
    await form.getByRole('textbox', {name: 'Task ID', exact: true}).fill('SYNTHETIC-RECONNECT-TASK');
    for (const name of ['Current head commit', 'Evidence head commit']) await form.getByRole('textbox', {name, exact: true}).fill('a'.repeat(40));
    await form.getByRole('textbox', {name: 'Observation time (UTC ISO)', exact: true}).fill(new Date().toISOString());
    await form.getByRole('combobox', {name: 'tests status', exact: true}).selectOption('passed');
    await form.getByRole('textbox', {name: 'tests evidence reference', exact: true}).fill('synthetic-receipt');
    await form.getByRole('combobox', {name: 'browser status', exact: true}).selectOption('unrun');
    };
    await fill(); await inspect.click();
    await form.getByText(/Enable Reachy text cards to inspect/).waitFor();
    assert.equal(await card.count(), 0, 'fresh disabled settings refuse an otherwise sufficient proposal');
    await page.evaluate('window.fixture.render(false)');
    await page.evaluate('window.fixture.render(true)');
    await page.waitForFunction('window.fixture.calls === 3');
    await page.evaluate('window.fixture.finish(true)');
    await page.getByRole('button', {name: 'Disable Reachy text cards', exact: true}).waitFor();
    await fill();
    await inspect.click(); await card.waitFor();
    await form.getByRole('button', {name: 'Copy coding suggestion', exact: true}).click();
    assert.equal(await page.evaluate('window.fixture.copied.length'), 1, 'explicit Copy works after current enabled settings sync');
    await page.evaluate('window.fixture.render(false)');
    await page.evaluate('window.fixture.render(true)');
    await page.waitForFunction('window.fixture.calls === 4');
    assert.equal(await card.count(), 0, 'a prior proposal cannot survive a pending replacement copy');
    assert.equal(await inspect.isDisabled(), true);
    assert.equal(await page.evaluate('window.fixture.copied.length'), 1);
  } finally {await page.close();}
}
