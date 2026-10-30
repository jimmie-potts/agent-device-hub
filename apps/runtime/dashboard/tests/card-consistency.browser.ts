// Shared presentation on real runtime cards; every source and device here is synthetic.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium, type Page} from 'playwright';
import {approvalPrompt} from '../../dist/tests/fixtures/agents.js';
import {changes, feed, startWorld} from './harness.ts';

const world = await startWorld({lighting: true, pixooPages: true, tidbyt: true, onn: true, wemo: true,
  roborock: true, companions: true, wispr: {exposeToDashboard: true}});
const browser = await chromium.launch({headless: true});
const receipts = process.env.DASHBOARD_RECEIPTS;
const frames = [
  ['Hub mode', '.widget[data-widget="hub-mode"]'], ['Inbox', '.widget[data-widget="inbox"]'],
  ['Agent status', '.widget[data-widget="sessions"]'], ['Timeline', '.widget[data-widget="timeline"]'],
  ['MicroDuck', '.widget[data-widget="duck-latest"]'], ['Lights', '.light-card:not(.pixoo-card):not(.tidbyt-card)'],
  ['Room', '[data-home-card="light:room:studio"] .light-card'], ['Pixoo', '.pixoo-card'], ['Tidbyt', '.tidbyt-card'],
  ['Music', '.music-card'], ['Wemo', '.wemo-card'], ['Wispr', '.wispr-card'], ['ONN', '.onn-card'], ['Roborock', '.roborock-card'],
] as const;
const tabbed = [
  ['Lights', '.light-card:not(.pixoo-card):not(.tidbyt-card)', '.light-artwork', true],
  ['Pixoo', '.pixoo-card', '.pixoo-artwork', false], ['Tidbyt', '.tidbyt-card', '.tidbyt-artwork', false],
  ['Wemo', '.wemo-card', '.wemo-art', true], ['ONN', '.onn-card', '.onn-card-hero', true],
  ['Roborock', '.roborock-card', '.roborock-art', true],
] as const;
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));});
}
try {
  if (receipts !== undefined) await mkdir(receipts, {recursive: true});
  await world.observe({kind: 'session-started'}, {title: {value: 'Synthetic card comparison', source: 'provider'}});
  await world.observe(approvalPrompt('card-comparison-attention'));
  world.onnOnline(false);
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  const page = await context.newPage(); page.setDefaultTimeout(15_000);
  const errors: string[] = []; context.on('weberror', event => errors.push(event.error().name));
  await page.goto(world.url); await feed(page, 'connected');
  for (const selector of ['.roborock-card', '.onn-card', '.wispr-card', '.tidbyt-card', '.pixoo-card', '.wemo-card', '.music-card']) await page.locator(selector).first().waitFor();
  // Setup only: place empty optional cards and a room using the actual core metadata API.
  // No conversation/source is activated, and the command observer starts after fixture setup.
  const ids = await page.locator('[data-home-card]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-home-card') ?? ''));
  assert.equal(await page.evaluate(async initial => {
    const headers = {'content-type': 'application/json', 'bunny-request': '1'};
    const room = await fetch('/api/v2/commands/lighting-layout-set', {method: 'POST', headers, body: JSON.stringify({target: 'lighting', requestId: 'card-comparison-room',
      data: {expectedRevision: 0, layout: {rooms: [{id: 'studio', name: 'Studio'}], assignments: [], groups: [], home: null}}})});
    if (!room.ok) return room.status;
    const snapshot = await fetch('/api/v2/snapshot?families=home-layout&owner=bunny/core');
    const value = await snapshot.json() as {records: {'home-layout': {revision: number}[]}};
    const cards = [...new Set([...initial, 'timeline', 'duck-latest', 'light:room:studio'])].map(widget => ({widget, size: 'medium', hidden: false}));
    const saved = await fetch('/api/v2/commands/home-layout-set', {method: 'POST', headers, body: JSON.stringify({target: 'home', requestId: 'card-comparison-layout',
      data: {expectedRevision: value.records['home-layout'][0]?.revision ?? 0, layouts: {desktop: cards, phone: cards}}})});
    return saved.status;
  }, ids), 200);
  for (const [, selector] of frames) await page.locator(selector).first().waitFor();
  await page.locator('.agent-status-card[data-attention=true]').waitFor();
  await page.locator('.onn-card[data-state=unavailable]').waitFor();
  const sent = changes(page), metrics: unknown[] = [];
  const lamp = page.locator('[data-light-card="lamp-a"]').first();
  await lamp.getByRole('slider').waitFor();
  const brightnessNames = await lamp.getByRole('slider', {name: /^Brightness · (observed|requested)$/}).count();
  assert.match(await lamp.locator('output').innerText(), /%$/);
  await lamp.getByRole('tab', {name: 'Color', exact: true}).click();
  await lamp.getByRole('slider', {name: 'Saturation', exact: true}).waitFor();
  const temperatureNames = await lamp.getByRole('slider', {name: 'Temperature', exact: true}).count();
  assert.match(await lamp.locator('.light-slider').last().locator('output').innerText(), / K$/);
  assert.deepEqual({brightnessNames, temperatureNames}, {brightnessNames: 1, temperatureNames: 1}, 'shared sliders have meaningful names without their changing values');
  await lamp.getByRole('tab', {name: 'Power', exact: true}).click();
  const emptyRoom = page.locator('[data-home-card="light:room:studio"] .light-card');
  assert.equal(await emptyRoom.getByRole('slider', {name: 'Brightness · requested', exact: true}).isDisabled(), true, 'unknown and disabled values keep their label');
  assert.equal(await emptyRoom.locator('output').innerText(), 'Mixed / unknown');
  assert.deepEqual(sent, [], 'inspecting slider names and tabs sends no command');
  for (const width of [1440, 680, 390, 320]) for (const colorScheme of ['light', 'dark'] as const) {
    await page.setViewportSize({width, height: 1000}); await page.emulateMedia({colorScheme, reducedMotion: 'reduce'});
    await settle(page);
    const values = await Promise.all(frames.map(async ([name, selector]) => ({name, ...await page.locator(selector).first().evaluate(node => {
      const style = getComputedStyle(node);
      return {padding: style.paddingTop, radius: style.borderTopLeftRadius, background: style.backgroundColor, shadow: style.boxShadow,
        width: node.getBoundingClientRect().width, slotWidth: node.closest('.home-card-content')?.getBoundingClientRect().width};
    })})));
    metrics.push({width, colorScheme, frames: values});
    if (receipts !== undefined) {
      await writeFile(join(receipts, 'card-comparison-metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
      if (width === 1440 || width === 390) await page.screenshot({path: join(receipts, `cards-${width}-${colorScheme}.png`), fullPage: true});
      if (width === 390 && colorScheme === 'dark') for (const [name, selector] of frames) {
        await page.locator(selector).first().screenshot({path: join(receipts, `card-${name.toLowerCase().replaceAll(' ', '-')}.png`)});
      }
    }
    for (const value of values) {
      assert.equal(value.padding, width <= 680 ? '16px' : '24px', `${value.name} shares responsive card padding at ${width}px ${colorScheme}`);
      assert.equal(value.radius, values[0]?.radius, `${value.name} shares the outer glass frame`);
      assert.ok(value.slotWidth !== undefined && Math.abs(value.width - value.slotWidth) <= 1, `${value.name} fills its chosen Home slot: ${value.width}/${value.slotWidth ?? 'missing'}`);
    }
    const attention = await page.locator('.agent-status-card[data-attention=true]').first().evaluate(node => ({tile: getComputedStyle(node).backgroundColor,
      outer: getComputedStyle(node.closest('.widget') ?? node).backgroundColor}));
    assert.notEqual(attention.tile, attention.outer, 'shared chrome preserves the agent attention surface');
    const headings = await page.locator('.light-card-heading h3,.onn-card-identity h2,.wispr-card-identity h2,.hub-control-heading h2,.timeline-heading h2,.widget-head h2,.roborock-head h2,.wemo-heading>span:first-child,.agent-status-card .session-id h3')
      .evaluateAll(nodes => nodes.map(node => ({text: node.textContent, size: getComputedStyle(node).fontSize})));
    assert.ok(headings.length >= 10);
    for (const heading of headings) assert.equal(heading.size, headings[0]?.size, `${heading.text ?? 'Card title'} shares the title hierarchy`);
    const tabStyle = await page.locator('.light-tabs button').first().evaluate(node => ({font: getComputedStyle(node).fontSize, radius: getComputedStyle(node).borderTopLeftRadius}));
    for (const [name, selector, artwork, fixed] of tabbed) {
      const card = page.locator(selector).first(), art = card.locator(artwork).first(), handle = await art.elementHandle();
      await card.getByRole('tab').first().focus(); await page.keyboard.press('Enter'); await settle(page);
      const before = await card.boundingBox(), image = await art.boundingBox(); assert.ok(before); assert.ok(image);
      const tabs = card.getByRole('tab');
      for (let index = 0; index < await tabs.count(); index += 1) {
        const tab = tabs.nth(index); await tab.focus(); await page.keyboard.press('Enter'); await settle(page);
        assert.equal(await tab.getAttribute('aria-selected'), 'true');
        const style = await tab.evaluate(node => {
          const s = getComputedStyle(node), track = getComputedStyle(node.parentElement ?? node);
          const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
          const paint = canvas.getContext('2d'); if (paint === null) throw new Error('color-check-unavailable');
          const luminance = (color: string): number => {
            paint.clearRect(0, 0, 1, 1); paint.fillStyle = color; paint.fillRect(0, 0, 1, 1);
            return [...paint.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => {
              const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
            }).reduce((sum, value, channel) => sum + value * ([.2126, .7152, .0722][channel] ?? 0), 0);
          };
          const ratio = (first: string, second: string): number => {const a = luminance(first), b = luminance(second); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);};
          return {height: node.getBoundingClientRect().height,
          font: s.fontSize, radius: s.borderTopLeftRadius, background: s.backgroundColor, track: getComputedStyle(node.parentElement ?? node).backgroundColor,
          boundaryContrast: Math.min(ratio(s.borderTopColor, s.backgroundColor), ratio(s.borderTopColor, track.backgroundColor)),
          focus: s.outlineStyle !== 'none' && Number.parseFloat(s.outlineWidth) >= 2};});
        assert.ok(style.height >= 44, `${name} tabs have touch targets`); assert.equal(style.font, tabStyle.font, `${name} uses the shared tab type`); assert.equal(style.radius, tabStyle.radius, `${name} uses the shared tab shape`);
        assert.notEqual(style.background, style.track, `${name} selected tab is distinguishable`); assert.equal(style.focus, true, `${name} has keyboard focus`);
        assert.ok(style.boundaryContrast >= 3, `${name} selected boundary has 3:1 contrast: ${style.boundaryContrast}`);
        assert.equal(await handle.evaluate(node => node.isConnected), true, `${name} artwork stays mounted`);
        assert.deepEqual(await art.boundingBox(), image, `${name} artwork stays in place`);
        if (fixed) assert.equal((await card.boundingBox())?.height, before.height, `${name} retains its fixed control face`);
      }
      await handle.dispose();
    }
    assert.equal(await page.locator('.tidbyt-links a').count(), 2, 'the fixture renders both Tidbyt footer destinations');
    for (const link of await page.locator('.roborock-foot a,.onn-card-foot a,.wispr-card-foot a,.tidbyt-links a,.widget[data-widget=duck-latest]>a,.widget[data-widget=duck-latest]>p>a').all()) {
      const box = await link.boundingBox(); assert.ok(box); assert.ok(box.height >= 44, 'card footer links have touch targets');
    }
    for (const button of await page.locator('.onn-status-button,.roborock-warning,.wispr-card-actions button').all()) {
      const box = await button.boundingBox(); assert.ok(box); assert.ok(box.height >= 44 && box.width >= 44, 'corner controls have touch targets');
    }
    assert.equal(await page.locator('.light-face:not([hidden]),.onn-control-plane>section:not([hidden]),.roborock-plane>section:not([hidden])')
      .evaluateAll(nodes => nodes.every(node => getComputedStyle(node).animationName === 'none')), true, 'reduced motion suppresses control flips');
    assert.ok(await page.locator('.onn-card button:disabled').count() > 0, 'unavailable ONN controls remain disabled');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `all cards fit ${width}px ${colorScheme}`);
    const axe = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(axe.violations.map(item => ({id: item.id, nodes: item.nodes.map(node => node.target)})), []);
  }
  const plug = await page.locator('.wemo-card').first().getAttribute('data-device'); assert.notEqual(plug, null);
  const featureViews = [
    ['Lights', '#/lights/lifx', '.light-card'], ['Room', '#/rooms', '.light-card'],
    ['Pixoo', '#/module/pixoo/player', '.pixoo-card'], ['Tidbyt', '#/module/tidbyt/display', '.tidbyt-card'],
    ['ONN', '#/module/onn/controls', '.onn-card'], ['Roborock', '#/module/roborock/status', '.roborock-card'],
    ['Wemo', `#/component/${encodeURIComponent(plug ?? '')}`, '.wemo-card'], ['Music', '#/audio', '.music-card'],
  ] as const;
  for (const [width, colorScheme] of [[1440, 'light'], [390, 'dark']] as const) {
    await page.setViewportSize({width, height: 1000}); await page.emulateMedia({colorScheme, reducedMotion: 'reduce'});
    for (const [name, address, selector] of featureViews) {
      await page.goto(`${world.url}/${address}`); await feed(page, 'connected');
      const card = page.locator(selector).first(); await card.waitFor(); await settle(page);
      const chrome = await card.evaluate(node => {const s = getComputedStyle(node); return {padding: s.paddingTop, radius: s.borderTopLeftRadius, width: node.getBoundingClientRect().width};});
      assert.equal(chrome.padding, width <= 680 ? '16px' : '24px', `${name} feature uses the same card padding`);
      assert.equal(chrome.radius, '26px', `${name} feature retains the existing glass frame`);
      if (name === 'Music' || name === 'Wemo') assert.ok(chrome.width <= 430, `${name} keeps its feature-page width limit`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} feature fits ${width}px`);
      if (receipts !== undefined && width === 390) await card.screenshot({path: join(receipts, `feature-${name.toLowerCase()}.png`)});
    }
  }
  assert.deepEqual(sent, [], 'browsing, focus and tabs send no product command'); assert.deepEqual(errors, []);
  await context.close();
  console.log(JSON.stringify({journey: 'card-consistency', cards: frames.length, themesAndWidths: 8, featureViews: featureViews.length,
    attention: true, stableArt: true, keyboard: true, fixtureMetadataSaves: 2, inspectionCommands: 0, physical: false}));
} finally {await browser.close(); await world.close();}
