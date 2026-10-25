import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import type {Browser} from 'playwright';

/** A known speech-state gap and voice discovery settle before React renders the invalidation. */
export async function speechReadinessJourney(browser: Browser): Promise<void> {
  const bundle = await build({stdin: {contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
    import {SpeechControls} from '../../../../modules/companions/src/frontend/speech.tsx';
    const voice = {name: 'Synthetic local English', lang: 'en-US', voiceURI: 'synthetic-local', localService: true, default: false};
    const fixture = window.fixture = {calls: 0, closed: 0, voices: true};
    const events = new EventTarget(); let utterance;
    const NativeUtterance = SpeechSynthesisUtterance;
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {value: class extends NativeUtterance {
      constructor(text) {super(text); Object.defineProperty(this, 'voice', {value: null, writable: true});}
    }});
    Object.defineProperty(navigator, 'userAgentData', {value: {platform: 'macOS', getHighEntropyValues: async () => ({fullVersionList: [{brand: 'Google Chrome', version: '150.0.0.1'}]})}});
    Object.defineProperty(window, 'speechSynthesis', {value: {
      getVoices: () => fixture.voices ? [voice] : [], addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
      get speaking() {return utterance !== undefined;}, get pending() {return false;},
      speak: value => {utterance = value; fixture.calls++;}, cancel: () => {
        const value = utterance; utterance = undefined;
        if (value) value.dispatchEvent(new SpeechSynthesisErrorEvent('error', {utterance: value, error: 'canceled'}));
      }
    }});
    const now = Date.now(), attention = {kind: 'question', id: {status: 'known', id: 'attention-test'}, turn: {status: 'unknown'}};
    const session = {id: 'session-test', revision: 1, generation: 1, freshness: 'current', restartUncertain: false, lastEvidenceAtMs: now,
      identity: null, turn: {status: 'unknown'}, attention: [attention], notices: []};
    const card = {opportunity: {origin: {source: 'bunny/core', id: 'event-test', type: 'org.bunny.attention.raised'}, sourceKind: 'coding', context: 'live',
      category: 'coding-attention', cue: 'question', revision: 1, generation: 1, session: session.id, identity: null, turn: session.turn, attention,
      noticeId: null, evidence: 'lifecycle-metadata', occurredAtMs: now, observedAtMs: now, validUntilMs: now + 30000,
      busy: null, media: null, visitor: null, location: null}, text: 'Synthetic question.', phrase: 0, presentedAtMs: now, history: false, content: 'unavailable'};
    let remote = {id: 'reachy', revision: 1, endpointId: null, availability: 'off', playback: null, pending: false};
    const api = {
      read: async () => ({schema: 'browser-speech-qualification/1.0', browserVersion: '150.0.0.1', platform: 'macos', qualifiedAt: '2026-10-24T00:00:00.000Z',
        voice: {name: voice.name, lang: voice.lang, voiceURI: voice.voiceURI}}),
      sync: async (_families, callback, options) => {
        fixture.invalidate = kind => kind === 'restart' ? options.onRestarted() : callback({type: kind});
        fixture.update = callback;
        return {status: 'synced', copy: {states: () => [{data: remote}], close: async () => {}}};
      },
      speech: {open: async options => {fixture.output = options.respond; return {id: 'endpoint-test',
        control: async () => {remote = {...remote, endpointId: 'endpoint-test', availability: 'available'}; fixture.update({type: 'updated', message: {data: remote}}); return {status: 'accepted'};},
        observe: async () => {}, close: async () => {fixture.closed++; options.onClosed();}};}}
    };
    const state = {id: 'reachy', revision: 1, settings: {enabled: true, muted: [], snoozedUntilMs: 0, timeZone: 'UTC'},
      presentation: null, decision: 'settings-saved', availability: 'available'};
    flushSync(() => createRoot(document.getElementById('root')).render(React.createElement(SpeechControls, {state, live: true,
      context: {api, connected: true, control: true, operations: [], operationsLive: true,
        core: {sessions: [session], sessionsLive: true, mode: 'work', modeLive: true}}})));
    fixture.begin = () => {
      fixture.voices = false;
      return fixture.output({source: 'bunny/modules/companions', traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
        expiresat: new Date(Date.now() + 5000).toISOString(), data: {action: 'speak', operationId: 'operation-test', requestId: 'request-test', card}});
    };
    fixture.race = kind => {
      fixture.invalidate(kind); fixture.voices = true; events.dispatchEvent(new Event('voiceschanged'));
    };
  `, resolveDir: fileURLToPath(new URL('.', import.meta.url)), sourcefile: 'speech-readiness-entry.js'},
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent'});
  const context = await browser.newContext();
  try {
    await context.route('https://speech-readiness.invalid/**', route => route.fulfill(new URL(route.request().url()).pathname === '/bundle.js'
      ? {contentType: 'text/javascript', body: bundle.outputFiles[0]?.text ?? ''}
      : {contentType: 'text/html', body: '<!doctype html><html lang="en"><title>Synthetic speech readiness</title><div id="root"></div><script type="module" src="/bundle.js"></script></html>'}));
    for (const gap of ['restart', 'failed', 'removed']) {
      const page = await context.newPage(); page.setDefaultTimeout(5000);
      await page.goto('https://speech-readiness.invalid/');
      await page.getByRole('button', {name: 'Enable spoken alerts in this tab', exact: true}).click();
      await page.getByText('Spoken alerts enabled in this tab.', {exact: true}).waitFor();
      await page.evaluate('window.fixture.begin()');
      await page.evaluate(`window.fixture.race(${JSON.stringify(gap)})`);
      await page.waitForFunction('window.fixture.closed === 1');
      assert.equal(await page.evaluate('window.fixture.calls'), 0, `${gap} prevents speech before React renders`);
      await page.close();
    }
    console.log(JSON.stringify({journey: 'speech-readiness', gaps: 3, spoken: 0, physical: false}));
  } finally {await context.close();}
}
