import {worldClock} from './world-clock.ts';
import assert from 'node:assert/strict';
import {chromium, type Browser} from 'playwright';
import {PACKET} from '@jimmie-potts/lifx';
import {feed, startWorld} from './harness.ts';

export async function lifxConversationJourney(browser: Browser): Promise<void> {
  const world = await startWorld({companions: true, devices: true, lighting: true, assistantLights: true});
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    await page.goto(`${world.url}/#/module/companions/assistant`);
    await feed(page, 'connected');
    const conversation = page.getByRole('region', {name: 'B.U.N.N.Y. conversation', exact: true});
    await conversation.getByRole('button', {name: 'Enable conversation', exact: true}).click();
    await page.waitForFunction(async url => {
      const response = await fetch(url);
      const value: unknown = await response.json();
      return typeof value === 'object' && value !== null && 'records' in value && Array.isArray(value.records) &&
        value.records.some((record: unknown) => typeof record === 'object' && record !== null &&
          'id' in record && record.id === 'lamp-a' && 'availability' in record && record.availability === 'available');
    }, `${world.url}/api/v2/families/device`);
    const deviceCopyReady = (): boolean => world.logs.some(record => record.event_name === 'runtime.sync.served'
      && record.attributes['bunny.participant'] === 'bunny/modules/companions' && record.attributes['bunny.pattern'] === 'sync device');
    for (let attempt = 0; !deviceCopyReady() && attempt < 100; attempt += 1) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(deviceCopyReady(), 'Conversation synced from the LIFX owner');
    const send = async (text: string): Promise<void> => {
      await conversation.getByRole('textbox', {name: 'Message', exact: true}).fill(text);
      await conversation.getByRole('button', {name: 'Send', exact: true}).click();
    };
    await send('SYNTHETIC_LIFX status lamp-a');
    await conversation.getByText(/Synthetic result: lamp-a.*Observed power: on/).waitFor().catch(async (error: unknown) => {
      throw new Error(`Unexpected synthetic status: ${await conversation.innerText()}`, {cause: error});
    });
    const colorWrites = (): string[] => world.lifxState().packets.filter(packet => packet.type === PACKET.setColor).map(packet => packet.address);
    assert.deepEqual(colorWrites(), []);
    await send('Set lamp-a brightness to 30%');
    assert.equal(await conversation.getByRole('article', {name: 'Proposed command', exact: true}).count(), 0);
    const tool = conversation.getByRole('article', {name: 'tool message', exact: true}).filter({has: page.locator('p', {hasText: 'accepted: brightness-set on lamp-a'})});
    await tool.locator('summary').click();
    await tool.getByText('Tracked operation succeeded · evidence transmitted', {exact: true}).waitFor();
    assert.deepEqual(colorWrites(), ['192.0.2.42']);
  } finally {
    await context.close();
    await world.close();
  }
  process.stdout.write('LIFX Conversation browser: status, direct brightness request, exact target, and tracked brightness evidence passed.\n');
}

export async function wemoConversationJourney(browser: Browser): Promise<void> {
  const clock = worldClock();
  let overrideRead: (() => Promise<boolean | undefined>) | undefined;
  let release: (value: boolean) => void = () => {};
  const reading = new Promise<boolean>(resolve => {release = resolve;});
  const world = await startWorld({companions: true, wemo: true, assistantWemo: true, clock,
    wemoReadback: (plug, observed) => {
      assert.equal(plug, 'shelf-lamp');
      return overrideRead?.() ?? Promise.resolve(observed);
    }});
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    await page.goto(`${world.url}/#/module/companions/assistant`);
    await feed(page, 'connected');
    const conversation = page.getByRole('region', {name: 'B.U.N.N.Y. conversation', exact: true});
    await conversation.getByRole('button', {name: 'Enable conversation', exact: true}).click();
    const send = async (text: string): Promise<void> => {
      await conversation.getByRole('textbox', {name: 'Message', exact: true}).fill(text);
      await conversation.getByRole('button', {name: 'Send', exact: true}).click();
    };
    await clock.advance(50);
    await send('SYNTHETIC_WEMO status shelf-lamp');
    await conversation.getByText(/Synthetic result: Shelf lamp.*Observed power: off/).waitFor();
    const control = async (on: boolean, before?: () => void) => {
      before?.();
      await send(`Turn ${on ? 'on' : 'off'} shelf-lamp`);
      assert.equal(await conversation.getByRole('article', {name: 'Proposed command', exact: true}).count(), 0);
    };
    await control(true);
    await conversation.getByText('Shelf lamp reports power on.').waitFor();
    const tool = conversation.getByRole('article', {name: 'tool message', exact: true}).filter({has: page.locator('p', {hasText: 'accepted: power-set on shelf-lamp'})});
    await tool.locator('summary').click();
    await tool.getByText('Tracked operation succeeded · evidence transmitted', {exact: true}).waitFor();
    await control(false);
    await conversation.getByText('Shelf lamp reports power off.').waitFor();
    assert.equal(world.wemo.state()['shelf-lamp']?.writes, 2);

    overrideRead = () => reading;
    await control(true);
    await clock.advance(1100);
    const pending = conversation.getByText('Power command sent. I’ll update this reply when confirmation for Shelf lamp is available.');
    await pending.waitFor();
    await send('Wait for my next answer.');
    await conversation.getByRole('textbox', {name: 'Answer', exact: true}).waitFor();
    release(true);
    const update = conversation.getByRole('article', {name: 'assistant message'}).filter({has: page.getByRole('link', {name: 'Update to earlier reply'})});
    await update.getByText('Shelf lamp reports power on.', {exact: true}).waitFor();
    await page.reload();
    await feed(page, 'connected');
    await pending.waitFor();
    assert.equal(await update.count(), 1);
    const answer = conversation.getByRole('textbox', {name: 'Answer', exact: true});
    await answer.fill('Continue');
    await conversation.getByRole('button', {name: 'Answer', exact: true}).click();
    await conversation.getByText(/Synthetic result: Continue/).waitFor();

    overrideRead = () => Promise.resolve(undefined);
    await control(false);
    await conversation.getByText('Power command sent. I couldn’t confirm Shelf lamp’s power.').waitFor();
    await control(true, () => {world.wemoLoseReply();});
    await conversation.getByText('I couldn’t tell whether Shelf lamp switched on. The plug entered a hold after the unanswered write.').waitFor();
    await clock.advance(5100);
    await send('SYNTHETIC_WEMO status shelf-lamp');
    await conversation.getByText(/Synthetic result: Shelf lamp.*Device held.*Observed power: on/).waitFor();
    assert.equal(world.wemo.state()['shelf-lamp']?.writes, 5, 'one write per explicit request, including the unanswered write');
    assert.equal(world.wemo.state()['desk-lamp']?.writes, 0);
  } finally {
    release(false);
    await context.close();
    await world.close();
  }
  process.stdout.write('Wemo Conversation browser: on and off, delayed follow-up, unavailable readback, and uncertainty with one write per explicit request passed.\n');
}

if (import.meta.main) {
  const browser = await chromium.launch({headless: true});
  try {await lifxConversationJourney(browser); await wemoConversationJourney(browser);}
  finally {await browser.close();}
}
