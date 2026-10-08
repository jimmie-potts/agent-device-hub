// The runtime dashboard's full browser suite (Hub #922), converted from `apps/dashboard/tests/browser.mjs`: the shell,
// its routes and Places, and the agent sessions it syncs from the core, on the built runtime with a synthetic hook.
// Sessions appear, an approval is raised and cleared, a finished turn stays unread until the session record clears it,
// a lost stream resyncs with nothing replayed, the explicit acknowledgment sends one command, an ended session offers one
// sign-in, and the pages pass axe at desktop and phone widths. It contacts no device and no installed service.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium, type Page} from 'playwright';
import {OTHER, approvalPrompt, approvalResolved, runtimeEnded, sessionStarted, turnEnded, turnStarted} from '../../dist/tests/fixtures/agents.js';
import {changes, feed, startWorld} from './harness.ts';
import {controlReach, textOverlaps} from './layout.ts';

const PAIRED = 'http://127.0.0.1:47123/';
const world = await startWorld({placeLinks: {wall: PAIRED}});
const browser = await chromium.launch({headless: true});
const output = process.env.DASHBOARD_RECEIPTS;
if (output !== undefined) await mkdir(output, {recursive: true});
const shot = async (page: Page, name: string): Promise<void> => { if (output !== undefined) await page.screenshot({path: `${output}/${name}.png`, fullPage: true}); };
const axe = async (page: Page): Promise<string[]> => (await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations
  .map(violation => `${violation.id}: ${violation.nodes.map(node => node.target.join(' ')).join(', ')}`);
const checks: string[] = [];
const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
const errors: string[] = [];
context.on('weberror', error => { errors.push(error.error().name); });
const page = await context.newPage();
page.setDefaultTimeout(12_000);
const sent = changes(page);
const syncs: string[] = [];
page.on('request', request => { if (new URL(request.url()).pathname === '/api/sdk/v1/sync') syncs.push(request.url()); });
const row = (name: string) => page.locator('article.session').filter({has: page.getByRole('heading', {name, exact: true})});
const chip = (name: string, text: string) => row(name).locator('.chip', {hasText: text}).waitFor();

try {
  await page.goto(world.url);
  await feed(page, 'connected');
  await page.getByRole('heading', {name: 'Home', exact: true}).waitFor();
  await page.locator('.empty', {hasText: 'No sessions observed'}).waitFor();
  assert.deepEqual(await page.locator('.home-wide>[data-widget]').evaluateAll(all => all.map(widget => widget.getAttribute('data-widget'))), ['hub-mode', 'sessions']);
  assert.deepEqual(await page.locator('.home-narrow>[data-widget]').evaluateAll(all => all.map(widget => widget.getAttribute('data-widget'))), ['inbox', 'attention']);
  assert.equal(await page.locator('[data-widget=hub-mode] button, [data-widget=hub-mode] select').count(), 0, 'the Hub mode panel sends nothing yet');
  await page.getByText('No attention needed.', {exact: true}).waitFor();
  checks.push('the home follows the mockup: Hub mode and sessions wide, the inbox and attention narrow');

  // Places: a run is a preview (Hub #495), so Wall leads to the paired run named in the runtime's links.
  const places = page.getByRole('navigation', {name: 'Places'});
  await places.getByRole('link', {name: 'Wall Local'}).waitFor();
  assert.deepEqual(await places.locator('a, [aria-current=page]').allTextContents(), ['Guide', 'Architecture', 'Atlas', 'Reference', 'B.U.N.N.Y.Local', 'WallLocal']);
  assert.equal(await places.getByRole('link', {name: 'Wall Local'}).getAttribute('href'), PAIRED);
  assert.equal(await places.getByRole('link', {name: 'Guide'}).getAttribute('href'), 'https://jimmie-potts.github.io/agent-device-guide/');
  checks.push('Places link Wall to the paired run and keep the public guide');

  // Sessions appear as the hook observes them.
  await world.observe(sessionStarted, {title: {value: 'Port the wall', source: 'provider'}});
  await world.observe(turnStarted);
  await chip('Port the wall', 'Working');
  assert.equal(await row('Port the wall').locator('.session-id p').textContent(), 'Claude Code');
  await page.getByText('1 working · 1 sessions', {exact: true}).waitFor();
  checks.push('a session appears, working');

  // An approval prompt is raised and cleared.
  await world.observe(approvalPrompt('approval-1'));
  await chip('Port the wall', 'Waiting for approval');
  await row('Port the wall').getByText('Approval · blocked attention', {exact: true}).waitFor();
  await page.locator('[data-widget=attention]').getByText('Waiting for approval', {exact: false}).waitFor();
  await world.observe(approvalResolved('approval-1'));
  await chip('Port the wall', 'Working');
  await page.getByText('No attention needed.', {exact: true}).waitFor();
  checks.push('an approval prompt is raised and cleared');

  // A finished turn shows unread from the record, and nothing on the page or a timer clears it.
  await world.observe(turnEnded);
  await chip('Port the wall', 'Finished · unread');
  await row('Port the wall').getByRole('heading', {name: 'Retained notices', exact: true}).waitFor();
  await row('Port the wall').getByText('Acknowledged by: none.', {exact: false}).waitFor();
  await page.waitForTimeout(2500);
  assert.equal(await row('Port the wall').locator('.chip').textContent(), 'Finished · unread', 'still unread: no timer cleared it');
  assert.deepEqual(sent, [], 'the page sent nothing by itself');
  checks.push('a finished turn stays unread until the record clears it');

  // A second session's new turn clears its finished turn for the consumers set to clear on one, which the record shows.
  await world.observe(sessionStarted, {identity: OTHER, title: {value: 'Plan wave three', source: 'provider'}});
  await world.observe(turnStarted, {identity: OTHER});
  await world.observe(turnEnded, {identity: OTHER});
  await chip('Plan wave three', 'Finished · unread');
  await world.observe(turnStarted, {identity: OTHER, turn: 'turn-2'});
  await chip('Plan wave three', 'Working');
  await row('Plan wave three').getByText('Acknowledged by: nanoleaf, pixoo.', {exact: false}).waitFor();
  checks.push('a new turn clears the earlier finished turn, as the record says');

  // A lost stream: the page syncs again and shows the core's current state; nothing missed is replayed or sent.
  const before = syncs.length;
  world.dropDashboardStreams();
  await world.observe(turnEnded, {identity: OTHER, turn: 'turn-2'});
  await world.observe(sessionStarted, {identity: {...OTHER, sessionId: 'session-sim-3'}, title: {value: 'Review the inbox', source: 'provider'}});
  await page.waitForFunction(count => Number(document.getElementById('main')?.dataset.syncs) >= count, 2);
  await feed(page, 'connected');
  await chip('Plan wave three', 'Finished · unread');
  await row('Review the inbox').waitFor();
  assert.ok(syncs.length > before, 'the copy synced again after the stream came back');
  assert.deepEqual(sent, [], 'a reconnect replays no command');
  checks.push('a reconnect resyncs to current state with no replayed command');

  // The explicit acknowledgment: one command, for the dashboard; the record's change is its evidence.
  await row('Port the wall').getByRole('button', {name: 'Acknowledge for the dashboard', exact: true}).click();
  await row('Port the wall').getByText('Acknowledged for the dashboard.', {exact: true}).waitFor();
  await chip('Port the wall', 'Idle');
  await row('Port the wall').getByText('Acknowledged by: dashboard.', {exact: false}).waitFor();
  assert.equal(await row('Port the wall').getByRole('button', {name: 'Acknowledge for the dashboard'}).count(), 0);
  assert.deepEqual(sent, ['/api/sdk/v1/request'], 'exactly one command');
  checks.push('an explicit acknowledgment sends one command and the record clears the finished turn');

  // A session's end removes it.
  await world.observe(runtimeEnded, {identity: {...OTHER, sessionId: 'session-sim-3'}});
  await row('Review the inbox').waitFor({state: 'detached'});
  checks.push('a session that ended leaves the list');

  // Details keep the rare facts; the search filters without sending anything.
  await row('Port the wall').locator('details>summary').click();
  await row('Port the wall').getByText('Top-level session', {exact: true}).waitFor();
  await page.getByLabel('Find a session').fill('no-match');
  await page.getByRole('heading', {name: 'No matching sessions'}).waitFor();
  await page.getByLabel('Find a session').fill('');
  checks.push('details and the search');

  // Hash routes: every page has an address and the back button walks the history (Hub #247).
  await page.getByRole('link', {name: 'Connections', exact: true}).click();
  await page.getByRole('heading', {name: 'Connections', exact: true}).waitFor();
  assert.equal(new URL(page.url()).hash, '#/connections');
  assert.deepEqual(await page.locator('nav a[aria-current=page]').allTextContents(), ['Connections']);
  const cards = await page.locator('.cards.two>.card').evaluateAll(all => all.map(card => card.getBoundingClientRect().toJSON() as DOMRect));
  assert.ok(cards.length === 2 && (cards[1]?.left ?? 0) > (cards[0]?.right ?? 0), 'the connection cards sit side by side at 1440');
  await page.getByText('claude / host-sim / claude-code', {exact: true}).waitFor();
  await shot(page, 'runtime-connections');
  await page.goBack();
  await page.getByRole('heading', {name: 'Home', exact: true}).waitFor();
  await page.evaluate(() => { location.hash = '#/component/nothing'; });
  await page.getByRole('heading', {name: 'No component named nothing', exact: true}).waitFor();
  await page.getByRole('link', {name: 'Go to the home', exact: true}).click();
  await page.getByRole('heading', {name: 'Home', exact: true}).waitFor();
  checks.push('hash routes, the back button and a missing address');

  // Layout and accessibility, desktop and phone.
  assert.deepEqual(await textOverlaps(page), [], 'home text never overlaps');
  assert.ok(await controlReach(page) >= 0.5, 'the home uses the width');
  assert.deepEqual(await axe(page), []);
  await shot(page, 'runtime-home-desktop');
  await page.setViewportSize({width: 390, height: 844});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow on a phone');
  assert.deepEqual(await axe(page), []);
  await shot(page, 'runtime-home-mobile');
  await page.setViewportSize({width: 1440, height: 900});
  checks.push('no overlap, axe at 1440 and 390 px, no phone overflow');

  // A restart ends every browser session: the page offers one sign-in, and never signs in by itself.
  await world.restart();
  await feed(page, 'ended');
  await page.getByRole('alert').filter({hasText: 'Your session ended.'}).waitFor();
  await page.waitForTimeout(1500);
  assert.equal(world.browserSessions(), 0, 'the page did not sign in by itself');
  await page.getByRole('button', {name: 'Sign in again', exact: true}).click();
  await feed(page, 'connected');
  await chip('Port the wall', 'Idle');
  assert.equal(world.browserSessions(), 1);
  checks.push('an ended session offers one sign-in, which restores the page');

  // Disconnect ends the session; Sign in opens a new one.
  await page.getByRole('button', {name: 'Disconnect', exact: true}).click();
  await page.getByRole('heading', {name: 'You’re signed out.', exact: true}).waitFor();
  assert.equal(world.browserSessions(), 0);
  await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  await feed(page, 'connected');
  assert.equal(world.browserSessions(), 1);
  checks.push('Disconnect and Sign in');

  assert.deepEqual(sent, ['/api/sdk/v1/request'], 'still exactly one command');
  assert.deepEqual(errors, []);
  process.stdout.write(`${JSON.stringify({passed: true, checks})}\n`);
} catch (error) {
  process.stderr.write(`${await page.locator('main').innerText().catch(() => 'no page')}\n`);
  throw error;
} finally {
  await context.close();
  await browser.close();
  await world.close();
}
