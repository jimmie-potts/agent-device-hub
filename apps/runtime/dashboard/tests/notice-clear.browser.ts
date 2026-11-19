import {destinationLink, openConnections} from './navigation-helpers.ts';
// One focused confirmed Connections journey against the built synthetic runtime; no installed services or devices.
import assert from 'node:assert/strict';
import {chromium, type Browser} from 'playwright';
import {IDENTITY, OTHER, sessionStarted, turnStarted, turnEnded} from '../../dist/tests/fixtures/agents.js';
import {changes, feed, startWorld} from './harness.ts';
import {worldClock} from './world-clock.ts';

const world = await startWorld();
let browser: Browser | undefined;
try {
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
  try {
    const errors: string[] = [];
    context.on('weberror', error => {errors.push(error.error().name);});
    const page = await context.newPage(); page.setDefaultTimeout(12_000);
    const sent = changes(page), clears = (): number => sent.filter(path => path === '/api/v2/commands/notice-clear').length;
    await page.goto(world.url); await feed(page, 'connected');
    await world.observe(sessionStarted, {title: {value: 'Port the wall', source: 'provider'}});
    await world.observe(turnStarted); await world.observe(turnEnded);
    await page.locator('article.session .chip', {hasText: 'Finished'}).waitFor();
    assert.equal(await page.getByRole('button', {name: /acknowledge/i}).count(), 0, 'session rows stay passive');
    await openConnections(page);
    await page.getByLabel('Session', {exact: true}).selectOption({label: 'Port the wall'});
    const clear = page.getByRole('button', {name: 'Clear this notice on every device', exact: true});
    await clear.click();
    const confirm = page.getByRole('button', {name: 'Confirm clear', exact: true});
    assert.equal(await confirm.evaluate(button => button === document.activeElement), true);
    assert.equal(clears(), 0, 'opening confirmation sends nothing');
    await confirm.press('Escape');
    assert.equal(await clear.evaluate(button => button === document.activeElement), true);
    await clear.click();
    await confirm.press('Enter');
    await page.getByText('Accepted. Completion and acknowledgments are shown separately.', {exact: true}).waitFor();
    await page.getByText('Completion: completed.', {exact: true}).waitFor();
    await page.getByText('Synced session acknowledgments: dashboard, nanoleaf, pixoo.', {exact: true}).waitFor();
    assert.equal(clears(), 1);
    await page.getByRole('button', {name: 'Close', exact: true}).click();
    await (await destinationLink(page, /^Home/)).click();
    await page.locator('article.session .chip', {hasText: 'Idle'}).waitFor();
    assert.equal(await page.getByRole('button', {name: /acknowledge/i}).count(), 0);
    world.dropDashboardStreams(); await feed(page, 'connected');
    await page.reload(); await feed(page, 'connected');
    assert.equal(clears(), 1, 'reconnect and reload do not replay the override');

    // A lost reply stays uncertain; the copies independently show completion and current acknowledgments.
    await world.observe(turnStarted, {turn: 'turn-second'}); await world.observe(turnEnded, {turn: 'turn-second'});
    await page.locator('article.session .chip', {hasText: 'Finished'}).waitFor();
    await openConnections(page);
    await page.getByLabel('Session', {exact: true}).selectOption({label: 'Port the wall'});
    await page.route('**/api/v2/commands/notice-clear', async route => {await route.fetch(); await route.abort('failed');}, {times: 1});
    await clear.click(); await confirm.click();
    await page.getByText('The reply is uncertain. The action was not sent again.', {exact: true}).waitFor();
    await page.getByText('Completion: completed.', {exact: true}).waitFor();
    await page.getByText('Synced session acknowledgments: dashboard, nanoleaf, pixoo.', {exact: true}).waitFor();
    assert.equal(clears(), 2);
    await page.reload(); await feed(page, 'connected'); assert.equal(clears(), 2);

    // UI authority refusal is a read-only presentation check; the real gateway refusal is covered independently.
    await page.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: JSON.stringify({error: {code: 'forbidden', retryable: false}})}));
    await page.reload(); await feed(page, 'connected');
    await openConnections(page);
    await page.getByText('Read-only connection. Operator controls require control authority.', {exact: true}).waitFor();
    assert.equal(await clear.isDisabled(), true); assert.equal(clears(), 2);
    assert.deepEqual(errors, []);
    process.stdout.write(`${JSON.stringify({passed: true, checks: ['confirmed notice override, synced acknowledgments, passive row, keyboard, no replay and read-only refusal'], clearRequests: clears()})}\n`);
  } finally {await context.close();}
} finally {try {await browser?.close();} finally {await world.close();}}

// Silence marks no row, and only unconfirmed work does (Hub #1865, design decision 10, as Hub #1947 amends it): one session
// waits on a question, one holds an unread finished turn and one works, and all three stay silent for ten minutes on the
// world's clock, which the page shares. No row is uncertain, in the rows or in Habitat; each face says the hub heard from
// it ten minutes ago, from the record's evidence time against the page's clock; and the notice override stays available
// for the finished session. A runtime restart then leaves the running work unconfirmed: only that row is marked.
const clock = worldClock();
const silent = await startWorld({clock});
let quietBrowser: Browser | undefined;
try {
  quietBrowser = await chromium.launch({headless: true});
  const context = await quietBrowser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
  try {
    const page = await context.newPage(); page.setDefaultTimeout(12_000);
    await clock.install(page);
    const sent = changes(page);
    await page.goto(silent.url); await feed(page, 'connected');
    const WORKING = {...IDENTITY, sessionId: 'session-sim-working'}, LATER = {...IDENTITY, sessionId: 'session-sim-later'};
    await silent.observe(sessionStarted, {identity: OTHER, title: {value: 'Ask a question', source: 'provider'}});
    await silent.observe(turnStarted, {identity: OTHER});
    await silent.observe({kind: 'question-continuing', attention: {status: 'known', id: 'question-1'}}, {identity: OTHER});
    await silent.observe(sessionStarted, {title: {value: 'Port the wall', source: 'provider'}});
    await silent.observe(turnStarted); await silent.observe(turnEnded);
    await silent.observe(sessionStarted, {identity: WORKING, title: {value: 'Keep working', source: 'provider'}});
    await silent.observe(turnStarted, {identity: WORKING});
    const card = (name: string) => page.locator('article.session').filter({has: page.getByRole('heading', {name, exact: true})});
    await card('Ask a question').locator('.chip', {hasText: 'Question'}).waitFor();
    await card('Port the wall').locator('.chip', {hasText: 'Finished · unread'}).waitFor();
    await card('Keep working').locator('.chip', {hasText: 'Working'}).waitFor();
    await card('Keep working').locator('.agent-heard', {hasText: '<1m ago'}).waitFor();
    await clock.advance(10 * 60_000);
    // A later session orders the copy: once it shows, anything the silence published before it shows too.
    await silent.observe(sessionStarted, {identity: LATER, title: {value: 'Arrive later', source: 'provider'}});
    await card('Arrive later').waitFor();
    const SILENT = ['Ask a question', 'Port the wall', 'Keep working'];
    assert.deepEqual(await Promise.all(SILENT.map(name => card(name).getAttribute('data-stale'))), ['false', 'false', 'false'], 'silence marks no row');
    for (const name of SILENT) await card(name).locator('.agent-heard', {hasText: '10m ago'}).waitFor();
    await card('Arrive later').locator('.agent-heard', {hasText: '<1m ago'}).waitFor();
    await card('Keep working').locator('.chip', {hasText: 'Working'}).waitFor();
    await card('Port the wall').locator('.chip', {hasText: 'Finished · unread'}).waitFor();
    await openConnections(page);
    await page.getByLabel('Session', {exact: true}).selectOption({label: 'Port the wall'});
    assert.equal(await page.getByRole('button', {name: 'Clear this notice on every device', exact: true}).isEnabled(), true,
      'the override stays available for a finished session silent for ten minutes');
    await page.getByRole('link', {name: 'Habitat', exact: true}).click(); await page.locator('#habitat[data-ready=true]').waitFor();
    await page.locator('.habitat-root .agent[data-assigned=true]').nth(3).waitFor();
    assert.equal(await page.locator('.habitat-root .agent[data-uncertain=true]').count(), 0, 'Habitat marks no resident from silence');
    assert.deepEqual(sent, [], 'reading the silent sessions sends nothing');
    // A restart ends the browser session and leaves the running work unconfirmed (reason restart); nothing else changes.
    await silent.restart();
    await feed(page, 'ended');
    await page.getByRole('button', {name: 'Sign in again', exact: true}).click();
    await feed(page, 'connected');
    await (await destinationLink(page, /^Home/)).click();
    await card('Keep working').locator('.chip', {hasText: 'Unconfirmed'}).waitFor();
    assert.deepEqual(await Promise.all([...SILENT, 'Arrive later'].map(name => card(name).getAttribute('data-stale'))), ['false', 'false', 'true', 'false'],
      'only the work the restart left unconfirmed is marked');
    await card('Ask a question').locator('.chip', {hasText: 'Question'}).waitFor();
    await card('Port the wall').locator('.chip', {hasText: 'Finished · unread'}).waitFor();
    await card('Keep working').locator('.agent-heard', {hasText: '10m ago'}).waitFor();
    assert.deepEqual(sent, [], 'the restart and the sign-in send no command');
    process.stdout.write(`${JSON.stringify({passed: true, checks: ['ten minutes of silence mark no row, each face shows its evidence age, and the override stays available for a finished session', 'after a restart only the unconfirmed working row is marked']})}\n`);
  } finally {await context.close();}
} finally {try {await quietBrowser?.close();} finally {await silent.close();}}
