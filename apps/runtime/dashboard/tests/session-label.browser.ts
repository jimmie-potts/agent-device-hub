// One focused label/reload journey against the built synthetic runtime (Hub #1006).
import assert from 'node:assert/strict';
import {chromium, type Browser} from 'playwright';
import {sessionStarted} from '../../dist/tests/fixtures/agents.js';
import {changes, feed, startWorld} from './harness.ts';
import {labelJourney} from './label-journey.ts';

const world = await startWorld();
let browser: Browser | undefined;
try {
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
  try {
    const errors: string[] = [];
    context.on('weberror', error => { errors.push(error.error().name); });
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    const sent = changes(page);
    await page.goto(world.url);
    await feed(page, 'connected');
    await world.observe(sessionStarted, {title: {value: 'Port the wall', source: 'provider'}});
    const check = await labelJourney(page, world, sent);
    assert.deepEqual(errors, []);
    process.stdout.write(`${JSON.stringify({passed: true, checks: [check]})}\n`);
  } finally {
    await context.close();
  }
} finally {
  try { await browser?.close(); } finally { await world.close(); }
}
