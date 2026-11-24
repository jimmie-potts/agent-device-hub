import assert from 'node:assert/strict';
import type {Locator, Page} from 'playwright';
import type {CaptureContext} from '@jimmie-potts/app-verify';

/** Browse the real conversation after the isolated assistant scenario has saved its reply. */
export async function captureConversationWorkspace(t: CaptureContext): Promise<void> {
  const page = t.page as Page;
  const viewport = page.viewportSize();
  assert.deepEqual(viewport, {width: 390, height: 844});
  await page.goto(new URL('/#/module/companions/assistant', t.url).href);
  await page.locator('main[data-feed="connected"]').waitFor();
  const conversation = page.getByRole('region', {name: 'B.U.N.N.Y. conversation', exact: true});
  // The chat profiles are chosen in the rail (Hub #1890), which at this width is the drawer behind the menu button.
  const menu = page.getByRole('button', {name: 'Open navigation', exact: true});
  const rail = page.locator('.shell>aside');
  const conversations = page.getByRole('navigation', {name: 'Conversations', exact: true});
  // Found by its class, not its role: the walkthrough clears its highlight from a row after the drawer has closed over it.
  const row = (id: string): Locator => page.locator(`.rail-conversations a[data-profile="${id}"]`);
  const openProfile = conversation.locator('.conversation-header h2');
  const draft = conversation.getByRole('textbox', {name: 'Message', exact: true});
  const reply = conversation.getByRole('list', {name: 'Saved conversation messages'}).getByText(/^Synthetic result: SYNTHETIC_ASSISTANT_ANSWER/);
  const send = conversation.getByRole('button', {name: 'Send', exact: true});
  const invitation = conversation.getByRole('heading', {name: 'What’s on your mind?', exact: true});
  await reply.waitFor();
  await send.waitFor();

  await page.evaluate(() => {
    const label = document.createElement('div');
    label.id = 'conversation-demo-label';
    label.style.cssText = 'position:fixed;top:8px;left:8px;right:8px;padding:8px;background:#111827;color:white;border:2px solid #ffcf66;border-radius:8px;font:14px system-ui;z-index:9999;pointer-events:none';
    const cursor = document.createElement('div');
    cursor.id = 'conversation-demo-cursor';
    cursor.style.cssText = 'position:fixed;left:18px;top:72px;width:20px;height:20px;border:3px solid #ffcf66;border-radius:50%;transform:translate(-50%,-50%);z-index:10000;pointer-events:none';
    document.body.append(label, cursor);
    document.addEventListener('pointermove', event => {
      cursor.style.left = `${event.clientX}px`;
      cursor.style.top = `${event.clientY}px`;
    });
  });
  // The label sits at the top of the page. For a control under it, such as the menu button, it moves to the bottom,
  // so the control and its highlight stay in view.
  const caption = (text: string, low = false) => page.locator('#conversation-demo-label').evaluate((element, [label, bottom]) => {
    element.textContent = `Synthetic workspace demo: ${String(label)}`;
    element.style.top = bottom === true ? 'auto' : '8px';
    element.style.bottom = bottom === true ? '8px' : 'auto';
  }, [text, low] as const);
  const cursor = page.locator('#conversation-demo-cursor');
  const act = async (target: Locator, label: string, activate: () => Promise<void>): Promise<void> => {
    const bounds = await target.boundingBox();
    assert.ok(bounds);
    await caption(label, bounds.y < 64);
    await target.evaluate(node => {node.style.outline = '3px solid #ffcf66';});
    const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, {steps: reduced ? 1 : 8});
    await page.waitForTimeout(350);
    await cursor.evaluate(node => {node.style.background = '#ffcf66';});
    await activate();
    await page.waitForTimeout(250);
    await cursor.evaluate(node => {node.style.background = 'transparent';});
    await target.evaluate(node => {node.style.outline = '';});
    await page.waitForTimeout(500);
  };

  await caption('The saved reply and Send share the phone viewport.');
  await t.expect('the saved reply and Send fit at 390 by 844 without document scrolling', async () => {
    const bounds = await Promise.all([reply.boundingBox(), send.boundingBox()]);
    assert.ok(bounds.every(box => box !== null && box.x >= 0 && box.y >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844));
    assert.equal(await reply.evaluate(node => {
      const box = node.getBoundingClientRect(), transcript = node.closest('.conversation-transcript')?.getBoundingClientRect();
      return transcript !== undefined && box.top >= transcript.top && box.bottom <= transcript.bottom;
    }), true);
    assert.deepEqual(await page.evaluate(() => [scrollY, document.documentElement.scrollWidth, document.documentElement.scrollHeight]), [0, 390, 844]);
  });
  await page.waitForTimeout(900);
  const writes: string[] = [];
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    const path = new URL(request.url()).pathname;
    if (path === '/api/v2/modules/companions/upload' || path === '/api/sdk/v1/request') writes.push(path);
  });
  const text = 'Check the next step.';
  await act(draft, 'Click Message and type an unsent draft.', async () => {
    await draft.click();
    await draft.pressSequentially(text, {delay: 35});
  });
  /** Opens the drawer with its button, then chooses a conversation in it. The drawer closes behind the choice. */
  const choose = async (id: string, name: string, first = false): Promise<void> => {
    await act(menu, 'Open navigation to choose a conversation.', async () => {
      await menu.click();
      await row(id).waitFor();
    });
    if (first) await t.expect('the rail lists each conversation by its name, with no Demo label', async () => {
      assert.deepEqual(await conversations.getByRole('link').evaluateAll(links => links.map(link => [...link.querySelectorAll('.rail-text > *')].map(part => part.textContent).join(' '))),
        ['B.U.N.N.Y.', 'Reachy', 'MicroDuck']);
    });
    await act(row(id), `Choose ${name} in Conversations.`, async () => {
      await row(id).click();
      await rail.waitFor({state: 'hidden'});
    });
  };
  for (const {name, value, first} of [{name: 'Reachy', value: 'reachy', first: true}, {name: 'MicroDuck', value: 'microduck', first: false}]) {
    await choose(value, name, first);
    await t.expect(`${name} shows an invitation, no saved messages and a blank draft`, async () => {
      await invitation.waitFor();
      assert.equal(await openProfile.innerText(), name);
      assert.equal(await conversation.locator('.conversation-header small').count(), 0, 'no Demo label');
      assert.equal(await conversation.locator('[data-message]').count(), 0);
      assert.equal(await draft.inputValue(), '');
    });
  }
  await choose('bunny', 'B.U.N.N.Y.');
  await reply.waitFor();
  await t.expect('B.U.N.N.Y. restores the original unsent draft and saved reply', async () => {
    assert.equal(await openProfile.innerText(), 'B.U.N.N.Y.');
    assert.equal(await conversation.locator('.conversation-header small').count(), 0);
    assert.equal(await invitation.count(), 0);
    assert.equal(await draft.inputValue(), text);
    assert.equal(await send.isEnabled(), true);
    assert.deepEqual(writes, [], 'browsing and typing send no command');
  });
  await caption('The original draft is back. No message was sent.');
  await page.waitForTimeout(1000);
}
