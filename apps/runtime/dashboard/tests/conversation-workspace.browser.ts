import assert from 'node:assert/strict';
import {chromium, type Browser} from 'playwright';
import {feed, startWorld} from './harness.ts';

export async function conversationWorkspaceJourney(browser: Browser): Promise<void> {
  const world = await startWorld({companions: true, speech: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    await page.route('**/modules/companions/content/conversation?profile=bunny&view=recent',
      route => route.fulfill({status: 503, json: {}}), {times: 1});
    await page.goto(`${world.url}/#/module/companions/assistant`);
    await feed(page, 'connected');
    const assistant = page.getByRole('region', {name: 'B.U.N.N.Y. conversation', exact: true});
    const message = assistant.getByRole('textbox', {name: 'Message', exact: true});
    const send = assistant.getByRole('button', {name: 'Send', exact: true});
    const invitation = assistant.getByRole('heading', {name: 'What’s on your mind?', exact: true});
    const retry = assistant.getByRole('button', {name: 'Retry history', exact: true});
    await retry.waitFor();
    assert.equal(await invitation.count(), 0, 'a failed history read does not invite a new message');
    await retry.click();
    await assistant.getByText('No saved messages for this profile yet.', {exact: true}).waitFor();
    assert.equal(await invitation.count(), 0, 'off state does not invite a new message');
    await assistant.getByRole('button', {name: 'Enable conversation', exact: true}).click();
    await invitation.waitFor({timeout: 3000});
    await message.fill('Companion fixture is ready');
    await message.clear();

    const layout = async (width: number, height: number): Promise<number> => {
      await page.setViewportSize({width, height});
      await page.evaluate(() => window.scrollTo(0, 0));
      const sendBounds = await send.boundingBox();
      assert.ok(sendBounds !== null && sendBounds.y + sendBounds.height <= height, `Send fits at ${String(width)}x${String(height)}`);
      const {scrollWidth, scrollHeight} = await page.locator('html').evaluate(node => ({scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight}));
      assert.ok(scrollWidth <= width + 1 && scrollHeight <= height + 1,
        `normal Conversation fits at ${String(width)}x${String(height)} (document: ${String(scrollWidth)}x${String(scrollHeight)})`);
      const reading = await assistant.locator('.conversation-transcript').boundingBox();
      assert.ok(reading !== null && reading.height >= 96, 'the transcript has room to read');
      const [column, input] = await Promise.all([
        assistant.locator('.conversation-transcript > ol, .conversation-empty').boundingBox(),
        assistant.locator('.conversation-input-surface').boundingBox(),
      ]);
      assert.ok(column !== null && input !== null && column.width <= 761
        && Math.abs(column.x - input.x) <= 1 && Math.abs(column.width - input.width) <= 1,
      `reading content and composer share their measure at ${String(width)}x${String(height)}`);
      return reading.height;
    };

    await layout(1280, 800);
    const short = await layout(1440, 800);
    const tall = await layout(1440, 1000);
    assert.ok(tall - short >= 180, `growing the viewport gives the extra height to the transcript (${String(short)} to ${String(tall)})`);
    await layout(390, 844);
    await layout(320, 844);
    await page.setViewportSize({width: 1440, height: 1000});
    const transcript = assistant.getByRole('list', {name: 'Saved conversation messages'});
    await message.fill('Synthetic workspace fixture');
    await send.click();
    const answer = assistant.getByRole('textbox', {name: 'Answer', exact: true});
    await answer.fill('Short answer');
    await assistant.getByRole('button', {name: 'Answer', exact: true}).click();
    await transcript.getByText(/Synthetic result: Short answer/).waitFor();
    await message.fill('Draft through resize and menu');
    await layout(1440, 1000);
    await layout(1280, 800);
    await layout(390, 844);
    await layout(320, 844);

    const profiles = assistant.getByRole('navigation', {name: 'Conversation profiles'});
    assert.deepEqual(await profiles.getByRole('combobox').locator('option').allTextContents(),
      ['B.U.N.N.Y. · Everyday assistant', 'Reachy · Demo', 'MicroDuck · Demo']);
    const navigation = page.getByRole('navigation', {name: 'Main navigation'});
    assert.deepEqual(await navigation.getByRole('link').allTextContents(), ['Home', 'Habitat', 'Rooms', 'Devices', 'Automation']);
    const labelLines = await navigation.getByRole('link').evaluateAll(links => links.map(link => {
      const text = document.createRange();
      text.selectNodeContents(link);
      return text.getClientRects().length;
    }));
    assert.deepEqual(labelLines, [1, 1, 1, 1, 1], 'all five navigation labels fit on one line at 320px');
    assert.equal(await page.getByRole('heading', {name: 'Conversation', exact: true}).count(), 1);
    const posts: string[] = [];
    page.on('request', request => {
      if (request.method() !== 'POST') return;
      const path = new URL(request.url()).pathname;
      if (/^\/api\/sdk\/v1\/(request|respond|sync|upload|publish)$/.test(path)) posts.push(path);
    });
    const pages = page.getByText('Companion pages', {exact: true});
    await pages.press('Enter');
    const siblings = page.getByRole('navigation', {name: 'companions pages', exact: true});
    assert.equal(await siblings.getByRole('link', {name: 'Conversation', exact: true}).getAttribute('aria-current'), 'page');
    assert.equal(await siblings.getByRole('link', {name: 'Reachy', exact: true}).getAttribute('href'), '#/module/companions/reachy');
    assert.equal(await siblings.getByRole('link', {name: 'MicroDuck', exact: true}).getAttribute('href'), '#/module/companions/microduck');
    await pages.press('Enter');
    await layout(1440, 1000);
    assert.equal(await message.inputValue(), 'Draft through resize and menu');
    assert.deepEqual(posts, [], 'layout and navigation disclosure send no command, sync or endpoint registration');
    for (const name of ['B.U.N.N.Y. Everyday assistant', 'Reachy Demo', 'MicroDuck Demo']) {
      await profiles.getByRole('button', {name, exact: true}).waitFor();
    }

    await navigation.getByRole('link', {name: 'Home', exact: true}).click();
    await page.getByRole('region', {name: 'Home', exact: true}).waitFor();
    await navigation.getByRole('link', {name: 'Devices', exact: true}).click();
    await page.getByRole('heading', {name: 'Devices', exact: true}).waitFor();
    await page.getByRole('button', {name: 'Other', exact: true}).click();
    await page.getByRole('link', {name: 'Conversation', exact: true}).click();
    await pages.click();
    await siblings.getByRole('link', {name: 'Reachy', exact: true}).click();
    await page.getByRole('heading', {name: 'Reachy', exact: true, level: 1}).waitFor();
    assert.equal(await siblings.getByRole('link', {name: 'Reachy', exact: true}).getAttribute('aria-current'), 'page');
    await page.getByRole('link', {name: 'Settings', exact: true}).click();
    await page.getByRole('heading', {name: 'Settings', exact: true}).waitFor();
  } finally {
    await context.close();
    await world.close();
  }
  process.stdout.write('Conversation workspace browser: fitting transcript/composer, passive disclosure, labelled profiles and retained dashboard navigation passed.\n');
}

if (import.meta.main) {
  const browser = await chromium.launch({headless: true});
  try {await conversationWorkspaceJourney(browser);}
  finally {await browser.close();}
}
