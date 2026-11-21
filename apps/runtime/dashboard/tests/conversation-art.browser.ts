import assert from 'node:assert/strict';
import {chromium, type Browser} from 'playwright';
import {feed, startWorld} from './harness.ts';

export async function conversationArtJourney(browser: Browser): Promise<void> {
  const world = await startWorld({companions: true, art: true, artRecentLimit: 1, pixooPages: true, assistantCatalog: ['create_artwork']});
  const context = await browser.newContext({reducedMotion: 'reduce'});
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    await page.goto(`${world.url}/#/module/companions/assistant`);
    await feed(page, 'connected');
    const conversation = page.getByRole('region', {name: 'B.U.N.N.Y. conversation', exact: true});
    await conversation.getByRole('button', {name: 'Enable conversation', exact: true}).click();
    const create = async (format: string, description: string) => {
      const input = {name: 'create_artwork', input: {format, description}};
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
    await page.route('**/modules/art/content/rendition.*', route => route.fulfill({status: 404, contentType: 'application/json',
      body: '{"error":{"code":"not-found"}}'}));
    await page.reload();
    await feed(page, 'connected');
    await conversation.getByText('Artwork attachment is unavailable.', {exact: true}).first().waitFor();
    await conversation.getByText('Artwork for this conversation.', {exact: true}).first().waitFor();
    world.art.act('invalid-next');
    await create('still', 'Invalid art fixture');
    await conversation.getByText('Artwork could not be created (invalid-message).', {exact: true}).waitFor();
    assert.equal(world.art.state().imageCalls, 3);
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
