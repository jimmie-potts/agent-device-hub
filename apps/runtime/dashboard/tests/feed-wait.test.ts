// The feed wait's failure says what the page showed and how its stream requests stood (#2068). A fake page and a fake
// clock stand in for Playwright's page and the wall clock, so this runs without a browser and every time is exact; the
// page-side watch itself runs in every browser journey.
import assert from 'node:assert/strict';
import test from 'node:test';
import {waitForFeed, type FeedPage, type FeedRequest} from './feed-wait.ts';

const ORIGIN = 'http://127.0.0.1:4100';
/** The fake clock's reading when each wait begins. */
const SINCE = 1_800_000_000_000;

type RequestState = {failed?: string; status?: number; ended?: boolean; loads?: boolean; subframe?: boolean; url?: () => string};

function request(path: string, startTime: number, state: RequestState = {}): FeedRequest {
  return {
    url: state.url ?? (() => ORIGIN + path),
    failure: () => state.failed === undefined ? null : {errorText: state.failed},
    existingResponse: () => state.status === undefined ? null : {status: () => state.status ?? 0},
    timing: () => ({startTime, responseStart: state.status === undefined ? -1 : 5, responseEnd: state.ended === true ? 9 : -1}),
    isNavigationRequest: () => state.loads === true,
    frame: () => ({parentFrame: () => state.subframe === true ? {} : null}),
  };
}

type Script = {
  wait: (sent: (request: FeedRequest) => void) => Promise<unknown>;
  seen?: unknown;
  requests?: () => readonly FeedRequest[];
  readFails?: boolean;
  stopFails?: boolean;
};

function fakePage(script: Script): {page: FeedPage; selectors: string[]; evaluated: string[]} {
  const selectors: string[] = [];
  const evaluated: string[] = [];
  const listeners: ((request: FeedRequest) => void)[] = [];
  const sent = (request: FeedRequest): void => { for (const listener of listeners) listener(request); };
  const page: FeedPage = {
    on: (_event, listener) => { listeners.push(listener); },
    locator: selector => { selectors.push(selector); return {waitFor: () => script.wait(sent)}; },
    evaluate: <R, Arg>(pageFunction: (arg: Arg) => R): Promise<R> => {
      evaluated.push(pageFunction.name);
      if (pageFunction.name === 'stopFeedWatch' && script.stopFails === true) return Promise.reject(new Error('Target page, context or browser has been closed'));
      if (pageFunction.name === 'watchFeed' || pageFunction.name === 'stopFeedWatch') return Promise.resolve(undefined as R);
      if (script.readFails === true) return Promise.reject(new Error('Execution context was destroyed\nmore'));
      return Promise.resolve(script.seen as R);
    },
    requests: () => Promise.resolve(script.requests?.() ?? []),
  };
  return {page, selectors, evaluated};
}

const ORIGINAL = 'locator.waitFor: Timeout 10000ms exceeded.';
const timeout = (): Promise<never> => Promise.reject(new Error(`${ORIGINAL}\nCall log:\n  - waiting for locator`));
const HEAD = `feed(page, 'connected') did not see main#main[data-feed="connected"]: ${ORIGINAL}`;

async function expired(page: FeedPage, clock: () => number): Promise<Error> {
  const error = await waitForFeed(page, 'connected', clock).then(() => assert.fail('the wait expired'), (caught: unknown) => caught);
  assert.ok(error instanceof Error);
  return error;
}

void test('a connected feed resolves the wait and then removes the page-side watch', async () => {
  const {page, selectors, evaluated} = fakePage({wait: () => Promise.resolve()});
  await waitForFeed(page, 'connected', () => SINCE);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(selectors, ['main#main[data-feed="connected"]']);
  assert.deepEqual(evaluated, ['watchFeed', 'stopFeedWatch']);
});

void test('an expired wait says which feed states the page showed and how its stream requests stood', async () => {
  let now = SINCE;
  const original = new Error(`${ORIGINAL}\nCall log:\n  - waiting for locator`);
  // Playwright reports a start time only for an answered request; the wait records when the others were sent.
  const stranded = request('/api/sdk/v1/stream', 0);
  const {page} = fakePage({
    wait: sent => { now = SINCE + 2100; sent(stranded); now = SINCE + 10_000; return Promise.reject(original); },
    seen: {trail: ['connected@+0ms', 'reconnecting@+40ms'], main: {feed: 'reconnecting', copies: 'syncing', syncs: '2'}},
    requests: () => [
      request('/api/sdk/v1/stream', 0),
      request('/api/sdk/v1/stream', SINCE - 1200, {status: 200}),
      request('/api/sdk/v1/sync', SINCE - 900, {status: 200, ended: true}),
      request('/api/sdk/v1/stream', SINCE + 30, {failed: 'net::ERR_FAILED'}),
      stranded,
      request('/api/sdk/v1/sync', SINCE + 2200),
      request('/app.js', SINCE - 1500, {status: 200, ended: true}),
    ],
  });
  const error = await expired(page, () => now);
  assert.equal(error.cause, original, 'the original timeout stays the cause');
  assert.deepEqual(error.message.split('\n').map(line => line.trim()), [
    HEAD,
    'data-feed during the wait: connected@+0ms -> reconnecting@+40ms',
    'main#main now has data-feed="reconnecting" data-copies="syncing" data-syncs="2"',
    'stream requests (start relative to the wait): 4, latest (start unknown, before the page\'s first feed wait) no response yet; '
      + '-1200ms answered 200 5ms after it started (body open); +30ms failed net::ERR_FAILED; +2100ms no response yet; '
      + 'other SDK requests of this document with no response yet: 1',
  ]);
});

void test('a page that closes before the watch is removed leaves no unhandled rejection', async () => {
  const {page, evaluated} = fakePage({wait: () => Promise.resolve(), stopFails: true});
  await waitForFeed(page, 'connected', () => SINCE);
  // node:test fails the file on an unhandled rejection; let the unawaited removal settle within this test.
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(evaluated, ['watchFeed', 'stopFeedWatch']);
});

void test('a subframe load or a main-frame navigation that failed or is unanswered does not start a new document', async () => {
  const {page} = fakePage({
    wait: timeout,
    seen: {trail: ['connected@+0ms', 'reconnecting@+40ms'], main: {feed: 'reconnecting', copies: 'synced', syncs: '1'}},
    requests: () => [
      request('/api/sdk/v1/stream', SINCE - 5000, {status: 200}),
      request('/frame.html', SINCE - 3000, {status: 200, ended: true, loads: true, subframe: true}),
      request('/report.csv', SINCE - 2000, {status: 200, failed: 'net::ERR_ABORTED', loads: true}),
      request('/', SINCE - 1000, {loads: true}),
    ],
  });
  const error = await expired(page, () => SINCE);
  assert.equal(error.message.split('\n').at(-1)?.trim(), 'stream requests (start relative to the wait): 1, latest '
    + '-5000ms answered 200 5ms after it started (body open); other SDK requests of this document with no response yet: 0');
});

void test('requests sent before the page\'s latest document load are marked as the previous document\'s', async () => {
  const {page} = fakePage({
    wait: timeout,
    seen: {trail: ['(no main)@+0ms', 'connecting@+300ms'], main: {feed: 'connecting', copies: 'loading', syncs: '0'}},
    requests: () => [
      request('/api/sdk/v1/stream', SINCE - 5000, {status: 200}),
      request('/api/sdk/v1/sync', SINCE - 4000),
      request('/', SINCE - 100, {status: 200, ended: true, loads: true}),
      request('/api/sdk/v1/stream', SINCE + 250, {status: 200}),
    ],
  });
  const error = await expired(page, () => SINCE);
  assert.equal(error.message.split('\n').at(-1)?.trim(), 'stream requests (start relative to the wait): 2, latest '
    + '-5000ms answered 200 5ms after it started (body open) [previous document]; +250ms answered 200 5ms after it started (body open); '
    + 'other SDK requests of this document with no response yet: 0');
});

void test('an expired wait on a page it cannot read still names the wait and says why', async () => {
  const {page} = fakePage({wait: timeout, readFails: true});
  const error = await expired(page, () => SINCE);
  assert.deepEqual(error.message.split('\n').map(line => line.trim()), [
    HEAD,
    'the page could not be read: Execution context was destroyed',
    'stream requests (start relative to the wait): none in the page\'s recent requests; other SDK requests of this document with no response yet: 0',
  ]);
});

void test('a failure while gathering the facts does not replace the original timeout', async () => {
  const original = new Error(`${ORIGINAL}\nCall log:\n  - waiting for locator`);
  const {page} = fakePage({
    wait: () => Promise.reject(original),
    seen: {trail: null, main: null},
    requests: () => [request('/api/sdk/v1/stream', 0, {url: () => { throw new TypeError('the request was collected'); }})],
  });
  const error = await expired(page, () => SINCE);
  assert.equal(error.cause, original);
  assert.deepEqual(error.message.split('\n').map(line => line.trim()), [HEAD, 'the wait\'s facts could not be gathered: the request was collected']);
});

void test('an absent main region and an unrecorded watch are reported as such', async () => {
  const {page} = fakePage({wait: timeout, seen: {trail: null, main: null}});
  const error = await expired(page, () => SINCE);
  assert.deepEqual(error.message.split('\n').slice(1, 3).map(line => line.trim()), ['data-feed during the wait: (not observed)', 'main#main is absent']);
});
