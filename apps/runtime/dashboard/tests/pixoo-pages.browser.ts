// A real Pixoo editor command through the authenticated shell, against fresh synthetic state only (Hub #932).
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium, type Browser} from 'playwright';
import {changes, feed, startWorld} from './harness.ts';

const world = await startWorld({pixooPages: true});
let browser: Browser | undefined;
try {
  await world.createPlaylist('Synthetic desk');
  for (let attempt = 0; (await world.pixooPlaylists()).length === 0 && attempt < 50; attempt++) await delay(20);
  const before = (await world.pixooPlaylists())[0]; assert.ok(before);
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
  try {
    const errors: string[] = []; context.on('weberror', error => {errors.push(error.error().name);});
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    const sent = changes(page);
    await page.goto(`${world.url}/#/module/pixoo/playlists`); await feed(page, 'connected');
    await page.getByRole('combobox', {name: 'Playlist', exact: true}).selectOption(before.id);
    const name = page.getByRole('textbox', {name: 'Playlist name', exact: true});
    await name.waitFor();
    assert.equal(sent.length, 0, 'opening and syncing the real editor sends no command');
    await name.fill('Evening desk');
    assert.deepEqual(await world.pixooPlaylists(), [before], 'draft typing changes no owner state');
    assert.equal(sent.length, 0);
    const save = page.getByRole('button', {name: 'Save name', exact: true});
    await save.focus(); await save.press('Enter');
    await page.getByRole('status').filter({hasText: 'Completed: succeeded.'}).waitFor();
    const after = (await world.pixooPlaylists())[0]; assert.ok(after);
    assert.equal(after.name, 'Evening desk'); assert.equal(after.playlistRevision, before.playlistRevision + 1);
    assert.equal(sent.length, 1, 'one explicit save sends one tracked command');
    await page.reload(); await feed(page, 'connected');
    await page.getByRole('combobox', {name: 'Playlist', exact: true}).selectOption(before.id); await name.waitFor();
    assert.equal(await name.inputValue(), 'Evening desk'); assert.equal(sent.length, 1, 'reload never resends');
    assert.equal(world.pixooState().sent, 0, 'page, drafts and playlist metadata save do not write to the display');
    const violations = (await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
    assert.deepEqual(violations.map(item => item.id), []);
    await page.getByRole('link', {name: 'Trusted editor fixture', exact: true}).click();
    const frame = page.frameLocator('iframe.module-page');
    await frame.getByText('Editor ready', {exact: true}).waitFor();
    assert.equal(await page.locator('iframe.module-page').getAttribute('sandbox'), null, 'trusted code has no untrusted sandbox claim');
    await frame.getByRole('button', {name: 'Edit draft', exact: true}).click();
    await frame.getByText('Draft changed', {exact: true}).waitFor();
    assert.equal(sent.length, 1, 'trusted editor open/draft issues no command');
    await page.getByRole('link', {name: 'Passive fixture', exact: true}).click();
    await frame.getByRole('heading', {name: 'Passive preview', exact: true}).waitFor();
    assert.equal(await page.locator('iframe.module-page').getAttribute('sandbox'), 'allow-same-origin');
    await page.getByRole('link', {name: 'Playlists', exact: true}).click();
    await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
    await page.reload(); await feed(page, 'connected');
    await page.getByRole('combobox', {name: 'Playlist', exact: true}).selectOption(before.id);
    await page.getByText('Read-only access.', {exact: true}).waitFor();
    assert.equal(await save.count(), 0, 'read-only view offers no write control');
    assert.equal(await world.readonlyPlaylistCommand({change: {operation: 'rename', playlistId: after.id, revision: after.playlistRevision, name: 'Denied'}}), 403);
    assert.deepEqual(await world.pixooPlaylists(), [after]); assert.equal(sent.length, 1);
    assert.deepEqual(errors, []);
    process.stdout.write(`${JSON.stringify({passed: true, journey: 'pixoo-playlist-rename', requests: sent.length, ownerRevision: after.playlistRevision, displayWrites: world.pixooState().sent, trustedBundle: true, passiveScriptBlocked: true, readOnlyRefused: true, axe: 'passed'})}\n`);
  } finally {await context.close();}
} finally {try {await browser?.close();} finally {await world.close();}}
