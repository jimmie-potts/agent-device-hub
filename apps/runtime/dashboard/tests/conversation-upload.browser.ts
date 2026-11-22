import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ART_SHOW_LEAD_MS, MAX_ART_ATTACHMENT_BYTES, artShowSurfaces} from '@jimmie-potts/event-contracts/v2/art-show';
import {SimulatedTronbyt} from '@jimmie-potts/tidbyt';
import {chromium, expect, type Browser} from 'playwright/test';
import sharp from 'sharp';
import {sessionStarted, turnStarted} from '../../dist/tests/fixtures/agents.js';
import {feed, startWorld} from './harness.ts';
import {worldClock} from './world-clock.ts';

export async function conversationUploadJourney(browser: Browser): Promise<void> {
  const clock = worldClock(), tronbyt = new SimulatedTronbyt({now: () => clock.clock.now()});
  const world = await startWorld({companions: true, art: true, pixooPages: true, tidbyt: true, tronbyt, clock});
  const context = await browser.newContext({reducedMotion: 'reduce'});
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await clock.install(page);
  const still = await sharp({create: {width: 82, height: 60, channels: 3, background: '#3c784b'}}).png().toBuffer();
  const pixels = Buffer.concat([Buffer.alloc(64 * 32 * 3, 24), Buffer.alloc(64 * 32 * 3, 190)]);
  const gif = await sharp(pixels, {raw: {width: 64, height: 64, pageHeight: 32, channels: 3}})
    .gif({delay: [100, 200]}).toBuffer();
  type Payload = {requestId: string; data: {action?: string; artworkId?: string; targets?: string[]}};
  const requests: ({family: string} & Payload)[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => {errors.push(error.name);});
  page.on('request', request => {
    const [, family] = /^\/api\/v2\/commands\/(art-show|art-attachment-edit)$/.exec(new URL(request.url()).pathname) ?? [];
    if (family !== undefined && request.method() === 'POST') requests.push({family, ...request.postDataJSON() as Payload});
  });
  const displays = () => requests.filter(item => item.family === 'art-show');
  const saves = () => requests.filter(item => item.data.action === 'save');
  const catalog = async (): Promise<{artworkId: string}[]> => {
    const response = await fetch(`${world.url}/modules/art/content/catalog`, {headers: {authorization: `Bearer ${world.readerToken}`}});
    assert.equal(response.status, 200);
    const {artworks} = await response.json() as {artworks: {artworkId: string}[]};
    return artworks;
  };
  const conversation = page.getByRole('region', {name: 'B.U.N.N.Y. conversation', exact: true});
  const attachment = conversation.getByRole('region', {name: 'Artwork attachment', exact: true});
  const preview = attachment.getByRole('img', {name: 'Attached artwork', exact: true});
  const remove = () => attachment.getByRole('button', {name: 'Remove attachment', exact: true}).click();
  const picker = async (bytes: Buffer, mimeType: string, name: string): Promise<void> => {
    const button = conversation.getByRole('button', {name: /^(Attach|Replace attachment)$/});
    await expect(button).toBeEnabled();
    await button.focus();
    const chooser = page.waitForEvent('filechooser');
    await button.press('Enter');
    await (await chooser).setFiles({name, mimeType, buffer: bytes});
  };
  const drop = async (bytes: Buffer, mimeType: string, name: string): Promise<void> => {
    const data = await page.evaluateHandle(({base64, mimeType, name}) => {
      const transfer = new DataTransfer(), contents = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      transfer.items.add(new File([contents], name, {type: mimeType}));
      return transfer;
    }, {base64: bytes.toString('base64'), mimeType, name});
    try {await conversation.getByRole('textbox', {name: 'Message', exact: true}).dispatchEvent('drop', {dataTransfer: data});}
    finally {await data.dispose();}
  };
  const admittedMoment = async (index: number): Promise<void> => {
    await expect.poll(() => displays().length).toBe(index + 1);
    const show = displays()[index];
    assert.ok(show?.data.targets !== undefined);
    const surfaces = await artShowSurfaces(show.requestId, show.data.targets);
    for (const surface of surfaces) {
      if (surface.kind === 'display') {
        await expect.poll(() => world.logs.some(record => record.event_name === 'command.admitted' &&
          record.attributes['bunny.request.id'] === surface.momentRequestId)).toBe(true);
      }
    }
  };

  try {
    await page.goto(`${world.url}/#/module/pixoo/monitor`);
    await feed(page, 'connected');
    await clock.advance(31_000);
    await world.observe(sessionStarted);
    await world.observe(turnStarted);
    const mode = page.locator('section[aria-label="Pixoo monitor"] [data-mode-target]');
    await mode.getByRole('button', {name: 'Work', exact: true}).click();
    await expect(page.getByText('Choice saved. Device results are separate.', {exact: true})).toBeVisible();
    await clock.advance(3000);
    await expect(page.getByText('Monitor presentation active', {exact: true})).toBeVisible();
    await page.goto(`${world.url}/#/module/companions/assistant`);
    await feed(page, 'connected');
    await conversation.getByRole('button', {name: 'Enable conversation', exact: true}).click();
    const available = await page.evaluate(async () => (await fetch('/api/v2/automation/art/display-availability')).json() as unknown);
    assert.match(JSON.stringify(available), /"kind":"pixoo","formats":\["png","gif"\]/, 'the disposable Pixoo has current artwork capability');
    await picker(still, 'image/png', 'still.png');
    await expect(preview).toBeVisible();
    await remove();
    await drop(gif, 'image/gif', 'moving.gif');
    await expect(preview).toBeVisible();
    await attachment.getByRole('button', {name: 'Play animation', exact: true}).click();
    const src = await preview.getAttribute('src');
    assert.ok(src !== null);
    const privateRead = await fetch(world.url + src);
    assert.ok(privateRead.status === 401 || privateRead.status === 403);
    const exact = await fetch(world.url + src, {headers: {authorization: `Bearer ${world.readerToken}`}});
    assert.deepEqual(Buffer.from(await exact.arrayBuffer()), gif);
    await remove();
    await picker(Buffer.from('synthetic invalid bytes'), 'image/gif', 'invalid.gif');
    await expect(attachment.getByRole('status')).toContainText('could not be used');
    await remove();
    await picker(Buffer.alloc(MAX_ART_ATTACHMENT_BYTES + 1), 'image/png', 'oversized.png');
    await expect(conversation.getByRole('alert')).toContainText('up to 4 MB');
    assert.equal(displays().length, 0);
    assert.equal(saves().length, 0);
    assert.equal((await catalog()).length, 0);

    await drop(still, 'image/png', 'still.png');
    await expect(preview).toBeVisible();
    await attachment.getByRole('checkbox', {name: 'Pixoo', exact: true}).check();
    await attachment.getByRole('button', {name: 'Display now', exact: true}).click();
    await admittedMoment(0);
    await clock.advance(ART_SHOW_LEAD_MS + 1500);
    const rgb = Buffer.alloc(64 * 64 * 3);
    for (let index = 0; index < rgb.byteLength; index += 3) rgb.set([0x3c, 0x78, 0x4b], index);
    const expected = createHash('sha256').update(rgb).digest('hex').slice(0, 16);
    await expect.poll(() => world.pixooState().shown?.digests).toEqual([expected]);
    assert.equal((await catalog()).length, 0);
    await clock.advance(11_000);
    await remove();

    await picker(gif, 'image/gif', 'moving.gif');
    await expect(preview).toBeVisible();
    await attachment.getByRole('button', {name: 'Save to library', exact: true}).click();
    await expect(attachment.getByText('Library. Saved to library.', {exact: true})).toBeVisible();
    assert.equal(displays().length, 1);
    const [saved] = await catalog();
    assert.ok(saved !== undefined && saved.artworkId === saves()[0]?.data.artworkId);
    await page.goto(`${world.url}/#/module/art/gallery`);
    await feed(page, 'connected');
    await page.getByRole('button', {name: 'Play saved animation', exact: true}).click();
    await expect(page.getByRole('img', {name: 'Saved animation', exact: true})).toBeVisible();
    const panel = page.getByRole('region', {name: 'Show now', exact: true});
    await panel.getByRole('checkbox', {name: 'Show on Browser', exact: true}).uncheck();
    await panel.getByRole('checkbox', {name: /Show on Pixoo/}).uncheck();
    await panel.getByRole('button', {name: 'Show now', exact: true}).click();
    await admittedMoment(1);
    await clock.advance(ART_SHOW_LEAD_MS + 1500);
    await expect.poll(() => tronbyt.state().installations.bunnymoment?.animation?.frames.length).toBe(2);
    const frames = tronbyt.state().installations.bunnymoment?.animation?.frames;
    assert.ok(frames !== undefined && JSON.stringify(frames[0]) !== JSON.stringify(frames[1]));
    await clock.advance(31_000);

    await page.goto(`${world.url}/#/module/companions/assistant`);
    await feed(page, 'connected');
    await drop(gif, 'image/gif', 'moving.gif');
    await expect(preview).toBeVisible();
    await attachment.getByRole('checkbox', {name: 'Pixoo', exact: true}).check();
    await attachment.getByRole('checkbox', {name: 'Tidbyt', exact: true}).check();
    await attachment.getByRole('button', {name: 'Display and save', exact: true}).click();
    await expect(attachment.getByText('Library. Saved to library.', {exact: true})).toBeVisible();
    await admittedMoment(2);
    await clock.advance(ART_SHOW_LEAD_MS + 1500);
    await expect.poll(() => world.pixooState().shown?.frames).toBe(2);
    await expect.poll(() => tronbyt.state().installations.bunnymoment?.animation?.frames.length).toBe(2);
    const combined = displays()[2], save = saves()[1];
    assert.ok(combined?.data.targets !== undefined && save?.data.artworkId !== undefined);
    assert.equal(combined.data.targets.length, 2);
    assert.equal(combined.data.artworkId, save.data.artworkId);
    const traceRequestIds = [
      save.data.artworkId.slice('upload-'.length), save.requestId, combined.requestId,
      ...(await artShowSurfaces(combined.requestId, combined.data.targets)).flatMap(surface =>
        surface.kind === 'display' ? [surface.prepareRequestId, surface.momentRequestId] : []),
    ];
    const traceIds = traceRequestIds.map(id => world.logs.find(record => record.event_name === 'command.queued' &&
      record.attributes['bunny.request.id'] === id)?.trace_id);
    assert.ok(traceIds[0] !== undefined && traceIds.every(id => id === traceIds[0]), 'upload, save and both device attempts share a trace');
    assert.equal(saves().length, 2);
    assert.equal((await catalog()).length, 2);
    await clock.advance(31_000);
    await remove();

    await picker(still, 'image/png', 'failure.png');
    await expect(preview).toBeVisible();
    const pixoo = attachment.getByRole('checkbox', {name: 'Pixoo', exact: true});
    await pixoo.check();
    await attachment.getByRole('checkbox', {name: 'Tidbyt', exact: true}).check();
    await attachment.getByRole('button', {name: 'Display and save', exact: true}).click();
    await expect(attachment.getByText('Library. Saved to library.', {exact: true})).toBeVisible();
    await admittedMoment(3);
    world.pixooMode('offline');
    await clock.advance(ART_SHOW_LEAD_MS + 3500);
    const retry = attachment.getByRole('button', {name: 'Retry display on Pixoo', exact: true});
    await expect(retry).toBeVisible();
    const shownStill = tronbyt.state().installations.bunnymoment;
    assert.ok(shownStill !== undefined && shownStill.animation === undefined, 'the other display received the still');
    assert.equal((await catalog()).length, 3);
    await attachment.getByRole('button', {name: 'Check displays', exact: true}).click();
    await expect(attachment.getByText(/Unavailable/, {exact: false})).toBeVisible();

    world.pixooMode('online');
    await clock.advance(31_000);
    await attachment.getByRole('button', {name: 'Check displays', exact: true}).click();
    await retry.click();
    await admittedMoment(4);
    world.pixooMode('silent');
    await clock.advance(ART_SHOW_LEAD_MS + 9000);
    await expect(attachment.getByText('Outcome uncertain. The request was not sent again.', {exact: false})).toBeVisible();
    await expect(retry).toHaveCount(0);
    assert.equal(displays().length, 5);
    const [retriedDisplay] = displays()[4]?.data.targets ?? [];
    assert.deepEqual(displays()[4]?.data.targets, [retriedDisplay]);
    assert.match(retriedDisplay ?? '', /^pixoo/);
    assert.equal(saves().length, 3);
    assert.equal((await catalog()).length, 3);

    await remove();
    await drop(gif, 'image/gif', 'partial.gif');
    await expect(preview).toBeVisible();
    await attachment.getByRole('checkbox', {name: 'Tidbyt', exact: true}).check();
    await attachment.getByRole('button', {name: 'Display now', exact: true}).click();
    await admittedMoment(5);
    tronbyt.answerNextPatch(400);
    await clock.advance(ART_SHOW_LEAD_MS + 3500);
    await expect(attachment.getByText('Media was sent to the display.', {exact: false})).toBeVisible();
    await expect(attachment.getByRole('button', {name: 'Retry display on Tidbyt', exact: true})).toHaveCount(0);
    assert.equal((await catalog()).length, 3);
    assert.equal(world.art.state().imageCalls, 0);
    assert.deepEqual(errors, []);
    console.log('Conversation uploads passed with simulated Pixoo and Tidbyt display evidence.');
  } catch (error) {
    console.log(await attachment.innerText().catch(() => 'Attachment unavailable'));
    console.log(world.logs.filter(record => String(record.attributes['bunny.routing.key']).startsWith('bunny.cmd.art') ||
      String(record.attributes['bunny.routing.key']).startsWith('bunny.cmd.moment-play')).map(record =>
      [record.event_name, record.attributes['bunny.routing.key'], record.attributes['bunny.request.id'], record.attributes['bunny.code']]));
    throw error;
  } finally {
    await context.close();
    await world.close();
  }
}

if (import.meta.main) {
  const browser = await chromium.launch({headless: true});
  try {await conversationUploadJourney(browser);}
  finally {await browser.close();}
}
