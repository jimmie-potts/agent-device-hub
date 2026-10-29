import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import type {BrowserContext} from 'playwright';

/** Replacement sync can reuse a revision; private content still needs a fresh read. */
export async function duckReplacementJourney(context: BrowserContext): Promise<void> {
  const bundle = await build({stdin: {contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {DuckWidget, DuckConversation} from '../../../../modules/companions/src/frontend/duck.tsx';
    const text = 'SYNTHETIC_PRIVATE_REPLACEMENT';
    const document = {schema: 'duck-widget/1.0', revision: 1, next: null,
      conversation: {id: 'synthetic-selected', participants: ['reachy', 'microduck'], epoch: 'synthetic-epoch', profile: null},
      messages: [{schema: 'companion-message/1.0', messageId: 'synthetic-message', conversationId: 'synthetic-selected',
        turnId: null, speakerId: 'microduck', recipientIds: ['reachy'], createdAtMs: 1, revision: 1,
        ordering: {authority: 'companions', epoch: 'synthetic-epoch', sequence: 1}, meaning: {kind: 'literal', text, language: 'en'},
        provenance: {kind: 'synthetic', imported: false}, deliveryRefs: [], taskId: null}]};
    const fixture = window.fixture = {callbacks: [], restarts: [], pending: [], hold: false, effects: 0};
    const api = {
      sync: async (_families, callback, options) => {
        fixture.callbacks.push(callback); fixture.restarts.push(() => options?.onRestarted?.());
        return {status: 'synced', copy: {states: () => [{data: {id: 'assistant', revision: 1}}], close: async () => {}}};
      },
      read: async () => fixture.hold ? new Promise(resolve => fixture.pending.push(() => resolve(document))) : document,
      command: () => {fixture.effects++;}, upload: () => {fixture.effects++;}
    };
    fixture.restart = () => {fixture.hold = true; fixture.restarts.forEach(restart => restart());};
    fixture.complete = () => fixture.callbacks.forEach(callback => callback({type: 'synced'}));
    fixture.release = () => {fixture.hold = false; fixture.pending.splice(0).forEach(resolve => resolve());};
    createRoot(window.document.getElementById('root')).render(React.createElement(React.Fragment, null,
      React.createElement(DuckWidget, {context: {api, connected: true, control: false}}),
      React.createElement(DuckConversation, {context: {api, connected: true, control: false}})));
  `, resolveDir: fileURLToPath(new URL('.', import.meta.url)), sourcefile: 'duck-replacement-entry.js'},
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent', loader: {'.css': 'empty'}});
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  try {
    await page.route('https://duck-replacement.invalid/**', route => route.fulfill(new URL(route.request().url()).pathname === '/bundle.js'
      ? {contentType: 'text/javascript', body: bundle.outputFiles[0]?.text ?? ''}
      : {contentType: 'text/html', body: '<!doctype html><html lang="en"><title>Synthetic private replacement</title><div id="root"></div><script type="module" src="/bundle.js"></script></html>'}));
    await page.goto('https://duck-replacement.invalid/');
    const privateText = page.getByText('SYNTHETIC_PRIVATE_REPLACEMENT', {exact: true});
    await privateText.last().waitFor(); assert.equal(await privateText.count(), 2);
    await page.evaluate('window.fixture.restart()');
    await privateText.last().waitFor({state: 'detached'}); assert.equal(await privateText.count(), 0, 'replacement hides both private views while transport remains connected');
    await page.evaluate('window.fixture.complete()');
    await page.waitForFunction('window.fixture.pending.length === 2');
    assert.equal(await privateText.count(), 0, 'same-revision sync cannot resurrect the prior private read');
    await page.evaluate('window.fixture.release()');
    await privateText.last().waitFor(); assert.equal(await privateText.count(), 2);
    assert.equal(await page.evaluate('window.fixture.effects'), 0);
  } finally {await page.close();}
}
