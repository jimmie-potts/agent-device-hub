import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import type {BrowserContext} from 'playwright';

/** Real components with a stopped SDK copy; the shared core feed remains connected. */
export async function duckFailureJourney(context: BrowserContext): Promise<void> {
  const bundle = await build({stdin: {contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {DuckWidget, DuckConversation} from '../../../../modules/companions/src/frontend/duck.tsx';
    const mode = new URLSearchParams(location.search).get('mode');
    const fixture = window.fixture = {allow: mode === 'failed', callbacks: [], effects: 0};
    const error = {error: {code: 'unavailable', retryable: true}};
    const api = {
      sync: async (_families, callback) => {
        fixture.callbacks.push(callback);
        if (!fixture.allow) {
          if (mode === 'thrown') throw {body: error};
          return {status: 'rejected', requestId: 'synthetic', error: mode === 'denied' ? {error: {code: 'forbidden', retryable: false}} : error};
        }
        return {status: 'synced', copy: {states: () => [{data: {id: 'assistant', revision: 1}}], close: async () => {}}};
      },
      read: async () => ({schema: 'duck-widget/1.0', revision: 1, conversation: null, messages: [], next: null}),
      command: () => {fixture.effects += 1;}, upload: () => {fixture.effects += 1;}
    };
    fixture.fail = () => fixture.callbacks.forEach(callback => callback({type: 'failed', error}));
    const context = {api, connected: true};
    createRoot(document.getElementById('root')).render(React.createElement(React.Fragment, null,
      React.createElement(DuckWidget, {context}), React.createElement(DuckConversation, {context})));
  `, resolveDir: fileURLToPath(new URL('.', import.meta.url)), sourcefile: 'duck-failure-entry.js'},
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent'});
  assert.ok(bundle.outputFiles[0]);
  const page = await context.newPage();
  try {
    await page.route('http://duck-fixture.invalid/**', route => route.fulfill(new URL(route.request().url()).pathname === '/bundle.js'
      ? {contentType: 'text/javascript', body: bundle.outputFiles[0]?.text ?? ''}
      : {contentType: 'text/html', body: '<!doctype html><html lang="en"><title>Synthetic Duck recovery</title><div id="root"></div><script type="module" src="/bundle.js"></script></html>'}));
    for (const mode of ['rejected', 'denied', 'thrown', 'failed']) {
      await page.goto(`http://duck-fixture.invalid/?mode=${mode}`);
      if (mode === 'failed') {
        await page.getByText('No conversation selected.', {exact: true}).nth(1).waitFor();
        await page.evaluate('window.fixture.fail()');
      }
      const error = mode === 'denied' ? 'Access denied. Private conversation hidden.' : 'Conversation unavailable. Refresh to try again.';
      await page.getByText(error, {exact: true}).nth(1).waitFor();
      assert.equal(await page.getByText('Loading selected conversation.', {exact: true}).count(), 0);
      await page.evaluate('window.fixture.allow = true');
      const buttons = page.getByRole('button', {name: 'Refresh conversation', exact: true});
      await buttons.first().click(); await buttons.first().click();
      await page.getByText('No conversation selected.', {exact: true}).nth(1).waitFor();
      assert.equal(await page.evaluate('window.fixture.effects'), 0, 'fresh sync never replays an effect');
    }
  } finally {await page.close();}
}
