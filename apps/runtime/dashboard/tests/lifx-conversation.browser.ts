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
    await send('SYNTHETIC_LIFX brightness lamp-a 30');
    const proposal = conversation.getByRole('article', {name: 'Proposed command', exact: true});
    await proposal.getByText('Set lamp-a brightness to 30%?', {exact: true}).waitFor();
    const colorWrites = (): string[] => world.lifxState().packets.filter(packet => packet.type === PACKET.setColor).map(packet => packet.address);
    assert.deepEqual(colorWrites(), []);
    await page.reload();
    await feed(page, 'connected');
    await proposal.getByText('Set lamp-a brightness to 30%?', {exact: true}).waitFor();
    await proposal.getByRole('button', {name: 'Approve proposal', exact: true}).click();
    const tool = conversation.getByRole('article', {name: 'tool message', exact: true}).filter({has: page.locator('p', {hasText: 'accepted: brightness-set on lamp-a'})});
    await tool.locator('summary').click();
    await tool.getByText('Tracked operation succeeded · evidence transmitted', {exact: true}).waitFor();
    assert.deepEqual(colorWrites(), ['192.0.2.42']);
  } finally {
    await context.close();
    await world.close();
  }
  process.stdout.write('LIFX Conversation browser: status, saved approval across reload, exact target, and tracked brightness evidence passed.\n');
}

export async function wemoConversationJourney(browser: Browser): Promise<void> {
  const world = await startWorld({companions: true, wemo: true, assistantWemo: true});
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
    await send('SYNTHETIC_WEMO status shelf-lamp');
    await conversation.getByText(/Synthetic result: Shelf lamp.*Observed power: off/).waitFor();
    await send('SYNTHETIC_WEMO power shelf-lamp on');
    const proposal = conversation.getByRole('article', {name: 'Proposed command', exact: true});
    await proposal.getByText('Turn on Shelf lamp?', {exact: true}).waitFor();
    assert.equal(world.wemo.state()['shelf-lamp']?.writes, 0);
    await page.reload();
    await feed(page, 'connected');
    await proposal.getByText('Turn on Shelf lamp?', {exact: true}).waitFor();
    await proposal.getByRole('button', {name: 'Approve proposal', exact: true}).click();
    const tool = conversation.getByRole('article', {name: 'tool message', exact: true}).filter({has: page.locator('p', {hasText: 'accepted: power-set on shelf-lamp'})});
    await tool.locator('summary').click();
    await tool.getByText('Tracked operation succeeded · evidence transmitted', {exact: true}).waitFor();
    assert.equal(world.wemo.state()['shelf-lamp']?.writes, 1);
    assert.equal(world.wemo.state()['desk-lamp']?.writes, 0);
  } finally {
    await context.close();
    await world.close();
  }
  process.stdout.write('Wemo Conversation browser: status, saved owner and target, and tracked power evidence passed.\n');
}

if (import.meta.main) {
  const browser = await chromium.launch({headless: true});
  try {await lifxConversationJourney(browser); await wemoConversationJourney(browser);}
  finally {await browser.close();}
}
