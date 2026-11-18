// The real runtime shell over synthetic owners; navigation never sends a device command.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {changes, feed, startWorld} from './harness.ts';
import {destinationLink, openSettings} from './navigation-helpers.ts';
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
const open = async (name: string): Promise<void> => {await (await destinationLink(page, name)).click();};
const settings = async (): Promise<void> => {await openSettings(page);};
const railWidth = (): Promise<number> => page.locator('.shell>aside').evaluate(element => Math.round(element.getBoundingClientRect().width));
// The stylesheet decides the rail's state from the window width, so it is read from the layout with no wait after a resize.
const railState = async (): Promise<string> => {const width = await railWidth(); return width === 184 ? 'expanded' : width === 64 ? 'collapsed' : `unexpected ${String(width)}px`;};
const FIVE = ['Home', 'Habitat', 'Rooms', 'Devices', 'Automation'];
const category = async (name: string): Promise<void> => {await page.getByRole('group', {name: 'Device categories'}).getByRole('button', {name, exact: true}).click();};
const checks: string[] = [];
try {
  await page.goto(world.url); await feed(page, 'connected');
  assert.deepEqual(await primary.getByRole('link').allTextContents(), ['Home', 'Habitat', 'Rooms', 'Devices', 'Automation']);
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

  const devices = primary.getByRole('link', {name: 'Devices', exact: true});
  assert.equal(await devices.getAttribute('href'), '#/devices', 'navigation retains a native hash anchor');
  const modifiedClicks = await devices.evaluate(element => ['ctrlKey', 'metaKey', 'shiftKey', 'altKey'].map(key => {
    let prevented = false;
    // Observe the real React handler, then suppress only the browser default so
    // this check does not depend on headless-window/tab creation policy.
    document.addEventListener('click', event => {prevented = event.defaultPrevented; event.preventDefault();}, {once: true});
    element.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, [key]: true}));
    return prevented;
  }));
  assert.deepEqual(modifiedClicks, [false, false, false, false], 'modified clicks remain native rather than intercepted by the shell');
  await devices.focus();
  assert.equal(await devices.evaluate(element => {const style = getComputedStyle(element); return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 2;}), true, 'keyboard focus remains visible');
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
  const order = await page.evaluate(() => {
    const rail = document.querySelector('.shell>aside'), main = rail?.querySelector('nav[aria-label="Main navigation"]'), utilities = rail?.querySelector('nav[aria-label="Utilities"]');
    if (rail === null || rail === undefined || main === null || main === undefined || utilities === null || utilities === undefined) throw new Error('The rail holds both navigation groups.');
    const box = rail.getBoundingClientRect(), settingsBox = utilities.getBoundingClientRect();
    return {after: (main.compareDocumentPosition(utilities) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0, inView: box.top === 0 && box.bottom <= innerHeight && settingsBox.bottom <= innerHeight,
      status: rail.querySelector('.sidebar-foot')?.textContent ?? ''};
  });
  assert.deepEqual({after: order.after, inView: order.inView}, {after: true, inView: true}, 'Settings follows the destinations and the rail fits the window');
  assert.match(order.status, /Control enabled · Local/, 'the control mode is stated beside the feed');
  await open('Devices'); await category('Displays');
  await page.evaluate(() => {window.scrollTo(0, document.documentElement.scrollHeight);});
  assert.equal(await page.locator('.shell>aside').evaluate(element => element.getBoundingClientRect().top), 0, 'the rail stays in view while the page scrolls');
  await page.evaluate(() => {window.scrollTo(0, 0);});

  await page.setViewportSize({width: 1024, height: 1000});
  assert.equal(await railWidth(), 64, 'a narrower window starts with the icon rail, with no wait for a script');
  assert.deepEqual(await primary.getByRole('link').allTextContents(), FIVE, 'the icon rail keeps every destination name');
  const rooms = primary.getByRole('link', {name: 'Rooms', exact: true});
  assert.equal(await rooms.locator('.rail-text').evaluate(element => getComputedStyle(element).opacity), '0', 'an icon-rail name is hidden until it is asked for');
  await rooms.hover();
  await page.waitForFunction(() => {const name = document.querySelector('.primary-navigation a:hover .rail-text'); return name !== null && getComputedStyle(name).opacity === '1';});
  assert.equal(await rooms.evaluate(element => (element.querySelector('.rail-text')?.getBoundingClientRect().left ?? 0) >= element.getBoundingClientRect().right), true, 'the name opens beside the icon, outside the rail');
  assert.equal(await page.getByText('Control enabled · Local', {exact: true}).isVisible(), true, 'the control mode stays readable to assistive technology');
  await toggle.click();
  assert.equal(await railState(), 'expanded');
  assert.equal(await toggle.getAttribute('aria-label'), 'Collapse navigation');
  assert.deepEqual(JSON.parse(await page.evaluate(key => localStorage.getItem(key), RAIL_PREFERENCE_KEY) ?? 'null'), {wide: null, narrow: true});
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
  assert.equal(await drawer.isVisible(), false, 'the drawer starts closed');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await menu.click();
  await drawer.waitFor();
  assert.equal(await menu.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(await primary.getByRole('link').allTextContents(), FIVE);
  assert.equal(await drawer.evaluate(element => element.contains(document.activeElement)), true, 'opening moves focus into the drawer');
  assert.equal(await page.locator('#main').evaluate(element => element.hasAttribute('inert')), true, 'the page behind the open drawer is inert');
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
  await menu.click(); await drawer.waitFor();
  await primary.getByRole('link', {name: 'Rooms', exact: true}).click();
  await page.getByRole('region', {name: 'Rooms', exact: true}).waitFor();
  await drawer.waitFor({state: 'hidden'});
  assert.equal(await menu.getAttribute('aria-expanded'), 'false', 'choosing a destination closes the drawer');
  await page.setViewportSize({width: 1440, height: 1000});
  checks.push('the phone drawer opens from the menu button and closes on Escape, an outside tap and a chosen destination');

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
