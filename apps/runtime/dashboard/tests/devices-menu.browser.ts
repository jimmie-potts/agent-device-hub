// The Devices menu and the pinned pages (Hub #1889) on the real shell over synthetic owners, with the hardware-only
// inventory, its expandable brands, Companions and the displays' views (Hub #1950). They only navigate or change this
// browser's own list; nothing here sends a command, sync, upload or provider request.
import assert from 'node:assert/strict';
import {chromium, type Locator, type Page, type Request} from 'playwright';
import {expect} from 'playwright/test';
import {changes, copiesSynced, feed, startWorld} from './harness.ts';
import {chooseConversation, conversationLink, destinationLink, jumpTo, openDeviceMenu, openDirectory} from './navigation-helpers.ts';
import {PINS_KEY} from '../src/pins.ts';

const world = await startWorld({devices: true, pixooPages: true, tidbyt: true, companions: true, speech: true, nanoleaf: true, nanoleafPanels: true});
const browser = await chromium.launch({headless: true});
const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const sent = changes(page);
const errors: string[] = [];
context.on('weberror', error => {errors.push(error.error().message);});
/** Records the POSTs that would be a command, sync, upload or provider request. */
const recordWrites = (target: Page): {stop: () => string[]} => {
  const seen: string[] = [];
  const listen = (request: Request): void => {
    if (request.method() !== 'POST') return;
    const path = new URL(request.url()).pathname;
    if (/^\/api\/sdk\/v1\/(request|respond|sync|upload|publish)$/.test(path) || path.startsWith('/api/v2/commands/')) seen.push(path);
  };
  target.on('request', listen);
  return {stop: () => {target.off('request', listen); return seen;}};
};
const primary = page.getByRole('navigation', {name: 'Main navigation', exact: true});
const devices = primary.getByRole('button', {name: 'Devices', exact: true});
const menu = page.getByRole('menu', {name: 'Device pages', exact: true}), items = menu.getByRole('menuitem');
const pinned = page.getByRole('navigation', {name: 'Pinned pages', exact: true}), rows = pinned.locator('.rail-pin');
// With nothing to list the Pinned heading stands alone: no line of explanation sits under it.
const pinnedParts = (): Promise<(string | null)[]> => page.locator('.rail-pins').evaluate(pins => [...pins.children].map(child => child.textContent));
const toggle = page.getByRole('button', {name: /^(Pin to rail|Pinned)$/});
const hash = (): string => new URL(page.url()).hash;
const saved = (): Promise<unknown> => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null') as unknown, PINS_KEY);
const focused = (): Promise<string> => page.evaluate(() => {
  const active = document.activeElement;
  return active === null ? '' : active.id === 'main' ? 'main' : active.getAttribute('aria-label') ?? active.textContent ?? '';
});
const rowNames = (): Promise<string[]> => rows.locator('a').evaluateAll(links => links.map(link => link.getAttribute('aria-label') ?? ''));
/**
 * Waits for the rail to show these rows. A module page's row is named after the module alone while the module offers
 * that one page, and with the module once its devices' records add their own pages, which arrive after the catalog.
 */
const railShows = (names: string[], message: string): Promise<void> => expect.poll(rowNames, {message, timeout: 15_000}).toEqual(names);
/** The menu slides in; its box is measured once that has finished. The wait has the page's timeout, as every wait here does. */
const settled = async (): Promise<void> => {await page.waitForFunction(() => document.querySelector('.device-menu')?.getAnimations().every(animation => animation.playState === 'finished') === true);};
/** Chooses an item in the menu, expanding its brand first when it is a light or a brand's overview. */
const choose = async (name: string, brand?: string): Promise<void> => {
  const open = await openDeviceMenu(page);
  const group = brand === undefined ? undefined : open.getByRole('menuitem', {name: brand, exact: true});
  if (group !== undefined && await group.getAttribute('aria-expanded') !== 'true') await group.click();
  await open.getByRole('menuitem', {name, exact: true}).click(); await menu.waitFor({state: 'detached'});
};
const brandToggle = (name: string): Locator => menu.getByRole('menuitem', {name, exact: true});
const tabs = page.locator('nav.feature-navigation'), viewPages = page.locator('nav.feature-pages');
const companionsRow = (): Locator => page.getByRole('navigation', {name: 'Main navigation', exact: true}).getByRole('link', {name: 'Companions', exact: true});
const checks: string[] = [];
try {
  await page.goto(`${world.url}/#/devices`); await feed(page, 'connected');
  await page.getByRole('heading', {name: 'Devices', level: 1, exact: true}).waitFor();
  await page.getByRole('link', {name: 'LIFX overview', exact: true}).waitFor();
  assert.deepEqual(await pinnedParts(), ['Pinned'], 'with no pins the rail shows the Pinned heading and nothing under it');
  assert.equal(await pinned.count(), 0);
  assert.deepEqual([await devices.getAttribute('aria-haspopup'), await devices.getAttribute('aria-expanded'), await devices.getAttribute('aria-current')], ['menu', 'false', 'page'],
    'the Devices row is a menu button, marked current on the directory');
  assert.equal(await devices.getAttribute('data-ancestor'), null);

  // The menu: every page the directory lists, beside the rail. The directory mounts no module page, so any write
  // from here to the end of this part would be the menu's own, once the page's own load syncs are behind it.
  await copiesSynced(page);
  const menuWrites = recordWrites(page);
  await devices.click();
  await menu.waitFor();
  assert.equal(await devices.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator(`#${await devices.getAttribute('aria-controls') ?? 'missing'}`).evaluate(element => element.querySelector('[role=menu]') !== null), true, 'the row names the menu it controls');
  assert.deepEqual(await menu.locator('.device-menu-category').allTextContents(), ['Displays', 'Lighting', 'Appliances']);
  const names = await items.allTextContents();
  const first = names[0] ?? '';
  // The configured hardware only (#1950): one entry each for the displays, a disclosure for each lighting brand, and
  // no companion, music or task page. Both brands start collapsed.
  assert.deepEqual([...names].sort(), ['All devices', 'LIFX', 'Nanoleaf', 'Pixoo', 'Tidbyt', 'sign'], 'the menu lists hardware destinations only');
  assert.deepEqual([names.at(-1), await brandToggle('LIFX').getAttribute('aria-expanded'), await brandToggle('Nanoleaf').getAttribute('aria-expanded')], ['All devices', 'false', 'false']);
  assert.equal(await page.locator('.device-menu-head').getByRole('button', {name: 'Close device pages', exact: true}).isVisible(), true, 'the menu has its head and close button beside the rail too');
  assert.equal(await focused(), 'All devices', 'the menu opens with focus on the current page\'s item');
  await settled();
  assert.deepEqual(await page.locator('.device-menu').evaluate(element => {
    const box = element.getBoundingClientRect(), rail = document.querySelector('.shell>aside')?.getBoundingClientRect();
    const columns = getComputedStyle(element.querySelector('.device-menu-columns') ?? element).gridTemplateColumns.split(' ').length;
    return {beside: rail !== undefined && box.left >= rail.right, inWindow: box.top >= 0 && box.bottom <= innerHeight && box.right <= innerWidth, columns};
  }), {beside: true, inWindow: true, columns: 2}, 'the menu opens beside the rail in two columns, inside the window');
  await page.keyboard.press('Home');
  assert.equal(await focused(), first);
  await page.keyboard.press('ArrowDown');
  assert.equal(await focused(), names[1], 'the arrow keys move through the menu');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  assert.equal(await focused(), 'All devices', 'up from the first item wraps to the last');
  await page.keyboard.press('ArrowDown');
  assert.equal(await focused(), first, 'down from the last item wraps to the first');
  await page.keyboard.press('End');
  assert.equal(await focused(), 'All devices');
  assert.equal(await menu.getByRole('menuitem', {name: 'All devices', exact: true}).evaluate(element => {
    const style = getComputedStyle(element);
    return element.matches(':focus-visible') && style.outlineStyle === 'solid' && Number.parseFloat(style.outlineWidth) >= 2 && Number.parseFloat(style.outlineOffset) < 0;
  }), true, 'a focused item has a visible ring inside the row');
  // A press on a part of the menu that is not an item leaves focus on the entry that had it.
  await menu.locator('.device-menu-category').first().click();
  await menu.waitFor();
  assert.equal(await focused(), 'All devices', 'a press on a heading does not take focus from the entry');
  // With focus on nothing while the menu is open, the arrow keys start from the ends.
  await page.evaluate(() => {if (document.activeElement instanceof HTMLElement) document.activeElement.blur();});
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
  await page.keyboard.press('ArrowDown');
  assert.equal(await focused(), first, 'down with focus on nothing starts at the first entry');
  await page.evaluate(() => {if (document.activeElement instanceof HTMLElement) document.activeElement.blur();});
  await page.keyboard.press('ArrowUp');
  assert.equal(await focused(), 'All devices', 'up with focus on nothing starts at the last entry');
  await page.keyboard.press('Escape');
  await menu.waitFor({state: 'detached'});
  assert.deepEqual([await focused(), await devices.getAttribute('aria-expanded'), await devices.getAttribute('aria-controls')], ['Devices', 'false', null], 'Escape closes the menu with focus on the row');
  // The row opens the menu with the down arrow and closes it when pressed again.
  await page.keyboard.press('ArrowDown');
  await menu.waitFor();
  await devices.click();
  await menu.waitFor({state: 'detached'});
  assert.equal(await focused(), 'Devices', 'the row pressed again closes the menu with focus on the row');
  // A press outside the menu closes it. The brand takes no focus, so here it is the press that closes it.
  await devices.click(); await menu.waitFor();
  await page.locator('.rail-head .brand').click();
  await menu.waitFor({state: 'detached'});
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true, 'the press moved focus to nothing, so the press itself closed the menu');
  // Focus moving out of the menu closes it too. The menu is drawn right after the rail (#1950 review), so Tab leaves
  // it for the page's first stop, and Shift+Tab, past its close button, for the rail's last stop.
  await devices.click(); await menu.waitFor();
  await page.keyboard.press('Tab');
  await menu.waitFor({state: 'detached'});
  assert.deepEqual(await page.evaluate(() => {
    const active = document.activeElement, first = [...document.querySelectorAll<HTMLElement>('#main :is(a[href],button,input,select,textarea,summary,[tabindex])')]
      .find(element => element.tabIndex >= 0 && element.checkVisibility() && element.closest('[inert]') === null && !(element as HTMLButtonElement).disabled);
    return {first: active !== null && active === first, inInventory: active?.closest('.inventory') !== null, name: active?.getAttribute('aria-label') ?? active?.textContent ?? ''};
  }), {first: true, inInventory: true, name: 'Tidbyt'}, 'Tab leaves the menu for the page\'s first stop, the first directory card, and the menu closes behind it');
  await devices.click(); await menu.waitFor();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await focused(), 'Close device pages', 'Shift+Tab from an item reaches the menu\'s close button');
  await page.keyboard.press('Shift+Tab');
  await menu.waitFor({state: 'detached'});
  assert.deepEqual(await page.evaluate(() => {
    const active = document.activeElement, stops = [...document.querySelectorAll<HTMLElement>('#rail :is(a[href],button,input,select,textarea,summary,[tabindex])')]
      .filter(element => element.tabIndex >= 0 && element.checkVisibility() && !(element as HTMLButtonElement).disabled);
    return {last: active !== null && active === stops.at(-1), inFoot: active?.closest('.sidebar-foot') !== null};
  }), {last: true, inFoot: true}, 'Shift+Tab past the close button reaches the rail\'s last stop, and the menu closes');
  // The palette's keys close the menu, and a slash typed in the menu is not the palette's.
  await devices.click(); await menu.waitFor();
  await page.keyboard.press('/');
  assert.equal(await page.getByRole('dialog', {name: 'Jump to a page', exact: true}).count(), 0, 'a slash in the open menu does not open the palette');
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog', {name: 'Jump to a page', exact: true}).waitFor();
  assert.equal(await menu.count(), 0, 'the palette opens over a closed menu');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', {name: 'Jump to a page', exact: true}).waitFor({state: 'detached'});
  await page.waitForFunction(() => document.activeElement?.textContent === 'Devices' && document.activeElement.closest('.primary-navigation') !== null);
  // A menu left open does not come back in the phone drawer after the window narrows.
  await devices.click(); await menu.waitFor();
  await page.setViewportSize({width: 390, height: 700});
  await menu.waitFor({state: 'detached'});
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Open navigation');
  await page.getByRole('button', {name: 'Open navigation', exact: true}).click();
  await page.locator('.shell>aside').waitFor();
  assert.equal(await menu.count(), 0, 'narrowing the window closes the menu for good');
  await page.keyboard.press('Escape');
  await page.locator('.shell>aside').waitFor({state: 'hidden'});
  await page.setViewportSize({width: 1440, height: 1000});
  // The same with focus on nothing while the menu is open: there is no focus to hand on, and the menu still does not come back.
  await devices.click(); await menu.waitFor();
  await page.evaluate(() => {if (document.activeElement instanceof HTMLElement) document.activeElement.blur();});
  await page.setViewportSize({width: 390, height: 700});
  await menu.waitFor({state: 'detached'});
  await page.getByRole('button', {name: 'Open navigation', exact: true}).click();
  await page.locator('.shell>aside').waitFor();
  assert.equal(await menu.count(), 0, 'narrowing the window closes the menu when focus is not in it');
  await page.keyboard.press('Escape');
  await page.locator('.shell>aside').waitFor({state: 'hidden'});
  await page.setViewportSize({width: 1440, height: 1000});
  // In a window too short for the menu, it stays inside the window and scrolls.
  // A menu that does not fit under the Devices row moves up until it does (#1950): at 900 by 560 beside the icon rail
  // the whole menu fits, so its lists do not scroll.
  await page.setViewportSize({width: 900, height: 560});
  await devices.click(); await menu.waitFor();
  await settled();
  assert.deepEqual(await page.locator('.device-menu').evaluate(element => {
    const box = element.getBoundingClientRect(), lists = element.querySelector('.device-menu-scroll'), row = document.querySelector('.rail-devices')?.getBoundingClientRect();
    return {inWindow: box.top >= 8 && box.bottom <= innerHeight - 7, scrolls: lists !== null && lists.scrollHeight > lists.clientHeight + 1, movedUp: row !== undefined && box.top < row.top};
  }), {inWindow: true, scrolls: false, movedUp: true}, 'the menu moves up to fit the window instead of scrolling its lists');
  await page.keyboard.press('Escape'); await menu.waitFor({state: 'detached'});
  // In a window too short for the whole menu with both brands open, it starts 8px from the top and its lists scroll.
  // The directory draws on the glass layer, whose frosted rail scrolls with the page in this window.
  await page.setViewportSize({width: 1024, height: 420});
  await openDirectory(page); await feed(page, 'connected');
  await expect(page.locator('#main')).toHaveAttribute('data-glass', /^(webgl|quiet)$/);
  await devices.click(); await menu.waitFor();
  for (const brand of ['LIFX', 'Nanoleaf']) if (await brandToggle(brand).getAttribute('aria-expanded') !== 'true') await brandToggle(brand).click();
  await settled();
  assert.deepEqual(await page.locator('.device-menu').evaluate(element => {
    const box = element.getBoundingClientRect(), rail = document.querySelector('.shell>aside')?.getBoundingClientRect();
    const lists = element.querySelector('.device-menu-scroll');
    return {beside: rail !== undefined && Math.round(rail.width) === 64 && box.left >= rail.right, inWindow: box.top >= 0 && box.bottom <= innerHeight && box.right <= innerWidth,
      scrolls: lists !== null && lists.scrollHeight > lists.clientHeight};
  }), {beside: true, inWindow: true, scrolls: true}, 'beside the icon rail in a short window the menu stays in the window and its lists scroll');
  assert.equal(await page.locator('.device-menu').evaluate(element => Math.round(element.getBoundingClientRect().top)), 8, 'it starts 8px from the window\'s top');
  // Scrolling the page under it leaves it where it is, whole and under the pointer (#1950 review): it is fixed to the
  // window, not held by the frosted rail that scrolls away with the page.
  await page.mouse.move(900, 300); await page.mouse.wheel(0, 300);
  await page.waitForFunction(() => scrollY > 0);
  assert.deepEqual(await page.locator('.device-menu').evaluate(element => {
    const box = element.getBoundingClientRect(), hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {top: Math.round(box.top), whole: box.bottom <= innerHeight, hit: hit !== null && element.contains(hit), scrolled: scrollY > 0};
  }), {top: 8, whole: true, hit: true, scrolled: true}, 'a scrolled page leaves the menu whole and in reach');
  await page.evaluate(() => {scrollTo(0, 0);});
  await page.keyboard.press('End');
  assert.equal(await menu.getByRole('menuitem', {name: 'All devices', exact: true}).evaluate(element => element.getBoundingClientRect().bottom <= innerHeight), true, 'the keys bring the last item into view');
  await devices.hover();
  assert.deepEqual(await devices.locator('.rail-text').evaluate(element => [getComputedStyle(element).opacity, getComputedStyle(element).visibility]), ['0', 'visible'],
    'the icon rail\'s name for Devices stays out of sight under the open menu, and stays the row\'s name');
  await page.mouse.move(900, 300);
  await page.keyboard.press('Escape');
  await page.setViewportSize({width: 1440, height: 1000});
  assert.deepEqual(menuWrites.stop(), [], 'opening, moving through and closing the menu send no command, sync, upload or provider request');
  // "All devices" is the directory's link, and choosing a page closes the menu.
  await (await destinationLink(page, 'Rooms')).click();
  await page.getByRole('region', {name: 'Rooms', exact: true}).waitFor();
  assert.equal(await devices.getAttribute('aria-current'), null);
  await devices.click(); await menu.waitFor();
  assert.equal(await focused(), first, 'with no current page in it, the menu opens on its first item');
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.getByRole('heading', {name: 'Devices', level: 1, exact: true}).waitFor();
  await menu.waitFor({state: 'detached'});
  assert.deepEqual([hash(), await devices.getAttribute('aria-current'), await focused()], ['#/devices', 'page', 'main'], '"All devices" opens the directory with the Devices row marked current and focus on the page');
  // A page change the menu did not make closes it as well.
  await devices.click(); await menu.waitFor();
  await page.goBack();
  await page.getByRole('region', {name: 'Rooms', exact: true}).waitFor();
  await menu.waitFor({state: 'detached'});
  await page.waitForFunction(() => document.activeElement?.textContent === 'Devices' && document.activeElement.closest('.primary-navigation') !== null);
  assert.equal(hash(), '#/rooms', 'the browser\'s back button changes the page and closes the menu, with focus handed to the Devices row');
  // In a window too short for the rail, the rail scrolls with the page. A press outside the menu there closes it
  // without moving the page: the focus the menu hands on must not scroll its row into view.
  await (await destinationLink(page, 'Home')).click();
  await page.getByRole('button', {name: 'Edit Home', exact: true}).waitFor();
  await page.setViewportSize({width: 1280, height: 480});
  await page.waitForFunction(() => {const rail = document.querySelector('.shell>aside'); return rail !== null && getComputedStyle(rail).position === 'static';});
  await devices.focus(); await page.keyboard.press('Enter'); await menu.waitFor();
  await page.evaluate(() => {window.scrollTo(0, 500);});
  assert.equal(await page.evaluate(() => scrollY), 500, 'Home scrolls under the open menu in this window');
  await page.mouse.click(1272, 240);
  await menu.waitFor({state: 'detached'});
  assert.equal(await page.evaluate(() => scrollY), 500, 'a press outside the menu leaves the page where it was scrolled');
  await page.evaluate(() => {window.scrollTo(0, 0);});
  await page.setViewportSize({width: 1440, height: 1000});
  checks.push('the Devices row opens a menu of the configured hardware; the arrow keys, Home, End, Escape, an outside press and Tab work; "All devices" opens the directory');

  // The lighting brands (#1950): each is a disclosure over its lights and its overview. Expanding shows what the page
  // already holds, so it sends nothing; the keys skip a collapsed brand's lights. The directory mounts no module page.
  await openDirectory(page);
  await copiesSynced(page);
  const brandWrites = recordWrites(page);
  await devices.click(); await menu.waitFor();
  const shown = (): Promise<string[]> => items.allTextContents();
  const before = await shown();
  await page.keyboard.press('Home');
  const visited: string[] = [];
  for (let step = 0; step < before.length; step++) { visited.push(await focused()); await page.keyboard.press('ArrowDown'); }
  assert.deepEqual(visited, before, 'the arrow keys visit the shown items only, skipping the collapsed brands\' lights');
  await brandToggle('LIFX').focus();
  await page.keyboard.press('Enter');
  assert.deepEqual([await brandToggle('LIFX').getAttribute('aria-expanded'), await focused()], ['true', 'LIFX'], 'Enter expands a brand and leaves focus on it');
  assert.deepEqual(await menu.getByRole('group', {name: 'LIFX lights', exact: true}).getByRole('menuitem').allTextContents(), ['Pendant 1', 'Beam', 'LIFX overview'],
    'LIFX lists its distinct fixtures, then its overview');
  await page.keyboard.press('ArrowDown');
  assert.equal(await focused(), 'Pendant 1', 'the down arrow goes into the expanded brand');
  await page.keyboard.press('ArrowLeft');
  assert.deepEqual([await brandToggle('LIFX').getAttribute('aria-expanded'), await focused()], ['false', 'LIFX'], 'the left arrow collapses the brand from one of its lights');
  await page.keyboard.press('ArrowRight');
  assert.equal(await brandToggle('LIFX').getAttribute('aria-expanded'), 'true', 'the right arrow expands it');
  await brandToggle('Nanoleaf').click();
  assert.deepEqual(await menu.getByRole('group', {name: 'Nanoleaf lights', exact: true}).getByRole('menuitem').allTextContents(), ['Lines', 'Panels', 'Nanoleaf overview'],
    'Nanoleaf lists the Lines and the Panels, then its overview');
  // With both brands open the menu still fits beside the full rail and "All devices" is in view.
  await settled();
  assert.deepEqual(await page.locator('.device-menu').evaluate(element => {
    const box = element.getBoundingClientRect(), all = element.querySelector('.device-menu-all')?.getBoundingClientRect();
    return {inWindow: box.top >= 0 && box.bottom <= innerHeight && box.right <= innerWidth, all: all !== undefined && all.top >= box.top && all.bottom <= box.bottom};
  }), {inWindow: true, all: true}, 'with both brands open the menu fits in the window with "All devices" in view');
  await page.keyboard.press('Escape');
  await menu.waitFor({state: 'detached'});
  assert.deepEqual(brandWrites.stop(), [], 'expanding, collapsing and moving through the brands send no command, sync, upload or provider request');
  // Every light opens its own existing page, and the menu opens again with that light's brand expanded and the other collapsed.
  for (const [light, brand, id, other] of [['Pendant 1', 'LIFX', 'pendant-1', 'Nanoleaf'], ['Beam', 'LIFX', 'beam', 'Nanoleaf'], ['Lines', 'Nanoleaf', 'wall', 'LIFX'], ['Panels', 'Nanoleaf', 'nl22', 'LIFX']] as const) {
    await choose(light, brand);
    await page.getByRole('heading', {name: light, level: 1, exact: true}).waitFor();
    assert.equal(hash(), `#/component/${id}`, `${light} opens its device page`);
    assert.equal(await page.getByRole('navigation', {name: 'Breadcrumb', exact: true}).getByRole('link').getAttribute('href'), `#/lights/${brand.toLowerCase()}`, `${light}'s page leads back to ${brand}`);
    await devices.click(); await menu.waitFor();
    assert.deepEqual([await focused(), await brandToggle(brand).getAttribute('aria-expanded'), await brandToggle(other).getAttribute('aria-expanded')], [light, 'true', 'false'],
      `the menu opens on ${light} with ${brand} expanded and ${other} collapsed`);
    await page.keyboard.press('Escape');
  }
  // The directory shows the same membership: each brand's overview and its lights directly under it.
  await openDirectory(page);
  const lighting = page.getByRole('region', {name: 'Lighting', exact: true});
  assert.deepEqual(await lighting.getByRole('navigation', {name: 'LIFX lights', exact: true}).getByRole('link').allTextContents(), ['Pendant 1', 'Beam']);
  assert.deepEqual(await lighting.getByRole('navigation', {name: 'Nanoleaf lights', exact: true}).getByRole('link').allTextContents(), ['Lines', 'Panels']);
  assert.deepEqual(await lighting.getByRole('link', {name: /overview$/}).evaluateAll(links => links.map(link => link.getAttribute('href'))), ['#/lights/lifx', '#/lights/nanoleaf']);
  assert.deepEqual(await page.locator('.inventory-section h2').allTextContents(), ['Displays', 'Lighting', 'Appliances']);
  assert.deepEqual(await page.getByRole('region', {name: 'Displays', exact: true}).getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('aria-label'))).then(names => names.sort()),
    ['Pixoo', 'Tidbyt'], 'Pixoo and Tidbyt have one entry each in the directory too');
  checks.push('Nanoleaf and LIFX expand to their lights and overview, start collapsed, open for the current light, skip collapsed lights with the keys, and match the directory');

  // The displays (#1950): Tidbyt opens its Status and Content view; Pixoo opens Display, which links Advanced playback
  // and Device settings, with Media and Agent status beside it. Existing addresses open their views.
  await choose('Tidbyt');
  await page.getByRole('tablist', {name: 'Tidbyt information', exact: true}).waitFor();
  assert.deepEqual([await page.getByRole('tab').allTextContents(), await tabs.count()], [['Status', 'Content'], 0], 'Tidbyt is one view with its Status and Content tabs');
  await page.getByRole('tab', {name: 'Content', exact: true}).click();
  await page.getByRole('tabpanel', {name: 'Content', exact: true}).waitFor();
  await choose('Pixoo');
  await page.getByRole('heading', {name: 'Pixoo', level: 1, exact: true}).waitFor();
  assert.deepEqual([await tabs.first().getByRole('link').allTextContents(), await tabs.first().locator('[aria-current]').textContent()], [['Display', 'Media', 'Agent status'], 'Display']);
  const displayLinks = page.getByRole('navigation', {name: 'Display links', exact: true});
  assert.deepEqual(await displayLinks.getByRole('link').allTextContents(), ['Advanced playback', 'Device settings']);
  await displayLinks.getByRole('link', {name: 'Device settings', exact: true}).click();
  await page.getByRole('region', {name: 'Settings', exact: true}).waitFor();
  assert.deepEqual([hash(), await tabs.first().locator('[aria-current]').textContent()], ['#/module/pixoo/settings', 'Device settings'], 'Device settings opens at its existing address as a tab of its own');
  await tabs.first().getByRole('link', {name: 'Agent status', exact: true}).click();
  await page.getByRole('region', {name: 'Monitor', exact: true}).waitFor();
  assert.equal(hash(), '#/module/pixoo/monitor', 'Agent status is the Monitor at its existing address');
  await tabs.first().getByRole('link', {name: 'Media', exact: true}).click();
  await viewPages.getByRole('link', {name: 'Playlists', exact: true}).click();
  await page.getByRole('region', {name: 'Playlists', exact: true}).waitFor();
  assert.deepEqual([hash(), await viewPages.locator('[aria-current]').textContent()], ['#/module/pixoo/playlists', 'Playlists']);
  await page.goto(`${world.url}/#/module/pixoo/player`); await feed(page, 'connected');
  await page.getByRole('region', {name: 'Player', exact: true}).waitFor();
  assert.equal(await tabs.first().locator('[aria-current]').textContent(), 'Advanced playback', 'an old Player bookmark opens Advanced playback');
  await jumpTo(page, 'pixoo monitor', 'Pixoo · Monitor');
  await page.getByRole('region', {name: 'Monitor', exact: true}).waitFor();
  checks.push('Tidbyt opens Status and Content; Pixoo opens Display with Advanced playback and Device settings, Media and Agent status, from the menu, bookmarks and the palette');

  // Companions (#1950) takes Habitat's place: its overview links Habitat and the companion features, and an old
  // Habitat bookmark selects it.
  await (await destinationLink(page, 'Companions')).click();
  const overview = page.getByRole('region', {name: 'Companions', exact: true});
  await overview.getByRole('heading', {name: 'Companions', level: 1, exact: true}).waitFor();
  assert.deepEqual(await overview.getByRole('link').evaluateAll(links => links.map(link => `${link.textContent ?? ''} ${link.getAttribute('href') ?? ''}`)), [
    'Open Habitat #/habitat', 'Reachy #/module/companions/reachy', 'MicroDuck #/module/companions/microduck', 'Duck conversation #/module/companions/duck-conversation',
    'Open Preferences #/module/companions/preferences', 'Open Companion knowledge #/module/companions/knowledge']);
  assert.equal(await companionsRow().getAttribute('aria-current'), 'page');
  await page.goto(`${world.url}/#/habitat`); await feed(page, 'connected');
  await page.getByRole('heading', {name: 'Habitat', level: 1, exact: true}).waitFor();
  assert.deepEqual([await companionsRow().getAttribute('aria-current'), await page.getByRole('navigation', {name: 'Breadcrumb', exact: true}).getByRole('link').textContent()],
    ['page', 'Companions'], 'an old Habitat bookmark selects Companions and shows it as the parent');
  await overview.waitFor({state: 'detached'});
  for (const profile of ['reachy', 'microduck', 'bunny'] as const) {
    await chooseConversation(page, profile);
    assert.equal(await (await conversationLink(page, profile)).getAttribute('aria-current'), 'page', `the ${profile} conversation opens from the rail`);
  }
  // A page of a module that is not hardware is under Home, not Devices, and names Home as its parent.
  await jumpTo(page, 'passive fixture', 'editor-fixture · Passive fixture');
  await page.frameLocator('iframe.module-page').getByRole('heading', {name: 'Passive preview', exact: true}).waitFor();
  assert.deepEqual([await primary.getByRole('link', {name: 'Home', exact: true}).getAttribute('aria-current'), await devices.getAttribute('aria-current'),
    await page.getByRole('navigation', {name: 'Breadcrumb', exact: true}).getByRole('link').textContent()], ['page', null, 'Home'], 'a page outside the hardware inventory selects Home');
  checks.push('Companions opens from the rail and links Habitat and the companion features; old Habitat bookmarks select it; the conversations stay in the rail; pages outside the hardware inventory select Home');

  // A page under Devices: the row is marked lightly, and the open page is a temporary row with a pin button.
  await choose('LIFX overview', 'LIFX');
  await page.getByRole('region', {name: 'LIFX lights', exact: true}).waitFor();
  assert.deepEqual([hash(), await focused(), await devices.getAttribute('aria-current'), await devices.getAttribute('data-ancestor')], ['#/lights/lifx', 'main', 'page', ''],
    'a chosen page opens with focus on it, and Devices stays its containing destination');
  assert.equal(await devices.evaluate(element => getComputedStyle(element).borderTopColor), 'rgba(0, 0, 0, 0)', 'on a page under it the Devices row has no box of its own');
  assert.deepEqual(await rowNames(), ['LIFX']);
  const visiting = rows.first(), visitingLink = visiting.getByRole('link');
  assert.deepEqual([await visiting.getAttribute('class'), await visitingLink.getAttribute('aria-current'), await visitingLink.getAttribute('title'), await visitingLink.evaluate(element => getComputedStyle(element).borderTopStyle)],
    ['rail-pin visiting', 'page', 'LIFX · not pinned', 'dashed'], 'the open page is a dashed temporary row');
  assert.equal(await visiting.getByRole('button', {name: 'Pin LIFX', exact: true}).evaluate(element => getComputedStyle(element).opacity), '1', 'a temporary row always shows its pin button');
  assert.deepEqual([await toggle.textContent(), await toggle.getAttribute('aria-pressed')], ['Pin to rail', 'false']);
  // Pinning and unpinning change this browser's list only. The lighting page is mounted, so any write is the pin's own.
  const pinWrites = recordWrites(page);
  await toggle.click();
  assert.deepEqual([await toggle.textContent(), await toggle.getAttribute('aria-pressed'), await visiting.getAttribute('class'), await visitingLink.getAttribute('title')], ['Pinned', 'true', 'rail-pin', 'LIFX'],
    'the header toggle pins the page, and its row is an ordinary pinned row');
  assert.deepEqual(await saved(), ['#/lights/lifx']);
  await devices.click(); await menu.waitFor();
  assert.deepEqual([await focused(), await brandToggle('LIFX').getAttribute('aria-expanded')], ['LIFX overview', 'true'], 'the menu opens on the page that is open, with its brand expanded');
  assert.deepEqual([await menu.getByRole('menuitem', {name: /^LIFX overview/}).getByRole('img', {name: 'Pinned', exact: true}).count(), await menu.getByRole('img', {name: 'Pinned', exact: true}).count()], [1, 1], 'the menu marks the pinned page and no other');
  await page.keyboard.press('Escape');
  // The pinned row opens the page from another page. The directory mounts no module page, so this stays inside the
  // part that must send nothing.
  await openDirectory(page);
  const lifxRow = pinned.getByRole('link', {name: 'LIFX', exact: true});
  assert.deepEqual([await lifxRow.getAttribute('aria-current'), await lifxRow.getAttribute('href'), await rows.first().getAttribute('class')], [null, '#/lights/lifx', 'rail-pin']);
  const unpin = pinned.getByRole('button', {name: 'Unpin LIFX', exact: true});
  assert.equal(await unpin.evaluate(element => getComputedStyle(element).opacity), '0', 'a pinned row hides its unpin button until it is asked for');
  await rows.first().hover();
  await page.waitForFunction(() => {const button = document.querySelector('.rail-pin:hover .rail-pin-button'); return button !== null && getComputedStyle(button).opacity === '1';});
  await page.mouse.move(900, 500);
  await lifxRow.click();
  await page.getByRole('region', {name: 'LIFX lights', exact: true}).waitFor();
  assert.deepEqual([hash(), await lifxRow.getAttribute('aria-current'), await devices.getAttribute('data-ancestor')], ['#/lights/lifx', 'page', ''], 'a pinned row opens its page and is marked current');
  // The row's own button unpins with the keyboard. The page is open, so its row stays as the temporary row. The
  // pointer is moved off the row first, so it is the keyboard focus that shows the button.
  await page.mouse.move(900, 500);
  assert.equal(await unpin.evaluate(element => getComputedStyle(element).opacity), '0');
  await lifxRow.focus();
  await page.keyboard.press('Tab');
  assert.equal(await unpin.evaluate(element => element === document.activeElement && element.matches(':focus-visible') && getComputedStyle(element).opacity === '1'), true, 'the unpin button is the Tab stop after its row and shows with keyboard focus');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Pin LIFX');
  assert.deepEqual([await saved(), await rows.first().getAttribute('class'), await toggle.textContent()], [[], 'rail-pin visiting', 'Pin to rail'], 'unpinning the open page leaves its temporary row, with focus on that row\'s button');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Unpin LIFX');
  assert.deepEqual(await saved(), ['#/lights/lifx'], 'the temporary row\'s button pins the page and keeps focus');
  assert.deepEqual(pinWrites.stop(), [], 'pinning, unpinning and using a pinned row send no command, sync, upload or provider request');
  // A pinned row opens its page at the top, from a page that was scrolled. Home is taller than this window.
  await page.setViewportSize({width: 1024, height: 640});
  await (await destinationLink(page, 'Home')).click();
  await page.getByRole('button', {name: 'Edit Home', exact: true}).waitFor();
  await page.evaluate(() => {window.scrollTo(0, 200);});
  assert.equal(await page.evaluate(() => scrollY), 200, 'Home scrolls in this window');
  await lifxRow.click();
  await page.getByRole('region', {name: 'LIFX lights', exact: true}).waitFor();
  assert.equal(await page.evaluate(() => scrollY), 0, 'a pinned row opens its page at the top');
  await page.setViewportSize({width: 1440, height: 1000});
  checks.push('a page header toggle and the rail rows pin and unpin a page, and a pinned row opens it from another page');

  // Device, Audio and module pages have the toggle; the Conversation page and the hub's own pages do not.
  await choose('Pixoo');
  await tabs.getByRole('link', {name: 'Media', exact: true}).click();
  await page.getByRole('region', {name: 'Library', exact: true}).waitFor();
  assert.deepEqual(await rowNames(), ['LIFX', 'Pixoo · Library'], 'a page of a module with several pages is named with its module');
  assert.equal(await rows.nth(1).locator('.rail-mono').textContent(), 'PL');
  await rows.nth(1).getByRole('button', {name: 'Pin Pixoo · Library', exact: true}).click();
  assert.deepEqual([await saved(), await toggle.textContent()], [['#/lights/lifx', '#/module/pixoo/library'], 'Pinned'], 'a pin is added after the others, and the header follows the rail');
  // Audio is under Home (#1950): Home's heading links it.
  await (await destinationLink(page, 'Home')).click();
  await page.locator('.home-layout-heading').getByRole('link', {name: 'Audio', exact: true}).click();
  await page.getByRole('heading', {name: 'Audio', level: 1, exact: true}).waitFor();
  assert.equal(await toggle.count(), 1, 'the Audio page can be pinned');
  await page.goto(`${world.url}/#/component/pendant-1`);
  await page.locator('[data-device=pendant-1]').waitFor();
  assert.deepEqual([await toggle.textContent(), await rowNames()], ['Pin to rail', ['LIFX', 'Pixoo · Library', 'LIFX · Pendant 1']], 'a light\'s own page can be pinned, although the directory reaches it through its brand page');
  // A press inside a framed module page is outside the menu too. It never reaches the shell's document; the shell
  // sees its window lose focus to the frame.
  await choose('sign');
  await tabs.getByRole('link', {name: 'Sign preview', exact: true}).click();
  const frameHeading = page.frameLocator('iframe.module-page').getByRole('heading', {name: 'hello'});
  await frameHeading.waitFor();
  await devices.click(); await menu.waitFor();
  await frameHeading.click();
  await menu.waitFor({state: 'detached'});
  assert.equal(await devices.getAttribute('aria-expanded'), 'false', 'a press inside a framed page closes the menu');
  await chooseConversation(page, 'bunny');
  await page.getByRole('heading', {name: 'Conversation', level: 1, exact: true}).waitFor();
  assert.deepEqual([await toggle.count(), await rowNames()], [0, ['LIFX', 'Pixoo · Library']], 'the Conversation page has no pin toggle and no temporary row');
  // The open conversation has its own row in the rail (#1890), so the rail boxes that row and marks its destination,
  // Companions (#1950), lightly.
  const companions = primary.getByRole('link', {name: 'Companions', exact: true});
  const mark = async (row: Locator): Promise<unknown[]> => [await row.getAttribute('aria-current'), await row.getAttribute('data-ancestor'),
    await row.evaluate(element => getComputedStyle(element).borderTopColor !== 'rgba(0, 0, 0, 0)'),
    await page.locator('.shell>aside a[aria-current], .shell>aside button[aria-current]').evaluateAll(links => links.map(link => link.getAttribute('data-profile') ?? link.textContent))];
  assert.deepEqual(await mark(companions), ['page', '', false, ['Companions', 'bunny']], 'on the Conversation page the open conversation is the boxed row, under Companions');
  assert.equal(await devices.getAttribute('aria-current'), null);
  // A page under Devices with no row of its own leaves the box on the Devices row, so the rail still boxes one row.
  await page.goto(`${world.url}/#/component/not-declared`);
  await page.getByRole('heading', {name: 'No component named not-declared', exact: true}).waitFor();
  assert.deepEqual(await mark(devices), ['page', null, true, ['Devices']], 'on a page with no row of its own the Devices row is the boxed row');
  await openDirectory(page);
  assert.equal(await toggle.count(), 0, 'the directory is not a page to pin');
  // Both pins survive a reload, in order; an unpinned page stays unpinned.
  await page.reload(); await feed(page, 'connected');
  await rows.nth(1).waitFor();
  assert.deepEqual(await rowNames(), ['LIFX', 'Pixoo · Library'], 'pins survive a reload in the order they were made');
  // Focus is on a row's button when it unpins a page that is not open: it moves to the row before it, and to the Devices row when none is left.
  await rows.nth(1).getByRole('button').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'LIFX' && document.activeElement.closest('.rail-pins') !== null);
  await page.reload(); await feed(page, 'connected');
  await rows.first().waitFor();
  assert.deepEqual([await rowNames(), await saved()], [['LIFX'], ['#/lights/lifx']], 'an unpinned page stays unpinned after a reload');
  await rows.first().getByRole('button').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.textContent === 'Devices' && document.activeElement.closest('.primary-navigation') !== null);
  assert.deepEqual([await saved(), await pinnedParts(), await pinned.count()], [[], ['Pinned'], 0], 'with the last pin gone the heading stands alone and focus is on the Devices row');
  checks.push('device, Audio and module pages can be pinned, the Conversation page cannot, and pins survive a reload');

  // A pin whose page the catalog no longer declares is not shown, and stays saved. A module that is not running is
  // named with its state in the menu and offers no page there.
  await page.evaluate(key => {localStorage.setItem(key, JSON.stringify(['#/module/sign/preview', '#/module/pixoo/retired', '#/lights/lifx']));}, PINS_KEY);
  await page.reload(); await feed(page, 'connected');
  await railShows(['sign · Sign preview', 'LIFX'], 'a pin with no declared page is left out of the rail');
  await rows.nth(1).getByRole('button').focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(await saved(), ['#/module/sign/preview', '#/module/pixoo/retired'], 'the hidden pin is kept when another is unpinned');
  await page.route('**/api/v2/modules', async route => {
    const response = await route.fetch();
    const catalog = await response.json() as {modules: {name: string; state: string}[]};
    await route.fulfill({response, json: {...catalog, modules: catalog.modules.map(module => module.name === 'sign' ? {...module, state: 'stopped'} : module)}});
  });
  await page.reload(); await feed(page, 'connected');
  await rows.first().waitFor();
  await devices.click(); await menu.waitFor();
  await menu.getByRole('menuitem', {name: 'Pixoo', exact: true}).waitFor();
  assert.deepEqual([await menu.locator('.device-menu-module').filter({hasText: /^sign · stopped$/}).count(), await menu.getByRole('menuitem', {name: /^sign$|Sign preview|Sign 1/}).count()], [1, 0],
    'a stopped module is named with its state in the menu and offers no page');
  await page.keyboard.press('Escape');
  await railShows(['sign · Sign preview · stopped'], 'a pinned page of a stopped module keeps its row, with the module\'s state in its name');
  assert.deepEqual([await rowNames(), await rows.first().locator('.rail-pin-state').textContent(), await rows.first().getByRole('link').getAttribute('title')],
    [['sign · Sign preview · stopped'], 'stopped', 'sign · Sign preview · stopped'], 'a pinned page of a stopped module keeps its row, which shows the module\'s state in its text, its name and its title');
  assert.deepEqual(await rows.first().evaluate(row => {
    const state = row.querySelector('.rail-pin-state'), name = row.querySelector('.rail-pin-name'), link = row.querySelector('a');
    if (state === null || name === null || link === null) throw new Error('A pinned row of a stopped module holds its name and the state.');
    const box = state.getBoundingClientRect(), inside = link.getBoundingClientRect();
    return {whole: box.width >= state.scrollWidth - 1 && box.width > 20, inRow: box.left >= name.getBoundingClientRect().right - 1 && box.right <= inside.right, nameCut: name.scrollWidth > name.clientWidth};
  }), {whole: true, inRow: true, nameCut: true}, 'the state is whole on the screen in the full rail; the longer page name is the part that is cut');
  await page.unroute('**/api/v2/modules');
  await page.route('**/api/v2/modules', async route => {
    const response = await route.fetch();
    const catalog = await response.json() as {modules: {name: string}[]};
    await route.fulfill({response, json: {...catalog, modules: catalog.modules.filter(module => module.name !== 'sign')}});
  });
  await page.reload(); await feed(page, 'connected');
  await devices.click(); await menu.waitFor();
  await menu.getByRole('menuitem', {name: 'Pixoo', exact: true}).waitFor();
  await page.keyboard.press('Escape');
  assert.deepEqual([await pinned.count(), await pinnedParts(), await saved()], [0, ['Pinned'], ['#/module/sign/preview', '#/module/pixoo/retired']],
    'when the catalog no longer declares the page its pin is hidden and kept');
  await page.unroute('**/api/v2/modules');
  await page.reload(); await feed(page, 'connected');
  await railShows(['sign · Sign preview'], 'the pin is listed again once its page is declared');
  checks.push('a pin with no declared page is hidden and kept, and a stopped module offers no page in the menu');

  // The pinned list scrolls inside the rail when it is longer than the room above the foot.
  const every = ['#/lights/lifx', '#/lights/nanoleaf', '#/component/pendant-1', '#/component/beam', '#/component/wall', '#/component/nl22', '#/component/pixoo-1',
    '#/component/tidbyt', '#/component/sign-1', '#/module/pixoo/library', '#/module/pixoo/playlists', '#/module/pixoo/player', '#/module/pixoo/monitor',
    '#/module/pixoo/settings', '#/module/sign/preview', '#/audio', '#/module/companions/preferences'];
  await page.evaluate(([key, pins]) => {localStorage.setItem(key ?? '', pins ?? '[]');}, [PINS_KEY, JSON.stringify(every)]);
  // This world's rail also holds the conversations (#1890), so it needs a taller window to stay in view than a rail without them.
  await page.setViewportSize({width: 1440, height: 800});
  await page.reload(); await feed(page, 'connected');
  await rows.nth(every.length - 1).waitFor();
  const list = (): Promise<{scrolls: boolean; lastInView: boolean; footInWindow: boolean; sticky: boolean; ringRoom: boolean}> => pinned.evaluate(element => {
    const rail = element.closest('aside'), foot = rail?.querySelector('.sidebar-foot')?.getBoundingClientRect(), box = element.getBoundingClientRect();
    const last = element.querySelector('.rail-pin:last-child')?.getBoundingClientRect(), first = element.querySelector('.rail-pin')?.getBoundingClientRect();
    return {scrolls: element.scrollHeight > element.clientHeight + 30, lastInView: last !== undefined && last.bottom <= box.bottom + 1 && last.top >= box.top - 1,
      footInWindow: foot !== undefined && foot.bottom <= innerHeight + 1 && foot.top >= box.bottom - 1, sticky: rail !== null && getComputedStyle(rail).position === 'sticky' && Math.round(rail.getBoundingClientRect().height) === innerHeight,
      ringRoom: first !== undefined && first.left - box.left >= 6 && box.right - first.right >= 6};
  });
  assert.deepEqual(await list(), {scrolls: true, lastInView: false, footInWindow: true, sticky: true, ringRoom: true}, 'a long pinned list scrolls above the foot, which stays in the window');
  await rows.last().getByRole('link').focus();
  assert.deepEqual(await list(), {scrolls: true, lastInView: true, footInWindow: true, sticky: true, ringRoom: true}, 'focus brings the last pinned row into view inside the list');
  // In the icon rail a pinned page is its monogram, named by its title; the unpin button needs the full rail.
  await page.setViewportSize({width: 1024, height: 800});
  assert.deepEqual(await rows.first().evaluate(element => {
    const link = element.querySelector('a'), name = element.querySelector('.rail-pin-name'), button = element.querySelector('.rail-pin-button'), mono = element.querySelector('.rail-mono');
    if (link === null || name === null || button === null || mono === null) throw new Error('A pinned row holds a link, a name, a button and a monogram.');
    return {wide: link.getBoundingClientRect().width >= 43, name: getComputedStyle(name).display, button: getComputedStyle(button).display, mono: mono.getBoundingClientRect().width > 0, title: link.getAttribute('title') === link.getAttribute('aria-label')};
  }), {wide: true, name: 'none', button: 'none', mono: true, title: true}, 'the icon rail shows a pinned page as a named monogram, as wide as the rail\'s column');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  checks.push('a long pinned list scrolls inside the rail, and the icon rail shows monograms');

  // On a phone the menu covers the drawer, scrolls and closes with its own button, leaving the drawer open.
  for (const width of [390, 320]) {
    await page.setViewportSize({width, height: 560});
    const drawerButton = page.getByRole('button', {name: 'Open navigation', exact: true}), drawer = page.locator('.shell>aside');
    await drawerButton.click(); await drawer.waitFor();
    await devices.click(); await menu.waitFor();
    // Both brands open (#1950): the lists scroll, and "All devices" stays at the foot of the menu in view.
    for (const brand of ['LIFX', 'Nanoleaf']) if (await brandToggle(brand).getAttribute('aria-expanded') !== 'true') await brandToggle(brand).click();
    // The drawer finishes sliding before the menu is measured against it.
    await page.waitForFunction(() => {const rail = document.querySelector('.shell>aside'); return rail !== null && Math.abs(rail.getBoundingClientRect().left) < .5;});
    await settled();
    assert.deepEqual(await page.locator('.device-menu').evaluate(element => {
      const box = element.getBoundingClientRect(), rail = document.querySelector('.shell>aside')?.getBoundingClientRect();
      const columns = getComputedStyle(element.querySelector('.device-menu-columns') ?? element).gridTemplateColumns.split(' ').length;
      const item = element.querySelector('[role=menuitem]')?.getBoundingClientRect(), lists = element.querySelector('.device-menu-scroll');
      return {covers: rail !== undefined && box.left >= rail.left && box.right <= rail.right && rail.width - box.width <= 16.5 && innerHeight - box.height <= 16.5, inWindow: box.top >= 0 && box.bottom <= innerHeight,
        columns, scrolls: lists !== null && lists.scrollHeight > lists.clientHeight + 100, touch: item !== undefined && item.height >= 44, fits: document.documentElement.scrollWidth <= innerWidth};
    }), {covers: true, inWindow: true, columns: 1, scrolls: true, touch: true, fits: true}, `at ${String(width)}px the menu covers the drawer as one scrolling column`);
    const allInView = (): Promise<boolean> => menu.getByRole('menuitem', {name: 'All devices', exact: true}).evaluate(element => {const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight;});
    assert.equal(await allInView(), true, 'with both brands open "All devices" is in view before the lists scroll');
    await page.locator('.device-menu-scroll').evaluate(element => {element.scrollTo(0, element.scrollHeight);});
    assert.equal(await allInView(), true, 'and after they scroll to their end');
    await page.getByRole('button', {name: 'Close device pages', exact: true}).click();
    await menu.waitFor({state: 'detached'});
    assert.deepEqual([await page.locator('.shell').getAttribute('data-drawer'), await focused()], ['open', 'Devices'], 'the menu\'s own button closes it, leaving the drawer open with focus on the Devices row');
    // Over the drawer the page behind is inert, so on the directory Tab from the menu goes round to the menu button,
    // the menu closes and the drawer stays open; Shift+Tab past the menu's close button reaches the drawer's last stop.
    await page.goto(`${world.url}/#/devices`); await feed(page, 'connected');
    if (await page.locator('.shell').getAttribute('data-drawer') !== 'open') { await drawerButton.click(); await drawer.waitFor(); }
    await devices.click(); await menu.waitFor();
    await page.keyboard.press('Tab');
    await menu.waitFor({state: 'detached'});
    assert.deepEqual([await focused(), await page.locator('.shell').getAttribute('data-drawer')], ['Open navigation', 'open'], `at ${String(width)}px Tab from the menu reaches the menu button`);
    await devices.click(); await menu.waitFor();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await focused(), 'Close device pages');
    await page.keyboard.press('Shift+Tab');
    await menu.waitFor({state: 'detached'});
    assert.deepEqual(await page.evaluate(() => {
      const active = document.activeElement, stops = [...document.querySelectorAll<HTMLElement>('#rail :is(a[href],button,input,select,textarea,summary,[tabindex])')]
        .filter(element => element.tabIndex >= 0 && element.checkVisibility() && !(element as HTMLButtonElement).disabled);
      return {last: active !== null && active === stops.at(-1), open: document.querySelector('.shell')?.getAttribute('data-drawer') === 'open'};
    }), {last: true, open: true}, `at ${String(width)}px Shift+Tab past the close button reaches the drawer's last stop`);
    // Escape closes the menu first, and only then the drawer.
    await devices.click(); await menu.waitFor();
    await page.keyboard.press('Escape');
    await menu.waitFor({state: 'detached'});
    assert.deepEqual([await page.locator('.shell').getAttribute('data-drawer'), await focused()], ['open', 'Devices'], 'Escape closes the menu and not the drawer under it, with focus on the Devices row');
    await page.keyboard.press('Escape');
    await drawer.waitFor({state: 'hidden'});
    assert.equal(await focused(), 'Open navigation', 'the next Escape closes the drawer, with focus on its button');
    // A chosen page closes both, with focus on the button that opens the drawer.
    await drawerButton.click(); await drawer.waitFor();
    await devices.click(); await menu.waitFor();
    await menu.getByRole('menuitem', {name: 'All devices', exact: true}).click();
    await page.getByRole('heading', {name: 'Devices', level: 1, exact: true}).waitFor();
    await drawer.waitFor({state: 'hidden'});
    assert.deepEqual([await menu.count(), await focused()], [0, 'Open navigation'], 'a page chosen in the menu closes it and the drawer');
    // The lighting page's heading keeps its name on one line beside the pin toggle, which is at its widest when the
    // page is not pinned; the heading's actions move under the name when the row is too narrow.
    await page.goto(`${world.url}/#/lights/lifx`);
    await page.getByRole('region', {name: 'LIFX lights', exact: true}).waitFor();
    if (await toggle.textContent() === 'Pinned') await toggle.click();
    assert.deepEqual(await page.locator('.lighting-heading').evaluate(header => {
      const lines = (element: Element | null): number => {
        if (element === null) return 0;
        const range = document.createRange(); range.selectNodeContents(element);
        return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size;
      };
      return {toggle: header.querySelector('.pin-toggle')?.textContent, name: lines(header.querySelector('h2')), label: lines(header.querySelector('.pin-toggle span')), arrange: lines(header.querySelector('summary')),
        fits: document.documentElement.scrollWidth <= innerWidth};
    }), {toggle: 'Pin to rail', name: 1, label: 1, arrange: 1, fits: true}, `at ${String(width)}px the lighting heading keeps its name, its toggle and Arrange on one line each`);
    // The temporary row's pin button is always shown, so in the drawer it is a full touch target.
    await drawerButton.click(); await drawer.waitFor();
    assert.deepEqual(await rows.locator('.rail-pin-button').last().evaluate(button => {
      const box = button.getBoundingClientRect(), row = button.closest('.rail-pin')?.getBoundingClientRect();
      return {label: button.getAttribute('aria-label'), target: box.width >= 44 && box.height >= 44, inRow: row !== undefined && box.right <= row.right + 1 && box.left >= row.left};
    }), {label: 'Pin LIFX', target: true, inRow: true}, 'the temporary row\'s pin button is a full touch target in the drawer');
    await rows.locator('.rail-pin-button').last().click();
    assert.equal(await toggle.textContent(), 'Pinned', 'and it pins the page');
    await page.keyboard.press('Escape');
    await drawer.waitFor({state: 'hidden'});
    // A link opened in a new tab from the menu closes the drawer, as any link in the drawer does; the menu goes with it.
    // The page leaves a modified click to the browser. The check records that the click reached the document with its
    // default intact, then stops that default, so it does not depend on whether headless Chromium opens the tab: on
    // hosted runners it sometimes never did (#1919), as shell.browser.ts notes for the rail's links.
    await drawerButton.click(); await drawer.waitFor();
    await devices.click(); await menu.waitFor();
    await page.evaluate(() => {
      document.addEventListener('click', event => {
        const link = event.target instanceof Element ? event.target.closest('a') : null;
        Object.assign(window, {modifiedClick: {modified: event.ctrlKey || event.metaKey, prevented: event.defaultPrevented, href: link?.getAttribute('href') ?? null}});
        event.preventDefault();
      }, {once: true});
    });
    await menu.getByRole('menuitem', {name: 'All devices', exact: true}).click({modifiers: ['ControlOrMeta']});
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'modifiedClick') as unknown), {modified: true, prevented: false, href: '#/devices'},
      'the modified click on the menu\'s link is left to the browser');
    assert.equal(hash(), '#/lights/lifx', 'and this page does not follow it');
    await drawer.waitFor({state: 'hidden'});
    await drawerButton.click(); await drawer.waitFor();
    assert.equal(await menu.count(), 0, 'the menu does not come back with the drawer');
    assert.equal(await rows.first().getByRole('link').evaluate(element => element.getBoundingClientRect().height >= 44), true, 'a pinned row is a full touch target in the drawer');
    await page.keyboard.press('Escape');
    await drawer.waitFor({state: 'hidden'});
  }
  checks.push('at 390 and 320px the menu covers the drawer, scrolls, and closes with its own button without closing the drawer');

  // With browser storage refused, pins work for the open page and nothing throws.
  const refusing = await context.newPage();
  refusing.setDefaultTimeout(15_000);
  await refusing.addInitScript(key => {
    const get = Storage.prototype.getItem.bind(localStorage), set = Storage.prototype.setItem.bind(localStorage);
    Storage.prototype.getItem = function(name: string): string | null {if (name === key) throw new DOMException('Synthetic storage refusal', 'SecurityError'); return get(name);};
    Storage.prototype.setItem = function(name: string, value: string): void {if (name === key) throw new DOMException('Synthetic storage refusal', 'QuotaExceededError'); set(name, value);};
  }, PINS_KEY);
  await refusing.setViewportSize({width: 1440, height: 1000});
  await refusing.goto(`${world.url}/#/lights/lifx`); await feed(refusing, 'connected');
  const refusedRows = refusing.getByRole('navigation', {name: 'Pinned pages', exact: true}).locator('.rail-pin'), refusedToggle = refusing.getByRole('button', {name: /^(Pin to rail|Pinned)$/});
  await refusedToggle.waitFor();
  assert.deepEqual([await refusedRows.count(), await refusedRows.first().getAttribute('class'), await refusedToggle.textContent()], [1, 'rail-pin visiting', 'Pin to rail'], 'refused storage starts with no pins, although pins are saved');
  await refusedToggle.click();
  assert.deepEqual([await refusedRows.first().getAttribute('class'), await refusedToggle.textContent()], ['rail-pin', 'Pinned'], 'a refused save still pins the page for this page session');
  await refusing.getByRole('navigation', {name: 'Main navigation', exact: true}).getByRole('link', {name: 'Home', exact: true}).click();
  await refusing.getByRole('region', {name: 'Home', exact: true}).waitFor();
  await refusedRows.first().getByRole('link').click();
  await refusing.getByRole('region', {name: 'LIFX lights', exact: true}).waitFor();
  await refusedToggle.click();
  assert.deepEqual([await refusedRows.first().getAttribute('class'), await refusedToggle.textContent()], ['rail-pin visiting', 'Pin to rail'], 'and unpins it');
  await refusing.close();
  checks.push('with storage refused, pins work for the page session');

  assert.deepEqual(sent, [], 'the menu and the pins send no command');
  assert.deepEqual(errors, [], 'nothing throws');
  console.log(JSON.stringify({journey: 'devices-menu', checks, commands: sent.length, errors}));
} finally {
  await context.close(); await browser.close(); await world.close();
}
