// A tiny journey that card-errors.browser.ts runs in a child process to check the harness's end-of-run failure (Hub
// #2139): with CARD_WATCH_LATE=1 the Inbox card fails after the journey's last feed() and the world's close() must make
// the process exit 1 naming it; without it the run is healthy and exits 0. Synthetic world, no device, no installed service.
import {chromium} from 'playwright';
import {serveFaultable} from './card-faults.ts';
import {feed, startWorld} from './harness.ts';
import {openSettings} from './navigation-helpers.ts';

const world = await startWorld({});
const browser = await chromium.launch({headless: true});
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(12_000);
  const faults = await serveFaultable(page, {});
  await page.goto(world.url);
  await feed(page, 'connected');
  await page.locator('[data-home-card=inbox] h2', {hasText: 'Inbox'}).first().waitFor();
  if (process.env.CARD_WATCH_LATE === '1') {
    await faults.set('inbox', 'render');
    await openSettings(page);
    await page.goBack();
    await page.locator('[data-card-failed=inbox]').waitFor();
  }
} finally {
  await browser.close();
  await world.close();
}
