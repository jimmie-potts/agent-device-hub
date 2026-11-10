import assert from 'node:assert/strict';
import {join} from 'node:path';
import {chromium, expect, type Page} from 'playwright/test';
import {browserArtifactDirectory} from './browser-artifacts.ts';
import {feed, startWorld} from './harness.ts';

/** Real core policy, gateway and synced browser state; providers and storage are disposable. */
export async function artScheduleJourney(): Promise<void> {
  const world = await startWorld({art: true}), browser = await chromium.launch({headless: true});
  const artifacts = await browserArtifactDirectory(), context = await browser.newContext({viewport: {width: 1440, height: 1100}});
  const page = await context.newPage(), other = await context.newPage();
  const writes: string[] = [], errors: string[] = [];
  const panel = (view: Page) => view.getByRole('region', {name: 'Daily art', exact: true});
  const open = async (view: Page): Promise<void> => {
    await view.goto(`${world.url}/#/automation`);await feed(view, 'connected');
    await view.getByRole('tab', {name: 'Art', exact: true}).click();
    await expect(panel(view).getByLabel('Waking day starts', {exact: true})).toBeEnabled();
  };
  for (const view of [page, other]) {
    view.setDefaultTimeout(12_000);view.on('pageerror', error => {errors.push(error.message);});
    view.on('request', request => {if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/v2/automation/art') {
      assert.equal(request.headers()['bunny-request'], '1');writes.push(request.postData() ?? '');
    }});
  }
  const save = async (view: Page): Promise<void> => {
    const reply = view.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith('/api/v2/automation/art'));
    await panel(view).getByRole('button', {name: 'Save art settings', exact: true}).click();assert.equal((await reply).status(), 200);
    await expect(panel(view)).toContainText('Daily art settings saved.');
  };
  try {
    await open(page);await open(other);assert.equal(writes.length, 0);
    const before = world.art.state();
    // Disabled configuration edits persist without generating or presenting art.
    await expect(panel(page).getByLabel('Enable daily art', {exact: true})).not.toBeChecked();
    await panel(page).getByLabel('Waking day starts', {exact: true}).fill('08:30');
    await panel(page).getByLabel('Waking day ends', {exact: true}).fill('22:15');
    await panel(page).getByLabel('Appearances per day', {exact: true}).selectOption('8');
    await panel(page).getByLabel('Allow new art generation', {exact: true}).uncheck();
    await page.getByRole('tab', {name: 'Settings', exact: true}).click();
    await page.getByRole('tab', {name: 'Art', exact: true}).click();
    await expect(panel(page).getByLabel('Waking day starts', {exact: true})).toHaveValue('08:30');
    assert.equal(writes.length, 0, 'typing and switching tabs preserve a local draft without writes');
    await save(page);assert.equal(writes.length, 1);
    await expect(panel(other).getByLabel('Appearances per day', {exact: true})).toHaveValue('8');
    await page.reload();await feed(page, 'connected');await page.getByRole('tab', {name: 'Art', exact: true}).click();
    await expect(panel(page).getByLabel('Waking day ends', {exact: true})).toHaveValue('22:15');
    // Two dirty tabs use the stored settings revision, never silently replace each other's policy.
    await panel(page).getByLabel('Appearances per day', {exact: true}).selectOption('6');
    await panel(other).getByLabel('Appearances per day', {exact: true}).selectOption('7');
    await save(page);
    const conflict = other.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith('/api/v2/automation/art'));
    await panel(other).getByRole('button', {name: 'Save art settings', exact: true}).click();assert.equal((await conflict).status(), 409);
    await expect(panel(other)).toContainText('Your draft is retained.');
    await expect(panel(other).getByLabel('Appearances per day', {exact: true})).toHaveValue('7');
    await expect(panel(other).getByRole('button', {name: 'Save art settings', exact: true})).toBeDisabled();
    await panel(other).getByRole('button', {name: 'Refresh art settings', exact: true}).click();
    await expect(panel(other).getByLabel('Appearances per day', {exact: true})).toHaveValue('6');
    // Commit once at the real gateway, then lose the HTTP reply. Explicit refresh only reads state.
    await page.route('**/api/v2/automation/art', async route => {
      if (route.request().method() !== 'PUT') {await route.continue();return;}
      const response = await route.fetch();assert.equal(response.status(), 200);await route.abort('connectionreset');
    });
    await panel(page).getByLabel('Appearances per day', {exact: true}).selectOption('8');
    await panel(page).getByRole('button', {name: 'Save art settings', exact: true}).click();
    await expect(panel(page)).toContainText('The change has no reliable reply.');
    const afterLoss = writes.length;
    await expect(panel(page).getByRole('button', {name: 'Save art settings', exact: true})).toBeDisabled();
    await page.unrouteAll({behavior: 'wait'});
    await panel(page).getByRole('button', {name: 'Refresh art settings', exact: true}).click();
    await expect(panel(page)).toContainText('Current art settings refreshed. Nothing was sent again.');
    await expect(panel(page).getByLabel('Appearances per day', {exact: true})).toHaveValue('8');assert.equal(writes.length, afterLoss);
    // The fourth tab participates in keyboard navigation and keeps focus on its control.
    const artTab = page.getByRole('tab', {name: 'Art', exact: true});await artTab.focus();
    await page.keyboard.press('Home');await expect(page.getByRole('tab', {name: 'Routines', exact: true})).toBeFocused();
    await page.keyboard.press('End');await expect(artTab).toBeFocused();await expect(artTab).toHaveAttribute('aria-selected', 'true');
    for (const theme of ['light', 'dark'] as const) for (const width of [320, 390, 1440]) {
      await page.emulateMedia({colorScheme: theme, reducedMotion: width === 390 ? 'no-preference' : 'reduce'});
      await page.setViewportSize({width, height: 1100});
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme}/${String(width)} overflow`);
      await page.screenshot({path: join(artifacts, `art-schedule-${theme}-${String(width)}.png`), fullPage: true});
    }
    // Authority interception tests the browser's read-only rendering; gateway authorization has separate tests.
    await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
    await page.reload();await feed(page, 'connected');await page.getByRole('tab', {name: 'Art', exact: true}).click();
    await expect(panel(page).getByLabel('Enable daily art', {exact: true})).toBeDisabled();
    await expect(panel(page).getByRole('button', {name: 'Save art settings', exact: true})).toBeDisabled();
    assert.equal(writes.length, afterLoss);assert.deepEqual(world.art.state(), before);assert.deepEqual(errors, []);
    console.log(`Daily art settings browser passed; synthetic screenshots: ${artifacts}`);
  } catch (error) {await page.screenshot({path: join(artifacts, 'art-schedule-failed.png'), fullPage: true});throw error;}
  finally {await browser.close();await world.close();}
}
