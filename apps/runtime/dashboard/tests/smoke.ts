// CI's smoke check of the runtime's dashboard (Hub #922), as PR #986 gave the old one: the full browser suite
// (`npm run test:runtime-dashboard:browser`) runs locally. One trusted loopback page on the built runtime with the core:
// the gateway serves the built page, which signs in without a form, shows a synthetic session's finished turn as unread
// from its synced record, keeps the Hub mode and inbox panels, passes axe, and sends no command while it loads.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium} from 'playwright';
import {changes, feed, startWorld} from './harness.ts';

const started = performance.now();
const world = await startWorld();
const browser = await chromium.launch({headless: true});
const output = process.env.DASHBOARD_RECEIPTS;
if (output !== undefined) await mkdir(output, {recursive: true});
const checks: string[] = [];
try {
  await world.observe({kind: 'session-started'}, {title: {value: 'Port the wall', source: 'provider'}});
  await world.observe({kind: 'turn-ended'});
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, reducedMotion: 'reduce'});
  const errors: string[] = [];
  context.on('weberror', error => { errors.push(error.error().name); });
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  const sent = changes(page);
  const response = await page.goto(world.url);
  assert.equal(response?.status(), 200);
  assert.equal(await page.locator('script[type=module][src="/dashboard.js"]').count(), 1, 'the gateway serves the built page');
  checks.push('the built dashboard loads from the runtime');

  await page.getByText('Control enabled · Local', {exact: true}).waitFor();
  await feed(page, 'connected');
  assert.equal(await page.getByText('Open B.U.N.N.Y. with the launcher.').count(), 0, 'no sign-in page');
  assert.equal(world.browserSessions(), 1);
  checks.push('trusted loopback opens signed in');

  const row = page.locator('article.session').filter({has: page.getByRole('heading', {name: 'Port the wall', exact: true})});
  await row.locator('.chip', {hasText: 'Finished · unread'}).waitFor();
  for (const slot of ['hub-mode', 'inbox']) assert.equal(await page.locator(`[data-slot="${slot}"]`).count(), 1, `the ${slot} panel`);
  checks.push('the home shows the synced session\'s finished turn unread, with the Hub mode and inbox panels');

  const a11y = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  assert.deepEqual(a11y.violations.map(violation => ({id: violation.id, nodes: violation.nodes.map(node => `${node.target.join(' ')}: ${node.failureSummary ?? ''}`)})), []);
  if (output !== undefined) await page.screenshot({path: `${output}/runtime-smoke-home.png`, fullPage: true});
  checks.push('the home passes axe');

  assert.deepEqual(sent, [], 'loading and inspecting send no command');
  assert.deepEqual(errors, []);
  await context.close();
  process.stdout.write(`${JSON.stringify({passed: true, checks, seconds: Math.round((performance.now() - started) / 100) / 10})}\n`);
} finally {
  await browser.close();
  await world.close();
}
