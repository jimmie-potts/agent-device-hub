// A card that throws is contained to that card (Hub #2139). The built runtime and its real Pixoo and Tidbyt modules over
// synthetic devices; the page is the faultable test build (card-faults.ts), so one chosen card throws while it renders or
// from an effect. Without containment the page's React root unmounts and `main#main` is gone; with it, the failed card
// says so in its own place, offers one Retry that remounts it, records the failure, and every other card, the rail,
// the feed indicator and navigation keep working. Neither the failure nor a Retry sends a command. It contacts no device
// and no installed service.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium, type Page} from 'playwright';
import {sessionStarted} from '../../dist/tests/fixtures/agents.js';
import {serveFaultable, type CardFault} from './card-faults.ts';
import {changes, feed, startWorld} from './harness.ts';
import {textOverlaps} from './layout.ts';
import {openSettings} from './navigation-helpers.ts';

const world = await startWorld({pixooPages: true, tidbyt: true});
const browser = await chromium.launch({headless: true});
const output = process.env.DASHBOARD_RECEIPTS;
if (output !== undefined) await mkdir(output, {recursive: true});
const shot = async (page: Page, name: string): Promise<void> => { if (output !== undefined) await page.screenshot({path: `${output}/card-errors-${name}.png`, fullPage: true}); };
const checks: string[] = [];
const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
// CARD_ERRORS_PART runs one part: render, effect, component or module.
const part = process.env.CARD_ERRORS_PART;
const runs = (name: string): boolean => part === undefined || part === name;
const failed = (page: Page, card: string) => page.locator(`[data-card-failed="${card}"]`);

/** The page is still mounted: a contained fault leaves the shell, its main region and the rail in place. */
async function mounted(page: Page, why: string): Promise<void> {
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
  assert.equal(await face.getByRole('status').textContent(), `${name} failed to show. Its controls are unavailable.`);
  assert.deepEqual(await face.locator('button, a, input, select, textarea, [role=button], [tabindex]').evaluateAll(all => all.map(node => node.textContent)), ['Retry'],
    'a failed card offers Retry and no control that could send a command');
}

/** The Home cards' boxes, by card, to show that a failed card keeps its place. */
const boxes = (page: Page) => page.locator('.home-layout-grid > [data-home-card]').evaluateAll(all => Object.fromEntries(all.map(node => {
  const box = node.getBoundingClientRect();
  return [(node as HTMLElement).dataset.homeCard ?? '', [box.x, box.y, box.width, box.height].map(Math.round).join(',')];
})));

async function open(fault: Record<string, CardFault>): Promise<{page: Page; errors: string[]; sent: string[]; set: (card: string, fault: CardFault | undefined) => Promise<void>}> {
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  const errors: string[] = [];
  page.on('pageerror', error => { errors.push(error.name); });
  const sent = changes(page);
  const {set} = await serveFaultable(page, fault);
  await page.goto(world.url);
  await page.locator('main#main').waitFor({timeout: 8000}).catch(() => {});
  return {page, errors, sent, set};
}

try {
  if (runs('render')) {
  // The healthy Home: the reference places of its cards at each width.
  const healthy = await open({});
  await feed(healthy.page, 'connected');
  await healthy.page.locator('[data-home-card=inbox] h2', {hasText: 'Inbox'}).first().waitFor();
  const places: Record<string, Record<string, string>> = {};
  for (const width of [1440, 390]) {
    await healthy.page.setViewportSize({width, height: 900});
    await healthy.page.waitForTimeout(200);
    places[width] = await boxes(healthy.page);
  }
  assert.ok(Object.keys(places[1440] ?? {}).includes('inbox'), 'Home shows the Inbox card');
  await healthy.page.close();

  // A card that throws while it renders, on the first render of Home.
  const home = await open({inbox: 'render'});
  await mounted(home.page, 'a card that throws while it renders');
  await feed(home.page, 'connected', {failedCards: ['inbox']});
  await failedFace(home.page, 'inbox', 'TypeError', 'Inbox');
  assert.equal(await home.page.locator('[data-home-card=inbox] [data-card-failed=inbox]').count(), 1, 'the failure shows in the card\'s own place');
  assert.equal(await failed(home.page, 'inbox').getAttribute('data-fault-count'), '1', 'the failure is recorded once');
  assert.deepEqual(home.errors, ['TypeError'], 'the page reports the contained error once, as a page error');
  checks.push('a card that throws while it renders shows its failure in its own place; the page stays mounted');

  // The harness's health check names a failed card that a journey did not expect.
  await assert.rejects(feed(home.page, 'connected'), /a card failed: inbox \(TypeError\)/, 'feed() reports an unexpected failed card');
  checks.push('the journey harness fails a health check on a failed card and names it');

  // Layout: the failed card keeps its place, at its own size, at desktop and phone widths, light and dark.
  for (const colorScheme of ['light', 'dark'] as const) {
    await home.page.emulateMedia({colorScheme});
    for (const width of [1440, 390]) {
      await home.page.setViewportSize({width, height: 900});
      await home.page.waitForTimeout(200);
      assert.deepEqual(await boxes(home.page), places[width], `at ${String(width)} px the cards keep their places`);
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
  await home.page.waitForFunction(() => document.querySelector('[data-card-failed=inbox]')?.getAttribute('data-fault-count') === '2');
  await home.page.waitForTimeout(500);
  assert.equal(await failed(home.page, 'inbox').getAttribute('data-fault-count'), '2', 'one more failure, recorded once, and no loop');
  assert.deepEqual(home.errors, ['TypeError', 'TypeError']);
  await home.set('inbox', undefined);
  await failed(home.page, 'inbox').getByRole('button', {name: 'Retry', exact: true}).click();
  await failed(home.page, 'inbox').waitFor({state: 'detached'});
  await home.page.locator('[data-home-card=inbox] h2', {hasText: 'Inbox'}).first().waitFor();
  assert.equal(home.sent.length, before, 'neither the failure nor a Retry sends a command');
  assert.deepEqual(home.sent, [], 'the page sent no command');
  await feed(home.page, 'connected');
  checks.push('Retry remounts the card; a card that throws again is contained again; no command is sent');
  await home.page.close();
  }

  // A card that throws from an effect.
  if (runs('effect')) {
  const effect = await open({inbox: 'effect'});
  await mounted(effect.page, 'a card that throws from an effect');
  await feed(effect.page, 'connected', {failedCards: ['inbox']});
  await failedFace(effect.page, 'inbox', 'RangeError', 'Inbox');
  assert.equal(await failed(effect.page, 'inbox').getAttribute('data-fault-count'), '1');
  await openSettings(effect.page);
  await effect.page.getByRole('heading', {name: 'Settings', exact: true}).waitFor();
  await effect.page.goBack();
  await effect.set('inbox', undefined);
  await failed(effect.page, 'inbox').getByRole('button', {name: 'Retry', exact: true}).click();
  await effect.page.locator('[data-home-card=inbox] h2', {hasText: 'Inbox'}).first().waitFor();
  assert.deepEqual(effect.errors, ['RangeError']);
  assert.deepEqual(effect.sent, []);
  checks.push('a card that throws from an effect is contained and recovers on Retry');
  await effect.page.close();
  }

  // A component page: the Tidbyt device card throws on its route; the heading, tabs and rail stay.
  if (runs('component')) {
  const component = await open({});
  await feed(component.page, 'connected');
  await openSettings(component.page);
  await component.set('tidbyt', 'render');
  await component.page.evaluate(() => { location.hash = '#/component/tidbyt'; });
  await mounted(component.page, 'a component page whose card throws');
  await failedFace(component.page, 'component:tidbyt', 'TypeError', 'Tidbyt');
  await component.page.getByRole('heading', {level: 1}).waitFor();
  await openSettings(component.page);
  await component.page.getByRole('heading', {name: 'Settings', exact: true}).waitFor();
  await component.set('tidbyt', undefined);
  await component.page.goBack();
  // A remount by navigation is a new card: it shows again without a Retry.
  await component.page.locator('[data-tidbyt-artwork]').first().waitFor();
  assert.equal(await failed(component.page, 'component:tidbyt').count(), 0);
  assert.deepEqual(component.errors, ['TypeError']);
  assert.deepEqual(component.sent, []);
  await shot(component.page, 'component');
  checks.push('a component page contains its failed card; navigation away and back shows it again');
  await component.page.close();
  }

  // A module page on its route, from an effect. Its boundary resets when the page it holds changes.
  if (runs('module')) {
  const modulePage = await open({'module:pixoo/playlists': 'effect'});
  await feed(modulePage.page, 'connected');
  await modulePage.page.evaluate(() => { location.hash = '#/module/pixoo/playlists'; });
  await mounted(modulePage.page, 'a module page that throws');
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
  assert.deepEqual(modulePage.sent, []);
  checks.push('a module page contains its failure, resets on another page and recovers on Retry');
  await modulePage.page.close();
  }

  process.stdout.write(`${JSON.stringify({passed: true, checks})}\n`);
} finally {
  await context.close();
  await browser.close();
  await world.close();
}
