// Hub #853: browser and accessibility check of the CHOMPI bridge verification run's control page, in the manner of
// the dashboard's browser checks. It starts a run in this process (synthetic feed, simulated controller and
// desktop), drives the page with the keyboard in Chromium and runs axe (WCAG 2.1 A and AA) at desktop and phone
// widths. `npm run test:chompi-bridge:browser`; exits non-zero on any failure.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright';
import { seedRun, startServer } from '../server.mjs';

const dataDir = await mkdtemp(join(tmpdir().length <= 60 ? tmpdir() : '/tmp', 'cp-'));
await seedRun(dataDir, 'desk-basic');
const run = await startServer({ dataDir, processHooks: Object.assign(new EventEmitter(), { exit() {} }) });
const browser = await chromium.launch({ headless: true });
const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const state = async () => (await fetch(new URL('/api/harness/state', run.url))).json();
  const until = async (read, what, ms = 8000) => {
    for (const deadline = Date.now() + ms; ;) {
      if (await read()) return;
      if (Date.now() > deadline) throw new Error(`timed out: ${what}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };

  await page.goto(run.url);
  await page.locator('#run-controller').filter({ hasText: 'connected to the bridge' }).waitFor({ timeout: 15000 });

  await check('a skip link leads to the controller', async () => {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Skip to the controller');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'controller-heading');
  });

  await check('every control has an accessible name', async () => {
    const unnamed = await page.locator('button, input, select').evaluateAll(nodes => nodes.filter(node => {
      const label = node.getAttribute('aria-label') || (node.id && document.querySelector(`label[for="${node.id}"]`)?.textContent) || node.textContent;
      return !label || !label.trim();
    }).length);
    assert.equal(unnamed, 0);
  });

  await check('Space holds a key down until it is released, as the protocol input shows', async () => {
    const record = page.getByRole('button', { name: /^Record \(CHOMPI key\), light / });
    await record.focus();
    await page.keyboard.down('Space');
    await until(async () => (await state()).controller.pressed.includes(26), 'Record held');
    await until(async () => (await record.getAttribute('aria-pressed')) === 'true', 'aria-pressed true');
    await until(async () => (await state()).desktop.held.length === 2, 'the dictation chord is held');
    // The held Record key reads "record", though the record and error colors are both red.
    await page.getByRole('button', { name: 'Record (CHOMPI key), light record', exact: true }).waitFor({ timeout: 5000 });
    await page.keyboard.up('Space');
    await until(async () => !(await state()).controller.pressed.includes(26), 'Record released');
    await until(async () => (await record.getAttribute('aria-pressed')) === 'false', 'aria-pressed false');
    await until(async () => (await state()).desktop.held.length === 0, 'the chord came up');
  });

  await check('Latch keys turns each activation into a toggle', async () => {
    await page.getByRole('button', { name: 'Latch keys' }).click();
    assert.equal(await page.getByRole('button', { name: 'Latch keys' }).getAttribute('aria-pressed'), 'true');
    const loop = page.getByRole('button', { name: /^Loop, light / });
    await loop.focus();
    await page.keyboard.press('Enter');
    await until(async () => (await state()).controller.pressed.includes(28), 'Loop latched');
    await page.keyboard.press('Enter');
    await until(async () => !(await state()).controller.pressed.includes(28), 'Loop released');
    await page.getByRole('button', { name: 'Latch keys' }).click();
  });

  await check('the wheel turns by its counts, and keyboard focus survives the page refreshing', async () => {
    const counts = page.getByLabel('Counts per turn').nth(4);
    await counts.fill('3');
    await page.getByRole('button', { name: 'Big wheel turn right' }).focus();
    await page.keyboard.press('Enter');
    await page.locator('#action-status').filter({ hasText: 'Turned Big wheel right 3.' }).waitFor();
    const activity = page.getByLabel('Activity of Synthetic Codex task 1');
    await activity.focus();
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Activity of Synthetic Codex task 1');
  });

  await check('knob 4 pages the slot keys by one page step, and its light names the page', async () => {
    const light = page.locator('[data-encoder="knob-4"] > .light');
    assert.equal(await page.getByLabel('Counts per turn').nth(3).inputValue(), '6', 'knob 4 starts at one page step');
    await light.filter({ hasText: /^page 1$/ }).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: 'Knob 4 turn right' }).focus();
    await page.keyboard.press('Enter');
    await until(async () => (await state()).log.some(entry => entry.line.type === 'page' && entry.line.page === 2), 'the bridge shows page 2');
    await light.filter({ hasText: /^page 2$/ }).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: 'Knob 4 turn left' }).click();
    await light.filter({ hasText: /^page 1$/ }).waitFor({ timeout: 5000 });
    assert.equal((await state()).desktop.foreground, 'other', 'paging brought no window to the front');
  });

  await check('the Hub controls change a slot light: attention on the Codex task', async () => {
    await page.getByLabel('Attention of Synthetic Codex task 1').selectOption('approval');
    const slot = (await state()).slots.find(s => s.client === 'codex').slot;
    await page.getByRole('button', { name: new RegExp(`^Slot ${slot}, light attention`) }).waitFor({ timeout: 8000 });
  });

  await check('the desktop log and the bridge log are shown', async () => {
    await page.locator('#bridge-log li').filter({ hasText: '"type":"slot-assigned"' }).first().waitFor();
    await page.locator('#desktop-log li').filter({ hasText: 'key down LeftControl+LeftWindows' }).first().waitFor();
  });

  await check('no WCAG 2.1 A or AA violations at 1440 px', async () => {
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target.join(' ')) })), []);
  });

  await check('no WCAG 2.1 A or AA violations at phone width, and no page scroll sideways', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => `${n.target.join(' ')}: ${n.failureSummary}`) })), []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'the page itself does not scroll sideways; only the key rows do');
  });

  await check('a cross-origin action is refused', async () => {
    const response = await fetch(new URL('/api/harness/controller', run.url), { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:1' }, body: '{"op":"click","control":1}' });
    assert.equal(response.status, 403);
    const form = await fetch(new URL('/api/harness/controller', run.url), { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"op":"click","control":1}' });
    assert.equal(form.status, 415);
  });

  assert.deepEqual(errors, [], 'the page logged no errors');
  process.stdout.write(`${JSON.stringify({ synthetic: true, physical: false, checks }, null, 2)}\n`);
} finally {
  await browser.close();
  await run.close();
  await rm(dataDir, { recursive: true, force: true });
}
