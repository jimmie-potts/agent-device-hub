// The real runtime shell over synthetic owners; navigation never sends a device command.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium} from 'playwright';
import {changes, feed, startWorld} from './harness.ts';

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
const open = async (name: string): Promise<void> => {await primary.getByRole('link', {name, exact: true}).click();};
const settings = async (): Promise<void> => {await page.getByRole('navigation', {name: 'Utilities'}).getByRole('link', {name: 'Settings', exact: true}).click();};
const category = async (name: string): Promise<void> => {await page.getByRole('group', {name: 'Device categories'}).getByRole('button', {name, exact: true}).click();};
const checks: string[] = [];
try {
  await page.goto(world.url); await feed(page, 'connected');
  assert.deepEqual(await primary.getByRole('link').allTextContents(), ['Home', 'Rooms', 'Devices', 'Automation']);
  assert.equal(await primary.getByRole('link', {name: 'Settings'}).count(), 0);
  await page.locator('.light-bulb-glow').first().waitFor();
  // Axe does not check decorative illustration or selected-state boundary contrast.
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
  checks.push('four destinations, keyboard activation, brands, module pages, Audio and back history');

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
        const accessibility = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        assert.deepEqual(accessibility.violations.map(item => ({id: item.id, nodes: item.nodes.map(node => `${node.target.join(' ')}: ${node.failureSummary ?? ''}`)})), [], `${destination} ${width}px ${colorScheme}`);
        if (receipts !== undefined && (width === 390 || width === 1440)) await page.screenshot({path: join(receipts, `shell-${destination.toLowerCase()}-${width}-${colorScheme}.png`), fullPage: true});
      }
    }
  }
  checks.push('desktop and 320/390px light/dark pages fit and pass accessibility with reduced motion');

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
