import {chromium} from 'playwright';
import {openJourneyContext} from './browser-context.ts';
import {companionCardsJourney} from './companion-cards-journey.ts';
import {startWorld} from './harness.ts';

const world = await startWorld({companions: true});
const browser = await chromium.launch({headless: true});
try {
  const context = await openJourneyContext(browser, {viewport: {width: 1280, height: 1000}, reducedMotion: 'reduce'});
  const page = await context.newPage(); page.setDefaultTimeout(12_000);
  await companionCardsJourney(world, page, context);
  await context.close();
  process.stdout.write('Companion cards: Home/page reuse, fixed artwork and tab geometry, explicit private selection, reload, keyboard, themes, phone layout and no passive effects passed.\n');
} finally {await browser.close(); await world.close();}
