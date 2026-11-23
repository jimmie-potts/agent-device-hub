import assert from 'node:assert/strict';
import {chromium, type Browser} from 'playwright';
import {expect} from 'playwright/test';
import {feed, startWorld} from './harness.ts';
import {worldClock} from './world-clock.ts';

export async function pixooConfirmationJourney(browser: Browser): Promise<void> {
  const clock = worldClock();
  let reading: Promise<number | undefined> = Promise.resolve(35);
  let release: (value: number | undefined) => void = () => {};
  const delayed = new Promise<number | undefined>(resolve => {release = resolve;});
  const world = await startWorld({companions: true, pixooPages: true, clock, assistantCatalog: ['control_brightness_set'],
    pixooReadback: {label: 'Studio Display', reading: () => reading}});
  const context = await browser.newContext({reducedMotion: 'reduce'});
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    await page.goto(world.url + '/#/module/companions/assistant');
    await feed(page, 'connected');
    await clock.advance(100);
    const conversation = page.getByRole('region', {name: 'B.U.N.N.Y. conversation', exact: true});
    await conversation.getByRole('button', {name: 'Enable conversation', exact: true}).click();
    const input = conversation.getByRole('textbox', {name: 'Message', exact: true});
    const send = conversation.getByRole('button', {name: 'Send', exact: true});
    const approve = async (percent: number, beforeApproval?: () => void) => {
      await input.fill('SYNTHETIC_CATALOG ' + JSON.stringify({name: 'control_brightness_set',
        input: {owner: 'bunny/modules/pixoo', target: 'pixoo-1', arguments: JSON.stringify({percent})}}));
      await send.click();
      await expect(conversation.getByText(`Set Studio Display brightness to ${percent}%?`, {exact: true}).first()).toBeVisible();
      const proposal = conversation.getByRole('article', {name: 'Proposed command', exact: true});
      await proposal.locator('summary').click();
      await expect(proposal.locator('pre')).toContainText('bunny/modules/pixoo');
      await expect(proposal.locator('pre')).toContainText('configurationRevision');
      await expect(proposal.locator('pre')).toContainText('generation');
      beforeApproval?.();
      await proposal.getByRole('button', {name: 'Approve proposal', exact: true}).click();
      await expect(conversation.getByRole('button', {name: 'Approve proposal', exact: true})).toHaveCount(0);
      await clock.advance(50);
    };
    await approve(35);
    await expect(conversation.getByText('Studio Display reports 35% brightness.')).toBeVisible();
    assert.equal(world.pixooState().writes, 1);

    await approve(35);
    await expect(conversation.getByText('Studio Display reports 35% brightness.')).toHaveCount(2);
    assert.equal(world.pixooState().writes, 2, 'an already-matching value still uses one write and a fresh reading');

    reading = delayed;
    await approve(65);
    await expect.poll(() => world.pixooState().writes).toBe(3);
    await clock.advance(1050);
    const pending = conversation.getByText('Brightness command sent. I’ll update this reply when confirmation for Studio Display is available.');
    await expect(pending).toBeVisible();

    await input.fill('Wait for my next answer.');
    await send.click();
    await conversation.getByRole('textbox', {name: 'Answer', exact: true}).waitFor();
    release(65);
    const update = conversation.getByRole('article', {name: 'assistant message'}).filter({hasText: 'Studio Display reports 65% brightness.'});
    await expect(update).toHaveCount(1);
    await update.getByRole('link', {name: 'Update to earlier reply'}).click();
    await expect(pending.locator('xpath=ancestor::li')).toBeFocused();
    assert.equal(world.pixooState().writes, 3);

    await page.reload();
    await feed(page, 'connected');
    await expect(pending).toBeVisible();
    await expect(update).toHaveCount(1);
    assert.equal(world.pixooState().writes, 3);

    await conversation.getByRole('textbox', {name: 'Answer', exact: true}).fill('Continue');
    await conversation.getByRole('button', {name: 'Answer', exact: true}).click();
    await expect(send).toBeDisabled();
    await expect(conversation.getByText(/Synthetic result: Continue/)).toBeVisible();
    reading = Promise.resolve(undefined);
    await approve(70);
    await expect(conversation.getByText('Brightness command sent. I couldn’t confirm Studio Display’s brightness.')).toBeVisible();
    assert.equal(world.pixooState().writes, 4);

    const sent = world.pixooState().sent;
    await approve(75, () => {world.pixooMode('silent');});
    await clock.advance(1100);
    await expect(conversation.getByText(/Brightness request accepted.*confirmation for Studio Display is available/)).toBeVisible();
    await clock.advance(5000);
    await expect(conversation.getByText('I couldn’t tell whether the brightness command took effect.', {exact: true})).toBeVisible();
    assert.equal(world.pixooState().sent, sent + 1, 'a lost reply never replays the command');
    assert.equal(world.pixooState().writes, 4, 'the fixture never acknowledged the lost reply');
  } finally {
    release(undefined);
    await context.close();
    await world.close();
  }
}

if (import.meta.main) {
  const browser = await chromium.launch({headless: true});
  try {
    await pixooConfirmationJourney(browser);
    process.stdout.write('Pixoo Conversation confirmed an in-turn reading, linked a later reading to an earlier reply, and reported unavailable readback.\n');
  }
  finally {await browser.close();}
}
