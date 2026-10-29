// The existing shell at a television viewport, driven from the keyboard only (#1112): a TV browser presents the remote's
// D-pad as focus movement, Select as Enter and Back as the browser's back. Nothing here is a TV browser or the ONN; it is
// Playwright's Chromium on the disposable synthetic runtime, and it establishes the shell's keyboard and layout behavior
// at that size, not rendering, password, cookie or stream behavior on any device. The television page sends no command.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium, type BrowserContext, type Locator, type Page} from 'playwright';
import {OTHER, approvalPrompt, sessionStarted, turnStarted} from '../../dist/tests/fixtures/agents.js';
import {changes, feed, startWorld} from './harness.ts';
import {textOverlaps} from './layout.ts';

const DESKTOP = {...OTHER, provider: 'codex', client: 'desktop', sourceId: 'codex-desktop'} as const;
const world = await startWorld();
const browser = await chromium.launch({headless: true});
const output = process.env.DASHBOARD_RECEIPTS;
if (output !== undefined) await mkdir(output, {recursive: true});
const checks: string[] = [];
const errors: string[] = [];

async function open(viewport: {width: number; height: number}): Promise<{context: BrowserContext; page: Page; sent: string[]}> {
  const context = await browser.newContext({viewport, reducedMotion: 'reduce'});
  context.on('weberror', error => { errors.push(error.error().name); });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const sent = changes(page);
  await page.goto(world.url);
  await feed(page, 'connected');
  return {context, page, sent};
}
const shot = async (page: Page, name: string): Promise<void> => { if (output !== undefined) await page.screenshot({path: `${output}/${name}.png`}); };
const focused = (page: Page, target: Locator): Promise<boolean> => target.evaluate(element => element === document.activeElement);
/** Presses Tab until `target` holds focus, as a remote's directional keys would, within a bound that covers the Home page. */
async function tabTo(page: Page, target: Locator, bound = 80): Promise<void> {
  for (let presses = 0; presses < bound; presses += 1) {
    if (await focused(page, target)) return;
    await page.keyboard.press('Tab');
  }
  assert.fail(`focus never reached ${await target.evaluate(element => element.outerHTML.slice(0, 80))} within ${bound} presses`);
}
/** The focused control shows the style guide's outline, so a viewer across the room can see where the ring is. */
const focusVisible = (page: Page): Promise<boolean> => page.evaluate(() => {
  const element = document.activeElement;
  if (element === null || element === document.body) return false;
  const style = getComputedStyle(element);
  return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 2;
});
const modeCommands = (sent: string[]): number => sent.filter(item => item.endsWith('/commands/mode-set')).length;

try {
  await world.observe(sessionStarted, {title: {value: 'Port the wall', source: 'provider'}});
  await world.observe(turnStarted);
  await world.observe(approvalPrompt('approval-1'));
  await world.observe(sessionStarted, {identity: DESKTOP, title: {value: 'Trim the inbox', source: 'provider'}});
  await world.observe(turnStarted, {identity: DESKTOP});

  const tv = await open({width: 1920, height: 1080});
  const {page} = tv;
  const card = (name: string): Locator => page.locator('article.session').filter({has: page.getByRole('heading', {name, exact: true})});
  await card('Port the wall').waitFor();
  await card('Trim the inbox').waitFor();
  await shot(page, 'tv-home');

  // Reading from the sofa: each card's face carries the name, the client line, the state and attention; opening it adds the evidence age.
  assert.equal(await card('Port the wall').locator('.agent-client').textContent(), 'Claude Code');
  assert.equal(await card('Trim the inbox').locator('.agent-client').textContent(), 'Codex Desktop');
  assert.equal(await card('Port the wall').getAttribute('data-attention'), 'true');
  assert.equal(await card('Port the wall').locator('.chip').textContent(), 'Waiting for approval');
  assert.equal(await card('Trim the inbox').locator('.chip').textContent(), 'Working');
  const inView = await page.locator('article.session').evaluateAll(all => all.filter(element => {
    const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight;
  }).length);
  assert.equal(inView, 2, 'both cards sit within the first television screen');
  const smallestText = await page.evaluate(() => Math.min(...[...document.querySelectorAll<HTMLElement>('main p, main h1, main h2, main h3, main span, main a, main button, main dt, main dd, main label')]
    .filter(element => element.offsetParent !== null && (element.textContent ?? '').trim() !== '')
    .map(element => Number.parseFloat(getComputedStyle(element).fontSize))));
  assert.deepEqual(await textOverlaps(page), []);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll');
  checks.push('the agent cards show name, client, state and attention within one 1080p screen');

  // The remote: Tab reaches Settings, Enter opens it, Back returns; every stop shows the focus ring.
  const settings = page.getByRole('navigation', {name: 'Utilities'}).getByRole('link', {name: 'Settings', exact: true});
  await tabTo(page, settings);
  assert.equal(await focusVisible(page), true, 'focus is visible on the Settings link');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', {name: 'Settings', level: 1, exact: true}).waitFor();
  await page.goBack();
  await page.getByRole('heading', {name: 'Home', exact: true}).waitFor();
  const quiet = page.locator('[data-widget="hub-mode"]').getByRole('button', {name: 'Quiet', exact: true});
  await tabTo(page, quiet);
  assert.equal(await focusVisible(page), true, 'focus is visible on a mode button');
  const face = card('Port the wall').locator('summary');
  await tabTo(page, face);
  assert.equal(await focusVisible(page), true, 'focus is visible on a card');
  await page.keyboard.press('Enter');
  await card('Port the wall').locator('details[open]').waitFor();
  await card('Port the wall').getByText(/^Last evidence: .* ago\./).waitFor();
  await card('Port the wall').locator('.attention', {hasText: 'Approval · blocked attention'}).waitFor();
  await shot(page, 'tv-card-open');
  await page.keyboard.press('Enter');
  assert.equal(await card('Port the wall').locator('details[open]').count(), 0, 'Select again closes the card');
  assert.equal(tv.sent.length, 0, 'reading and navigating send nothing');
  checks.push('Tab, Enter and Back reach Settings, the mode buttons and a card with a visible focus ring');

  // Away: the television loses its network while another browser changes the mode. Back: the current state appears once.
  const phone = await open({width: 390, height: 844});
  await tv.context.setOffline(true);
  world.dropDashboardStreams();
  await page.waitForFunction(() => document.querySelector('main#main')?.getAttribute('data-feed') !== 'connected');
  await card('Port the wall').locator('.chip', {hasText: 'Stale'}).waitFor();
  await shot(page, 'tv-stale');
  await feed(phone.page, 'connected');
  const phoneQuiet = phone.page.locator('[data-widget="hub-mode"]').getByRole('button', {name: 'Quiet', exact: true});
  await phoneQuiet.click();
  await phone.page.locator('[data-widget="hub-mode"]').getByRole('button', {name: 'Quiet', exact: true, pressed: true}).waitFor();
  assert.equal(modeCommands(phone.sent), 1);
  await tv.context.setOffline(false);
  await feed(page, 'connected');
  await page.locator('[data-widget="hub-mode"]').getByRole('button', {name: 'Quiet', exact: true, pressed: true}).waitFor();
  await card('Port the wall').locator('.chip', {hasText: 'Waiting for approval'}).waitFor();
  assert.equal(modeCommands(tv.sent), 0, 'the television shows the other browser\'s mode without repeating it');
  assert.equal(tv.sent.length, 0);
  await phone.context.close();
  checks.push('a lost stream marks the cards stale, and reconnecting shows the mode another browser set without a command');

  // Accessibility at television size, with a card open and the ring on it.
  await tabTo(page, face);
  const violations = (await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
  assert.deepEqual(violations.map(violation => `${violation.id}: ${violation.nodes.map(node => node.target.join(' ')).join(', ')}`), []);
  checks.push('axe passes at 1,920 × 1,080');

  // The session ends with a runtime restart; Sign in again is reachable from the keyboard and signs the television back in.
  await world.restart();
  await feed(page, 'ended');
  const again = page.getByRole('button', {name: 'Sign in again', exact: true});
  await tabTo(page, again);
  assert.equal(await focusVisible(page), true, 'focus is visible on Sign in again');
  await shot(page, 'tv-ended');
  await page.keyboard.press('Enter');
  await feed(page, 'connected');
  await page.getByText('Control enabled · Local', {exact: true}).waitFor();
  assert.equal(tv.sent.length, 0, 'signing in again sends no command');
  checks.push('after a restart, Sign in again works from the keyboard');

  assert.deepEqual(errors, []);
  await tv.context.close();
  process.stdout.write(`${JSON.stringify({passed: true, viewport: '1920x1080', smallestTextPx: smallestText, checks, actualOnn: false, tvBrowser: false})}\n`);
} finally {
  await browser.close();
  await world.close();
}
