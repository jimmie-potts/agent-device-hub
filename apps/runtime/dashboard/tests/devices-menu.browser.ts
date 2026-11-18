// The Devices menu and the pinned pages (Hub #1889) on the real shell over synthetic owners. Both only navigate or
// change this browser's own list; nothing here sends a command, sync, upload or provider request.
import assert from 'node:assert/strict';
import {chromium, type Page, type Request} from 'playwright';
import {changes, feed, startWorld} from './harness.ts';
import {destinationLink, openDeviceMenu, openDirectory} from './navigation-helpers.ts';
import {PINS_KEY} from '../src/pins.ts';

const world = await startWorld({devices: true, pixooPages: true, tidbyt: true, companions: true, speech: true});
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
const hint = page.getByText('Pin a device page to keep it one click away.', {exact: true});
const toggle = page.getByRole('button', {name: /^(Pin to rail|Pinned)$/});
const hash = (): string => new URL(page.url()).hash;
const saved = (): Promise<unknown> => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null') as unknown, PINS_KEY);
const focused = (): Promise<string> => page.evaluate(() => {
  const active = document.activeElement;
  return active === null ? '' : active.id === 'main' ? 'main' : active.getAttribute('aria-label') ?? active.textContent ?? '';
});
const rowNames = (): Promise<string[]> => rows.locator('a').evaluateAll(links => links.map(link => link.getAttribute('aria-label') ?? ''));
/** The menu slides in; its box is measured once that has finished. */
const settled = async (): Promise<void> => {await page.locator('.device-menu').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));};
const choose = async (name: string): Promise<void> => {await (await openDeviceMenu(page)).getByRole('menuitem', {name, exact: true}).click(); await menu.waitFor({state: 'detached'});};
const checks: string[] = [];
try {
  await page.goto(`${world.url}/#/devices`); await feed(page, 'connected');
  await page.getByRole('heading', {name: 'Devices', level: 1, exact: true}).waitFor();
  await page.getByRole('link', {name: 'LIFX', exact: true}).waitFor();
  assert.equal(await hint.isVisible(), true, 'with no pins the rail says how to pin a page');
  assert.equal(await pinned.count(), 0);
  assert.deepEqual([await devices.getAttribute('aria-haspopup'), await devices.getAttribute('aria-expanded'), await devices.getAttribute('aria-current')], ['menu', 'false', 'page'],
    'the Devices row is a menu button, marked current on the directory');
  assert.equal(await devices.getAttribute('data-ancestor'), null);

  // The menu: every page the directory lists, beside the rail. The directory mounts no module page, so any write
  // from here to the end of this part would be the menu's own.
  const menuWrites = recordWrites(page);
  await devices.click();
  await menu.waitFor();
  assert.equal(await devices.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator(`#${await devices.getAttribute('aria-controls') ?? 'missing'}`).evaluate(element => element.querySelector('[role=menu]') !== null), true, 'the row names the menu it controls');
  assert.deepEqual(await menu.locator('.device-menu-category').allTextContents(), ['Lighting', 'Displays', 'Audio', 'Other']);
  const names = await items.allTextContents();
  assert.deepEqual([names[0], names.at(-1)], ['LIFX', 'All devices']);
  for (const name of ['Music', 'Library', 'Sign preview', 'Conversation', 'Preferences']) assert.equal(names.includes(name), true, `${name} is in the menu`);
  assert.equal(await menu.locator('.device-menu-module').filter({hasText: /^Pixoo$/}).count(), 1, 'a module with several pages is a heading over them');
  assert.equal(await focused(), 'All devices', 'the menu opens with focus on the current page\'s item');
  await settled();
  assert.deepEqual(await page.locator('.device-menu').evaluate(element => {
    const box = element.getBoundingClientRect(), rail = document.querySelector('.shell>aside')?.getBoundingClientRect();
    const columns = getComputedStyle(element.querySelector('.device-menu-columns') ?? element).gridTemplateColumns.split(' ').length;
    return {beside: rail !== undefined && box.left >= rail.right, inWindow: box.top >= 0 && box.bottom <= innerHeight && box.right <= innerWidth, columns};
  }), {beside: true, inWindow: true, columns: 2}, 'the menu opens beside the rail in two columns, inside the window');
  await page.keyboard.press('Home');
  assert.equal(await focused(), 'LIFX');
  await page.keyboard.press('ArrowDown');
  assert.equal(await focused(), names[1], 'the arrow keys move through the menu');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  assert.equal(await focused(), 'All devices', 'up from the first item wraps to the last');
  await page.keyboard.press('ArrowDown');
  assert.equal(await focused(), 'LIFX', 'down from the last item wraps to the first');
  await page.keyboard.press('End');
  assert.equal(await focused(), 'All devices');
  assert.equal(await menu.getByRole('menuitem', {name: 'All devices', exact: true}).evaluate(element => {
    const style = getComputedStyle(element);
    return element.matches(':focus-visible') && style.outlineStyle === 'solid' && Number.parseFloat(style.outlineWidth) >= 2 && Number.parseFloat(style.outlineOffset) < 0;
  }), true, 'a focused item has a visible ring inside the row');
  // A press on a part of the menu that is not an item leaves the keys working.
  await menu.locator('.device-menu-category').first().click();
  await menu.waitFor();
  await page.keyboard.press('Home');
  assert.equal(await focused(), 'LIFX', 'a press on a heading does not take the keys from the menu');
  await page.keyboard.press('Escape');
  await menu.waitFor({state: 'detached'});
  assert.deepEqual([await focused(), await devices.getAttribute('aria-expanded'), await devices.getAttribute('aria-controls')], ['Devices', 'false', null], 'Escape closes the menu with focus on the row');
  // The row opens the menu with the down arrow and closes it when pressed again.
  await page.keyboard.press('ArrowDown');
  await menu.waitFor();
  await devices.click();
  await menu.waitFor({state: 'detached'});
  // A press outside the menu closes it. The brand takes no focus, so here it is the press that closes it.
  await devices.click(); await menu.waitFor();
  await page.locator('.rail-head .brand').click();
  await menu.waitFor({state: 'detached'});
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true, 'the press moved focus to nothing, so the press itself closed the menu');
  // Focus moving out of the menu closes it too.
  await devices.click(); await menu.waitFor();
  await page.keyboard.press('Tab');
  await menu.waitFor({state: 'detached'});
  assert.equal(await page.evaluate(() => document.activeElement !== null && document.activeElement !== document.body && document.activeElement.closest('.device-menu') === null), true, 'Tab leaves the menu, which closes behind it');
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
  await page.getByRole('button', {name: 'Open navigation', exact: true}).click();
  await page.locator('.shell>aside').waitFor();
  assert.equal(await menu.count(), 0, 'narrowing the window closes the menu for good');
  await page.keyboard.press('Escape');
  await page.locator('.shell>aside').waitFor({state: 'hidden'});
  await page.setViewportSize({width: 1440, height: 1000});
  // In a window too short for the menu, it stays inside the window and scrolls.
  await page.setViewportSize({width: 1024, height: 420});
  await devices.click(); await menu.waitFor();
  await settled();
  assert.deepEqual(await page.locator('.device-menu').evaluate(element => {
    const box = element.getBoundingClientRect(), rail = document.querySelector('.shell>aside')?.getBoundingClientRect();
    return {beside: rail !== undefined && Math.round(rail.width) === 64 && box.left >= rail.right, inWindow: box.top >= 0 && box.bottom <= innerHeight && box.right <= innerWidth, scrolls: element.scrollHeight > element.clientHeight};
  }), {beside: true, inWindow: true, scrolls: true}, 'beside the icon rail in a short window the menu stays in the window and scrolls');
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
  assert.equal(await focused(), 'LIFX', 'with no current page in it, the menu opens on its first item');
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.getByRole('heading', {name: 'Devices', level: 1, exact: true}).waitFor();
  await menu.waitFor({state: 'detached'});
  assert.deepEqual([hash(), await devices.getAttribute('aria-current'), await focused()], ['#/devices', 'page', 'main'], '"All devices" opens the directory with the Devices row marked current and focus on the page');
  // A page change the menu did not make closes it as well.
  await devices.click(); await menu.waitFor();
  await page.goBack();
  await page.getByRole('region', {name: 'Rooms', exact: true}).waitFor();
  await menu.waitFor({state: 'detached'});
  assert.equal(hash(), '#/rooms', 'the browser\'s back button changes the page and closes the menu');
  checks.push('the Devices row opens a menu of every device page; the arrow keys, Home, End, Escape, an outside press and Tab work; "All devices" opens the directory');

  // A page under Devices: the row is marked lightly, and the open page is a temporary row with a pin button.
  await choose('LIFX');
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
  assert.equal(await focused(), 'LIFX', 'the menu opens on the page that is open');
  assert.deepEqual([await items.first().getByRole('img', {name: 'Pinned', exact: true}).count(), await menu.getByRole('img', {name: 'Pinned', exact: true}).count()], [1, 1], 'the menu marks the pinned page and no other');
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
  await choose('Library');
  await page.getByRole('heading', {name: 'Library', level: 1, exact: true}).waitFor();
  assert.deepEqual(await rowNames(), ['LIFX', 'Pixoo · Library'], 'a page of a module with several pages is named with its module');
  assert.equal(await rows.nth(1).locator('.rail-mono').textContent(), 'PL');
  await rows.nth(1).getByRole('button', {name: 'Pin Pixoo · Library', exact: true}).click();
  assert.deepEqual([await saved(), await toggle.textContent()], [['#/lights/lifx', '#/module/pixoo/library'], 'Pinned'], 'a pin is added after the others, and the header follows the rail');
  await choose('Music');
  await page.getByRole('heading', {name: 'Audio', level: 1, exact: true}).waitFor();
  assert.equal(await toggle.count(), 1, 'the Audio page can be pinned');
  await page.goto(`${world.url}/#/component/pendant-1`);
  await page.locator('[data-device=pendant-1]').waitFor();
  assert.deepEqual([await toggle.textContent(), await rowNames()], ['Pin to rail', ['LIFX', 'Pixoo · Library', 'LIFX · pendant-1']], 'a light\'s own page can be pinned, although the directory reaches it through its brand page');
  await choose('Conversation');
  await page.getByRole('heading', {name: 'Conversation', level: 1, exact: true}).waitFor();
  assert.deepEqual([await toggle.count(), await rowNames()], [0, ['LIFX', 'Pixoo · Library']], 'the Conversation page has no pin toggle and no temporary row');
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
  assert.deepEqual([await saved(), await hint.isVisible(), await pinned.count()], [[], true, 0], 'with the last pin gone the hint returns and focus is on the Devices row');
  checks.push('device, Audio and module pages can be pinned, the Conversation page cannot, and pins survive a reload');

  // A pin whose page the catalog no longer declares is not shown, and stays saved. A module that is not running is
  // named with its state in the menu and offers no page there.
  await page.evaluate(key => {localStorage.setItem(key, JSON.stringify(['#/module/sign/preview', '#/module/pixoo/retired', '#/lights/lifx']));}, PINS_KEY);
  await page.reload(); await feed(page, 'connected');
  await rows.nth(1).waitFor();
  assert.deepEqual(await rowNames(), ['sign · Sign preview', 'LIFX'], 'a pin with no declared page is left out of the rail');
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
  await menu.getByRole('menuitem', {name: 'Library', exact: true}).waitFor();
  assert.deepEqual([await menu.locator('.device-menu-module').filter({hasText: /^sign · stopped$/}).count(), await menu.getByRole('menuitem', {name: /Sign preview|sign-1/}).count()], [1, 0],
    'a stopped module is named with its state in the menu and offers no page');
  await page.keyboard.press('Escape');
  assert.deepEqual(await rowNames(), ['sign · Sign preview'], 'a pinned page of a stopped module keeps its row; the page says why it is unavailable');
  await page.unroute('**/api/v2/modules');
  await page.route('**/api/v2/modules', async route => {
    const response = await route.fetch();
    const catalog = await response.json() as {modules: {name: string}[]};
    await route.fulfill({response, json: {...catalog, modules: catalog.modules.filter(module => module.name !== 'sign')}});
  });
  await page.reload(); await feed(page, 'connected');
  await devices.click(); await menu.waitFor();
  await menu.getByRole('menuitem', {name: 'Library', exact: true}).waitFor();
  await page.keyboard.press('Escape');
  assert.deepEqual([await pinned.count(), await hint.count(), await saved()], [0, 0, ['#/module/sign/preview', '#/module/pixoo/retired']],
    'when the catalog no longer declares the page its pin is hidden, kept, and not mistaken for an empty list');
  await page.unroute('**/api/v2/modules');
  await page.reload(); await feed(page, 'connected');
  await rows.first().waitFor();
  assert.deepEqual(await rowNames(), ['sign · Sign preview'], 'the pin is listed again once its page is declared');
  checks.push('a pin with no declared page is hidden and kept, and a stopped module offers no page in the menu');

  // The pinned list scrolls inside the rail when it is longer than the room above the foot.
  const every = (await (await openDeviceMenu(page)).getByRole('menuitem').evaluateAll(links => links.map(link => link.getAttribute('href') ?? ''))).filter(address => address !== '#/devices' && address !== '#/module/companions/assistant');
  await page.keyboard.press('Escape');
  assert.equal(every.length >= 12, true, `the world declares enough pages for a long list: ${String(every.length)}`);
  await page.evaluate(([key, pins]) => {localStorage.setItem(key ?? '', pins ?? '[]');}, [PINS_KEY, JSON.stringify(every)]);
  await page.setViewportSize({width: 1440, height: 700});
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
  await page.setViewportSize({width: 1024, height: 700});
  assert.deepEqual(await rows.first().evaluate(element => {
    const link = element.querySelector('a'), name = element.querySelector('.rail-pin-name'), button = element.querySelector('.rail-pin-button'), mono = element.querySelector('.rail-mono');
    if (link === null || name === null || button === null || mono === null) throw new Error('A pinned row holds a link, a name, a button and a monogram.');
    return {wide: link.getBoundingClientRect().width >= 43, name: getComputedStyle(name).display, button: getComputedStyle(button).display, mono: mono.getBoundingClientRect().width > 0, title: link.getAttribute('title') === link.getAttribute('aria-label')};
  }), {wide: true, name: 'none', button: 'none', mono: true, title: true}, 'the icon rail shows a pinned page as a named monogram, as wide as the rail\'s column');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  checks.push('a long pinned list scrolls inside the rail, and the icon rail shows monograms');

  // On a phone the menu covers the drawer, scrolls and closes with its own button, leaving the drawer open.
  for (const width of [390, 320]) {
    await page.setViewportSize({width, height: 700});
    const drawerButton = page.getByRole('button', {name: 'Open navigation', exact: true}), drawer = page.locator('.shell>aside');
    await drawerButton.click(); await drawer.waitFor();
    await devices.click(); await menu.waitFor();
    // The drawer finishes sliding before the menu is measured against it.
    await page.waitForFunction(() => {const rail = document.querySelector('.shell>aside'); return rail !== null && Math.abs(rail.getBoundingClientRect().left) < .5;});
    await settled();
    assert.deepEqual(await page.locator('.device-menu').evaluate(element => {
      const box = element.getBoundingClientRect(), rail = document.querySelector('.shell>aside')?.getBoundingClientRect();
      const columns = getComputedStyle(element.querySelector('.device-menu-columns') ?? element).gridTemplateColumns.split(' ').length;
      const item = element.querySelector('[role=menuitem]')?.getBoundingClientRect();
      return {covers: rail !== undefined && box.left >= rail.left && box.right <= rail.right && rail.width - box.width <= 16.5 && innerHeight - box.height <= 16.5, inWindow: box.top >= 0 && box.bottom <= innerHeight,
        columns, scrolls: element.scrollHeight > element.clientHeight + 100, touch: item !== undefined && item.height >= 44, fits: document.documentElement.scrollWidth <= innerWidth};
    }), {covers: true, inWindow: true, columns: 1, scrolls: true, touch: true, fits: true}, `at ${String(width)}px the menu covers the drawer as one scrolling column`);
    await page.locator('.device-menu').evaluate(element => {element.scrollTo(0, element.scrollHeight);});
    assert.equal(await menu.getByRole('menuitem', {name: 'All devices', exact: true}).evaluate(element => {const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight;}), true, 'the menu scrolls to its last item');
    await page.getByRole('button', {name: 'Close device pages', exact: true}).click();
    await menu.waitFor({state: 'detached'});
    assert.deepEqual([await page.locator('.shell').getAttribute('data-drawer'), await focused()], ['open', 'Devices'], 'the menu\'s own button closes it, leaving the drawer open with focus on the Devices row');
    // Escape closes the menu first, and only then the drawer.
    await devices.click(); await menu.waitFor();
    await page.keyboard.press('Escape');
    await menu.waitFor({state: 'detached'});
    assert.equal(await page.locator('.shell').getAttribute('data-drawer'), 'open', 'Escape closes the menu and not the drawer under it');
    await page.keyboard.press('Escape');
    await drawer.waitFor({state: 'hidden'});
    // A chosen page closes both, with focus on the button that opens the drawer.
    await drawerButton.click(); await drawer.waitFor();
    await devices.click(); await menu.waitFor();
    await menu.getByRole('menuitem', {name: 'All devices', exact: true}).click();
    await page.getByRole('heading', {name: 'Devices', level: 1, exact: true}).waitFor();
    await drawer.waitFor({state: 'hidden'});
    assert.deepEqual([await menu.count(), await focused()], [0, 'Open navigation'], 'a page chosen in the menu closes it and the drawer');
    // A link opened in a new tab from the menu closes the drawer, as any link in the drawer does; the menu goes with it.
    await drawerButton.click(); await drawer.waitFor();
    await devices.click(); await menu.waitFor();
    const opened = context.waitForEvent('page');
    await menu.getByRole('menuitem', {name: 'All devices', exact: true}).click({modifiers: ['ControlOrMeta']});
    await (await opened).close();
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
