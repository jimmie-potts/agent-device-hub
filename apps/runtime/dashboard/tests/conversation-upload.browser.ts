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
  await page.addInitScript(() => {
    const send = window.fetch.bind(window);
    window.fetch = (resource, init) => {
      if (typeof resource === 'string' && new URL(resource, location.href).searchParams.get('family') === 'assistant-input' &&
          init?.body instanceof Blob) {
        void init.body.text().then(body => {document.documentElement.dataset.assistantInput = body;});
      }
      return send(resource, init);
    };
  });
  const still = await sharp({create: {width: 82, height: 60, channels: 3, background: '#3c784b'}}).png().toBuffer();
  const pixels = Buffer.concat([Buffer.alloc(64 * 32 * 3, 24), Buffer.alloc(64 * 32 * 3, 190)]);
  const gif = await sharp(pixels, {raw: {width: 64, height: 64, pageHeight: 32, channels: 3}})
    .gif({delay: [100, 200]}).toBuffer();
  const errors: string[] = [];
  page.on('pageerror', error => {errors.push(error.name);});
  const admitted = (key: string) => world.logs.filter(record => record.event_name === 'command.admitted' &&
    record.attributes['bunny.routing.key'] === key);
  const displays = () => admitted('bunny.cmd.art-show.hub');
  const artMode = 'bunny.cmd.art-attachment-edit.art';
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
  const send = async (text = '') => {
    await conversation.getByRole('textbox', {name: 'Message', exact: true}).fill(text);
    const button = conversation.getByRole('button', {name: 'Send', exact: true});
    await expect(button).toBeEnabled();
    const admittedInput = page.waitForRequest(request => new URL(request.url()).searchParams.get('family') === 'assistant-input');
    await button.click();
    return admittedInput;
  };
  const surfaceMoment = (surface: Awaited<ReturnType<typeof artShowSurfaces>>[number] | undefined): string =>
    surface?.kind === 'display' ? surface.momentRequestId : assert.fail('missing moment identity');
  const admittedMoment = async (count: number, kind: 'pixoo' | 'tidbyt'): Promise<void> => {
    await expect.poll(() => displays().length).toBe(count);
    const show = displays().at(-1)?.attributes['bunny.request.id'];
    assert.equal(typeof show, 'string');
    if (typeof show !== 'string') return assert.fail('missing show identity');
    await expect.poll(() => world.logs.find(record => record.event_name === 'command.admitted' &&
      String(record.attributes['bunny.routing.key']).startsWith('bunny.cmd.moment-play.' + kind))?.attributes['bunny.request.id']).toBeDefined();
    const target = world.logs.find(record => record.event_name === 'command.admitted' &&
      String(record.attributes['bunny.routing.key']).startsWith('bunny.cmd.moment-play.' + kind))?.attributes['bunny.routing.key'];
    assert.equal(typeof target, 'string');
    if (typeof target !== 'string') return assert.fail('missing target routing identity');
    const surfaces = await artShowSurfaces(show, [target.split('.').at(-1) ?? '']);
    assert.ok(surfaces[0]?.kind === 'display');
    await expect.poll(() => admitted(target).filter(record =>
      record.attributes['bunny.request.id'] === surfaceMoment(surfaces[0])).length).toBe(1);
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
    assert.equal((await catalog()).length, 0);

    await drop(still, 'image/png', 'still.png');
    await expect(preview).toBeVisible();
    const firstDurableAttachment = admitted(artMode).length;
    await send();
    await expect(conversation.getByText('Saved to the library. Would you like me to display this?', {exact: true})).toBeVisible();
    await expect.poll(async () => (await catalog()).length).toBe(1);
    assert.equal(admitted(artMode).length, firstDurableAttachment + 1);
    assert.equal(displays().length, 0);
    await expect(conversation.getByRole('article', {name: 'owner message'}).getByRole('img', {name: 'Attached artwork'})).toBeVisible();
    await page.reload();
    await feed(page, 'connected');
    await expect(conversation.getByRole('article', {name: 'owner message'}).getByRole('img', {name: 'Attached artwork'})).toBeVisible();

    await picker(gif, 'image/gif', 'moving.gif');
    await expect(preview).toBeVisible();
    const tidbytSend = await send('Play this on the Tidbyt');
    await admittedMoment(1, 'tidbyt');
    await expect(conversation.getByRole('button', {name: 'Approve proposal'})).toHaveCount(0);
    await clock.advance(ART_SHOW_LEAD_MS + 1500);
    await expect.poll(() => tronbyt.state().installations.bunnymoment?.animation?.frames.length).toBe(2);
    const frames = tronbyt.state().installations.bunnymoment?.animation?.frames;
    assert.ok(frames !== undefined && JSON.stringify(frames[0]) !== JSON.stringify(frames[1]));
    await expect.poll(async () => (await catalog()).length).toBe(2);
    const body = await page.locator('html').getAttribute('data-assistant-input');
    assert.ok(body?.includes('Play this on the Tidbyt') === true);
    const duplicate = await page.evaluate(async ({url, body}) => {
      const statuses: number[] = [];
      for (let index = 0; index < 9; index += 1) {
        const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/octet-stream', 'bunny-request': '1'}, body});
        statuses.push(response.status);
      }
      return statuses;
    }, {url: tidbytSend.url(), body});
    assert.deepEqual(duplicate, Array.from({length: 9}, () => 200));
    assert.equal(displays().length, 1);
    assert.equal((await catalog()).length, 2);
    await clock.advance(31_000);

    await drop(still, 'image/png', 'pixoo.png');
    await expect(preview).toBeVisible();
    await send('Show this on the Pixoo');
    await admittedMoment(2, 'pixoo');
    await clock.advance(ART_SHOW_LEAD_MS + 1500);
    const rgb = Buffer.alloc(64 * 64 * 3);
    for (let index = 0; index < rgb.byteLength; index += 3) rgb.set([0x3c, 0x78, 0x4b], index);
    const expected = createHash('sha256').update(rgb).digest('hex').slice(0, 16);
    await expect.poll(() => world.pixooState().shown?.digests).toEqual([expected]);
    await expect.poll(async () => (await catalog()).length).toBe(3);
    await clock.advance(31_000);

    await picker(still, 'image/png', 'choose.png');
    await expect(preview).toBeVisible();
    await send('Play this');
    await expect(conversation.getByText('Saved to the library. Which display would you like to use?', {exact: true})).toBeVisible();
    await expect.poll(async () => (await catalog()).length).toBe(4);
    assert.equal(displays().length, 2);

    await drop(still, 'image/png', 'failure.png');
    await expect(preview).toBeVisible();
    await send('Play this on the Pixoo');
    await expect.poll(() => displays().length).toBe(3);
    await expect.poll(() => admitted('bunny.cmd.moment-play.pixoo-1').length).toBe(2);
    world.pixooMode('offline');
    await clock.advance(ART_SHOW_LEAD_MS + 9000);
    await expect.poll(async () => (await catalog()).length).toBe(5);
    await page.reload();
    await feed(page, 'connected');
    await expect(conversation.getByText(/Playback on pixoo-1 (failed|could not start)/)).toBeVisible();
    assert.equal(displays().length, 3);
    assert.equal(admitted('bunny.cmd.moment-play.pixoo-1').length, 2);
    await expect(conversation.getByText('Update to earlier reply', {exact: true}).last()).toBeVisible();
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
