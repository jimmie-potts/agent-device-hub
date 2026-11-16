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
  const profile = conversation.getByRole('combobox', {name: 'Companion profile', exact: true});
  const draft = conversation.getByRole('textbox', {name: 'Message', exact: true});
  const reply = conversation.getByRole('list', {name: 'Saved conversation messages'}).getByText(/^Synthetic result: SYNTHETIC_ASSISTANT_ANSWER/);
  const send = conversation.getByRole('button', {name: 'Send message', exact: true});
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
  const caption = (text: string) => page.locator('#conversation-demo-label').evaluate((element, label) => {
    element.textContent = `Synthetic workspace demo: ${label}`;
  }, text);
  const cursor = page.locator('#conversation-demo-cursor');
  const act = async (target: Locator, label: string, activate: () => Promise<void>): Promise<void> => {
    await caption(label);
    const bounds = await target.boundingBox();
    assert.ok(bounds);
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
  await t.expect('the picker labels the everyday assistant and both demos before selection', async () => {
    assert.deepEqual(await profile.locator('option').allTextContents(), ['B.U.N.N.Y. · Everyday assistant', 'Reachy · Demo', 'MicroDuck · Demo']);
  });

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
  const select = async (value: string): Promise<void> => {
    await profile.click();
    await profile.selectOption(value);
  };
  for (const {name, value} of [{name: 'Reachy', value: 'reachy'}, {name: 'MicroDuck', value: 'microduck'}]) {
    await act(profile, `Choose ${name} Demo in Companion profile.`, () => select(value));
    await conversation.getByText('No saved messages for this profile yet.', {exact: true}).waitFor();
    await t.expect(`${name} Demo opens its own history and empty draft`, async () => {
      assert.equal(await profile.inputValue(), value);
      assert.equal(await draft.inputValue(), '');
    });
  }
  await act(profile, 'Choose B.U.N.N.Y. in Companion profile.', () => select('bunny'));
  await reply.waitFor();
  await t.expect('B.U.N.N.Y. restores the original unsent draft and saved reply', async () => {
    assert.equal(await profile.inputValue(), 'bunny');
    assert.equal(await draft.inputValue(), text);
    assert.equal(await send.isEnabled(), true);
    assert.deepEqual(writes, [], 'browsing and typing send no command');
  });
  await caption('The original draft is back. No message was sent.');
  await page.waitForTimeout(1000);
}
