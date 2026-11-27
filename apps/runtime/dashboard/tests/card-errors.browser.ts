// A card that throws is contained to that card (Hub #2139). The built runtime and its real Pixoo and Tidbyt modules over
// synthetic devices; the page is the faultable test build (card-faults.ts), so one chosen card throws while it renders or
// from an effect. Without containment the page's React root unmounts and `main#main` is gone; with it, the failed card
// says so in its own place, offers one Retry that draws it again, records the failure, and every other card, the rail,
// the feed indicator and navigation keep working. A route page and the always-mounted device directory are contained the
// same way. Neither the failure nor a Retry sends a command. It also shows that the harness fails a run on a card that
// failed after the journey's last health check. It contacts no device and no installed service.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
import {chromium, type Page} from 'playwright';
import {openJourneyContext} from './browser-context.ts';
import {sessionStarted} from '../../dist/tests/fixtures/agents.js';
import {serveFaultable, type CardFault} from './card-faults.ts';
import {unreportedCardFaults} from './card-watch.ts';
import {changes, expectCardFaults, feed, startWorld} from './harness.ts';
import {textOverlaps} from './layout.ts';
import {openSettings} from './navigation-helpers.ts';

const world = await startWorld({pixooPages: true, tidbyt: true});
const browser = await chromium.launch({headless: true});
const output = process.env.DASHBOARD_RECEIPTS;
if (output !== undefined) await mkdir(output, {recursive: true});
const shot = async (page: Page, name: string): Promise<void> => { if (output !== undefined) await page.screenshot({path: `${output}/card-errors-${name}.png`, fullPage: true}); };
const checks: string[] = [];
const context = await openJourneyContext(browser, {viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
// CARD_ERRORS_PART runs one part: render, effect, component, module, page, directory, rail, backdrop, late or exit.
const part = process.env.CARD_ERRORS_PART;
const runs = (name: string): boolean => part === undefined || part === name;
// The rail's conversations and the art backdrop need the companions and art modules: a second world, for those parts only.
const modules = runs('rail') || runs('backdrop') ? await startWorld({companions: true, art: true}) : undefined;
const failed = (page: Page, card: string) => page.locator(`[data-card-failed="${card}"]`);

/**
 * Waits until `card` shows its failure or the page unmounts, then requires the page to be still mounted: a contained
 * fault leaves the shell, its main region and the rail in place. Without containment this is where a part fails.
 */
async function contained(page: Page, card: string, why: string): Promise<void> {
  await page.waitForFunction(name => document.querySelector(`[data-card-failed="${name}"]`) !== null || document.querySelector('main#main') === null, card);
  if (await page.locator('main#main').count() === 0) {
    throw new Error(`${why}: the page unmounted (no main#main); the root holds ${JSON.stringify(await page.locator('#root').innerHTML())}`);
  }
  await page.locator('#rail').waitFor();
}

/** The failed card's face: its name, the plain statement, one Retry and nothing else that acts. */
async function failedFace(page: Page, card: string, type: string, name: string): Promise<void> {
  const face = failed(page, card);
  await face.waitFor();
  assert.equal(await face.getAttribute('data-error-type'), type, `${card} names the error's type`);
  assert.equal(await face.getByRole('heading').textContent(), name);
  assert.equal(await face.getByRole('status').textContent(), `${name} failed to show. Retry draws it again and sends nothing.`);
  assert.deepEqual(await face.locator('button, a, input, select, textarea, [role=button], [tabindex]').evaluateAll(all => all.map(node => node.textContent)), ['Retry'],
    'a failed card offers Retry and no control that could send a command');
}

const HOME_CARDS = ['device:bunny/modules/tidbyt:tidbyt', 'music:bunny/modules/playback:living-room', 'device:bunny/modules/pixoo:pixoo-1', 'sessions', 'inbox'];
/** Waits for every card of this world's Home before its places are compared. */
async function allCards(page: Page): Promise<void> {
  for (const card of HOME_CARDS) await page.locator(`.home-layout-grid > [data-home-card="${card}"]`).waitFor();
  await page.locator('[data-tidbyt-artwork], [data-tidbyt-shape]').first().waitFor();
}

/** The records of the page's own log (card-fault.ts), as the faultable build exposes them. */
const records = (page: Page) => page.evaluate(() => (globalThis as unknown as {cardFaultRecords: () => unknown[]}).cardFaultRecords());
const record = (card: string, type: string) => ({level: 'error', event: 'dashboard.card.failed', fields: {'bunny.card': card, 'bunny.code': 'internal', 'error.type': type}});

/** Retries `card` and waits until it has recorded one more failure. */
async function retryFails(page: Page, card: string, count: number): Promise<void> {
  await failed(page, card).getByRole('button', {name: /^Retry/}).click();
  await recorded(page, card, count);
}

/** Waits until `card` has recorded `count` failures, then checks that no more follow. */
async function recorded(page: Page, card: string, count: number): Promise<void> {
  await page.waitForFunction(([name, value]) => document.querySelector(`[data-card-failed="${name}"]`)?.getAttribute('data-fault-count') === value, [card, String(count)] as const);
  await page.waitForTimeout(300);
  assert.equal(await failed(page, card).getAttribute('data-fault-count'), String(count), `${card} recorded ${String(count)} failures, once each, with no render loop`);
}

/** The Home cards' boxes, by card, to show that a failed card keeps its place. */
const boxes = (page: Page) => page.locator('.home-layout-grid > [data-home-card]').evaluateAll(all => Object.fromEntries(all.map(node => {
  const box = node.getBoundingClientRect();
  return [(node as HTMLElement).dataset.homeCard ?? '', [box.x, box.y, box.width, box.height].map(Math.round).join(',')];
})));

/** Opens the faultable page; `expected` are the cards this part fails on purpose, which therefore do not fail the run. */
async function open(fault: Record<string, CardFault>, expected: readonly string[], url = world.url): Promise<{page: Page; errors: string[]; sent: string[]; set: (card: string, fault: CardFault | undefined) => Promise<void>}> {
  const page = await context.newPage();
  expectCardFaults(page, expected);
  page.setDefaultTimeout(12_000);
  const errors: string[] = [];
  page.on('pageerror', error => { errors.push(error.name); });
  const sent = changes(page);
  const faults = await serveFaultable(page, fault);
  await page.goto(url);
  await page.locator('main#main').waitFor({timeout: 8000}).catch(() => {});
  return {page, errors, sent, set: async (card, value) => { await faults.set(card, value); }};
}

try {
  if (runs('render')) {
  // The healthy Home: the reference places of its cards at each width.
  const healthy = await open({}, []);
  await feed(healthy.page, 'connected');
  await healthy.page.locator('[data-home-card=inbox] h2', {hasText: 'Inbox'}).first().waitFor();
  await allCards(healthy.page);
  const places: Record<string, Record<string, string>> = {};
  for (const width of [1440, 390]) {
    await healthy.page.setViewportSize({width, height: 900});
    await healthy.page.waitForTimeout(200);
    places[width] = await boxes(healthy.page);
  }
  assert.ok(Object.keys(places[1440] ?? {}).includes('inbox'), 'Home shows the Inbox card');
  await healthy.page.close();

  // A card that throws while it renders, on the first render of Home.
  const home = await open({inbox: 'render'}, ['inbox']);
  await contained(home.page, 'inbox', 'a card that throws while it renders');
  await feed(home.page, 'connected', {failedCards: ['inbox']});
  await failedFace(home.page, 'inbox', 'TypeError', 'Inbox');
  assert.equal(await home.page.locator('[data-home-card=inbox] [data-card-failed=inbox]').count(), 1, 'the failure shows in the card\'s own place');
  await recorded(home.page, 'inbox', 1);
  assert.deepEqual(home.errors, ['TypeError'], 'the page reports the contained error once, as a page error');
  assert.deepEqual(await records(home.page), [record('inbox', 'TypeError')], 'the page formed one record: the card, its code and the error\'s type, no message');
  checks.push('a card that throws while it renders shows its failure in its own place; the page stays mounted');

  // The harness's health check names a failed card that a journey did not expect.
  await assert.rejects(feed(home.page, 'connected'), /a card failed: inbox \(TypeError\)/, 'feed() reports an unexpected failed card');
  checks.push('the journey harness fails a health check on a failed card and names it');

  await allCards(home.page);
  // Layout: the failed card keeps its place, at its own size, at desktop and phone widths, light and dark.
  for (const colorScheme of ['light', 'dark'] as const) {
    await home.page.emulateMedia({colorScheme});
    for (const width of [1440, 390]) {
      await home.page.setViewportSize({width, height: 900});
      await home.page.waitForTimeout(200);
      const now = await boxes(home.page), was = places[width] ?? {};
      if (width === 1440) assert.deepEqual(now, was, 'on the unit grid every card keeps its place and size');
      // A phone stacks the cards at their content heights: the order and the widths stay.
      else {
        const order = (all: Record<string, string>): string[] => Object.entries(all).sort(([, a], [, b]) => Number(a.split(',')[1]) - Number(b.split(',')[1])).map(([card, box]) => `${card}@${box.split(',')[2] ?? ''}`);
        assert.deepEqual(order(now), order(was), 'on a phone the cards keep their order and widths');
      }
      assert.ok(await home.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no horizontal overflow at ${String(width)} px`);
      assert.ok(await failed(home.page, 'inbox').evaluate(face => face.scrollWidth <= face.clientWidth && face.scrollHeight <= Math.max(face.clientHeight, (face.parentElement?.clientHeight ?? 0))),
        `the failed face fits its card at ${String(width)} px`);
      assert.deepEqual(await textOverlaps(home.page), [], `no text overlaps at ${String(width)} px`);
      await shot(home.page, `home-${colorScheme}-${String(width)}`);
    }
  }
  await home.page.emulateMedia({colorScheme: 'light'});
  await home.page.setViewportSize({width: 1440, height: 900});
  checks.push('the failed card keeps its place at 1440 and 390 px, light and dark');

  // Every other card keeps working: a session appears on the Sessions card and opens.
  await world.observe(sessionStarted, {title: {value: 'Contained card', source: 'provider'}});
  const session = home.page.locator('article.session').filter({has: home.page.getByRole('heading', {name: 'Contained card', exact: true})});
  await session.waitFor();
  await session.locator('summary').click();
  await session.getByText('Top-level session', {exact: true}).waitFor();
  await session.locator('summary.agent-face').click();
  // The rail, the feed indicator and navigation.
  await home.page.locator('.sidebar-foot').getByText(/Control enabled|Read-only/).waitFor();
  await openSettings(home.page);
  await home.page.getByRole('heading', {name: 'Settings', exact: true}).waitFor();
  await home.page.goBack();
  await home.page.getByRole('heading', {name: 'Home', exact: true}).waitFor();
  await failedFace(home.page, 'inbox', 'TypeError', 'Inbox');
  checks.push('other cards, the rail, the feed indicator and navigation keep working');

  // Retry remounts the card. A card that throws again is contained again, recorded again, with no render loop.
  const before = home.sent.length;
  await failed(home.page, 'inbox').getByRole('button', {name: 'Retry', exact: true}).click();
  await recorded(home.page, 'inbox', 2);
  // Returning to Home mounted the card again, which failed again: three failures in all, each reported and recorded once.
  assert.deepEqual(home.errors, ['TypeError', 'TypeError', 'TypeError']);
  assert.deepEqual(await records(home.page), [1, 2, 3].map(() => record('inbox', 'TypeError')));
  await home.set('inbox', undefined);
  await failed(home.page, 'inbox').getByRole('button', {name: 'Retry', exact: true}).click();
  await failed(home.page, 'inbox').waitFor({state: 'detached'});
  await home.page.locator('[data-home-card=inbox] h2', {hasText: 'Inbox'}).first().waitFor();
  assert.equal(home.sent.length, before, 'neither the failure nor a Retry sends a command');
  assert.deepEqual(home.sent, [], 'the page sent no command');
  await feed(home.page, 'connected');
  checks.push('Retry draws the card again; a card that throws again is contained again; no command is sent');
  await home.page.close();
  }

  // A card that throws from an effect.
  if (runs('effect')) {
  const effect = await open({inbox: 'effect'}, ['inbox']);
  await contained(effect.page, 'inbox', 'a card that throws from an effect');
  await feed(effect.page, 'connected', {failedCards: ['inbox']});
  await failedFace(effect.page, 'inbox', 'RangeError', 'Inbox');
  await recorded(effect.page, 'inbox', 1);
  await openSettings(effect.page);
  await effect.page.getByRole('heading', {name: 'Settings', exact: true}).waitFor();
  await effect.page.goBack();
  await effect.set('inbox', undefined);
  await failed(effect.page, 'inbox').getByRole('button', {name: 'Retry', exact: true}).click();
  await effect.page.locator('[data-home-card=inbox] h2', {hasText: 'Inbox'}).first().waitFor();
  assert.deepEqual(effect.errors, ['RangeError', 'RangeError'], 'the first mount and the one after navigating back');
  assert.deepEqual(await records(effect.page), [record('inbox', 'RangeError'), record('inbox', 'RangeError')]);
  assert.deepEqual(effect.sent, []);
  checks.push('a card that throws from an effect is contained and recovers on Retry');
  await effect.page.close();
  }

  // A component page: the Tidbyt device card throws on its route; the heading, tabs and rail stay.
  if (runs('component')) {
  const component = await open({}, ['component:tidbyt']);
  await feed(component.page, 'connected');
  await openSettings(component.page);
  await component.set('tidbyt', 'render');
  await component.page.evaluate(() => { location.hash = '#/component/tidbyt'; });
  await contained(component.page, 'component:tidbyt', 'a component page whose card throws');
  await failedFace(component.page, 'component:tidbyt', 'TypeError', 'Tidbyt');
  await component.page.getByRole('heading', {level: 1}).waitFor();
  // Retry draws the card again: still failing, it is contained again; once it no longer throws, it shows.
  await retryFails(component.page, 'component:tidbyt', 2);
  await component.set('tidbyt', undefined);
  await failed(component.page, 'component:tidbyt').getByRole('button', {name: 'Retry', exact: true}).click();
  await component.page.locator('[data-tidbyt-artwork]').first().waitFor();
  assert.equal(await failed(component.page, 'component:tidbyt').count(), 0);
  await openSettings(component.page);
  await component.set('tidbyt', 'render');
  await component.page.goBack();
  await failedFace(component.page, 'component:tidbyt', 'TypeError', 'Tidbyt');
  await openSettings(component.page);
  await component.page.getByRole('heading', {name: 'Settings', exact: true}).waitFor();
  await component.set('tidbyt', undefined);
  await component.page.goBack();
  // A remount by navigation is a new card: it shows again without a Retry.
  await component.page.locator('[data-tidbyt-artwork]').first().waitFor();
  assert.equal(await failed(component.page, 'component:tidbyt').count(), 0);
  assert.deepEqual(component.errors, ['TypeError', 'TypeError', 'TypeError']);
  assert.deepEqual(component.sent, [], 'neither the failures nor a Retry sent a command');
  await shot(component.page, 'component');
  checks.push('a component page contains its failed card; Retry draws it again; navigation away and back shows it again');
  await component.page.close();
  }

  // A module page on its route, from an effect. Its boundary resets when the page it holds changes.
  if (runs('module')) {
  const modulePage = await open({'module:pixoo/playlists': 'effect'}, ['module:pixoo/playlists']);
  await feed(modulePage.page, 'connected');
  await modulePage.page.evaluate(() => { location.hash = '#/module/pixoo/playlists'; });
  await contained(modulePage.page, 'module:pixoo/playlists', 'a module page that throws');
  await failedFace(modulePage.page, 'module:pixoo/playlists', 'RangeError', 'Playlists');
  await shot(modulePage.page, 'module');
  await modulePage.page.evaluate(() => { location.hash = '#/module/pixoo/library'; });
  await modulePage.page.waitForFunction(() => location.hash === '#/module/pixoo/library');
  await modulePage.page.waitForTimeout(300);
  assert.equal(await modulePage.page.locator('[data-card-failed]').count(), 0, 'another module page is a new identity and shows');
  await modulePage.page.goBack();
  await failedFace(modulePage.page, 'module:pixoo/playlists', 'RangeError', 'Playlists');
  await modulePage.set('module:pixoo/playlists', undefined);
  await failed(modulePage.page, 'module:pixoo/playlists').getByRole('button', {name: 'Retry', exact: true}).click();
  await failed(modulePage.page, 'module:pixoo/playlists').waitFor({state: 'detached'});
  assert.deepEqual(modulePage.errors, ['RangeError', 'RangeError']);
  // After a Retry that worked, another page mounts once: its boundary starts again without mounting it twice.
  const mounts = (page: Page) => page.evaluate(() => (globalThis as unknown as {cardMounts?: Record<string, number>}).cardMounts?.['module:pixoo/library'] ?? 0);
  const before = await mounts(modulePage.page);
  await modulePage.page.evaluate(() => { location.hash = '#/module/pixoo/library'; });
  await modulePage.page.waitForFunction(count => ((globalThis as unknown as {cardMounts?: Record<string, number>}).cardMounts?.['module:pixoo/library'] ?? 0) > count, before);
  assert.equal(await mounts(modulePage.page), before + 1, 'the next module page mounts once');
  assert.deepEqual(modulePage.sent, []);
  checks.push('a module page contains its failure, resets on another page, recovers on Retry and mounts the next page once');
  await modulePage.page.close();
  }

  // A route page: Automation throws while it renders. Its place shows the failure under its own heading; the rail stays.
  if (runs('page')) {
  const route = await open({'page:automation': 'render'}, ['page:automation']);
  await feed(route.page, 'connected');
  await route.page.evaluate(() => { location.hash = '#/automation'; });
  await contained(route.page, 'page:automation', 'a route page that throws');
  await failedFace(route.page, 'page:automation', 'TypeError', 'Automation');
  assert.equal(await failed(route.page, 'page:automation').getByRole('heading', {level: 1}).textContent(), 'Automation', 'the page keeps its heading');
  await shot(route.page, 'page');
  await openSettings(route.page);
  await route.page.getByRole('heading', {name: 'Settings', exact: true}).waitFor();
  await route.page.goBack();
  await failedFace(route.page, 'page:automation', 'TypeError', 'Automation');
  await route.set('page:automation', undefined);
  await failed(route.page, 'page:automation').getByRole('button', {name: 'Retry', exact: true}).click();
  await failed(route.page, 'page:automation').waitFor({state: 'detached'});
  await route.page.locator('section.automation-workspace h1', {hasText: 'Automation'}).waitFor();
  assert.deepEqual(route.errors, ['TypeError', 'TypeError']);
  assert.deepEqual(await records(route.page), [record('page:automation', 'TypeError'), record('page:automation', 'TypeError')]);
  assert.deepEqual(route.sent, []);
  checks.push('a route page contains its failure in its place; navigation works; Retry draws it again');
  await route.page.close();
  }

  // An always-mounted part: the device directory throws on every route. Elsewhere it draws nothing and Home works; on its
  // own route it shows its failure.
  if (runs('directory')) {
  const directory = await open({'page:devices': 'render'}, ['page:devices']);
  await contained(directory.page, 'page:devices', 'an always-mounted part that throws');
  await feed(directory.page, 'connected', {failedCards: ['page:devices']});
  await directory.page.locator('[data-home-card=inbox] h2', {hasText: 'Inbox'}).first().waitFor();
  assert.equal(await failed(directory.page, 'page:devices').isHidden(), true, 'off its route the failed directory draws nothing');
  await directory.page.evaluate(() => { location.hash = '#/devices'; });
  await failedFace(directory.page, 'page:devices', 'TypeError', 'Devices');
  await directory.set('page:devices', undefined);
  await failed(directory.page, 'page:devices').getByRole('button', {name: 'Retry', exact: true}).click();
  await failed(directory.page, 'page:devices').waitFor({state: 'detached'});
  await directory.page.locator('section[aria-label=Devices] h1', {hasText: 'Devices'}).waitFor();
  assert.deepEqual(directory.errors, ['TypeError']);
  assert.deepEqual(await records(directory.page), [record('page:devices', 'TypeError')]);
  assert.deepEqual(directory.sent, []);
  checks.push('an always-mounted part draws nothing off its route when it fails, shows its failure on its route and recovers on Retry');
  await directory.page.close();
  }

  // The rail's conversations: the failed part is one rail button that fits the rail, expanded, collapsed and as the phone
  // drawer. The rail keeps to the viewport, Settings and the feed indicator stay in view, and Retry sends nothing.
  if (runs('rail') && modules !== undefined) {
  const card = 'part:conversations';
  const rail = await open({[card]: 'render'}, [card], modules.url);
  await contained(rail.page, card, 'the rail\'s conversations that throw');
  await feed(rail.page, 'connected', {failedCards: [card]});
  const fits = async (state: string): Promise<void> => {
    const facts = await rail.page.evaluate(name => {
      const box = (node: Element | null) => node?.getBoundingClientRect();
      const aside = box(document.querySelector('#rail')), failedPart = document.querySelector(`[data-card-failed="${name}"]`), face = box(failedPart);
      const settings = box(document.querySelector('#rail nav[aria-label=Utilities] a')), foot = box(document.querySelector('#rail .sidebar-foot'));
      const inside = (inner: DOMRect | undefined, outer: DOMRect | undefined) => inner !== undefined && outer !== undefined && inner.width > 0
        && inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5 && inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5;
      const viewport = new DOMRect(0, 0, innerWidth, innerHeight);
      // Every visible box of the face, its text included, stays in the rail, and no text runs past its own box. Text the
      // rail hides visually (one pixel, clipped) is left out.
      const parts = [...(failedPart?.querySelectorAll('*') ?? [])].filter(node => node.getBoundingClientRect().width > 1 && node.getBoundingClientRect().height > 1);
      return {railHeight: Math.round(aside?.height ?? 0), viewport: innerHeight, faceHeight: Math.round(face?.height ?? 0),
        faceInRail: inside(face, aside) && parts.every(node => inside(box(node), aside) && node.scrollWidth <= node.clientWidth + 1),
        outside: parts.filter(node => !inside(box(node), aside) || node.scrollWidth > node.clientWidth + 1).map(node => `${node.tagName.toLowerCase()}.${node.getAttribute('class') ?? ''} ${node.scrollWidth}/${node.clientWidth}`),
        settingsInView: inside(settings, viewport), footInView: inside(foot, viewport)};
    }, card);
    assert.ok(facts.railHeight <= facts.viewport, `${state}: the rail keeps to the viewport (${JSON.stringify(facts)})`);
    assert.ok(facts.faceInRail, `${state}: the failed face stays inside the rail (${JSON.stringify(facts)})`);
    assert.ok(facts.settingsInView && facts.footInView, `${state}: Settings and the feed indicator stay in view (${JSON.stringify(facts)})`);
    assert.equal(await failed(rail.page, card).getByRole('button', {name: /^Retry/}).isVisible(), true, `${state}: Retry is reachable`);
    assert.deepEqual(await textOverlaps(rail.page), [], `${state}: no text overlaps`);
    await shot(rail.page, `rail-${state}`);
  };
  /** The rail face: one Retry named for the part, whose title and status carry the sentence. */
  const face = async (): Promise<void> => {
    const sentence = 'Conversations failed to show. Retry draws it again and sends nothing.';
    assert.equal(await failed(rail.page, card).getByRole('button', {name: 'Retry Conversations', exact: true}).getAttribute('title'), sentence);
    assert.equal(await failed(rail.page, card).getByRole('status').textContent(), sentence);
    assert.equal(await failed(rail.page, card).locator('button, a, input, select, textarea, [tabindex]').count(), 1, 'Retry is the face\'s one control');
  };
  const toggle = rail.page.locator('#rail .rail-toggle');
  if (await toggle.getAttribute('aria-label') === 'Expand navigation') await toggle.click();
  await rail.page.locator('#rail .rail-toggle[aria-label="Collapse navigation"]').waitFor();
  await fits('expanded');
  await toggle.click();
  await rail.page.locator('#rail .rail-toggle[aria-label="Expand navigation"]').waitFor();
  await fits('collapsed');
  await face();
  // Retry from the collapsed rail: still failing, it is contained again.
  await retryFails(rail.page, card, 2);
  await fits('collapsed-again');
  await toggle.click();
  await rail.page.setViewportSize({width: 390, height: 844});
  await rail.page.getByRole('button', {name: 'Open navigation'}).click();
  await rail.page.locator('.shell[data-drawer=open]').waitFor();
  await fits('drawer');
  await rail.set(card, undefined);
  await failed(rail.page, card).getByRole('button', {name: /^Retry/}).click();
  await failed(rail.page, card).waitFor({state: 'detached'});
  await rail.page.locator('#rail .rail-conversations > :not([data-card-failed])').first().waitFor();
  assert.deepEqual(rail.errors, ['TypeError', 'TypeError']);
  assert.deepEqual(await records(rail.page), [record(card, 'TypeError'), record(card, 'TypeError')]);
  assert.deepEqual(rail.sent, [], 'neither the failures nor a Retry sent a command');
  await rail.page.setViewportSize({width: 1440, height: 900});
  checks.push('the rail\'s failed conversations fit the expanded rail, the collapsed rail and the phone drawer; Retry draws them again');
  await rail.page.close();
  }

  // The art backdrop source draws nothing: failing, it still draws nothing, is recorded and counted, and Home stays.
  if (runs('backdrop') && modules !== undefined) {
  const card = 'part:art-backdrop';
  const backdrop = await open({[card]: 'render'}, [card], modules.url);
  await contained(backdrop.page, card, 'the art backdrop source that throws');
  await feed(backdrop.page, 'connected', {failedCards: [card]});
  await recorded(backdrop.page, card, 1);
  assert.equal(await failed(backdrop.page, card).isHidden(), true, 'the failed backdrop source draws nothing');
  assert.equal(await failed(backdrop.page, card).evaluate(node => node.getBoundingClientRect().height), 0);
  await backdrop.page.getByRole('heading', {name: 'Home', exact: true}).waitFor();
  await backdrop.page.locator('[data-home-card=inbox] h2', {hasText: 'Inbox'}).first().waitFor();
  assert.deepEqual(backdrop.errors, ['TypeError']);
  assert.deepEqual(await records(backdrop.page), [record(card, 'TypeError')]);
  assert.deepEqual(backdrop.sent, []);
  checks.push('a failed art backdrop source draws nothing, is recorded and counted, and Home stays');
  await backdrop.page.close();
  }

  // A card that fails after the journey's last health check: the harness records it as it happens, by its card, and the
  // world's close() would fail the run on it. This page expects no fault, so the record is taken back here.
  if (runs('late')) {
  const late = await open({}, []);
  await feed(late.page, 'connected');
  await late.page.locator('[data-home-card=inbox] h2', {hasText: 'Inbox'}).first().waitFor();
  await late.set('inbox', 'render');
  await openSettings(late.page);
  await late.page.goBack();
  await failed(late.page, 'inbox').waitFor();
  await late.page.close();
  assert.deepEqual(unreportedCardFaults(), ['inbox (TypeError)'], 'the harness recorded the late failure by its card, after its page closed');
  checks.push('the harness records a card that fails after the last health check, for the world\'s close() to fail the run');
  }

  // The real end of a run: a tiny journey in a child process, healthy and with a card that fails after its last feed().
  if (runs('exit')) {
  const run = (late: boolean) => new Promise<{code: number | null; stderr: string}>((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('card-watch-run.ts', import.meta.url))],
      {env: {...process.env, CARD_WATCH_LATE: late ? '1' : '0'}, stdio: ['ignore', 'ignore', 'pipe']});
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    // Bounded: a run that has not ended in two minutes is stopped and fails this part.
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`the child journey did not end in 120 s: ${stderr}`)); }, 120_000);
    child.on('error', reject).on('close', code => { clearTimeout(timer); resolve({code, stderr}); });
  });
  const healthy = await run(false);
  assert.equal(healthy.code, 0, `a healthy run exits 0: ${healthy.stderr}`);
  assert.equal(healthy.stderr.includes('a card failed'), false);
  const late = await run(true);
  assert.equal(late.code, 1, `a card that failed after the last feed() fails the run: ${late.stderr}`);
  assert.match(late.stderr, /a card failed: inbox \(TypeError\)/);
  checks.push('a card that fails after the last feed() makes the run exit 1 naming it; a healthy run exits 0');
  }

  process.stdout.write(`${JSON.stringify({passed: true, checks})}\n`);
} finally {
  await context.close();
  await browser.close();
  await modules?.close();
  await world.close();
}
