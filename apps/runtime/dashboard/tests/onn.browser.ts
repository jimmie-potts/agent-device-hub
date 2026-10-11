import assert from 'node:assert/strict';
import {join} from 'node:path';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium} from 'playwright';
import {changes, feed, startWorld} from './harness.ts';
const browser = await chromium.launch({headless: true});
const world = await startWorld({onn: true});
async function effectCount(expected: number): Promise<void> {
  for (let attempt = 0; attempt < 300 && world.onnState().effects < expected; attempt += 1) await new Promise(resolve => {setTimeout(resolve, 50);});
  assert.equal(world.onnState().effects, expected);
}
try {
  const context = await browser.newContext({viewport: {width: 1280, height: 1000}, reducedMotion: 'reduce'});
  try {
    const errors: string[] = []; context.on('weberror', error => {errors.push(error.error().name);});
    const page = await context.newPage(); page.setDefaultTimeout(15_000); const sent = changes(page);
    await page.goto(`${world.url}/#/module/onn/controls`); await feed(page, 'connected');
    const controls = page.getByRole('region', {name: 'ONN controls'});
    await controls.getByText('Connection: available · Current app: none', {exact: true}).waitFor();
    assert.equal(world.onnState().effects, 0); assert.deepEqual(sent, [], 'page inspection sends no controls');
    assert.equal(await world.readonlyOnn(), 403, 'real reader credentials cannot control');
    let count = 0;
    for (const label of ['Up', 'Down', 'Left', 'Right', 'Select', 'Back', 'Home', 'Play / pause', 'Open YouTube', 'Open Stremio']) {
      const button = controls.getByRole('button', {name: label, exact: true}); await button.focus(); await button.press('Enter');
      await effectCount(++count);
      await controls.getByText('Completed: succeeded. Transmitted; physical effect was not observed.', {exact: true}).waitFor();
    }
    const input = controls.getByRole('textbox', {name: 'Focused text'}), insert = controls.getByRole('button', {name: 'Insert text', exact: true});
    await input.fill('unsupported 😊'); assert.equal(await insert.isDisabled(), true);
    await controls.getByText('This input contains unsupported characters.', {exact: true}).waitFor();
    const marker = 'SYNTHETIC_ONN_BROWSER_TEXT'; await input.fill(marker); await input.press('Enter');
    await effectCount(11);
    await controls.getByText('Completed: succeeded. Transmitted; physical effect was not observed.', {exact: true}).waitFor();
    assert.equal(await input.inputValue(), '', 'submitted text is immediately removed from the draft');
    assert.equal(world.onnState().effects, 11);
    assert.equal(await page.evaluate(text => JSON.stringify({local: {...localStorage}, session: {...sessionStorage}}).includes(text), marker), false);
    assert.equal(JSON.stringify(world.logs).includes(marker), false);
    await page.getByRole('button', {name: 'Reload status', exact: true}).click();
    await controls.getByText(/^Connection: available/).waitFor();
    await page.reload(); await feed(page, 'connected');
    await controls.getByText(/^Connection: available/).waitFor(); assert.equal(world.onnState().effects, 11, 'status and browser reload never replay controls');
    await page.evaluate(() => {const now = Date.now(); Date.now = () => now + 60_000;});
    await controls.getByText('Connection: available · Current app: unknown', {exact: true}).waitFor();
    world.onnOnline(false); await controls.getByText('Connection: unavailable · Current app: unknown', {exact: true}).waitFor();
    assert.equal(await controls.getByRole('button', {name: 'Right', exact: true}).isDisabled(), true);
    assert.equal(await insert.isDisabled(), true); assert.equal(world.onnState().effects, 11);
    assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(item => item.id), []);
    world.onnOnline(true); await controls.getByText(/^Connection: available/).waitFor();
    // UI authority interception exercises the rendered read-only context; the real credential refusal was checked above.
    await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
    await page.reload(); await feed(page, 'connected');
    await controls.getByText('Read-only access. Control access is required to use the remote.', {exact: true}).waitFor();
    for (const button of await controls.getByRole('button').all()) assert.equal(await button.isDisabled(), true);
    assert.equal(await input.isDisabled(), true); assert.equal(world.onnState().effects, 11);
    await page.unroute('**/api/v2/authority?scope=control'); await page.reload(); await feed(page, 'connected');
    await controls.getByText(/^Connection: available/).waitFor();
    const screenshots = process.env.BUNNY_ONN_SCREENSHOTS;
    if (screenshots !== undefined) await page.screenshot({path: join(screenshots, 'onn-desktop.png'), fullPage: true});
    await page.setViewportSize({width: 390, height: 844});
    await controls.getByRole('button', {name: 'Right', exact: true}).focus();
    await controls.getByRole('button', {name: 'Right', exact: true}).press('Enter');
    await effectCount(12);
    await controls.getByText('Completed: succeeded. Transmitted; physical effect was not observed.', {exact: true}).waitFor();
    assert.equal(world.onnState().effects, 12, 'phone keyboard navigation sends one action');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'phone layout has no horizontal overflow');
    assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(item => item.id), []);
    if (screenshots !== undefined) await page.screenshot({path: join(screenshots, 'onn-phone.png'), fullPage: true});
    assert.deepEqual(errors, []);
    process.stdout.write(`${JSON.stringify({passed: true, journey: 'onn', evidence: 'authenticated simulated runtime', keys: 8, shortcuts: 2, text: true, keyboard: true, phone: true, axe: 'passed', reloadEffects: 0})}\n`);
  } finally {await context.close();}
} finally {await world.close(); await browser.close();}
