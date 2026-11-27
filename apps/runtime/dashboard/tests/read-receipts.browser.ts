import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {keepRequestInterception} from './browser-context.ts';
import {connectRemote} from '@jimmie-potts/sdk';
import type {Session30Record} from '@jimmie-potts/event-contracts/v2/families';
import {SESSION_SCHEMA} from '@jimmie-potts/event-contracts/v2/session';
import {runReadHelper} from '../../dist/src/read-receipts/helper.js';
import {IDENTITY} from '../../dist/tests/fixtures/agents.js';
import {changes, feed, startWorld} from './harness.ts';

const world = await startWorld({readReceipts: true});
const browser = await chromium.launch({headless: true});
const reader = await connectRemote({url: world.url, source: 'bunny/parts/reader', token: world.readerToken});
try {
  assert.ok(world.readProducer !== undefined);
  await world.observe({kind: 'session-started'}, {title: {value: 'Receipt compatibility', source: 'provider'}});
  await world.observe({kind: 'turn-ended'});
  const page = await browser.newPage();
  await keepRequestInterception(page.context());
  page.setDefaultTimeout(12_000);
  const errors: string[] = [];
  page.on('pageerror', error => {errors.push(error.name);});
  const sent = changes(page);
  await page.goto(world.url);
  await feed(page, 'connected');
  const row = page.locator('article.session').filter({has: page.getByRole('heading', {name: 'Receipt compatibility', exact: true})});
  const chip = (text: string) => row.locator('.chip', {hasText: text}).waitFor();
  await chip('Finished · unread');
  const selected = await runReadHelper(world.readProducer, {action: 'bind', version: '2.1.325',
    surface: 'desktop', sessionId: IDENTITY.sessionId, promptId: 'turn-1'});
  assert.equal(selected.status, 'ready');
  assert.ok(selected.status === 'ready');
  await chip('Finished · unread');
  assert.deepEqual(await runReadHelper(world.readProducer, {action: 'read', version: '2.1.325',
    surface: 'desktop', target: selected.target}), {status: 'confirmed'});
  await chip('Idle');
  const synced = await reader.sync<Session30Record>(['session'], () => {}, {owner: 'bunny/core', timeoutMs: 3000});
  assert.equal(synced.status, 'synced');
  assert.ok(synced.status === 'synced');
  const record = synced.copy.states()[0];
  assert.ok(record);
  assert.equal(record?.dataschema, SESSION_SCHEMA);
  assert.equal(record.data.outcome.read, 'read');
  assert.ok(record.data.outcome.readReceipt);
  await page.reload();
  await feed(page, 'connected');
  await chip('Idle');
  await world.observe({kind: 'turn-started'}, {turn: 'turn-2'});
  await world.observe({kind: 'turn-ended'}, {turn: 'turn-2'});
  await chip('Finished · unread');
  assert.deepEqual(sent, []);
  assert.deepEqual(errors, []);
  process.stdout.write(JSON.stringify({journey: 'qualified-read-receipt', passed: true,
    checks: ['bind keeps unread', 'the receipt\'s provenance clears the unread row', 'reload sync retains read', 'a new turn returns to unread', 'no dashboard command or browser error']}) + '\n');
} finally {
  await reader.close();
  await browser.close();
  await world.close();
}
