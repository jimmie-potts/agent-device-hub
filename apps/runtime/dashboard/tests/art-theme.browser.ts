import assert from 'node:assert/strict';
import {join} from 'node:path';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium, expect, type Locator, type Page} from 'playwright/test';
import {ART_THEME_KEY} from '../src/skins/art-theme.ts';
import {browserArtifactDirectory} from './browser-artifacts.ts';
import {changes, feed, startWorld} from './harness.ts';

const world = await startWorld({art: true}), browser = await chromium.launch({headless: true});
const artifacts = await browserArtifactDirectory();
const FIXED = ['--text', '--muted-dense', '--focus', '--pending', '--pending-text', '--warning-badge-bg', '--warning-badge-edge', '--agent-attention-surface', '--agent-attention-edge', '--disabled-bg', '--disabled-text', '--disabled-edge', '--chip-working', '--chip-question', '--chip-blocked', '--chip-unread', '--wemo-led-on'];
const colors = (page: Page, roles: readonly string[]): Promise<Record<string, string>> => page.evaluate(roles => {
  const probe = document.createElement('span');probe.style.position = 'absolute';probe.style.visibility = 'hidden';document.body.append(probe);
  const values = Object.fromEntries(roles.map(role => {probe.style.color = `var(${role})`;return [role, getComputedStyle(probe).color];}));probe.remove();return values;
}, roles);
const contrast = (a: string, b: string): number => {
  const luminance = (color: string): number => {
    const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);assert.equal(channels?.length, 3);
    const linear = (channels ?? []).map(value => value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);
    return (linear[0] ?? 0) * 0.2126 + (linear[1] ?? 0) * 0.7152 + (linear[2] ?? 0) * 0.0722;
  };
  return (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
};
const token = async (page: Page, role: string): Promise<string> => (await colors(page, [role]))[role] ?? '';
const layoutBox = (target: Locator): Promise<{x: number; y: number; width: number; height: number}> => target.evaluate(element => {
  const box = element.getBoundingClientRect();return {x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height};
});
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, colorScheme: 'light', reducedMotion: 'reduce'}), page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const sent = changes(page), errors: string[] = [];page.on('pageerror', error => {errors.push(error.message);});
  await page.goto(`${world.url}/#/settings`);await feed(page, 'connected');
  const settings = page.getByRole('region', {name: 'Artwork colors'});
  await expect(settings.getByRole('button', {name: 'Follow artwork', exact: true})).toBeVisible();
  await settings.getByRole('button', {name: 'Lock current colors', exact: true}).click();
  await expect(settings).toContainText('Default colors are locked');
  assert.deepEqual(JSON.parse(await page.evaluate(key => localStorage.getItem(key), ART_THEME_KEY) ?? 'null'), {version: 1, mode: 'locked', palette: null});
  await page.reload();await feed(page, 'connected');await expect(settings).toContainText('Default colors are locked');
  await settings.getByRole('button', {name: 'Restore default', exact: true}).click();
  await page.reload();await feed(page, 'connected');await expect(settings).toContainText('Using default colors');
  await settings.getByRole('button', {name: 'Follow artwork', exact: true}).click();
  await expect(settings).toContainText('Following artwork');
  assert.equal(sent.length, 0, 'theme preferences never send a command');assert.equal(world.art.state().imageCalls, 0);
  const fixed = new Map<string, Record<string, string>>();
  for (const scheme of ['light', 'dark'] as const) {await page.emulateMedia({colorScheme: scheme});fixed.set(scheme, await colors(page, FIXED));}
  await page.emulateMedia({colorScheme: 'light'});
  await page.goto(`${world.url}/#/module/art/gallery`);await feed(page, 'connected');
  const selected = page.getByRole('region', {name: 'Selected artwork'}), create = page.getByRole('button', {name: 'Create art', exact: true});
  await page.getByRole('checkbox', {name: 'Tidbyt', exact: true}).uncheck();await page.getByRole('checkbox', {name: 'Pixoo', exact: true}).uncheck();
  const make = async (action: string, description: string): Promise<void> => {
    world.art.act(action);await page.getByLabel('What would you like to see?', {exact: true}).fill(description);await create.click();
  };
  await make('warm-colors', 'A synthetic warm scene');await expect(selected.locator('[data-art-image-state="ready"]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-art-theme', 'applied');
  const warm = await token(page, '--accent');assert.deepEqual(await colors(page, FIXED), fixed.get('light'), 'theme never changes semantic or device colors');
  world.art.act('hold');await make('cool-colors', 'A synthetic cool scene');await expect.poll(() => world.art.state().pending).toBe(1);
  await expect(page.locator('[data-art-job]').first()).toContainText('running');await expect(create).toBeEnabled();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({colorScheme: scheme});assert.deepEqual(await colors(page, FIXED), fixed.get(scheme));
    assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations, []);
    await page.screenshot({path: join(artifacts, `theme-pending-${scheme}.png`), fullPage: true});
  }
  await page.emulateMedia({colorScheme: 'light'});
  const prompt = page.getByLabel('What would you like to see?', {exact: true});await prompt.focus();
  const beforeCold = await prompt.boundingBox();assert.ok(beforeCold !== null);
  assert.equal(await token(page, '--accent'), warm, 'pending generation is not a new presented palette');
  world.art.act('release');
  await expect.poll(() => token(page, '--accent')).not.toBe(warm);
  const cool = await token(page, '--accent');assert.deepEqual(await prompt.boundingBox(), beforeCold, 'a new palette does not move controls');
  await expect(prompt).toBeFocused();
  const themeCalls = world.art.state().imageCalls, themeCommands = sent.length;
  await page.goto(`${world.url}/#/settings`);await feed(page, 'connected');
  assert.equal(await token(page, '--accent'), cool, 'leaving visible art keeps the last valid decoration');
  await settings.getByRole('button', {name: 'Lock current colors', exact: true}).click();
  const locked = await page.evaluate(key => localStorage.getItem(key), ART_THEME_KEY);assert.ok(locked !== null);
  await page.goto(`${world.url}/#/module/art/gallery`);await feed(page, 'connected');
  await page.getByRole('checkbox', {name: 'Tidbyt', exact: true}).uncheck();await page.getByRole('checkbox', {name: 'Pixoo', exact: true}).uncheck();
  const oldArt = await selected.locator('.art-image').getAttribute('data-artwork');
  await make('warm-colors', 'Another synthetic warm scene');
  await expect(selected.locator('.art-image')).not.toHaveAttribute('data-artwork', oldArt ?? '');await expect(selected.locator('[data-art-image-state="ready"]')).toBeVisible();
  assert.equal(await token(page, '--accent'), cool, 'locked colors survive new visible artwork');
  await world.restart();await page.reload();await feed(page, 'connected');
  await expect(selected.locator('[data-art-image-state="ready"]')).toBeVisible();assert.equal(await token(page, '--accent'), cool, 'runtime restart does not undo the browser lock');
  const restarted = await browser.newContext({storageState: await context.storageState(), colorScheme: 'light'}), again = await restarted.newPage();
  await again.goto(`${world.url}/#/settings`);await feed(again, 'connected');assert.equal(await token(again, '--accent'), cool, 'a fresh browser context restores the explicit lock');await restarted.close();
  await page.goto(`${world.url}/#/settings`);await feed(page, 'connected');
  const beforeLocal = sent.length;
  await settings.getByRole('button', {name: 'Restore default', exact: true}).click();await expect(page.locator('html')).not.toHaveAttribute('data-art-theme', 'applied');
  await page.reload();await feed(page, 'connected');await expect(settings).toContainText('Using default colors');
  assert.equal(world.art.state().imageCalls, themeCalls + 1);assert.equal(sent.length, beforeLocal, 'restore and reload send no commands');assert.equal(themeCommands + 1, beforeLocal, 'only the explicit synthetic art request was sent');
  await settings.getByRole('button', {name: 'Follow artwork', exact: true}).click();
  await page.goto(`${world.url}/#/module/art/gallery`);await feed(page, 'connected');await expect(page.locator('html')).toHaveAttribute('data-art-theme', 'applied');
  for (const scheme of ['light', 'dark'] as const) for (const width of [1440, 390, 320]) {
    await page.emulateMedia({colorScheme: scheme});await page.setViewportSize({width, height: 1000});
    assert.deepEqual(await colors(page, FIXED), fixed.get(scheme));
    const actual = await colors(page, ['--text', '--muted-dense', '--panel', '--bg', '--accent', '--accent-ink', '--focus']);
    for (const text of ['--text', '--muted-dense']) for (const background of ['--panel', '--bg']) assert.ok(contrast(actual[text] ?? '', actual[background] ?? '') >= 4.5);
    assert.ok(contrast(actual['--accent'] ?? '', actual['--accent-ink'] ?? '') >= 4.5);assert.ok(contrast(actual['--focus'] ?? '', actual['--panel'] ?? '') >= 3);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations, []);
    await page.screenshot({path: join(artifacts, `theme-${scheme}-${width}.png`), fullPage: true});
  }
  for (const scheme of ['light', 'dark'] as const) for (const width of [1440, 390, 320]) {
    await page.emulateMedia({colorScheme: scheme});await page.setViewportSize({width, height: 1000});
    await page.goto(`${world.url}/#/module/art/gallery`);await feed(page, 'connected');await expect(page.locator('html')).toHaveAttribute('data-art-theme', 'applied');
    await page.getByRole('navigation', {name: 'Utilities'}).getByRole('link', {name: 'Settings', exact: true}).click();
    const lock = settings.getByRole('button', {name: 'Lock current colors', exact: true}), before = await layoutBox(lock);
    await lock.click();assert.deepEqual(await layoutBox(lock), before, 'locking does not move theme controls');
    await settings.getByRole('button', {name: 'Restore default', exact: true}).click();assert.deepEqual(await layoutBox(lock), before, 'default restore does not move theme controls');
    await settings.getByRole('button', {name: 'Follow artwork', exact: true}).click();assert.deepEqual(await layoutBox(lock), before, 'following does not move theme controls');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations, []);
    await page.screenshot({path: join(artifacts, `theme-settings-${scheme}-${width}.png`), fullPage: true});
  }
  await page.emulateMedia({colorScheme: 'light'});await page.setViewportSize({width: 1440, height: 1000});
  await page.goto(`${world.url}/#/module/art/gallery`);await feed(page, 'connected');await expect(page.locator('html')).toHaveAttribute('data-art-theme', 'applied');
  assert.deepEqual(JSON.parse(await page.evaluate(key => localStorage.getItem(key), ART_THEME_KEY) ?? 'null'), {version: 1, mode: 'follow'}, 'art arrival never persists a palette or preference');
  const beforeFaultCommands = sent.length, beforeFaultCalls = world.art.state().imageCalls;
  const prior = await token(page, '--accent'), tiles = page.locator('[data-gallery-art]');
  await page.route('**/modules/art/content/rendition.*', route => route.fulfill({status: 200, contentType: 'image/webp', body: 'invalid synthetic image'}));
  await tiles.nth(1).getByRole('button', {name: /Open artwork from/}).click();
  await expect(selected.locator('.art-image')).toHaveAttribute('data-art-image-state', 'unavailable');
  assert.equal(await token(page, '--accent'), prior, 'unavailable artwork cannot replace the valid theme');
  assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations, []);
  await page.screenshot({path: join(artifacts, 'theme-unavailable.png'), fullPage: true});
  await page.unrouteAll({behavior: 'wait'});await tiles.first().getByRole('button', {name: /Open artwork from/}).click();
  await expect(selected.locator('.art-image')).toHaveAttribute('data-art-image-state', 'ready');
  await context.setOffline(true);world.dropDashboardStreams();await expect(create).toBeDisabled();
  assert.equal(await token(page, '--accent'), prior, 'disconnect preserves the last valid colors');assert.deepEqual(await colors(page, FIXED), fixed.get('light'));
  await page.screenshot({path: join(artifacts, 'theme-disconnected-disabled.png'), fullPage: true});
  await context.setOffline(false);await page.goto(`${world.url}/#/settings`);await feed(page, 'connected');
  const requests: string[] = [];page.on('request', request => {requests.push(request.url());});
  await page.evaluate(key => {localStorage.setItem(key, JSON.stringify({version: 1, mode: 'locked', palette: ['url(file:///SYNTHETIC_PRIVATE_THEME_PATH)'], texture: 'url(https://example.invalid/theme.css)'}));}, ART_THEME_KEY);
  await page.reload();await feed(page, 'connected');await expect(settings.getByRole('alert')).toContainText('invalid');
  await expect(page.locator('html')).not.toHaveAttribute('data-art-theme', 'applied');
  assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations, []);
  await page.screenshot({path: join(artifacts, 'theme-invalid-preference.png'), fullPage: true});
  await page.evaluate(({key, value}) => {localStorage.setItem(key, value);}, {key: ART_THEME_KEY, value: locked});
  await page.reload();await feed(page, 'connected');assert.equal(await token(page, '--accent'), cool);
  const other = await context.newPage();await other.goto(`${world.url}/#/settings`);await feed(other, 'connected');
  await other.evaluate(key => {localStorage.setItem(key, '{"version":1,"mode":"locked","palette":[]}');}, ART_THEME_KEY);
  await expect(settings.getByRole('alert')).toContainText('Keeping the current colors');assert.equal(await token(page, '--accent'), cool);
  assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations, []);
  await other.getByRole('button', {name: 'Restore default', exact: true}).click();await expect(settings).toContainText('Using default colors');
  await settings.getByRole('button', {name: 'Follow artwork', exact: true}).click();await expect(other.getByRole('region', {name: 'Artwork colors'})).toContainText('Following artwork');await other.close();
  await page.evaluate(key => {
    const set = Storage.prototype.setItem.bind(localStorage);
    Storage.prototype.setItem = function(name: string, value: string): void {if (name === key) throw new DOMException('Synthetic storage refusal', 'QuotaExceededError');set(name, value);};
  }, ART_THEME_KEY);
  await settings.getByRole('button', {name: 'Lock current colors', exact: true}).click();await expect(settings.getByRole('alert')).toContainText('not saved');
  assert.deepEqual(JSON.parse(await page.evaluate(key => localStorage.getItem(key), ART_THEME_KEY) ?? 'null'), {version: 1, mode: 'follow'}, 'failed storage never claims a persisted lock');
  await page.reload();await feed(page, 'connected');await expect(settings).toContainText('Following artwork');
  await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
  await page.reload();await feed(page, 'connected');await settings.getByRole('button', {name: 'Restore default', exact: true}).click();
  await expect(settings).toContainText('Using default colors');
  assert.equal(sent.length, beforeFaultCommands, 'local theme controls and failures send no catalog, layout or device command');assert.equal(world.art.state().imageCalls, beforeFaultCalls);
  assert.ok(requests.every(url => new URL(url).origin === new URL(world.url).origin && !url.includes('SYNTHETIC_PRIVATE_THEME_PATH')), 'no styling input triggers an asset or external request');
  assert.deepEqual(errors, []);console.log(`Art theme browser passed; private synthetic screenshots: ${artifacts}`);
} finally {world.art.act('release');await browser.close();await world.close();}
