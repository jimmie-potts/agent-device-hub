import assert from 'node:assert/strict';
import {chromium, type Browser} from 'playwright';
import {feed, startWorld} from './harness.ts';
import {chooseConversation, conversationLink, destinationLink, destinationNames, openDeviceMenu, showRail} from './navigation-helpers.ts';

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

    // The reading column and the composer share one measure of at most 920px (Hub #1890); the chat profiles left the
    // page for the rail, which gave the width back. `widths` records the composer's width at each size.
    const widths = new Map<string, number>();
    const layout = async (width: number, height: number): Promise<number> => {
      await page.setViewportSize({width, height});
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
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
      assert.ok(column !== null && input !== null && column.width <= 921
        && Math.abs(column.x - input.x) <= 1 && Math.abs(column.width - input.width) <= 1,
      `reading content and composer share their measure at ${String(width)}x${String(height)}`);
      widths.set(`${String(width)}x${String(height)}`, input.width);
      return reading.height;
    };

    await layout(1024, 800);
    await layout(1280, 800);
    const short = await layout(1440, 800);
    // Before this story the composer was 689.75px wide at 1024px and 760px at 1280px and 1440px.
    assert.ok((widths.get('1024x800') ?? 0) > 760, `the composer is wider than the old measure at 1024px (${String(widths.get('1024x800'))})`);
    for (const size of ['1280x800', '1440x800']) assert.ok(Math.abs((widths.get(size) ?? 0) - 920) <= 1, `the composer is 920px wide at ${size} (${String(widths.get(size))})`);
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

    // The chat profiles are chosen in the rail (Hub #1890). The page has no profile list and no selector of its own.
    assert.equal(await page.getByRole('navigation', {name: 'Conversation profiles'}).count(), 0, 'the page has no profile column');
    assert.equal(await page.getByRole('combobox', {name: 'Companion profile'}).count(), 0, 'the page has no profile selector');
    const conversations = page.getByRole('navigation', {name: 'Conversations', exact: true});
    const navigation = page.getByRole('navigation', {name: 'Main navigation'});
    // At this width the rail is a drawer (Hub #1887), so the destinations and the conversations are checked with it open.
    await showRail(page);
    assert.deepEqual(await destinationNames(page), ['Home', 'Companions', 'Rooms', 'Devices', 'Automation']);
    assert.deepEqual(await conversations.getByRole('link').evaluateAll(links => links.map(link => [...link.querySelectorAll('.rail-text > *')].map(part => part.textContent).join(' '))),
      ['B.U.N.N.Y.', 'Reachy Demo', 'MicroDuck Demo'], 'both demos are labelled before they are chosen');
    const labelLines = await navigation.locator('a, button').evaluateAll(links => links.map(link => {
      const label = link.querySelector('.rail-text'), text = document.createRange();
      if (label === null) return 0;
      text.selectNodeContents(label);
      return text.getClientRects().length;
    }));
    assert.deepEqual(labelLines, [1, 1, 1, 1, 1], 'all five navigation labels fit on one line in the 320px drawer');
    await page.keyboard.press('Escape');
    await page.locator('.shell>aside').waitFor({state: 'hidden'});
    // One header row: the page's title stays as its heading and is not drawn, and the conversation's own row names the
    // open profile beside Details.
    const title = page.getByRole('heading', {name: 'Conversation', exact: true});
    assert.equal(await title.count(), 1);
    assert.ok(((await title.boundingBox())?.width ?? 0) <= 1, 'the page title is not drawn');
    const header = assistant.locator('.conversation-header');
    const [name, detailsButton] = await Promise.all([header.getByRole('heading', {name: 'B.U.N.N.Y.', exact: true}).boundingBox(), header.getByRole('button', {name: 'Details', exact: true}).boundingBox()]);
    assert.ok(name !== null && detailsButton !== null && name.y + name.height / 2 > detailsButton.y && name.y + name.height / 2 < detailsButton.y + detailsButton.height,
      'the profile name and Details share one row');
    assert.equal(await header.locator('.conversation-demo-tag').count(), 0, 'the everyday assistant has no Demo label');
    const posts: string[] = [];
    page.on('request', request => {
      if (request.method() !== 'POST') return;
      const path = new URL(request.url()).pathname;
      if (/^\/api\/sdk\/v1\/(request|respond|sync|upload|publish)$/.test(path)) posts.push(path);
    });
    // The other companion pages are reached from Companions (Hub #1950), not the Devices menu, which lists hardware
    // only; the page has no disclosure of its own.
    assert.equal(await page.getByText('Companion pages', {exact: true}).count(), 0);
    assert.equal(await page.getByRole('navigation', {name: 'companions pages', exact: true}).count(), 0);
    const menu = await openDeviceMenu(page);
    assert.equal(await menu.locator('a[href^="#/module/companions/"]').count(), 0, 'the Devices menu lists no companion page');
    await page.keyboard.press('Escape');
    await menu.waitFor({state: 'detached'});
    await page.keyboard.press('Escape');
    await page.locator('.shell>aside').waitFor({state: 'hidden'});
    await layout(1440, 1000);
    assert.equal(await message.inputValue(), 'Draft through resize and menu');
    // Choosing a demo in the rail shows its own empty history and blank draft, labelled Demo in the header row. The
    // everyday assistant's draft and saved exchange are there again when it is chosen. None of it sends a command.
    await chooseConversation(page, 'reachy');
    assert.equal(await header.locator('.conversation-demo-tag').innerText(), 'Demo');
    assert.equal(await (await conversationLink(page, 'reachy')).getAttribute('aria-current'), 'page');
    assert.equal(await (await conversationLink(page, 'bunny')).getAttribute('aria-current'), null);
    await assistant.getByText('Demo profile. No paid calls.', {exact: true}).waitFor();
    await invitation.waitFor();
    assert.equal(await assistant.locator('[data-message]').count(), 0, 'a demo has its own history');
    assert.equal(await message.inputValue(), '', 'and its own draft');
    await message.fill('Reachy draft');
    await chooseConversation(page, 'bunny');
    await transcript.getByText(/Synthetic result: Short answer/).waitFor();
    assert.equal(await message.inputValue(), 'Draft through resize and menu');
    await chooseConversation(page, 'reachy');
    assert.equal(await message.inputValue(), 'Reachy draft', 'each profile keeps its draft while the page is open');
    await chooseConversation(page, 'bunny');
    await transcript.getByText(/Synthetic result: Short answer/).waitFor();
    // The jump palette (#1888) leaves a slash typed in the composer as text, opens from it with Control and K, and
    // returns focus and the draft when it closes.
    const palette = page.getByRole('dialog', {name: 'Jump to a page', exact: true});
    await message.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('/');
    assert.equal(await message.inputValue(), 'Draft through resize and menu/', 'a slash typed in the composer is text');
    assert.equal(await palette.count(), 0, 'a slash typed in the composer does not open the palette');
    // Command and K on a Mac, Control and K elsewhere: on a Mac, Control and K in a field deletes to the end of the line.
    await page.keyboard.press('ControlOrMeta+k');
    await palette.waitFor();
    assert.equal(await palette.getByRole('option', {name: /Conversation/}).count() > 0, true, 'the palette offers the declared Conversation page');
    await page.keyboard.press('Escape');
    await palette.waitFor({state: 'detached'});
    const composer = await message.elementHandle();
    await page.waitForFunction(element => element !== null && element === document.activeElement, composer);
    await page.keyboard.press('Backspace');
    assert.equal(await message.inputValue(), 'Draft through resize and menu', 'the palette returns focus to the composer and keeps its draft');
    // Details is a modal dialog at phone width. The palette could only open underneath it, so its keys do nothing there.
    await page.setViewportSize({width: 390, height: 844});
    await assistant.getByRole('button', {name: 'Details', exact: true}).click();
    const details = page.locator('.conversation-details');
    await details.getByRole('heading', {name: 'Conversation details', exact: true}).waitFor();
    assert.equal(await page.locator('dialog:modal').count(), 1, 'Details is modal at phone width');
    await page.keyboard.press('ControlOrMeta+k');
    await page.keyboard.press('/');
    assert.equal(await palette.count(), 0, 'the palette does not open under a modal dialog');
    assert.equal(await page.locator('dialog:modal').count(), 1, 'and the dialog stays open');
    await details.getByRole('button', {name: 'Close details', exact: true}).click();
    await details.waitFor({state: 'hidden'});
    await page.setViewportSize({width: 1440, height: 1000});
    assert.deepEqual(posts, [], 'layout, the Devices menu, choosing a profile in the rail, Details and the jump palette send no command, sync or endpoint registration');
    // On the Conversation page the rail boxes the open conversation, and Companions is marked lightly above it.
    const companionsRow = navigation.getByRole('link', {name: 'Companions', exact: true});
    assert.equal(await companionsRow.getAttribute('aria-current'), 'page');
    assert.equal(await companionsRow.getAttribute('data-ancestor'), '', 'the Companions row leaves the box to the open conversation');
    assert.equal(await navigation.getByRole('button', {name: 'Devices', exact: true}).getAttribute('aria-current'), null, 'the Conversation page is not under Devices');

    await navigation.getByRole('link', {name: 'Home', exact: true}).click();
    await page.getByRole('region', {name: 'Home', exact: true}).waitFor();
    assert.equal(await conversations.locator('[aria-current]').count(), 0, 'no conversation is marked open on another page');
    await (await conversationLink(page, 'bunny')).click();
    await assistant.waitFor();
    // A companion profile opens from the Companions overview, and the page shows Companions as its parent.
    await (await destinationLink(page, 'Companions')).click();
    await page.getByRole('region', {name: 'Companions', exact: true}).getByRole('link', {name: 'Reachy', exact: true}).click();
    await page.getByRole('heading', {name: 'Reachy', exact: true, level: 1}).waitFor();
    assert.equal(await page.getByRole('navigation', {name: 'Breadcrumb', exact: true}).getByRole('link').textContent(), 'Companions');
    assert.equal(await page.getByRole('navigation', {name: 'companions pages', exact: true}).getByRole('link', {name: 'Reachy', exact: true}).getAttribute('aria-current'), 'page');
    await page.getByRole('link', {name: 'Settings', exact: true}).click();
    await page.getByRole('heading', {name: 'Settings', exact: true}).waitFor();
  } finally {
    await context.close();
    await world.close();
  }
  process.stdout.write('Conversation workspace browser: fitting transcript/composer at the 920px measure, one header row, profiles chosen in the rail and retained dashboard navigation passed.\n');
}

if (import.meta.main) {
  const browser = await chromium.launch({headless: true});
  try {await conversationWorkspaceJourney(browser);}
  finally {await browser.close();}
}
