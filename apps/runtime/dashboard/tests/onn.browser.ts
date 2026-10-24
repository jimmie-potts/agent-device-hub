import assert from 'node:assert/strict';
import {join} from 'node:path';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium, expect} from 'playwright/test';
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
    const controls = page.locator('[data-onn-card="soft-keys"]');
    const available = async (): Promise<void> => {await expect(controls).toHaveAttribute('data-state', 'available');};
    const completed = async (): Promise<void> => {
      const feedback = controls.getByRole('button', {name: 'Sent to ONN', exact: true});await feedback.waitFor();
      await expect(controls.getByRole('button', {name: 'Open YouTube', exact: true, includeHidden: true})).toBeEnabled();
      await feedback.click();
      await controls.locator('.onn-status-note').getByText('Completed: succeeded. Transmitted; physical effect was not observed.', {exact: true}).waitFor();
      await feedback.press('Escape');await expect(feedback).toHaveAttribute('aria-expanded', 'false');
    };
    await available();await controls.getByText('No app observed', {exact: true}).waitFor();
    assert.equal(world.onnState().effects, 0); assert.deepEqual(sent, [], 'page inspection sends no controls');
    assert.equal(await world.readonlyOnn(), 403, 'real reader credentials cannot control');
    let count = 0;
    for (const label of ['Up', 'Down', 'Left', 'Right', 'Select', 'Back', 'Home', 'Play / pause', 'Open YouTube', 'Open Stremio']) {
      if (label === 'Open YouTube') await controls.getByRole('tab', {name: 'Apps', exact: true}).click();
      const button = controls.getByRole('button', {name: label, exact: true}); await button.click({trial: true}); await button.focus(); await button.press('Enter');
      await effectCount(++count);
      await completed();
    }
    const input = controls.getByRole('textbox', {name: 'Focused text'}), insert = controls.getByRole('button', {name: 'Insert text', exact: true});
    await input.fill('unsupported 😊'); assert.equal(await insert.isDisabled(), true);
    await controls.getByText('Use letters, numbers, spaces, . _ -', {exact: true}).waitFor();
    const marker = 'SYNTHETIC_ONN_BROWSER_TEXT'; await input.fill(marker); await insert.click({trial: true}); await input.press('Enter');
    await effectCount(11);
    await completed();
    assert.equal(await input.inputValue(), '', 'submitted text is immediately removed from the draft');
    assert.equal(world.onnState().effects, 11);
    assert.equal(await page.evaluate(text => JSON.stringify({local: {...localStorage}, session: {...sessionStorage}}).includes(text), marker), false);
    assert.equal(JSON.stringify(world.logs).includes(marker), false);
    await controls.getByRole('button', {name: 'ONN help', exact: true}).click();
    await controls.getByRole('button', {name: 'Reload status', exact: true}).click();
    await available();
    await page.reload(); await feed(page, 'connected');
    await available(); assert.equal(world.onnState().effects, 11, 'status and browser reload never replay controls');
    await page.evaluate(() => {const now = Date.now(); Date.now = () => now + 60_000;});
    await controls.getByText('App unknown', {exact: true}).waitFor();
    world.onnOnline(false); await expect(controls).toHaveAttribute('data-state', 'unavailable');
    await controls.getByRole('button', {name: 'ONN status', exact: true}).click();
    await controls.getByText('ONN is unavailable. Controls are paused.', {exact: true}).waitFor();
    await controls.getByRole('button', {name: 'ONN status', exact: true}).press('Escape');
    assert.equal(await controls.getByRole('button', {name: 'Right', exact: true}).isDisabled(), true);
    await controls.getByRole('tab', {name: 'Apps', exact: true}).click();
    assert.equal(await insert.isDisabled(), true); assert.equal(world.onnState().effects, 11);
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({colorScheme});await controls.getByRole('button', {name: 'ONN status', exact: true}).hover();
      assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(item => ({id: item.id, nodes: item.nodes.map(node => ({target: node.target, failureSummary: node.failureSummary}))})), []);
    }
    assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(item => ({id: item.id, nodes: item.nodes.map(node => ({target: node.target, failureSummary: node.failureSummary}))})), []);
    world.onnOnline(true); await available();
    // UI authority interception exercises the rendered read-only context; the real credential refusal was checked above.
    await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
    await page.reload(); await feed(page, 'connected');
    await controls.getByText('Read only', {exact: true}).waitFor();
    for (const label of ['Up', 'Down', 'Left', 'Right', 'Select', 'Back', 'Home', 'Play / pause', 'Open YouTube', 'Open Stremio', 'Insert text']) {
      assert.equal(await controls.getByRole('button', {name: label, exact: true, includeHidden: true}).isDisabled(), true);
    }
    await controls.getByRole('tab', {name: 'Apps', exact: true}).click();
    assert.equal(await input.isDisabled(), true); assert.equal(world.onnState().effects, 11);
    await page.unroute('**/api/v2/authority?scope=control'); await page.reload(); await feed(page, 'connected');
    await available();
    await page.route('**/api/sdk/v1/sync', route => route.abort());
    await page.route('**/api/sdk/v1/stream', route => route.abort());world.dropDashboardStreams();
    await expect(controls).toHaveAttribute('data-state', 'stale');
    await expect(controls.getByRole('button', {name: 'Right', exact: true})).toBeDisabled();
    await page.unroute('**/api/sdk/v1/sync');await page.unroute('**/api/sdk/v1/stream');await feed(page, 'connected');await available();
    assert.equal(world.onnState().effects, 11, 'reconnect never replays controls');
    // Home and the existing component address render the same module-owned adapter.
    await page.goto(`${world.url}/#/`);await available();assert.equal(await controls.count(), 1);
    await page.getByRole('button', {name: 'Edit Home', exact: true}).click();
    await page.getByRole('button', {name: 'Hide ONN', exact: true}).click();
    await page.getByRole('button', {name: 'Cancel', exact: true}).click();await available();
    assert.equal(world.onnState().effects, 11, 'layout drafts and card re-entry send no TV action');
    await page.goto(`${world.url}/#/component/onn`);await available();
    const screenshots = process.env.BUNNY_ONN_SCREENSHOTS;
    for (const colorScheme of ['light', 'dark'] as const) for (const width of [1440, 736, 390, 320]) {
      await page.emulateMedia({colorScheme});await page.setViewportSize({width, height: 1000});
      const box = await controls.boundingBox(), art = controls.getByRole('img'), imageBox = await art.boundingBox();
      const handle = await art.elementHandle();assert.ok(handle !== null);
      await controls.getByRole('tab', {name: 'Remote', exact: true}).focus();await page.keyboard.press('End');
      await expect(controls.getByRole('tab', {name: 'Apps', exact: true})).toBeFocused();
      assert.deepEqual(await controls.boundingBox(), box, 'tabs keep card geometry');
      assert.deepEqual(await art.boundingBox(), imageBox, 'tabs keep image position');
      assert.equal(await handle.evaluate(node => node === document.querySelector('[data-onn-card] [role=img]')), true, 'art stays mounted');
      assert.equal(await controls.getByRole('button', {name: 'Right', exact: true}).isVisible(), false);
      await input.fill('Draft');await controls.getByRole('tab', {name: 'Apps', exact: true}).press('Home');
      assert.equal(await input.isVisible(), false);await controls.getByRole('tab', {name: 'Apps', exact: true}).click();
      assert.equal(await input.inputValue(), 'Draft', 'tabs retain memory-only drafts');await input.fill('');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(item => ({id: item.id, nodes: item.nodes.map(node => ({target: node.target, failureSummary: node.failureSummary}))})), []);
      if (screenshots !== undefined && width !== 736 && width !== 320) await controls.screenshot({path: join(screenshots, `onn-apps-${colorScheme}-${width}.png`)});
      await controls.getByRole('tab', {name: 'Remote', exact: true}).click();
      if (screenshots !== undefined && width !== 736 && width !== 320) await controls.screenshot({path: join(screenshots, `onn-remote-${colorScheme}-${width}.png`)});
      await handle.dispose();
    }
    assert.equal(await controls.locator('[role=tabpanel]:not([hidden])').evaluate(node => getComputedStyle(node).animationName), 'none');
    await page.emulateMedia({reducedMotion: 'no-preference'});await controls.getByRole('tab', {name: 'Apps', exact: true}).click();
    assert.equal(await controls.locator('[role=tabpanel]:not([hidden])').evaluate(node => getComputedStyle(node).animationName), 'onn-controls-flip');
    await page.emulateMedia({reducedMotion: 'reduce'});await controls.getByRole('tab', {name: 'Remote', exact: true}).click();
    await controls.getByRole('link', {name: 'History', exact: true}).click();
    assert.equal(new URL(page.url()).hash, '#/module/onn/history');
    await page.getByRole('heading', {name: 'ONN title history', exact: true}).waitFor();
    assert.equal(await controls.count(), 0, 'History owns its separate module page');
    await page.goto(`${world.url}/#/module/onn/controls`);await available();
    await page.getByRole('heading', {name: 'ONN title history', exact: true}).waitFor();
    assert.equal(world.onnState().effects, 11, 'both history addresses remain passive');
    if (screenshots !== undefined) await page.screenshot({path: join(screenshots, 'onn-desktop.png'), fullPage: true});
    await page.setViewportSize({width: 390, height: 844});
    await controls.getByRole('button', {name: 'Right', exact: true}).focus();
    await controls.getByRole('button', {name: 'Right', exact: true}).press('Enter');
    await effectCount(12);
    await completed();
    assert.equal(world.onnState().effects, 12, 'phone keyboard navigation sends one action');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'phone layout has no horizontal overflow');
    assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(item => ({id: item.id, nodes: item.nodes.map(node => ({target: node.target, failureSummary: node.failureSummary}))})), []);
    if (screenshots !== undefined) await page.screenshot({path: join(screenshots, 'onn-phone.png'), fullPage: true});
    // A response lost before admission has no operation evidence. The shared attempt stays locked,
    // including across the component/Home/page boundaries and browser reload; nothing is resent.
    await page.route('**/api/v2/commands/onn-key-press', route => route.abort());
    const beforeUncertain = sent.length;await controls.getByRole('button', {name: 'Up', exact: true}).click();
    await controls.getByRole('button', {name: 'Check request', exact: true}).waitFor();
    await expect(controls.getByRole('button', {name: 'Right', exact: true})).toBeDisabled();
    await page.unroute('**/api/v2/commands/onn-key-press');
    for (const hash of ['#/', '#/component/onn', '#/module/onn/controls']) {
      await page.goto(`${world.url}/${hash}`);await available();
      await expect(controls.getByRole('button', {name: 'Right', exact: true})).toBeDisabled();
    }
    await page.reload();await feed(page, 'connected');await available();
    await expect(controls.getByRole('button', {name: 'Right', exact: true})).toBeDisabled();
    assert.equal(sent.length, beforeUncertain + 1);assert.equal(world.onnState().effects, 12);
    assert.deepEqual(errors, []);
    process.stdout.write(`${JSON.stringify({passed: true, journey: 'onn', evidence: 'authenticated simulated runtime', keys: 8, shortcuts: 2, text: true, keyboard: true, phone: true, axe: 'passed', reloadEffects: 0})}\n`);
  } finally {await context.close();}
} finally {await world.close(); await browser.close();}
