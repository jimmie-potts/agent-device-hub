// The feed wait's failure says what the page showed and how its stream requests stood (#2068). A fake page stands in for
// Playwright's, so this runs without a browser; the page-side watch itself runs in every browser journey.
import assert from 'node:assert/strict';
import test from 'node:test';
import {waitForFeed, type FeedPage, type FeedRequest} from './feed-wait.ts';

const ORIGIN = 'http://127.0.0.1:4100';

function request(path: string, startTime: number, state: {failed?: string; status?: number; ended?: boolean}): FeedRequest {
  return {
    url: () => ORIGIN + path,
    failure: () => state.failed === undefined ? null : {errorText: state.failed},
    existingResponse: () => state.status === undefined ? null : {status: () => state.status ?? 0},
    timing: () => ({startTime, responseStart: state.status === undefined ? -1 : 5, responseEnd: state.ended === true ? 9 : -1}),
  };
}

type Script = {
  wait: (sent: (request: FeedRequest) => void) => Promise<unknown>;
  seen?: unknown;
  requests?: (since: number) => readonly FeedRequest[];
  readFails?: boolean;
};

function fakePage(script: Script): {page: FeedPage; selectors: string[]} {
  const selectors: string[] = [];
  const listeners: ((request: FeedRequest) => void)[] = [];
  const sent = (request: FeedRequest): void => { for (const listener of listeners) listener(request); };
  const since = Date.now();
  const page: FeedPage = {
    on: (_event, listener) => { listeners.push(listener); },
    locator: selector => { selectors.push(selector); return {waitFor: () => script.wait(sent)}; },
    evaluate: <R, Arg>(pageFunction: (arg: Arg) => R): Promise<R> => {
      if (pageFunction.name === 'watchFeed') return Promise.resolve(undefined as R);
      if (script.readFails === true) return Promise.reject(new Error('Execution context was destroyed\nmore'));
      return Promise.resolve(script.seen as R);
    },
    requests: () => Promise.resolve(script.requests?.(since) ?? []),
  };
  return {page, selectors};
}

const timeout = (): Promise<never> => Promise.reject(new Error('locator.waitFor: Timeout 10000ms exceeded.\nCall log:\n  - waiting for locator'));

void test('a connected feed resolves the wait without reading the page further', async () => {
  const {page, selectors} = fakePage({wait: () => Promise.resolve()});
  await waitForFeed(page, 'connected');
  assert.deepEqual(selectors, ['main#main[data-feed="connected"]']);
});

void test('an expired wait says which feed states the page showed and how its stream requests stood', async () => {
  const original = new Error('locator.waitFor: Timeout 10000ms exceeded.\nCall log:\n  - waiting for locator');
  // Playwright reports a start time only for an answered request; the wait records when the others were sent.
  const stranded = request('/api/sdk/v1/stream', 0, {});
  const {page} = fakePage({
    wait: async sent => { await new Promise(resolve => setTimeout(resolve, 20)); sent(stranded); throw original; },
    seen: {trail: ['connected@+0ms', 'reconnecting@+40ms'], main: {feed: 'reconnecting', copies: 'syncing', syncs: '2'}},
    requests: since => [
      request('/api/sdk/v1/stream', 0, {}),
      request('/api/sdk/v1/stream', since - 1200, {status: 200}),
      request('/api/sdk/v1/sync', since - 900, {status: 200, ended: true}),
      request('/api/sdk/v1/stream', since + 30, {failed: 'net::ERR_FAILED'}),
      stranded,
      request('/api/sdk/v1/sync', since + 2200, {}),
      request('/app.js', since - 1500, {status: 200, ended: true}),
    ],
  });
  const error = await waitForFeed(page, 'connected').then(() => assert.fail('the wait expired'), (caught: unknown) => caught);
  assert.ok(error instanceof Error);
  assert.equal(error.cause, original, 'the original timeout stays the cause');
  const lines = error.message.split('\n').map(line => line.trim());
  assert.equal(lines.length, 4);
  assert.deepEqual(lines.slice(0, 3), [
    'feed(page, \'connected\') did not see main#main[data-feed="connected"]: locator.waitFor: Timeout 10000ms exceeded.',
    'data-feed during the wait: connected@+0ms -> reconnecting@+40ms',
    'main#main now has data-feed="reconnecting" data-copies="syncing" data-syncs="2"',
  ]);
  assert.match(lines[3] ?? '', new RegExp('^stream requests \\(start relative to the wait\\): 4, latest '
    + '\\(start unknown, before the page\'s first feed wait\\) no response yet; -1200ms answered 200 5ms after it started \\(body open\\); '
    + '\\+30ms failed net::ERR_FAILED; \\+(1\\d|[2-9]\\d|\\d{3})ms no response yet; other SDK requests with no response yet: 1$'));
});

void test('an expired wait on a page it cannot read still names the wait and says why', async () => {
  const {page} = fakePage({wait: timeout, readFails: true});
  const error = await waitForFeed(page, 'connected').then(() => assert.fail('the wait expired'), (caught: unknown) => caught);
  assert.ok(error instanceof Error);
  assert.match(error.message, /^feed\(page, 'connected'\) did not see main#main\[data-feed="connected"\]: locator\.waitFor: Timeout 10000ms exceeded\.\n/);
  assert.match(error.message, /\n {2}the page could not be read: Execution context was destroyed\n/);
  assert.match(error.message, /\n {2}stream requests \(start relative to the wait\): none in the page's recent requests; other SDK requests with no response yet: 0$/);
});

void test('an absent main region and an unrecorded watch are reported as such', async () => {
  const {page} = fakePage({wait: timeout, seen: {trail: null, main: null}});
  const error = await waitForFeed(page, 'connected').then(() => assert.fail('the wait expired'), (caught: unknown) => caught);
  assert.ok(error instanceof Error);
  assert.match(error.message, /\n {2}data-feed during the wait: \(not observed\)\n {2}main#main is absent\n/);
});
