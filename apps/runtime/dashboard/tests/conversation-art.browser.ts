import assert from 'node:assert/strict';
import {chromium, type Browser} from 'playwright';
import {openJourneyContext} from './browser-context.ts';
import {expect} from 'playwright/test';
import {decodeConversationWindow} from '../../../../modules/companions/dist/src/frontend/conversation-history.js';
import {feed, startWorld} from './harness.ts';

export async function conversationArtJourney(browser: Browser): Promise<void> {
  const world = await startWorld({companions: true, art: true, artRecentLimit: 1, pixooPages: true, assistantCatalog: ['create_artwork', 'control_art_show']});
  const context = await openJourneyContext(browser, {reducedMotion: 'reduce'});
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    await page.goto(`${world.url}/#/module/companions/assistant`);
    await feed(page, 'connected');
    const conversation = page.getByRole('region', {name: 'B.U.N.N.Y. conversation', exact: true});
    const shows: unknown[] = [];
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v2/commands/art-show') shows.push(request.postDataJSON());
    });
    await conversation.getByRole('button', {name: 'Enable conversation', exact: true}).click();
    const create = async (format: string, description: string, showTargets?: string[]) => {
      const input = {name: 'create_artwork', input: {format, description, ...(showTargets === undefined ? {} : {showTargets})}};
      await conversation.getByRole('textbox', {name: 'Message', exact: true}).fill(`SYNTHETIC_CATALOG ${JSON.stringify(input)}`);
      await conversation.getByRole('button', {name: 'Send', exact: true}).click();
      await conversation.getByRole('button', {name: 'Approve proposal', exact: true}).click();
    };
    const send = conversation.getByRole('button', {name: 'Send', exact: true});
    await conversation.getByRole('textbox', {name: 'Message', exact: true}).fill('A text-only synthetic message');
    await send.click();
    await conversation.getByRole('textbox', {name: 'Answer', exact: true}).fill('Keep this response');
    await conversation.getByRole('button', {name: 'Answer', exact: true}).click();
    await conversation.getByText(/Synthetic result: Keep this response/).waitFor();
    await create('still', 'Moon above a blue garden');
    await conversation.getByRole('img', {name: 'Moon above a blue garden', exact: true}).waitFor();
    await create('gif', 'Moving moon above a blue garden');
    await conversation.getByRole('img', {name: 'Moving moon above a blue garden', exact: true}).waitFor();
    await conversation.getByRole('button', {name: 'Play animation', exact: true}).click();
    const gif = conversation.locator('img[alt="Moving moon above a blue garden"]');
    await gif.waitFor();
    await page.waitForFunction(() => {
      const image = document.querySelector<HTMLImageElement>('img[alt="Moving moon above a blue garden"]');
      return image !== null && image.complete && image.naturalWidth > 0;
    });
    const src = await gif.getAttribute('src');
    assert.ok(src !== null && src.startsWith('/modules/art/content/rendition.'));
    const denied = await fetch(world.url + src);
    assert.ok([401, 403].includes(denied.status), 'the rendition is private');
    const distinctFrames = await gif.evaluate(async img => {
      const response = await fetch((img as HTMLImageElement).src);
      const decoder = new ImageDecoder({data: await response.arrayBuffer(), type: 'image/gif'});
      try {
        await decoder.tracks.ready;
        const frames = decoder.tracks.selectedTrack?.frameCount ?? 0;
        if (frames < 2) return false;
        const first = (await decoder.decode({frameIndex: 0})).image;
        const second = (await decoder.decode({frameIndex: frames - 1})).image;
        try {
          const left = new Uint8Array(first.allocationSize()), right = new Uint8Array(second.allocationSize());
          await first.copyTo(left);
          await second.copyTo(right);
          return left.some((value, index) => value !== right[index]);
        } finally {first.close(); second.close();}
      } finally {decoder.close();}
    });
    assert.equal(distinctFrames, true);
    assert.equal(world.logs.some(entry => /^bunny\.cmd\.(art-stage|art-ambient-set|moment-play)\./.test(String(entry.attributes['bunny.routing.key']))), false,
      'Conversation generation sent no device commands');
    await conversation.getByRole('button', {name: 'Pause animation', exact: true}).click();
    await conversation.getByRole('img', {name: 'Moving moon above a blue garden', exact: true}).waitFor();
    const navigation = page.getByRole('navigation', {name: 'Conversations', exact: true});
    await navigation.locator('a[data-profile="reachy"]').click();
    await conversation.getByRole('heading', {name: 'Reachy', exact: true}).waitFor();
    assert.equal(await conversation.getByRole('img', {name: 'Moon above a blue garden', exact: true}).count(), 0);
    await navigation.locator('a[data-profile="bunny"]').click();
    await conversation.getByRole('img', {name: 'Moon above a blue garden', exact: true}).waitFor();
    await page.reload();
    await feed(page, 'connected');
    await conversation.getByRole('img', {name: 'Moon above a blue garden', exact: true}).waitFor();
    await conversation.getByRole('button', {name: 'Play animation', exact: true}).waitFor();
    assert.equal(world.art.state().imageCalls, 2);
    assert.equal(await conversation.getByRole('img', {name: 'Moon above a blue garden', exact: true}).count(), 1);
    await conversation.getByText(/Synthetic result: Keep this response/).waitFor();
    const oldGif = conversation.getByRole('article', {name: 'assistant message'}).filter({has: page.getByRole('img', {name: 'Moving moon above a blue garden'})});
    for (const limits of [{formats: ['png'], maxBytes: 1_000_000}, {formats: ['gif'], maxBytes: 1}]) {
      await page.route('**/api/v2/automation/art/targets?view=approval', async route => {
        const response = await route.fetch();
        const body: unknown = await response.json();
        assert.ok(typeof body === 'object' && body !== null && 'targets' in body && Array.isArray(body.targets));
        const targets = body.targets.map((row: unknown) => {
          assert.ok(typeof row === 'object' && row !== null && 'target' in row);
          return row.target === 'pixoo-1' ? {...row, ...limits} : row;
        });
        await route.fulfill({response, json: {...body, targets}});
      }, {times: 1});
      await oldGif.getByRole('button', {name: 'Show on…', exact: true}).click();
      await expect(oldGif.getByRole('checkbox', {name: /pixoo-1/i})).toBeDisabled();
      await expect(oldGif.getByText(/unsupported format or file size/i)).toBeVisible();
      await oldGif.getByRole('button', {name: 'Cancel', exact: true}).click();
    }
    await page.route('**/api/v2/automation/art/targets?view=approval', async route => {
      const response = await route.fetch();
      const body: unknown = await response.json();
      assert.ok(typeof body === 'object' && body !== null && 'targets' in body && Array.isArray(body.targets));
      const physical: unknown[] = body.targets;
      await route.fulfill({response, json: {...body, targets: [...physical, {kind: 'pixoo', target: 'browser', label: 'Lobby display'}]}});
    }, {times: 1});
    await oldGif.getByRole('button', {name: 'Show on…', exact: true}).click();
    await expect(oldGif.getByText(/Lobby display.*reserved/)).toBeVisible();
    await expect(oldGif.getByRole('checkbox', {name: 'Browser', exact: true})).toBeEnabled();
    await expect(oldGif.getByRole('checkbox', {name: /pixoo-1/i})).toBeEnabled();
    await oldGif.getByRole('button', {name: 'Cancel', exact: true}).click();
    assert.equal(shows.length, 0, 'Opening and dismissing the saved attachment makes no display request');
    // The simulated panel starts passive. Let its status base draw so it can admit a moment.
    const mode = await world.credentialAction('device-mode-set', 'pixoo-1', {mode: 'free'});
    assert.ok(mode.status >= 200 && mode.status < 300, JSON.stringify(mode.body));
    await expect.poll(() => world.pixooState().shown).not.toBeNull();
    await create('gif', 'Rotating striped pennant', ['pixoo']);
    const pennant = conversation.getByRole('article', {name: 'assistant message'}).filter({has: page.getByRole('img', {name: 'Rotating striped pennant', exact: true})});
    await pennant.getByRole('button', {name: 'Approve display', exact: true}).waitFor();
    const selectedDisplay = pennant.getByRole('checkbox', {name: /pixoo-1/i});
    assert.equal(await selectedDisplay.isChecked(), true);
    await create('still', 'Clockwork sunflower');
    await conversation.getByRole('img', {name: 'Clockwork sunflower', exact: true}).waitFor();
    const history = decodeConversationWindow(await page.evaluate(async (): Promise<unknown> =>
      (await fetch('/modules/companions/content/conversation?profile=bunny&view=recent')).json()), {profile: 'bunny'});
    const attachment = history.messages.find(message => message.attachment?.description === 'Rotating striped pennant')?.attachment;
    assert.ok(attachment);
    const mediaResult = await page.evaluate(async (id): Promise<unknown> => (await fetch('/modules/art/content/conversation.' + id)).json(), attachment.requestId);
    assert.ok(typeof mediaResult === 'object' && mediaResult !== null && 'artworkId' in mediaResult && typeof mediaResult.artworkId === 'string');
    assert.partialDeepStrictEqual(mediaResult, {usableKinds: ['ui', 'pixoo', 'tidbyt']}, 'one generated GIF can be prepared for each configured kind without another provider call');
    assert.equal(shows.length, 0, 'Generating artwork and preparing the proposal sends no show');
    const [showResponse] = await Promise.all([page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v2/commands/art-show'),
      pennant.getByRole('button', {name: 'Approve display', exact: true}).click()]);
    const receipt: unknown = await showResponse.json();
    assert.partialDeepStrictEqual(receipt, {status: 'accepted'});
    const results = pennant.getByRole('list', {name: 'Display results'});
    await expect(results).toContainText(/Preparation: succeeded/);
    await expect(results).toContainText(/Presentation: (accepted|sent|succeeded)/, {timeout: 25_000});
    assert.equal(shows.length, 1);
    assert.partialDeepStrictEqual(shows[0], {data: {artworkId: mediaResult.artworkId, targets: ['pixoo-1']}});
    await page.reload();
    await feed(page, 'connected');
    await pennant.getByRole('img', {name: 'Rotating striped pennant', exact: true}).waitFor();
    await expect(results).toContainText(/pixoo-1/i);
    await expect(results).toContainText(/Preparation: succeeded/);
    await expect(results).toContainText(/Presentation: (accepted|sent|succeeded)/);
    assert.equal(shows.length, 1, 'Restoring a conversation sends no show');
    const sunflower = conversation.getByRole('article', {name: 'assistant message'}).filter({has: page.getByRole('img', {name: 'Clockwork sunflower'})});
    await sunflower.getByRole('button', {name: 'Show on…', exact: true}).click();
    await sunflower.getByRole('checkbox', {name: 'Browser', exact: true}).check();
    await page.route('**/api/v2/commands/art-show', route => route.abort('failed'), {times: 1});
    await sunflower.getByRole('button', {name: 'Approve display', exact: true}).click();
    await sunflower.getByText(/Uncertain result/).waitFor();
    await page.reload();
    await feed(page, 'connected');
    const anotherShow = sunflower.getByRole('button', {name: 'Show on…', exact: true});
    await anotherShow.waitFor();
    await expect(sunflower.getByRole('list', {name: 'Display results'})).toContainText(/Browser.*awaiting evidence/i);
    assert.equal(await anotherShow.isDisabled(), true, 'An unknown dispatch keeps the retained request locked');
    assert.equal(shows.length, 2, 'Reload never replays a show with a lost reply');
    await page.route('**/modules/art/content/rendition.*', route => route.fulfill({status: 404, contentType: 'application/json',
      body: '{"error":{"code":"not-found"}}'}));
    await page.reload();
    await feed(page, 'connected');
    await conversation.getByText('Artwork attachment is unavailable.', {exact: true}).first().waitFor();
    await conversation.getByText('Artwork for this conversation.', {exact: true}).first().waitFor();
    world.art.act('invalid-next');
    await create('still', 'Invalid art fixture');
    await conversation.getByText('Artwork could not be created (invalid-message).', {exact: true}).waitFor();
    assert.equal(world.art.state().imageCalls, 5);
  } finally {
    await context.close();
    await world.close();
  }
}

if (import.meta.main) {
  const browser = await chromium.launch({headless: true});
  try {await conversationArtJourney(browser);}
  finally {await browser.close();}
}
