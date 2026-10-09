// Retained wall controls through the real gateway/core/module and a fresh simulated controller (Hub #934).
import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import type {Identity} from '@jimmie-potts/event-contracts/v2/families';
import {LINES_ADDRESS} from '@jimmie-potts/nanoleaf';
import {REQUEST_HEADER} from '@jimmie-potts/sdk/remote';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium, type Browser} from 'playwright';
import {IDENTITY, sessionStarted, turnStarted} from '../../dist/tests/fixtures/agents.js';
import {changes, feed, startWorld} from './harness.ts';

const desktop: Identity = {provider: 'codex', client: 'desktop', hostId: 'host-sim', sourceId: 'desktop',
  sessionId: '12345678-abcd-abcd-abcd-1234567890ab'};
const maliciousTitle = '<img src=x onerror="document.documentElement.dataset.nanoleafInjected=1">';
const world = await startWorld({nanoleaf: true});
type Wall = Awaited<ReturnType<typeof world.nanoleafWall>>;
const waitWall = async (matches: (wall: Wall) => boolean, message: string): Promise<Wall> => {
  let wall = await world.nanoleafWall();
  for (let attempt = 0; !matches(wall) && attempt < 100; attempt++) { await delay(50); wall = await world.nanoleafWall(); }
  assert.ok(matches(wall), message); return wall;
};
const saved = (wall: Wall): object => ({settings: wall.settings,
  elements: wall.elements.map(({id, number, signature, project}) => ({id, number, signature, project}))});
const effect = (): object => {
  const device = world.nanoleafState().devices[LINES_ADDRESS]; assert.ok(device);
  return {writes: device.writes, on: device.on, brightness: device.brightness, select: device.select, effect: device.effect};
};
// This file belongs to the fresh world above, never an installed Nanoleaf folder.
const scene = (): Promise<Buffer> => readFile(join(world.stateDir, 'modules', 'nanoleaf', 'scene-state.json'));
let browser: Browser | undefined;
try {
  const initial = await waitWall(wall => wall.elements.length === 6, 'ordinary startup saves the six synthetic Lines');
  const first = initial.elements[0]; assert.ok(first);
  const beforeScene = await scene();
  const beforeEffect = effect();
  browser = await chromium.launch({headless: true});
  const fallback = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'no-preference'});
  try {
    const errors: string[] = []; fallback.on('weberror', error => { errors.push(`${error.error().name}: ${error.error().message}`); });
    const page = await fallback.newPage(); page.setDefaultTimeout(12_000);
    const sent = changes(page);
    await page.route('**/modules/nanoleaf/content/editor-layout?device=wall', route => route.fulfill({status: 503,
      contentType: 'application/json', body: '{"error":{"code":"unavailable","retryable":true}}'}));
    await page.goto(`${world.url}/#/module/nanoleaf/wall`); await feed(page, 'connected');
    const drawing = page.locator('.nanoleaf-wall #wall.assembling');
    await drawing.waitFor();
    const animations = await drawing.evaluateHandle(element => element.getAnimations({subtree: true}).filter(animation => animation.id === 'assembly'));
    try {
      assert.ok(await animations.evaluate(items => items.length >= 3 && items.some(animation => animation.playState === 'running')),
        'normal-motion fallback assembly is visible and still running before navigation');
      const completion = animations.evaluate(async items => (await Promise.allSettled(items.map(animation => animation.finished))).map(result => result.status));
      await page.getByRole('navigation', {name: 'Main navigation'}).getByRole('link', {name: /^Home/}).click();
      await page.locator('.nanoleaf-wall').waitFor({state: 'detached'});
      const states = await animations.evaluate(items => items.map(animation => animation.playState));
      const finished = await completion;
      await page.evaluate(() => new Promise<void>(resolve => { setTimeout(resolve, 0); }));
      process.stdout.write(`${JSON.stringify({checkpoint: 'normal-motion-fallback-exit', states, finished, errors, requests: sent.length})}\n`);
      assert.ok(states.every(state => state === 'idle'), 'page exit cancels every running fallback animation');
      assert.ok(finished.every(state => state === 'rejected'), 'cancelled animation promises settle without restarting the removed wall');
      assert.deepEqual(errors, []);
      assert.equal(sent.length, 0, 'fallback assembly and navigation send no command');
    } finally { await animations.dispose(); }
  } finally { await fallback.close(); }
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  try {
    const errors: string[] = []; context.on('weberror', error => { errors.push(`${error.error().name}: ${error.error().message}`); });
    const page = await context.newPage(); page.setDefaultTimeout(12_000);
    const sent = changes(page);
    const actions: {requestId: string; target: string; data: object}[] = [];
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v2/commands/nanoleaf-wall-edit') {
        actions.push(request.postDataJSON() as {requestId: string; target: string; data: object});
      }
    });
    const receipts = process.env.DASHBOARD_RECEIPTS;
    const screenshot = async (name: string): Promise<void> => {
      if (receipts === undefined) return;
      await mkdir(receipts, {recursive: true});
      await page.screenshot({path: join(receipts, `${name}.png`), fullPage: true});
    };
    const axe = async (): Promise<void> => {
      const result = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      assert.deepEqual(result.violations.map(item => `${item.id}: ${item.nodes.map(node => node.target.join(' ')).join(', ')}`), []);
    };
    // Exercise a failed content read and explicit retry without replacing the real owner or command route.
    let failGeometry = true;
    await page.route('**/modules/nanoleaf/content/editor-layout?device=wall', async route => {
      if (!failGeometry) { await route.continue(); return; }
      failGeometry = false;
      await route.fulfill({status: 503, contentType: 'application/json', body: '{"error":{"code":"unavailable","retryable":true}}'});
    });
    await page.goto(`${world.url}/#/module/nanoleaf/wall`); await feed(page, 'connected');
    const wall = page.locator('.nanoleaf-wall');
    await wall.waitFor();
    await page.getByRole('alert').filter({hasText: 'Saved connector geometry is unavailable.'}).waitFor();
    await page.getByRole('button', {name: 'Refresh saved geometry', exact: true}).click();
    const drawing = wall.locator('#wall.prism-scene');
    try { await drawing.waitFor(); } catch (error) {
      await screenshot('nanoleaf-prism-failure');
      const diagnostic = await page.evaluate(async () => {
        const response = await fetch('/modules/nanoleaf/content/editor-layout?device=wall');
        const value = await response.json() as {schema?: string; geometry?: {nodes?: unknown[]; lines?: unknown[]}; error?: {code: string}};
        return {status: response.status, schema: value.schema, nodes: value.geometry?.nodes?.length,
          lines: value.geometry?.lines?.length, code: value.error?.code, notice: document.querySelector('.nanoleaf-wall #notice')?.textContent,
          svgClass: document.querySelector('.nanoleaf-wall #wall')?.getAttribute('class')};
      });
      process.stdout.write(`${JSON.stringify({checkpoint: 'prism', diagnostic, errors})}\n`);
      throw error;
    }
    assert.equal(await drawing.getAttribute('data-reduced-motion'), 'true');
    assert.equal(await wall.locator('#notice').isVisible(), false, 'successful geometry recovery clears the derived fallback notice');
    const line = wall.locator(`#wall [role="button"][data-line="${first.id}"]`);
    await line.focus(); await line.press('Enter');
    assert.equal(await line.getAttribute('aria-pressed'), 'true', 'keyboard selection reaches the retained inspector');
    await page.keyboard.press('Escape');
    assert.equal(await line.getAttribute('aria-pressed'), 'false');
    assert.equal(await wall.locator('#wallTitle').evaluate(element => element === document.activeElement), true);
    await line.focus(); await line.press('Space');
    await wall.locator('#wallOptions > summary').click();
    await wall.locator('#showNumbers').click();
    assert.equal(await wall.locator('#showNumbers').getAttribute('aria-pressed'), 'true');
    await wall.locator('#replay').click();
    assert.equal(await drawing.evaluate(element => element.classList.contains('assembling')), false, 'reduced motion suppresses assembly');
    assert.equal(sent.length, 0, 'open, read retry, keyboard selection and local presentation send no command');
    assert.deepEqual(saved(await world.nanoleafWall()), saved(initial));
    assert.deepEqual(await scene(), beforeScene, 'opening and local controls preserve the saved scene');
    assert.deepEqual(effect(), beforeEffect, 'opening and local controls have no device effect');

    // Hold only the HTTP answer after the real command is admitted, to observe the shared in-flight lock.
    let releaseReply: (() => void) | undefined;
    const heldReply = new Promise<void>(resolve => { releaseReply = resolve; });
    let admitted: (() => void) | undefined;
    const admission = new Promise<void>(resolve => { admitted = resolve; });
    await page.route('**/api/v2/commands/nanoleaf-wall-edit', async route => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      admitted?.(); await heldReply; await route.fulfill({response});
    }, {times: 1});
    try {
      await wall.locator('#project').focus(); await wall.locator('#project').press('Enter');
      await Promise.race([admission, delay(12_000).then(() => { throw new Error('the explicit Project edit was not admitted'); })]);
      assert.equal(await wall.locator('#project').isDisabled(), true, 'the tracked command locks repeated mutation');
    } finally { releaseReply?.(); }
    await waitWall(value => value.settings.style === 'project', 'the owner confirms Project layout');
    await page.getByRole('status').filter({hasText: 'Completed: succeeded.'}).waitFor();
    assert.equal(sent.length, 1);
    await page.keyboard.press('Escape');
    await line.focus(); await line.press('Enter');
    const swap = wall.getByRole('button', {name: 'Swap halves', exact: true});
    await swap.focus(); await swap.press('Enter');
    await waitWall(value => value.elements.find(element => element.id === first.id)?.signature === 1 - first.signature,
      'the real owner confirms the selected Line signature change');
    await page.getByRole('status').filter({hasText: 'Completed: succeeded.'}).waitFor();
    assert.equal(sent.length, 2);
    assert.deepEqual(actions[1]?.data, {edit: {kind: 'assign', elements: [{signature: 1 - first.signature, id: first.id}]}});
    assert.ok(actions.every(action => action.target === 'wall'));
    await screenshot('nanoleaf-tracked-edit');

    await page.reload(); await feed(page, 'connected'); await drawing.waitFor();
    assert.equal(sent.length, 2, 'reload never repeats a wall edit');
    await page.getByRole('navigation', {name: 'Main navigation'}).getByRole('link', {name: /^Home/}).click();
    assert.equal(await wall.count(), 0, 'leaving disposes the wall mount');
    await page.getByRole('link', {name: 'Wall', exact: true}).click(); await drawing.waitFor();
    assert.equal(sent.length, 2, 're-entry sends no command');
    await line.focus(); await line.press('Enter'); await swap.click();
    await waitWall(value => value.elements.find(element => element.id === first.id)?.signature === first.signature,
      'one re-entered handler restores the original signature');
    await page.getByRole('status').filter({hasText: 'Completed: succeeded.'}).waitFor();
    assert.equal(sent.length, 3, 'one click after re-entry reaches one handler');
    assert.equal(new Set(actions.map(action => action.requestId)).size, 3);
    const edited = saved(await world.nanoleafWall());
    assert.equal(await world.readonlyNanoleafEdit({edit: {kind: 'settings', settings: {rotation: 90}}}), 403,
      'a real read credential cannot mutate the owner');
    const crossOrigin = await context.request.post(`${world.url}/api/v2/commands/nanoleaf-wall-edit`, {
      headers: {origin: 'https://unrelated.invalid', [REQUEST_HEADER]: '1'},
      data: {target: 'wall', requestId: 'nanoleaf-origin-denied', data: {edit: {kind: 'settings', settings: {rotation: 90}}}},
    });
    assert.equal(crossOrigin.status(), 403, 'the real browser-session Origin boundary refuses before effects');
    await crossOrigin.dispose();
    assert.deepEqual(saved(await world.nanoleafWall()), edited);

    // Observe power before publishing active tasks that legitimately start Work rendering.
    await page.getByRole('navigation', {name: 'Main navigation'}).getByRole('link', {name: /^Home/}).click();
    const card = page.locator('[data-device="wall"]'); await card.waitFor();
    for (const on of [false, true]) {
      world.nanoleafPower(on);
      try {
        await page.waitForFunction(wanted => Array.from(document.querySelectorAll('[data-device="wall"] .facts > div')).some(row =>
          row.querySelector('dt')?.textContent === 'Observed power' && row.querySelector('dd')?.textContent === wanted), String(on), {timeout: 15_000});
      } catch (error) {
        await screenshot('nanoleaf-power-failure');
        process.stdout.write(`${JSON.stringify({checkpoint: 'power', wanted: on, simulation: effect(), facts: await card.locator('.facts').innerText()})}\n`);
        throw error;
      }
      assert.equal(world.nanoleafState().devices[LINES_ADDRESS]?.on, on, 'the Home card matches the actual simulated observation');
    }
    assert.equal(sent.length, 3, 'observing physical-switch simulation sends no dashboard command');
    await page.getByRole('link', {name: 'Wall', exact: true}).click(); await drawing.waitFor();

    await world.observe(sessionStarted, {identity: IDENTITY, title: {value: maliciousTitle, source: 'provider'}});
    await world.observe(turnStarted, {identity: IDENTITY});
    await world.observe(sessionStarted, {identity: desktop, title: {value: 'Synthetic Desktop task', source: 'provider'}});
    await world.observe(turnStarted, {identity: desktop});
    await wall.getByRole('button', {name: maliciousTitle, exact: true}).click();
    await wall.getByRole('heading', {name: maliciousTitle, exact: true}).waitFor();
    assert.equal(await wall.locator('img').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.nanoleafInjected), undefined);
    assert.equal(await wall.getByRole('link', {name: 'Open in Codex', exact: true}).count(), 0, 'Claude identity cannot become a Codex link');
    await wall.getByRole('button', {name: 'Synthetic Desktop task', exact: true}).click();
    const codex = wall.getByRole('link', {name: 'Open in Codex', exact: true});
    await codex.waitFor();
    assert.equal(await codex.getAttribute('href'), `codex://threads/${desktop.sessionId}`);
    assert.equal(sent.length, 3, 'task inspection and navigation-link rendering send no command');
    await axe(); await screenshot('nanoleaf-desktop');
    await page.setViewportSize({width: 390, height: 844}); await axe(); await screenshot('nanoleaf-mobile');

    // UI projection is tested separately from the actual read-credential and Origin refusals above.
    await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json',
      body: '{"error":{"code":"forbidden","retryable":false}}'}));
    await page.reload(); await feed(page, 'connected'); await drawing.waitFor();
    await page.getByText('Read-only access. Wall changes require control access.', {exact: true}).waitFor();
    await line.focus(); await line.press('Enter');
    await wall.locator('#showSavedProjects').click();
    const mutationControls = wall.locator('#work,#quiet,#free,#classic,#project,#coverage,#assignProject,#swap,#locate,#rotate,#flipX,#flipY,#resetColors,#projectList input,#colorRows button,#colorRows input,[data-evict-task]');
    assert.ok(await mutationControls.count() > 12);
    assert.equal(await mutationControls.evaluateAll(elements => elements.every(element => 'disabled' in element && element.disabled === true)), true,
      'local selection cannot re-enable read-only mutation controls');
    await delay(1100); // Exercise the retained inspector's one-second presentation tick while read-only.
    assert.equal(await wall.locator('#locate').isDisabled(), true);
    assert.deepEqual(saved(await world.nanoleafWall()), edited);
    assert.equal(sent.length, 3);
    assert.deepEqual(errors, []);
    process.stdout.write(`${JSON.stringify({passed: true, journey: 'nanoleaf-wall-editor', requests: sent.length,
      initialOpenAndLocalControls: 'no effects', readRetry: true, trackedEdit: true, inFlightLock: true,
      reloadAndReentry: 'no resend or duplicate handler', readCredential: 403, crossOrigin: 403,
      safeTaskTextAndLinks: true, observedPower: [false, true], reducedMotion: true, axe: ['desktop', 'mobile']})}\n`);
  } finally { await context.close(); }
} finally { try { await browser?.close(); } finally { await world.close(); } }
