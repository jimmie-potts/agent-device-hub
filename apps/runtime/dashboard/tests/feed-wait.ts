// The browser journeys' wait for the dashboard's feed, which says what it saw when it expires (#2068).

/** A response the page already has. */
type SeenResponse = {status(): number};

/** What the wait reads of one of the page's requests; Playwright's `Request` has it. */
export type FeedRequest = {
  url(): string;
  failure(): null | {errorText: string};
  existingResponse(): null | SeenResponse;
  timing(): {startTime: number; responseStart: number; responseEnd: number};
  isNavigationRequest(): boolean;
  frame(): {parentFrame(): unknown};
};

/** What the wait uses of a page; Playwright's `Page` has it. */
export type FeedPage = {
  locator(selector: string): {waitFor(): Promise<unknown>};
  evaluate<R, Arg>(pageFunction: (arg: Arg) => R, arg: Arg): Promise<R>;
  requests(): Promise<readonly FeedRequest[]>;
  on(event: 'request', listener: (request: FeedRequest) => void): unknown;
};

/** What the page's main region carries when the wait expires. */
type MainState = {feed: string | null; copies: string | null; syncs: string | null} | null;
type Seen = {trail: string[] | null; main: MainState};

/** How long each read after an expired wait may take, so a stalled page cannot hold the failure. */
const READ_MS = 2000;
/** How many of the page's latest stream requests the failure lists. */
const STREAMS = 4;
const STREAM_PATH = '/api/sdk/v1/stream';
const SDK_PATH = '/api/sdk/v1/';

/** The wait's clock, in epoch milliseconds like Playwright's request start times. */
export type Clock = () => number;

/**
 * When each page's requests began, on the clock of the page's first feed wait, from that wait on. Playwright gives a
 * request's start time only once it is answered, and a stranded request is the one whose start matters. The first
 * wait on a page adds one `request` listener to it here, which stays for the page's life and only records these times
 * in this process.
 */
const started = new WeakMap<FeedPage, WeakMap<FeedRequest, number>>();

function startTimes(page: FeedPage, clock: Clock): WeakMap<FeedRequest, number> {
  let times = started.get(page);
  if (times === undefined) {
    const own = new WeakMap<FeedRequest, number>();
    times = own;
    started.set(page, own);
    page.on('request', request => { own.set(request, clock()); });
  }
  return times;
}

/**
 * Runs in the page: records each `data-feed` value `main#main` shows from now on, with its time since the wait began,
 * and stops observing at `value`. It reads only the attribute. The one thing it adds to the page is its record under
 * `key` on `globalThis`, which the wait removes when it settles: `stopFeedWatch` after the wait succeeds, `readFeed`
 * after it expires. Only a document that is already gone keeps it.
 */
function watchFeed({key, value}: {key: string; value: string}): void {
  const started = performance.now();
  const trail: string[] = [];
  let last: string | undefined;
  const observer = new MutationObserver(() => { read(); });
  function read(): void {
    const main = document.querySelector('main#main');
    const seen = main === null ? '(no main)' : main.getAttribute('data-feed') ?? '(no data-feed)';
    if (seen !== last) {
      last = seen;
      trail.push(`${seen}@+${String(Math.round(performance.now() - started))}ms`);
    }
    if (seen === value) observer.disconnect();
  }
  observer.observe(document.documentElement, {subtree: true, childList: true, attributes: true, attributeFilter: ['data-feed']});
  Reflect.set(globalThis, key, {trail, stop: () => { observer.disconnect(); }});
  read();
}

/** Runs in the page: stops the watch under `key`, if it is still there, and removes its record. */
function stopFeedWatch(key: string): void {
  const watch: unknown = Reflect.get(globalThis, key);
  if (typeof watch === 'object' && watch !== null && 'stop' in watch && typeof watch.stop === 'function') (watch.stop as () => void)();
  Reflect.deleteProperty(globalThis, key);
}

/** Runs in the page: what the watch recorded, and the main region's connection attributes now. */
function readFeed(key: string): Seen {
  const watch: unknown = Reflect.get(globalThis, key);
  let trail: string[] | null = null;
  if (typeof watch === 'object' && watch !== null && 'trail' in watch && Array.isArray(watch.trail) && 'stop' in watch && typeof watch.stop === 'function') {
    (watch.stop as () => void)();
    trail = (watch.trail as unknown[]).map(String);
  }
  Reflect.deleteProperty(globalThis, key);
  const main = document.querySelector('main#main');
  return {trail, main: main === null ? null : {feed: main.getAttribute('data-feed'), copies: main.getAttribute('data-copies'), syncs: main.getAttribute('data-syncs')}};
}

/**
 * Runs `work`, a read after an expired wait, for at most `READ_MS`: its value, or a one-line problem when it fails or
 * gives no answer in time, so a stalled page cannot hold the failure. Journeys that describe their own expired waits
 * read the page through it too (#2129).
 */
export async function bounded<T>(work: () => Promise<T>): Promise<{value: T} | {problem: string}> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{problem: string}>(resolve => { timer = setTimeout(() => { resolve({problem: `no answer within ${String(READ_MS)} ms`}); }, READ_MS); });
  try {
    return await Promise.race([work().then(value => ({value}), (error: unknown) => ({problem: error instanceof Error ? error.message.split('\n')[0] ?? 'failed' : String(error)})), late]);
  } finally {
    clearTimeout(timer);
  }
}

const attribute = (value: string | null): string => value === null ? '(absent)' : `"${value}"`;

/** One request's outcome as the page saw it: failed, answered (and whether its body is still open), or unanswered. */
function outcome(request: FeedRequest): string {
  const failure = request.failure();
  if (failure !== null) return `failed ${failure.errorText}`;
  const response = request.existingResponse();
  if (response === null) return 'no response yet';
  const {responseStart, responseEnd} = request.timing();
  const after = responseStart < 0 ? '' : ` ${String(Math.round(responseStart))}ms after it started`;
  return `answered ${String(response.status())}${after}${responseEnd < 0 ? ' (body open)' : ' (body ended)'}`;
}

/**
 * Whether `request` loaded a document into the page's main frame, which starts a new document. A navigation that
 * failed, was aborted or has no response yet leaves the current document in place.
 */
function loadsDocument(request: FeedRequest): boolean {
  return request.isNavigationRequest() && request.frame().parentFrame() === null
    && request.failure() === null && request.existingResponse() !== null;
}

/**
 * The page's SDK requests, in the order the page sent them: its latest streams, with start times relative to `since`,
 * and how many others of the current document are unanswered. A request the page sent before its latest document load
 * is marked as the previous document's: Playwright may still show such a stream's body as open.
 */
function requestFacts(requests: readonly FeedRequest[], since: number, times: WeakMap<FeedRequest, number>): string {
  const load = requests.findLastIndex(loadsDocument);
  const previous = new Set(load < 0 ? [] : requests.slice(0, load));
  const sdk = requests.filter(request => new URL(request.url()).pathname.startsWith(SDK_PATH));
  const streams = sdk.filter(request => new URL(request.url()).pathname === STREAM_PATH);
  const shown = streams.slice(-STREAMS).map(request => {
    const {startTime} = request.timing();
    const start = times.get(request) ?? (startTime > 0 ? startTime : undefined);
    const document = previous.has(request) ? ' [previous document]' : '';
    if (start === undefined) return `(start unknown, before the page's first feed wait) ${outcome(request)}${document}`;
    const offset = Math.round(start - since);
    return `${offset < 0 ? '' : '+'}${String(offset)}ms ${outcome(request)}${document}`;
  });
  const others = sdk.filter(request => !streams.includes(request) && !previous.has(request) && request.failure() === null && request.existingResponse() === null).length;
  const listed = shown.length === 0 ? 'none in the page\'s recent requests' : `${String(streams.length)}, latest ${shown.join('; ')}`;
  return `stream requests (start relative to the wait): ${listed}; other SDK requests of this document with no response yet: ${String(others)}`;
}

const mainFact = (main: MainState): string => main === null ? 'main#main is absent'
  : `main#main now has data-feed=${attribute(main.feed)} data-copies=${attribute(main.copies)} data-syncs=${attribute(main.syncs)}`;

/** What the page showed and how its requests stood, from the reads after an expired wait. */
function describe(seen: {value: Seen} | {problem: string}, requests: {value: readonly FeedRequest[]} | {problem: string},
  since: number, times: WeakMap<FeedRequest, number>): string[] {
  const facts: string[] = [];
  if ('value' in seen) {
    const {trail, main} = seen.value;
    facts.push(`data-feed during the wait: ${trail === null || trail.length === 0 ? '(not observed)' : trail.join(' -> ')}`);
    facts.push(mainFact(main));
  } else {
    facts.push(`the page could not be read: ${seen.problem}`);
  }
  facts.push('value' in requests ? requestFacts(requests.value, since, times) : `the page's requests could not be read: ${requests.problem}`);
  return facts;
}

const firstLine = (error: unknown): string => error instanceof Error ? error.message.split('\n')[0] ?? '' : String(error);

/**
 * Waits, with the page's default timeout, for `main#main[data-feed="${value}"]`. If the wait expires, its error says
 * which `data-feed` values the page showed during the wait, the main region's `data-feed`, `data-copies` and
 * `data-syncs` at expiry, and how the page's latest SDK stream requests stood. The original error is its `cause`, and
 * a failure while gathering these facts is reported in the message without replacing it. `clock` times the requests.
 */
export async function waitForFeed(page: FeedPage, value: string, clock: Clock = Date.now): Promise<void> {
  const since = clock();
  const times = startTimes(page, clock);
  const key = `__bunnyFeedWait${String(since)}${Math.random().toString(36).slice(2)}`;
  // Started beside the wait, not before it, so the wait's own timing is unchanged; a page that navigates drops it.
  const watching = page.evaluate(watchFeed, {key, value}).then(() => true, () => false);
  try {
    await page.locator(`main#main[data-feed="${value}"]`).waitFor();
  } catch (error) {
    let facts: string[];
    try {
      const [seen, requests] = await Promise.all([bounded(async () => {
        const watched = await watching;
        const read = await page.evaluate(readFeed, key);
        return watched ? read : {...read, trail: null};
      }), bounded(() => page.requests())]);
      facts = describe(seen, requests, since, times);
    } catch (problem) {
      facts = [`the wait's facts could not be gathered: ${firstLine(problem)}`];
    }
    throw new Error(`feed(page, '${value}') did not see main#main[data-feed="${value}"]: ${firstLine(error)}\n  ${facts.join('\n  ')}`, {cause: error});
  }
  // Not awaited, so a successful wait takes no longer; a page that navigated or closed has dropped the record anyway.
  void watching.then(() => page.evaluate(stopFeedWatch, key)).catch(() => {});
}

/** Runs in the page: the main region's connection attributes now. `_unused` is the argument every page read here takes. */
function readMain(_unused: null): MainState {
  const main = document.querySelector('main#main');
  return main === null ? null : {feed: main.getAttribute('data-feed'), copies: main.getAttribute('data-copies'), syncs: main.getAttribute('data-syncs')};
}

/**
 * The main region's `data-feed`, `data-copies` and `data-syncs` now, in the words the feed waits use, read within
 * `READ_MS`. A journey describing its own expired wait states the page's connection with it (#2129).
 */
export async function mainNow(page: Pick<FeedPage, 'evaluate'>): Promise<string> {
  const main = await bounded(() => page.evaluate(readMain, null));
  return 'value' in main ? mainFact(main.value) : `the page could not be read: ${main.problem}`;
}

/**
 * Waits, with the page's default timeout, for `main#main[data-copies="synced"]`: the page holds a current copy of
 * every owner's records it follows. A page's feed connects before its copies arrive (ADR 0012), so a card that shows
 * records is not ready at `data-feed="connected"` (#2123). If the wait expires, its error says the main region's
 * `data-feed`, `data-copies` and `data-syncs` at expiry and how the page's latest SDK requests stood, as the feed
 * wait's does. The original error is its `cause`. `clock` times the requests.
 */
export async function waitForCopies(page: FeedPage, clock: Clock = Date.now): Promise<void> {
  const since = clock();
  const times = startTimes(page, clock);
  try {
    await page.locator('main#main[data-copies="synced"]').waitFor();
  } catch (error) {
    let facts: string[];
    try {
      const [main, requests] = await Promise.all([mainNow(page), bounded(() => page.requests())]);
      facts = [main, 'value' in requests ? requestFacts(requests.value, since, times) : `the page's requests could not be read: ${requests.problem}`];
    } catch (problem) {
      facts = [`the wait's facts could not be gathered: ${firstLine(problem)}`];
    }
    throw new Error(`copiesSynced(page) did not see main#main[data-copies="synced"]: ${firstLine(error)}\n  ${facts.join('\n  ')}`, {cause: error});
  }
}
