// The real runtime shell over synthetic owners; navigation never sends a device command.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium, type Request} from 'playwright';
import {changes, feed, startWorld} from './harness.ts';
import {destinationLink, destinationNames, openDirectory, openSettings} from './navigation-helpers.ts';
import {RAIL_PREFERENCE_KEY} from '../src/rail-preference.ts';

const world = await startWorld({devices: true, pixooPages: true, tidbyt: true});
const browser = await chromium.launch({headless: true});
const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const sent = changes(page);
const errors: string[] = [];
context.on('weberror', error => {errors.push(error.error().name);});
const receipts = process.env.DASHBOARD_RECEIPTS;
if (receipts !== undefined) await mkdir(receipts, {recursive: true});
const primary = page.getByRole('navigation', {name: 'Main navigation', exact: true});
const open = async (name: string): Promise<void> => {if (name === 'Devices') await openDirectory(page); else await (await destinationLink(page, name)).click();};
const settings = async (): Promise<void> => {await openSettings(page);};
const railWidth = (): Promise<number> => page.locator('.shell>aside').evaluate(element => Math.round(element.getBoundingClientRect().width));
// The stylesheet decides the rail's state from the window width, so it is read from the layout with no wait after a resize.
const railState = async (): Promise<string> => {const width = await railWidth(); return width === 184 ? 'expanded' : width === 64 ? 'collapsed' : `unexpected ${String(width)}px`;};
const FIVE = ['Home', 'Habitat', 'Rooms', 'Devices', 'Automation'];
/** Records the POSTs that would be a command, sync, upload or provider request; the rail and the drawer must send none. */
const recordWrites = (): {stop: () => string[]} => {
  const seen: string[] = [];
  const listen = (request: Request): void => {
    if (request.method() !== 'POST') return;
    const path = new URL(request.url()).pathname;
    if (/^\/api\/sdk\/v1\/(request|respond|sync|upload|publish)$/.test(path) || path.startsWith('/api/v2/commands/')) seen.push(path);
  };
  page.on('request', listen);
  return {stop: () => {page.off('request', listen); return seen;}};
};
/** The contrast ratio of two computed colors; a translucent foreground is laid over the background first. */
const contrastRatio = (foreground: string, background: string): number => {
  const channels = (value: string): number[] => (value.match(/[\d.]+/g) ?? []).map(Number);
  const luminance = (rgb: number[]): number => rgb.slice(0, 3).map(value => {
    const scaled = value / 255; return scaled <= .04045 ? scaled / 12.92 : ((scaled + .055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * ([0.2126, 0.7152, 0.0722][index] ?? 0), 0);
  const fg = channels(foreground), bg = channels(background), alpha = fg[3] ?? 1;
  const first = luminance(fg.slice(0, 3).map((value, index) => value * alpha + (bg[index] ?? 0) * (1 - alpha))), second = luminance(bg);
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
};
const category = async (name: string): Promise<void> => {await page.getByRole('group', {name: 'Device categories'}).getByRole('button', {name, exact: true}).click();};
const checks: string[] = [];
try {
  await page.goto(world.url); await feed(page, 'connected');
  assert.deepEqual(await destinationNames(page), ['Home', 'Habitat', 'Rooms', 'Devices', 'Automation']);
  assert.deepEqual(await primary.getByRole('link').allTextContents(), ['Home', 'Habitat', 'Rooms', 'Automation'], 'four destinations are links; Devices is the button that opens its menu');
  assert.equal(await primary.getByRole('link', {name: 'Settings'}).count(), 0);
  // A Tall light card on the Home grid keeps its artwork mounted but hidden (#1672); its colors are still checked.
  await page.locator('.light-bulb-glow').first().waitFor({state: 'attached'});
  // Decorative illustration and selected-state boundary contrast.
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({colorScheme});
    const contrast = await page.evaluate(() => {
      const channels = (value: string): number[] => (value.match(/[\d.]+/g) ?? []).map(Number);
      const luminance = (rgb: number[]): number => rgb.slice(0, 3).map(value => {
        const scaled = value / 255; return scaled <= .04045 ? scaled / 12.92 : ((scaled + .055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * ([0.2126, 0.7152, 0.0722][index] ?? 0), 0);
      const ratio = (foreground: string, background: string): number => {
        const fg = channels(foreground), bg = channels(background), alpha = fg[3] ?? 1;
        const first = luminance(fg.slice(0, 3).map((value, index) => value * alpha + (bg[index] ?? 0) * (1 - alpha)));
        const second = luminance(bg); return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
      };
      const selected = document.querySelector('.primary-navigation a[aria-current]'), aside = document.querySelector('.shell>aside');
      if (selected === null || aside === null) throw new Error('The selected navigation and rail must be present.');
      const style = getComputedStyle(selected), rail = getComputedStyle(aside);
      const shapes = [...document.querySelectorAll('.light-bulb-glow')];
      return {selection: Math.min(ratio(style.borderLeftColor, rail.backgroundColor), ratio(style.borderLeftColor, style.backgroundColor)),
        illustrations: shapes.map(shape => {
          const artwork = shape.closest('.light-artwork');
          if (artwork === null) throw new Error('The light silhouette must have its artwork surface.');
          return ratio(getComputedStyle(shape).fill, getComputedStyle(artwork).backgroundColor);
        })};
    });
    assert(contrast.selection >= 3, `${colorScheme} desktop selection boundary has 3:1 contrast: ${contrast.selection}`);
    assert(contrast.illustrations.length > 0 && contrast.illustrations.every(value => value >= 3), `${colorScheme} light silhouettes remain visible: ${contrast.illustrations.join(', ')}`);
  }

  // Four destinations are ordinary links. Devices is a button that opens the menu of every device page (#1889), and
  // the menu's "All devices" is the ordinary link to the directory.
  const rooms = primary.getByRole('link', {name: 'Rooms', exact: true});
  assert.equal(await rooms.getAttribute('href'), '#/rooms', 'navigation retains a native hash anchor');
  const modifiedClicks = await rooms.evaluate(element => ['ctrlKey', 'metaKey', 'shiftKey', 'altKey'].map(key => {
    let prevented = false;
    // Observe the real React handler, then suppress only the browser default so
    // this check does not depend on headless-window/tab creation policy.
    document.addEventListener('click', event => {prevented = event.defaultPrevented; event.preventDefault();}, {once: true});
    element.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, [key]: true}));
    return prevented;
  }));
  assert.deepEqual(modifiedClicks, [false, false, false, false], 'modified clicks remain native rather than intercepted by the shell');
  const devices = primary.getByRole('button', {name: 'Devices', exact: true}), deviceMenu = page.getByRole('menu', {name: 'Device pages', exact: true});
  await devices.focus();
  assert.equal(await devices.evaluate(element => {const style = getComputedStyle(element); return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 2;}), true, 'keyboard focus remains visible');
  await page.keyboard.press('Enter');
  await deviceMenu.waitFor();
  const allDevices = deviceMenu.getByRole('menuitem', {name: 'All devices', exact: true});
  assert.equal(await allDevices.getAttribute('href'), '#/devices', 'the directory keeps its native hash anchor behind the menu');
  await page.keyboard.press('End');
  assert.equal(await allDevices.evaluate(element => element === document.activeElement), true, 'End moves to the menu\'s last item');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', {name: 'Devices', level: 1, exact: true}).waitFor();
  await page.getByRole('link', {name: 'LIFX', exact: true}).click();
  assert.equal(new URL(page.url()).hash, '#/lights/lifx');
  assert.equal(await devices.getAttribute('aria-current'), 'page');
  await page.goBack();
  await page.getByRole('heading', {name: 'Devices', level: 1, exact: true}).waitFor();
  await page.goForward();
  assert.equal(new URL(page.url()).hash, '#/lights/lifx');
  await page.goBack();
  await category('Other');
  const sign = page.getByRole('link', {name: 'Sign preview', exact: true});
  const signAddress = await sign.getAttribute('href');
  await sign.click();
  await page.frameLocator('iframe.module-page').getByRole('heading', {name: 'hello'}).waitFor();
  assert.equal(await devices.getAttribute('aria-current'), 'page');
  await page.goBack();
  assert.equal(await page.getByRole('button', {name: 'Other', exact: true}).getAttribute('aria-pressed'), 'true', 'directory category survives navigation');
  await category('Audio'); await page.getByRole('link', {name: 'Audio', exact: true}).click();
  await page.getByRole('heading', {name: 'Audio', level: 1, exact: true}).waitFor();
  await page.getByRole('article', {name: /^Music /}).first().waitFor();
  checks.push('five destinations, keyboard activation, brands, module pages, Audio and back history');

  await settings();
  await page.locator('nav[aria-label=Places][data-links=loaded]').waitFor();
  assert.equal(await page.getByRole('button', {name: 'Disconnect', exact: true}).count(), 1);
  await page.getByRole('link', {name: 'Connections', exact: true}).click();
  await page.getByRole('heading', {name: 'Running build'}).waitFor();
  assert.equal(await page.getByRole('navigation', {name: 'Utilities'}).getByRole('link').getAttribute('aria-current'), 'page');
  await open('Home'); await page.getByRole('link', {name: 'Timeline', exact: true}).click();
  assert.equal(new URL(page.url()).hash, '#/timeline');
  assert.equal(await primary.getByRole('link', {name: 'Home', exact: true}).getAttribute('aria-current'), 'page');
  checks.push('Settings retains Places, Disconnect and Connections; Timeline remains under Home');

  // The rail (#1887): Settings and the feed sit at its bottom, it stays in view, and it collapses to icons.
  const toggle = page.getByRole('button', {name: /^(Collapse|Expand) navigation$/});
  assert.equal(await railState(), 'expanded', 'a wide window starts with the full rail');
  assert.equal(await railWidth(), 184, 'the full rail keeps its width, so pages keep theirs in a wide window');
  assert.equal(await page.locator('.top').count(), 0, 'the separate top utility row is gone');
  // The brand's second line is on one line, and what the toggle draws stays clear of it: its box when pointed at, and
  // its ring when it has keyboard focus. The box is the background clipped to the padding's inside, with no border.
  const headGaps = (): Promise<{lines: number; box: number; ring: number; clip: string; edge: string; ringStyle: string}> => page.locator('.rail-head').evaluate(head => {
    const line = head.querySelector('.brand small'), button = head.querySelector('.rail-toggle');
    if (line === null || button === null) throw new Error('The rail head holds the brand and the toggle.');
    const text = document.createRange(); text.selectNodeContents(line);
    const style = getComputedStyle(button), left = button.getBoundingClientRect().left, end = line.getBoundingClientRect().right;
    return {lines: text.getClientRects().length, box: left + Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft) - end,
      ring: left - Number.parseFloat(style.outlineOffset) - Number.parseFloat(style.outlineWidth) - end, clip: style.backgroundClip, edge: style.borderLeftColor, ringStyle: style.outlineStyle};
  });
  await toggle.hover();
  const pointed = await headGaps();
  assert.deepEqual({lines: pointed.lines, clip: pointed.clip, edge: pointed.edge, clear: pointed.box >= 4}, {lines: 1, clip: 'content-box', edge: 'rgba(0, 0, 0, 0)', clear: true},
    `the brand's second line is on one line, clear of the box the toggle draws: ${JSON.stringify(pointed)}`);
  await page.mouse.move(700, 500);
  await page.locator('.rail-jump').focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await toggle.evaluate(element => element === document.activeElement && element.matches(':focus-visible')), true, 'the toggle is the Tab stop before the field');
  const focused = await headGaps();
  assert.deepEqual({ringStyle: focused.ringStyle, clear: focused.ring >= 4}, {ringStyle: 'solid', clear: true}, `the toggle's focus ring is clear of the brand's second line: ${JSON.stringify(focused)}`);
  await toggle.evaluate(element => {if (element instanceof HTMLElement) element.blur();});
  const skip = page.getByRole('link', {name: 'Skip to content', exact: true});
  await skip.focus();
  assert.equal(await skip.evaluate(element => {
    const box = element.getBoundingClientRect();
    return document.elementFromPoint(box.left + 4, box.top + 4) === element && document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === element;
  }), true, 'the focused skip link is painted above the rail');
  await skip.evaluate(element => {element.blur();});
  const indicator = page.locator('.sidebar-foot .status-indicator');
  await indicator.focus();
  const feedDetails = page.getByRole('tooltip').filter({hasText: 'Control enabled'});
  await feedDetails.waitFor();
  assert.equal(await feedDetails.evaluate(element => {
    const box = element.getBoundingClientRect(), rail = document.querySelector('.shell>aside')?.getBoundingClientRect();
    return rail !== undefined && box.left >= rail.right && box.top >= 0 && box.bottom <= innerHeight;
  }), true, 'the feed details state the control mode and open beside the rail, over none of it');
  await page.keyboard.press('Escape');
  const order = await page.evaluate(() => {
    const rail = document.querySelector('.shell>aside'), main = rail?.querySelector('nav[aria-label="Main navigation"]'), utilities = rail?.querySelector('nav[aria-label="Utilities"]');
    if (rail === null || rail === undefined || main === null || main === undefined || utilities === null || utilities === undefined) throw new Error('The rail holds both navigation groups.');
    const box = rail.getBoundingClientRect(), settingsBox = utilities.getBoundingClientRect();
    return {after: (main.compareDocumentPosition(utilities) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0, inView: Math.abs(box.top) < 1 && box.bottom <= innerHeight + 1 && settingsBox.bottom <= innerHeight + 1,
      status: rail.querySelector('.sidebar-foot')?.textContent ?? ''};
  });
  assert.deepEqual({after: order.after, inView: order.inView}, {after: true, inView: true}, 'Settings follows the destinations and the rail fits the window');
  assert.match(order.status, /Control enabled · Local/, 'the control mode is stated beside the feed');
  // In a 1024x640 window Settings and Home are both well over a window tall, so each of them can scroll.
  await page.setViewportSize({width: 1024, height: 640});
  await settings();
  await page.getByRole('heading', {name: 'Settings', level: 1, exact: true}).waitFor();
  await page.evaluate(() => {window.scrollTo(0, document.documentElement.scrollHeight);});
  assert.equal(await page.evaluate(() => scrollY > 100), true, 'Settings scrolls in this window');
  // A scrolled position can be a fraction of a pixel, so the rail's top is compared within one pixel.
  assert.equal(await page.locator('.shell>aside').evaluate(element => Math.abs(element.getBoundingClientRect().top) < 1), true, 'the rail stays in view while the page scrolls');
  // A destination chosen while the page is scrolled opens at its top, on a page that could have stayed scrolled.
  await open('Home');
  await page.getByRole('button', {name: 'Edit Home', exact: true}).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight > 100), true, 'Home is taller than the window, so it could have opened scrolled');
  assert.equal(await page.evaluate(() => scrollY), 0, 'a chosen destination opens at its top');
  // A window too short for the rail lets it scroll with the page, and its panel still runs the page's full height.
  await page.setViewportSize({width: 1024, height: 500});
  assert.deepEqual(await page.locator('.shell>aside').evaluate(element => {
    const total = document.documentElement.scrollHeight, height = element.getBoundingClientRect().height;
    return {position: getComputedStyle(element).position, tallerPage: total > innerHeight + 100, fullHeight: Math.abs(height - total) <= 1};
  }), {position: 'static', tallerPage: true, fullHeight: true}, 'in a short window the rail scrolls with the page and its panel runs the full height');
  // The rail holds the heading of the pinned pages and one of them, about 608px in all: a 600px window lets it scroll
  // with the page too, and a 640px one holds it, so it stays in view there. An ended session's rail is taller.
  await page.setViewportSize({width: 1024, height: 600});
  assert.equal(await page.locator('.shell>aside').evaluate(element => getComputedStyle(element).position), 'static', 'a connected rail scrolls with the page in a 600px window');
  await page.setViewportSize({width: 1024, height: 640});
  assert.deepEqual(await page.locator('.shell>aside').evaluate(element => {
    const foot = element.querySelector('.sidebar-foot'), pins = element.querySelector('.rail-pins');
    if (foot === null || pins === null) throw new Error('The rail has pinned pages and a foot.');
    return {position: getComputedStyle(element).position, footInWindow: foot.getBoundingClientRect().bottom <= innerHeight + 1, pinsWhole: pins.scrollHeight <= pins.clientHeight + 1};
  }), {position: 'sticky', footInWindow: true, pinsWhole: true}, 'a connected rail stays in view in a 640px window and fits it');
  await page.setViewportSize({width: 1440, height: 1000});
  await open('Devices'); await category('Displays');

  // From here to the reload nothing opens a page, so any command, sync, upload or provider request would be the rail's own.
  const railWrites = recordWrites();
  await page.setViewportSize({width: 1024, height: 1000});
  assert.equal(await railWidth(), 64, 'a narrower window starts with the icon rail, with no wait for a script');
  assert.deepEqual(await destinationNames(page), FIVE, 'the icon rail keeps every destination name');
  assert.equal(await rooms.locator('.rail-text').evaluate(element => getComputedStyle(element).opacity), '0', 'an icon-rail name is hidden until it is asked for');
  await rooms.hover();
  await page.waitForFunction(() => {const name = document.querySelector('.primary-navigation a:hover .rail-text'); return name !== null && getComputedStyle(name).opacity === '1';});
  assert.equal(await rooms.evaluate(element => (element.querySelector('.rail-text')?.getBoundingClientRect().left ?? 0) >= element.getBoundingClientRect().right), true, 'the name opens beside the icon, outside the rail');
  await page.mouse.move(600, 500);
  // The jump field sits between the toggle and the destinations, so Tab from it lands on Home.
  await page.locator('.rail-jump').focus(); await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => {
    const link = document.activeElement;
    if (link === null || link.closest('.primary-navigation') === null) return 'focus is not on a destination';
    const name = link.querySelector('.rail-text');
    return name !== null && link.matches(':focus-visible') ? getComputedStyle(name).opacity : 'no visible keyboard focus';
  }), '1', 'a keyboard-focused icon shows its name');
  assert.equal(await page.getByText('Control enabled · Local', {exact: true}).isVisible(), true, 'the control mode stays readable to assistive technology');
  await toggle.click();
  assert.equal(await railState(), 'expanded');
  assert.equal(await toggle.getAttribute('aria-label'), 'Collapse navigation');
  assert.deepEqual(JSON.parse(await page.evaluate(key => localStorage.getItem(key), RAIL_PREFERENCE_KEY) ?? 'null'), {wide: null, narrow: true});
  assert.deepEqual(railWrites.stop(), [], 'resizing, hovering, focusing and toggling the rail send no command, sync, upload or provider request');
  await page.reload(); await feed(page, 'connected');
  assert.equal(await railState(), 'expanded', 'the choice for a narrower window survives a reload');
  await page.setViewportSize({width: 1440, height: 1000});
  assert.equal(await railState(), 'expanded', 'the wide window keeps its own default');
  await toggle.click();
  assert.equal(await railState(), 'collapsed');
  await page.setViewportSize({width: 1024, height: 1000});
  assert.equal(await railState(), 'expanded', 'the narrower window still has its own choice');
  assert.deepEqual(JSON.parse(await page.evaluate(key => localStorage.getItem(key), RAIL_PREFERENCE_KEY) ?? 'null'), {wide: false, narrow: true}, 'each window size keeps its own choice');
  // Refused storage leaves the toggle working for this page.
  await page.evaluate(key => {
    const set = Storage.prototype.setItem.bind(localStorage);
    Storage.prototype.setItem = function(name: string, value: string): void {if (name === key) throw new DOMException('Synthetic storage refusal', 'QuotaExceededError'); set(name, value);};
  }, RAIL_PREFERENCE_KEY);
  await toggle.click();
  assert.equal(await railState(), 'collapsed', 'a refused save still collapses the rail on this page');
  await page.evaluate(key => {localStorage.removeItem(key);}, RAIL_PREFERENCE_KEY);
  await page.setViewportSize({width: 1440, height: 1000});
  await page.reload(); await feed(page, 'connected');
  assert.equal(await railState(), 'expanded');
  checks.push('the rail holds Settings and the feed, stays in view, collapses to named icons and remembers a choice per window size');

  // On a phone the rail is a drawer behind the menu button.
  await page.setViewportSize({width: 390, height: 844});
  const menu = page.getByRole('button', {name: 'Open navigation', exact: true}), drawer = page.locator('.shell>aside');
  await menu.waitFor();
  const drawerWrites = recordWrites();
  assert.equal(await drawer.isVisible(), false, 'the drawer starts closed');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await menu.click();
  await drawer.waitFor();
  assert.equal(await menu.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(await destinationNames(page), FIVE);
  assert.equal(await drawer.evaluate(element => element.contains(document.activeElement)), true, 'opening moves focus into the drawer');
  assert.equal(await page.locator('#main').evaluate(element => element.hasAttribute('inert')), true, 'the page behind the open drawer is inert');
  assert.equal(await skip.evaluate(element => element.hasAttribute('inert')), true, 'the skip link, hidden behind the drawer, leaves the tab order');
  assert.equal(await page.getByRole('navigation', {name: 'Utilities'}).getByRole('link', {name: 'Settings', exact: true}).isVisible(), true);
  await page.keyboard.press('Escape');
  await drawer.waitFor({state: 'hidden'});
  assert.equal(await menu.evaluate(element => element === document.activeElement), true, 'Escape returns focus to the menu button');
  assert.equal(await page.locator('#main').evaluate(element => element.hasAttribute('inert')), false);
  // A drawer left open does not come back when the window widens and narrows again.
  await menu.click(); await drawer.waitFor();
  await page.setViewportSize({width: 1024, height: 844});
  await page.waitForFunction(() => document.querySelector('.shell')?.hasAttribute('data-drawer') !== true);
  assert.equal(await page.locator('#main').evaluate(element => element.hasAttribute('inert')), false, 'widening the window releases the page');
  await page.setViewportSize({width: 390, height: 844});
  assert.equal(await drawer.isVisible(), false);
  await menu.click(); await drawer.waitFor();
  await page.locator('.rail-scrim').click({position: {x: 370, y: 400}});
  await drawer.waitFor({state: 'hidden'});
  assert.equal(await menu.evaluate(element => element === document.activeElement), true, 'an outside tap returns focus to the menu button');
  await menu.click(); await drawer.waitFor();
  await primary.getByRole('link', {name: 'Rooms', exact: true}).click();
  await page.getByRole('region', {name: 'Rooms', exact: true}).waitFor();
  await drawer.waitFor({state: 'hidden'});
  assert.equal(await menu.getAttribute('aria-expanded'), 'false', 'choosing a destination closes the drawer');
  assert.equal(await menu.evaluate(element => element === document.activeElement), true, 'a chosen destination returns focus to the menu button');
  // A short phone keeps the drawer a fixed panel; the short-window rule is for the desktop rail only. Its foot is at
  // the drawer's end, which a window shorter than the drawer's content reaches by scrolling the drawer.
  await page.setViewportSize({width: 390, height: 520});
  await menu.click(); await drawer.waitFor();
  assert.deepEqual(await drawer.evaluate(element => {
    element.scrollTo(0, element.scrollHeight);
    const foot = element.querySelector('.sidebar-foot')?.getBoundingClientRect(), pins = element.querySelector('.rail-pins');
    return {position: getComputedStyle(element).position, fullHeight: Math.round(element.getBoundingClientRect().height) === innerHeight,
      footAtEnd: foot !== undefined && innerHeight - foot.bottom >= 0 && innerHeight - foot.bottom <= 16, pinsWhole: pins !== null && pins.scrollHeight <= pins.clientHeight + 1};
  }), {position: 'fixed', fullHeight: true, footAtEnd: true, pinsWhole: true}, 'a short phone drawer is a fixed panel with its foot at its end and its pinned pages not squeezed');
  await page.keyboard.press('Escape');
  await drawer.waitFor({state: 'hidden'});
  // In the narrowest drawer the feed details open above the foot and fit inside it.
  await page.setViewportSize({width: 320, height: 844});
  await menu.click(); await drawer.waitFor();
  await indicator.focus();
  await page.getByRole('tooltip').filter({hasText: 'Control enabled'}).waitFor();
  assert.equal(await drawer.evaluate(element => element.scrollWidth <= element.clientWidth), true, 'the feed details fit inside the 320px drawer');
  await page.keyboard.press('Escape');
  await drawer.waitFor({state: 'hidden'});
  assert.deepEqual(drawerWrites.stop(), [], 'the drawer sends no command, sync, upload or provider request');
  checks.push('the phone drawer opens from the menu button and closes on Escape, an outside tap and a chosen destination, with focus back on the button');

  // An ended session keeps its recovery in view: the full rail at a desktop width, and the bar on a phone.
  await page.setViewportSize({width: 1024, height: 1000});
  await world.restart();
  await feed(page, 'ended');
  const again = page.getByRole('button', {name: 'Sign in again', exact: true});
  await again.waitFor();
  assert.equal(await railWidth(), 184, 'an ended session shows the full rail where the icon rail is the default');
  assert.equal(await toggle.isDisabled(), true);
  assert.equal(await again.evaluate(element => element.getBoundingClientRect().bottom <= innerHeight + 1), true, 'the recovery is inside the rail and the window');
  await page.setViewportSize({width: 1024, height: 500});
  await again.scrollIntoViewIfNeeded();
  assert.equal(await again.evaluate(element => {const box = element.getBoundingClientRect(); return box.top >= -1 && box.bottom <= innerHeight + 1;}), true, 'a window too short for the rail can scroll the recovery into view');
  // With the pinned pages the ended rail needs about 648px: a 640px window lets it scroll too, and a 660px one holds it.
  await page.setViewportSize({width: 1024, height: 640});
  assert.equal(await page.locator('.shell>aside').evaluate(element => getComputedStyle(element).position), 'static', 'an ended rail scrolls with the page in a 640px window');
  await again.scrollIntoViewIfNeeded();
  assert.equal(await again.evaluate(element => {const box = element.getBoundingClientRect(); return box.top >= -1 && box.bottom <= innerHeight + 1;}), true, 'a 640px window can scroll the recovery into view');
  await page.setViewportSize({width: 1024, height: 660});
  await page.evaluate(() => {window.scrollTo(0, 0);});
  assert.equal(await page.locator('.shell>aside').evaluate(element => getComputedStyle(element).position), 'sticky');
  assert.equal(await again.evaluate(element => element.getBoundingClientRect().bottom <= innerHeight + 1), true, 'a 660px window holds the whole ended rail');
  await page.setViewportSize({width: 390, height: 844});
  assert.equal(await drawer.isVisible(), false);
  assert.equal(await again.count(), 1, 'a phone offers one recovery action');
  assert.equal(await again.isVisible(), true, 'the phone bar offers the recovery without opening the drawer');
  await menu.click(); await drawer.waitFor();
  assert.equal(await drawer.getByRole('button', {name: 'Sign in again', exact: true}).isVisible(), true, 'the open drawer offers the recovery itself');
  assert.equal(await page.locator('.phone-sign-in').evaluate(element => element.hasAttribute('inert')), true, 'the copy under the open drawer leaves the tab order');
  await page.keyboard.press('Escape');
  await drawer.waitFor({state: 'hidden'});
  await again.click();
  await feed(page, 'connected');
  await page.setViewportSize({width: 1440, height: 1000});
  checks.push('an ended session shows the full rail, and its recovery on a phone without opening the drawer');

  // The journey above runs with reduced motion. With motion allowed, the drawer's slide and its delayed hiding still finish.
  const moving = await browser.newContext({viewport: {width: 390, height: 844}});
  try {
    const phone = await moving.newPage();
    phone.setDefaultTimeout(15_000);
    await phone.goto(world.url); await feed(phone, 'connected');
    const sliding = phone.locator('.shell>aside'), opener = phone.getByRole('button', {name: 'Open navigation', exact: true});
    await opener.click();
    await sliding.waitFor();
    await phone.waitForFunction(() => Math.abs(document.querySelector('.shell>aside')?.getBoundingClientRect().left ?? -1) < 1);
    await phone.keyboard.press('Escape');
    await sliding.waitFor({state: 'hidden'});
    assert.equal(await opener.evaluate(element => element === document.activeElement), true);
  } finally {
    await moving.close();
  }
  checks.push('with motion allowed the drawer slides fully open and hides after it closes');

  // The jump palette (#1888): Command or Control and K anywhere, or a slash outside a text field. It only navigates.
  // It is opened here on the Devices directory, which mounts no module page, so any write would be the palette's own.
  await open('Home'); await open('Devices');
  await page.getByRole('heading', {name: 'Devices', level: 1, exact: true}).waitFor();
  const palette = page.getByRole('dialog', {name: 'Jump to a page', exact: true}), jumpField = palette.getByRole('combobox', {name: 'Jump to a page', exact: true});
  const jumpOptions = palette.getByRole('option'), devicesLink = primary.getByRole('button', {name: 'Devices', exact: true});
  const inert = (selector: string): Promise<boolean> => page.locator(selector).evaluate(element => element.hasAttribute('inert'));
  const jumpWrites = recordWrites();
  await devicesLink.focus();
  await page.keyboard.press('Control+k');
  await palette.waitFor();
  assert.equal(await jumpField.evaluate(element => element === document.activeElement), true, 'the palette opens with focus in its field');
  assert.deepEqual([await inert('#main'), await inert('.shell>aside')], [true, true], 'the page and the rail behind the palette are inert');
  assert.deepEqual(await palette.locator('.jump-group').allTextContents(), ['Recent', 'Hub', 'Device pages']);
  const offered = await jumpOptions.allTextContents();
  assert.equal(offered[0], 'Home', 'the page just left is the first recent entry');
  assert.equal(offered.includes('LIFXLighting'), true, 'a declared device page is offered with its category');
  assert.equal(offered.filter(text => text === 'Settings').length, 1, 'a hub destination is offered once');
  assert.equal(await jumpOptions.first().getAttribute('aria-selected'), 'true');
  await page.keyboard.press('ArrowDown');
  assert.equal(await jumpOptions.nth(1).getAttribute('aria-selected'), 'true', 'the arrow keys move the choice');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  assert.equal(await jumpOptions.last().getAttribute('aria-selected'), 'true', 'the choice wraps at the ends');
  // The chosen row has a boundary that stands out from the panel and from the row's own tint, in both themes.
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({colorScheme});
    const row = await palette.locator('.jump-option[aria-selected=true]').evaluate(element => {
      const panel = element.closest('.jump-palette');
      if (panel === null) throw new Error('The chosen row is inside the palette.');
      return {edge: getComputedStyle(element).borderLeftColor, tint: getComputedStyle(element).backgroundColor, panel: getComputedStyle(panel).backgroundColor};
    });
    const boundary = Math.min(contrastRatio(row.edge, row.panel), contrastRatio(row.edge, row.tint));
    assert(boundary >= 3, `${colorScheme} chosen row boundary has 3:1 contrast: ${String(boundary)}`);
  }
  // A list scrolled by touch or wheel stays where it was put. The first row is chosen and then scrolled out of view,
  // as a finger would leave it; a change of the saved rail choice from another tab then renders the whole shell twice.
  const jumpList = palette.getByRole('listbox');
  await page.keyboard.press('ArrowDown');
  assert.equal(await jumpOptions.first().getAttribute('aria-selected'), 'true');
  assert.equal(await jumpList.evaluate(element => element.scrollTop), 0, 'the first choice shows the list from its top, with its group heading');
  await jumpList.evaluate(element => {element.scrollTo(0, 400);});
  const scrolledTo = await jumpList.evaluate(element => element.scrollTop);
  assert.equal(scrolledTo >= 300, true, `the list is long enough to scroll: ${String(scrolledTo)}`);
  const savedRail = await page.evaluate(key => localStorage.getItem(key), RAIL_PREFERENCE_KEY);
  for (const newValue of ['{"wide":false,"narrow":true}', savedRail]) {
    await page.evaluate(({key, value}) => {window.dispatchEvent(new StorageEvent('storage', {key, newValue: value}));}, {key: RAIL_PREFERENCE_KEY, value: newValue});
    await page.waitForFunction(width => Math.round(document.querySelector('.shell>aside')?.getBoundingClientRect().width ?? 0) === width, newValue === savedRail ? 184 : 64);
  }
  assert.equal(await jumpList.evaluate(element => element.scrollTop), scrolledTo, 'a scrolled list is not pulled back to the choice when the shell renders');
  // The keys still bring the choice into view.
  await page.keyboard.press('ArrowDown');
  assert.equal(await jumpOptions.nth(1).evaluate(element => {
    const row = element.getBoundingClientRect(), list = element.closest('.jump-list')?.getBoundingClientRect();
    return list !== undefined && row.top >= list.top - 1 && row.bottom <= list.bottom + 1;
  }), true, 'a choice moved with the keys is scrolled into view');
  await page.keyboard.press('ArrowUp');
  assert.equal(await jumpList.evaluate(element => element.scrollTop), 0);
  // A press on a part of the palette that is not a row leaves focus in the field, and the list is not a Tab stop.
  await palette.locator('.jump-group').first().click();
  await palette.locator('.jump-foot').click();
  assert.equal(await jumpField.evaluate(element => element === document.activeElement), true, 'a press on a heading or the footer leaves focus in the field');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.closest('.jump-list, #main, .shell>aside, .phone-bar') === null), true, 'Tab reaches neither the list nor anything behind the palette');
  // Wherever focus went, the palette still owns its keys, and typing goes to the field.
  await page.evaluate(() => {if (document.activeElement instanceof HTMLElement) document.activeElement.blur();});
  await page.keyboard.press('ArrowDown');
  assert.equal(await jumpOptions.nth(1).getAttribute('aria-selected'), 'true', 'the arrow keys work with focus outside the field');
  await page.keyboard.type('s');
  assert.equal(await jumpField.inputValue(), 's', 'a typed character goes to the field');
  assert.equal(await jumpField.evaluate(element => element === document.activeElement), true);
  await jumpField.fill('sign');
  const narrowed = await jumpOptions.allTextContents();
  assert.equal(narrowed.length > 0 && narrowed.length < offered.length && narrowed.every(text => /sign/i.test(text)) && narrowed.some(text => text.includes('Sign preview')), true,
    `typing narrows the list to matching pages: ${narrowed.join(' | ')}`);
  assert.equal(await palette.locator('.jump-group').count(), 0, 'a narrowed list has no group headings');
  await jumpField.fill('no such page');
  await palette.getByText('No page matches “no such page”.', {exact: true}).waitFor();
  assert.equal(await jumpOptions.count(), 0);
  // Escape closes it with focus outside the field too.
  await page.evaluate(() => {if (document.activeElement instanceof HTMLElement) document.activeElement.blur();});
  await page.keyboard.press('Escape');
  await palette.waitFor({state: 'detached'});
  await page.waitForFunction(() => document.activeElement?.textContent === 'Devices' && document.activeElement.closest('.primary-navigation') !== null);
  assert.deepEqual([await inert('#main'), await inert('.shell>aside')], [false, false], 'closing releases the page and returns focus to where it was');
  await page.keyboard.press('Meta+k');
  await palette.waitFor();
  await page.keyboard.press('Meta+k');
  await palette.waitFor({state: 'detached'});
  // A click outside the palette closes it as well.
  await page.keyboard.press('Control+k');
  await palette.waitFor();
  // The click is aimed at the rail's Home link, which the scrim covers, so the link is not followed.
  const homeBox = await primary.getByRole('link', {name: 'Home', exact: true}).boundingBox();
  assert.ok(homeBox !== null);
  const behind = {x: homeBox.x + homeBox.width / 2, y: homeBox.y + homeBox.height / 2};
  assert.equal(await page.evaluate(({x, y}) => document.elementFromPoint(x, y)?.className, behind), 'jump-scrim', 'the scrim covers what is behind the palette');
  await page.mouse.click(behind.x, behind.y);
  await palette.waitFor({state: 'detached'});
  assert.equal(await devicesLink.evaluate(element => element === document.activeElement), true, 'a click outside closes the palette and returns focus');
  assert.equal(new URL(page.url()).hash, '#/devices', 'the click outside reaches nothing behind the palette');
  await page.keyboard.press('/');
  await palette.waitFor();
  assert.deepEqual(jumpWrites.stop(), [], 'opening, moving, typing and closing send no command, sync, upload or provider request');
  await jumpField.fill('conn');
  assert.equal((await jumpOptions.allTextContents())[0], 'ConnectionsSettings', 'a name that starts with the query comes first');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', {name: 'Connections', level: 1, exact: true}).waitFor();
  await palette.waitFor({state: 'detached'});
  assert.equal(new URL(page.url()).hash, '#/connections');
  await page.waitForFunction(() => document.activeElement?.id === 'main');
  // A page opened from the palette opens at its top. As in the rail's check, Settings is scrolled first in a 1024x640
  // window and Home is taller than that window, so it could have opened scrolled.
  await page.setViewportSize({width: 1024, height: 640});
  await settings();
  await page.getByRole('heading', {name: 'Settings', level: 1, exact: true}).waitFor();
  await page.evaluate(() => {window.scrollTo(0, document.documentElement.scrollHeight);});
  assert.equal(await page.evaluate(() => scrollY > 100), true, 'Settings is scrolled before the jump');
  await page.keyboard.press('Control+k');
  await palette.waitFor();
  await jumpField.fill('home');
  assert.equal((await jumpOptions.allTextContents())[0], 'Home');
  await page.keyboard.press('Enter');
  await page.getByRole('button', {name: 'Edit Home', exact: true}).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight > 100), true, 'Home is taller than the window, so it could have opened scrolled');
  assert.equal(await page.evaluate(() => scrollY), 0, 'a page opened from the palette opens at its top');
  await page.waitForFunction(() => document.activeElement?.id === 'main');
  await page.setViewportSize({width: 1440, height: 1000});
  // The browser's back button changes the page under an open palette, and the palette closes. This is outside the
  // window that records writes, because the page it returns to reads its copies when it mounts.
  await page.keyboard.press('Control+k');
  await palette.waitFor();
  await page.goBack();
  await page.getByRole('heading', {name: 'Settings', level: 1, exact: true}).waitFor();
  await palette.waitFor({state: 'detached'});
  assert.deepEqual([await inert('#main'), await inert('.shell>aside')], [false, false], 'the page is released when the palette closes on a page change');
  await page.goForward();
  await page.getByRole('button', {name: 'Edit Home', exact: true}).waitFor();
  // The palette is drawn above the full-window visualizer, and Escape closes the palette, not the visualizer.
  await page.goto(`${world.url}/#/audio/visualizer`); await feed(page, 'connected');
  const exitFull = page.getByRole('button', {name: 'Exit full view', exact: true});
  await exitFull.waitFor();
  await page.keyboard.press('Control+k');
  await palette.waitFor();
  // The page is inert under the palette, so hit testing cannot tell which of the two is drawn on top. Their stacking
  // levels can: the palette and its scrim are above every level used inside the page, the visualizer's included.
  assert.deepEqual(await palette.evaluate(element => {
    const level = (node: Element): number => {const value = Number(getComputedStyle(node).zIndex); return Number.isNaN(value) ? 0 : value;};
    const scrim = document.querySelector('.jump-scrim'), full = document.querySelector('.music-visualizer-full');
    if (scrim === null || full === null) throw new Error('The scrim and the full-window visualizer must be present.');
    const page = Math.max(...[...document.querySelectorAll('#main *')].map(level));
    return {visualizerIsTopOfPage: level(full) === page && getComputedStyle(full).position === 'fixed', scrimAbovePage: level(scrim) > page, paletteAboveScrim: level(element) > level(scrim),
      siblings: element.parentElement === scrim.parentElement && element.parentElement === document.querySelector('#main')?.parentElement};
  }), {visualizerIsTopOfPage: true, scrimAbovePage: true, paletteAboveScrim: true, siblings: true}, 'the palette is drawn above the full-window visualizer');
  await page.keyboard.press('Escape');
  await palette.waitFor({state: 'detached'});
  assert.equal(await exitFull.isVisible() && new URL(page.url()).hash === '#/audio/visualizer', true, 'Escape closes the palette and leaves the visualizer open');
  // In the browser's full-screen mode only the full-screen element is drawn, so the palette's keys do nothing there.
  await page.evaluate(() => {Object.defineProperty(document, 'fullscreenElement', {configurable: true, get: () => document.body});});
  await page.keyboard.press('Control+k');
  await page.keyboard.press('/');
  assert.equal(await palette.count(), 0, 'the palette stays closed while an element is full screen');
  await page.evaluate(() => {Reflect.deleteProperty(document, 'fullscreenElement');});
  await page.keyboard.press('/');
  await palette.waitFor();
  await page.keyboard.press('Escape');
  await palette.waitFor({state: 'detached'});
  // A slash pressed on a slider is not text, so it opens the palette there, and closing returns focus to the slider.
  await page.goto(`${world.url}/#/component/pendant-1`); await feed(page, 'connected');
  const slider = page.getByRole('slider').first();
  await slider.focus();
  await page.keyboard.press('/');
  await palette.waitFor();
  await page.keyboard.press('Escape');
  await palette.waitFor({state: 'detached'});
  assert.equal(await slider.evaluate(element => element === document.activeElement), true, 'a slash on a slider opens the palette, and closing returns focus to the slider');
  // A slash typed into a field is text.
  await open('Home');
  const find = page.getByPlaceholder('Find a session');
  await find.click();
  await page.keyboard.press('/');
  assert.equal(await find.inputValue(), '/');
  assert.equal(await palette.count(), 0, 'a slash typed into a field does not open the palette');
  await find.fill('');
  // A held Enter opens the palette from the rail's field and does not also choose a row.
  const beforeHeld = new URL(page.url()).hash;
  await page.locator('.rail-jump').focus();
  await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await palette.waitFor();
  assert.equal(new URL(page.url()).hash, beforeHeld, 'a held Enter opens the palette and chooses nothing');
  await page.keyboard.press('Escape');
  await palette.waitFor({state: 'detached'});
  // The rail's field opens it too, and an option can be clicked.
  await page.locator('.rail-jump').click();
  await palette.waitFor();
  // Rooms can be listed twice here, as a recent page and as a hub destination; either opens it.
  await jumpOptions.filter({hasText: /^Rooms$/}).last().click();
  await page.getByRole('region', {name: 'Rooms', exact: true}).waitFor();
  await palette.waitFor({state: 'detached'});
  // On a phone the bar's search button opens it, and it fits the window.
  for (const width of [390, 320]) {
    await page.setViewportSize({width, height: 844});
    await page.locator('.phone-bar').getByRole('button', {name: 'Jump to a page', exact: true}).click();
    await palette.waitFor();
    assert.equal(await palette.evaluate(element => {const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight && document.documentElement.scrollWidth <= innerWidth;}), true,
      `the palette fits a ${String(width)}px window`);
    await page.keyboard.press('Escape');
    await palette.waitFor({state: 'detached'});
    await page.waitForFunction(() => document.activeElement?.classList.contains('phone-jump') === true);
  }
  // The drawer's own field opens it as well. The drawer closes underneath, so focus returns to the menu button.
  await page.getByRole('button', {name: 'Open navigation', exact: true}).click();
  assert.equal(await page.locator('.rail-head .brand').evaluate(element => Math.round(element.getBoundingClientRect().left)), 22, 'the drawer\'s brand keeps its inset');
  await page.locator('.shell>aside .rail-jump').click();
  await palette.waitFor();
  await page.locator('.shell>aside').waitFor({state: 'hidden'});
  await page.keyboard.press('Escape');
  await palette.waitFor({state: 'detached'});
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Open navigation');
  assert.equal(await page.locator('.shell').getAttribute('data-drawer'), null, 'the drawer stays closed after the palette');
  await page.setViewportSize({width: 1440, height: 1000});
  // The list follows the catalog the page holds: once the catalog reports a module as stopped, its pages are not offered.
  await page.route('**/api/v2/modules', async route => {
    const response = await route.fetch();
    const catalog = await response.json() as {modules: {name: string; state: string}[]};
    await route.fulfill({response, json: {...catalog, modules: catalog.modules.map(module => module.name === 'sign' ? {...module, state: 'stopped'} : module)}});
  });
  await page.reload(); await feed(page, 'connected');
  await page.keyboard.press('Control+k');
  await palette.waitFor();
  // The list fills as the catalog and the device copies arrive after the reload; wait for a declared page and a device entry.
  await jumpOptions.filter({hasText: 'Pixoo · Playlists'}).waitFor();
  await jumpOptions.filter({hasText: /^LIFXLighting$/}).waitFor();
  const afterStop = await jumpOptions.allTextContents();
  assert.equal(offered.some(text => text.includes('Sign preview')) && !afterStop.some(text => /sign/i.test(text)), true, `a stopped module's pages are not offered: ${afterStop.join(' | ')}`);
  assert.equal(afterStop.includes('LIFXLighting') && afterStop.includes('Home'), true, 'the other pages are still offered');
  await page.keyboard.press('Escape');
  await palette.waitFor({state: 'detached'});
  await page.unroute('**/api/v2/modules');
  await page.reload(); await feed(page, 'connected');
  checks.push('the jump palette opens from the keyboard, the rail and the phone bar, narrows as typed, follows the catalog, opens a page and closes with focus restored, sending nothing');

  for (const address of ['#/component/pendant-1', signAddress, '#/connections']) {
    assert.notEqual(address, null);
    await page.goto(`${world.url}/${address ?? ''}`); await feed(page, 'connected');
    assert.equal(await page.getByText('Nothing at this address', {exact: true}).count(), 0);
  }
  for (const address of ['#/component/devices', '#/component/settings', '#/missing-page']) {
    await page.goto(`${world.url}/${address}`); await feed(page, 'connected');
    await page.getByRole('region', {name: 'Not found'}).waitFor();
    assert.equal(await page.getByRole('heading', {level: 1, name: /^(Devices|Settings)$/}).count(), 0);
  }
  checks.push('legacy bookmarks and component aliases stay distinct from landing routes');

  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({width, height: 1000});
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({colorScheme, reducedMotion: 'reduce'});
      for (const destination of ['Home', 'Rooms', 'Devices', 'Automation', 'Settings']) {
        if (destination === 'Settings') await settings(); else await open(destination);
        if (destination === 'Devices') await category('Displays');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${destination} fits ${width}px ${colorScheme}`);
        if (receipts !== undefined && (width === 390 || width === 1440)) await page.screenshot({path: join(receipts, `shell-${destination.toLowerCase()}-${width}-${colorScheme}.png`), fullPage: true});
      }
    }
  }
  checks.push('desktop and 320/390px light/dark pages fit');

  await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
  await page.goto(`${world.url}/#/component/pendant-1`); await page.reload(); await feed(page, 'connected');
  const card = page.locator('[data-device=pendant-1]');
  await card.getByText('Your session is read-only.').waitFor();
  assert.equal(await card.getByRole('button').count(), 0);
  await open('Devices'); await category('Other');
  await page.getByRole('link', {name: 'Sign preview', exact: true}).waitFor();
  await page.route('**/api/v2/modules', route => route.fulfill({status: 503, contentType: 'application/json', body: '{"error":{"code":"unavailable","retryable":true}}'}));
  await page.reload(); await feed(page, 'connected');
  await page.getByRole('alert').filter({hasText: 'The module catalog is unavailable.'}).waitFor();
  assert.equal(await page.getByRole('region', {name: 'Devices', exact: true}).getByRole('link').count(), 0, 'a failed catalog invents no destinations');
  assert.deepEqual(sent, [], 'all navigation, inspection and read-only recovery remain passive');
  assert.deepEqual(errors, []);
  checks.push('read-only card and directory preserve capability guards with zero command attempts');
  console.log(JSON.stringify({journey: 'cleaner-shell', checks, commands: sent.length, errors}));
} finally {
  await context.close(); await browser.close(); await world.close();
}
