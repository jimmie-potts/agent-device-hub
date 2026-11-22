// Fuse (#1933) on the disposable lighting world with simulated Wemo plugs: a light or a plug dragged by its handle onto
// another groups them (mouse and touch, two lights, two plugs, a light with a plug), the saved group is there after a
// reload and in a second browser, All off and All on send each member its own power command and report a member that
// refuses or does not answer, the "Group with" selector groups and ungroups the same units, a refused save changes
// nothing, a drop elsewhere returns the card, and read-only sessions can neither group nor switch. Called by
// lighting.browser.ts; synthetic devices only.
import assert from 'node:assert/strict';
import {expect, type Browser, type Locator, type Page} from 'playwright/test';
import type {HomeLayoutRecord, HomePlacement, LightingLayoutRecord} from '@jimmie-potts/event-contracts/v2/families';
import {feed, holdDashboardStream} from './harness.ts';

type World = {url: string; holdDeviceWrites(hold: boolean): void; dropDashboardStreams(): void; lifxState(): {packets: unknown[]; bulbs: Record<string, {power: boolean} | undefined>}; wemo: {state(): Record<string, {power: boolean} | undefined>}};
type Sent = {path: string; target: string; on?: unknown};
const WEMO = 'bunny/modules/wemo';
const light = (id: string): string => `light:device:${id}`, plug = (id: string): string => `device:${WEMO}:${id}`;
const square = (widget: string): HomePlacement => ({widget, size: 'small', hidden: false, shape: 'square'});

/** Every command the page sends: its route, target and, for power, the value. */
function commands(page: Page): Sent[] {
  const sent: Sent[] = [];
  page.on('request', request => {
    const {pathname} = new URL(request.url());
    if (request.method() !== 'POST' || !pathname.startsWith('/api/v2/commands/')) return;
    const body = JSON.parse(request.postData() ?? '{}') as {target: string; data: Record<string, unknown>};
    sent.push({path: pathname.slice('/api/v2/commands/'.length), target: body.target, ...('on' in body.data ? {on: body.data['on']} : {})});
  });
  return sent;
}
async function arrange(page: Page, desktop: HomePlacement[]): Promise<void> {
  assert.equal(await page.evaluate(async desktop => {
    const record = (await (await fetch('/api/v2/snapshot?families=home-layout&owner=bunny/core')).json() as {records: {'home-layout': HomeLayoutRecord[]}}).records['home-layout'][0];
    return (await fetch('/api/v2/commands/home-layout-set', {method: 'POST', headers: {'content-type': 'application/json', 'bunny-request': '1'},
      body: JSON.stringify({target: 'home', requestId: crypto.randomUUID(), data: {expectedRevision: record?.revision ?? 0, layouts: {desktop, phone: desktop}}})})).status;
  }, desktop), 200);
  for (const entry of desktop) await expect(page.locator(`[data-home-card="${entry.widget}"]`)).toHaveAttribute('data-home-shape', entry.shape ?? '');
}
const lighting = (page: Page): Promise<LightingLayoutRecord> => page.evaluate(async () =>
  (await (await fetch('/api/v2/snapshot?families=lighting-layout&owner=bunny/core')).json() as {records: {'lighting-layout': LightingLayoutRecord[]}}).records['lighting-layout'][0] as LightingLayoutRecord);
const card = (page: Page, widget: string): Locator => page.locator(`[data-home-card="${widget}"]`);
const handle = (page: Page, widget: string): Locator => card(page, widget).locator('[data-fuse-handle]');
/**
 * How long a returning card may take to be home. The return eases over 340 ms on a time base and ends on the first frame
 * after that, so the wait is for frames: a one-thread runner draws the desktop page at 2 to 3 frames a second, and
 * slower at times, so the journey allows its 15 s action timeout rather than the 5 s poll default (#2017).
 */
const returned = {timeout: 15_000};
const center = async (locator: Locator): Promise<{x: number; y: number}> => {const box = await locator.boundingBox();assert.ok(box !== null);return {x: box.x + box.width / 2, y: box.y + box.height / 2};};
/** The group card whose panel lists exactly these members, in order. */
async function groupOf(page: Page, members: string[]): Promise<Locator> {
  const panel = page.locator('[data-group-panel]').filter({has: page.locator(`[data-group-member="${members[0] ?? ''}"]`)});
  await expect(panel.locator('[data-group-member]')).toHaveCount(members.length);
  assert.deepEqual(await panel.locator('[data-group-member]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-group-member'))), members);
  return panel;
}
/**
 * Waits until every member's switch of a group panel is enabled: its state is known and no command of its own is in
 * progress, so All on or All off sends each member a command. On a slow runner a member's records or its last command
 * can still be settling when the panel's All button is already enabled (#2017).
 */
async function membersReady(panel: Locator): Promise<void> {
  for (const member of await panel.locator('[data-group-member]').all()) await expect(member).toBeEnabled({timeout: 30_000});
}
/** Drags by the mouse: the card follows the pointer and the target lights up before the drop. */
async function mouseDrag(page: Page, from: string, to: string): Promise<void> {
  const start = await center(handle(page, from)), end = await center(card(page, to));
  await page.mouse.move(start.x, start.y);await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) await page.mouse.move(start.x + (end.x - start.x) * step / 8, start.y + (end.y - start.y) * step / 8);
  await expect(card(page, from)).toHaveAttribute('data-fuse-dragging', '');
  await expect(card(page, to)).toHaveAttribute('data-fuse-target', '');await expect(card(page, to)).toHaveAttribute('data-glass-target', '');
  const moved = await card(page, from).evaluate(node => (node as HTMLElement).style.transform);assert.match(moved, /^translate\(/, 'the card follows the pointer');
  await page.mouse.up();
}

export async function fuseJourney(browser: Browser, world: World): Promise<Record<string, unknown>> {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  const page = await context.newPage();page.setDefaultTimeout(15_000);
  const errors: string[] = [];page.on('pageerror', error => {errors.push(error.message);});
  const sent: Sent[] = commands(page);
  await page.goto(world.url);await feed(page, 'connected');
  await expect(page.getByRole('button', {name: 'Edit Home', exact: true})).toBeEnabled();
  // A room on Home: grouping keeps it in the lighting Home selection (#1972 review).
  assert.equal(await page.evaluate(async () => {
    const record = (await (await fetch('/api/v2/snapshot?families=lighting-layout&owner=bunny/core')).json() as {records: {'lighting-layout': {revision: number}[]}}).records['lighting-layout'][0];
    const home = [...['lamp-a', 'lamp-b', 'lamp-c'].map(id => ({kind: 'device', id})), {kind: 'room', id: 'studio'}];
    return (await fetch('/api/v2/commands/lighting-layout-set', {method: 'POST', headers: {'content-type': 'application/json', 'bunny-request': '1'},
      body: JSON.stringify({target: 'lighting', requestId: crypto.randomUUID(), data: {expectedRevision: record?.revision ?? 0, layout: {rooms: [{id: 'studio', name: 'Studio'}], assignments: [], groups: [], home}}})})).status;
  }), 200);
  await arrange(page, [square(light('lamp-a')), square(light('lamp-b')), square(light('lamp-c')), square(plug('desk-lamp')), square(plug('shelf-lamp')), square('module:roborock'), square('light:room:studio')]);
  sent.splice(0);

  // A drop anywhere else returns the card and sends nothing; the ring still dims and the handle does not.
  const lampA = card(page, light('lamp-a'));await expect(handle(page, light('lamp-a'))).toBeVisible();
  const home = await lampA.boundingBox();assert.ok(home !== null);
  const grip = await center(handle(page, light('lamp-a')));
  await page.mouse.move(grip.x, grip.y);await page.mouse.down();await page.mouse.move(grip.x + 40, grip.y + 300, {steps: 6});
  await expect(card(page, 'module:roborock')).not.toHaveAttribute('data-fuse-target', '');
  await page.mouse.up();
  await expect.poll(() => lampA.evaluate(node => (node as HTMLElement).style.transform), returned).toBe('');
  const back = await lampA.boundingBox();assert.deepEqual(back, home, 'a drop elsewhere returns the card');
  await page.waitForTimeout(200);assert.equal(sent.length, 0, 'a drop elsewhere and a handle drag send nothing');
  // Cards other than lights and plugs are not targets.
  const vacuum = await center(card(page, 'module:roborock'));
  await page.mouse.move(grip.x, grip.y);await page.mouse.down();await page.mouse.move(vacuum.x, vacuum.y, {steps: 8});
  await expect(card(page, 'module:roborock')).not.toHaveAttribute('data-fuse-target', '');await page.mouse.up();
  await page.waitForTimeout(200);assert.equal(sent.length, 0, 'a drop on another kind of card groups nothing');
  // A lost pointer capture ends the drag and returns the card; the next drag starts normally.
  await page.mouse.move(grip.x, grip.y);await page.mouse.down();await page.mouse.move(vacuum.x, vacuum.y, {steps: 6});
  await expect(lampA).toHaveAttribute('data-fuse-dragging', '');
  await handle(page, light('lamp-a')).evaluate(node => {node.releasePointerCapture(1);});
  await expect(lampA).not.toHaveAttribute('data-fuse-dragging', '');await page.mouse.up();
  await expect.poll(() => lampA.evaluate(node => (node as HTMLElement).style.transform), returned).toBe('');
  await page.waitForTimeout(200);assert.equal(sent.length, 0, 'a lost capture groups nothing');
  const ring = await center(lampA.locator('.light-dial'));
  await page.mouse.move(ring.x, ring.y - 30);await page.mouse.down();await page.mouse.move(ring.x, ring.y + 10, {steps: 4});await page.mouse.up();
  await expect.poll(() => sent.length).toBe(1);assert.equal(sent.shift()?.path, 'brightness-set', 'dragging the ring still dims');

  // Two lights by mouse: the panel follows, the target lights up, the drop groups and saves; the group is Wide.
  await expect(handle(page, light('lamp-b'))).toBeVisible();
  await mouseDrag(page, light('lamp-b'), light('lamp-a'));
  const lights = await groupOf(page, ['lamp-a', 'lamp-b']);
  await expect(card(page, light('lamp-a'))).toHaveCount(0);await expect(card(page, light('lamp-b'))).toHaveCount(0);
  await expect(lights.locator('xpath=ancestor::*[@data-home-card][1]')).toHaveAttribute('data-home-shape', 'wide');
  assert.deepEqual(sent.map(item => item.path), ['lighting-layout-set'], 'grouping sends only the layout save');sent.splice(0);
  assert.deepEqual((await lighting(page)).layout.home?.filter(item => item.kind === 'room'), [{kind: 'room', id: 'studio'}], 'the room stays on Home');
  await card(page, 'light:room:studio').getByLabel('Options for Studio', {exact: true}).click();
  await expect(card(page, 'light:room:studio').getByRole('button', {name: 'Remove from Home', exact: true})).toBeVisible();
  await card(page, 'light:room:studio').getByLabel('Options for Studio', {exact: true}).click();
  await expect(page.locator('[data-fuse-status]')).toHaveCount(0);

  // Two plugs by touch, in a second browser: the card follows the finger and the page does not scroll.
  const touch = await browser.newContext({viewport: {width: 1440, height: 1000}, hasTouch: true});
  const phone = await touch.newPage();phone.setDefaultTimeout(15_000);
  await phone.goto(world.url);await feed(phone, 'connected');
  await expect(handle(phone, plug('desk-lamp'))).toBeVisible();
  const finger = await center(handle(phone, plug('desk-lamp'))), shelf = await center(card(phone, plug('shelf-lamp')));
  const cdp = await touch.newCDPSession(phone), scrolled = (): Promise<number> => phone.evaluate(() => (document.scrollingElement ?? document.documentElement).scrollTop);
  const top = await scrolled();
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [finger]});
  for (let step = 1; step <= 8; step += 1) await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: finger.x + (shelf.x - finger.x) * step / 8, y: finger.y + (shelf.y - finger.y) * step / 8}]});
  await expect(card(phone, plug('shelf-lamp'))).toHaveAttribute('data-fuse-target', '');
  assert.equal(await scrolled(), top, 'a drag by the handle does not scroll the page');
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await groupOf(phone, ['shelf-lamp', 'desk-lamp']);
  // The other browser sees the saved group.
  const plugs = await groupOf(page, ['shelf-lamp', 'desk-lamp']);
  await expect(card(page, plug('desk-lamp'))).toHaveCount(0);await expect(card(page, plug('shelf-lamp'))).toHaveCount(0);
  await touch.close();
  assert.equal(sent.length, 0, 'the first browser sent nothing');

  // The keyboard path ungroups the plugs, groups a light with a plug and ungroups them again.
  await plugs.getByRole('button', {name: 'Ungroup', exact: true}).focus();await page.keyboard.press('Enter');
  await expect(card(page, plug('desk-lamp'))).toHaveAttribute('data-home-shape', 'square');await expect(card(page, plug('shelf-lamp'))).toHaveAttribute('data-home-shape', 'square');
  await card(page, light('lamp-c')).getByLabel('Options for lamp-c', {exact: true}).click();
  await card(page, light('lamp-c')).getByLabel('Group lamp-c with', {exact: true}).selectOption(plug('shelf-lamp'));
  const keyed = await groupOf(page, ['lamp-c', 'shelf-lamp']);
  assert.deepEqual((await lighting(page)).layout.groups.find(group => group.devices.includes('shelf-lamp'))?.plugs, [{device: 'shelf-lamp', owner: WEMO}]);
  await keyed.getByRole('button', {name: 'Ungroup', exact: true}).focus();await page.keyboard.press('Enter');
  await expect(card(page, light('lamp-c'))).toHaveAttribute('data-home-shape', 'square');await expect(card(page, plug('shelf-lamp'))).toHaveAttribute('data-home-shape', 'square');
  // The grouping line went with its save; a later save (this Ungroup) leaves no stale line behind.
  await expect(page.locator('[data-fuse-status]')).toHaveCount(0);
  assert.deepEqual((await lighting(page)).layout.home?.filter(item => item.kind === 'room'), [{kind: 'room', id: 'studio'}], 'the room stays on Home through the keyboard path');
  // The plug's own options offer the same choice.
  await card(page, plug('shelf-lamp')).getByLabel('Options for Shelf lamp', {exact: true}).click();
  await expect(card(page, plug('shelf-lamp')).getByLabel('Group Shelf lamp with', {exact: true}).locator('option')).toHaveText(['Choose a card', 'Light group', 'lamp-c', 'Desk lamp']);
  await card(page, plug('shelf-lamp')).getByLabel('Options for Shelf lamp', {exact: true}).click();
  assert.deepEqual(sent.map(item => item.path), ['lighting-layout-set', 'lighting-layout-set', 'lighting-layout-set'], 'the keyboard path sends only layout saves');sent.splice(0);

  // A light with a plug by mouse.
  await mouseDrag(page, plug('desk-lamp'), light('lamp-c'));
  const mixed = await groupOf(page, ['lamp-c', 'desk-lamp']);
  const mixedCard = `light:group:${await mixed.getAttribute('data-group-panel') ?? ''}`;
  await expect(card(page, mixedCard)).toHaveAttribute('data-home-shape', 'wide');
  const saved = await lighting(page);
  assert.deepEqual(saved.layout.groups.find(group => group.devices.includes('desk-lamp')), {id: mixedCard.slice('light:group:'.length), name: 'Group', scope: 'home', devices: ['lamp-c', 'desk-lamp'], plugs: [{device: 'desk-lamp', owner: WEMO}]});
  sent.splice(0);

  // A refused save shows its error and changes nothing.
  await page.route('**/api/v2/commands/lighting-layout-set', route => route.fulfill({status: 409, contentType: 'application/json', body: JSON.stringify({error: {code: 'revision-conflict', retryable: false}})}));
  await mouseDrag(page, plug('shelf-lamp'), mixedCard);
  await expect(page.locator('[data-fuse-status]')).toHaveText(/^Not grouped: Refused \(revision-conflict\) without changing state\./);
  await expect(card(page, plug('shelf-lamp'))).toHaveAttribute('data-home-shape', 'square');await groupOf(page, ['lamp-c', 'desk-lamp']);
  await expect.poll(() => card(page, plug('shelf-lamp')).evaluate(node => (node as HTMLElement).style.transform), returned).toBe('');
  assert.deepEqual(await lighting(page), saved, 'a refused save changes nothing');
  await page.unroute('**/api/v2/commands/lighting-layout-set');
  await mouseDrag(page, plug('shelf-lamp'), mixedCard);
  const group = await groupOf(page, ['lamp-c', 'desk-lamp', 'shelf-lamp']);
  await expect(page.locator('[data-fuse-status]')).toHaveCount(0);sent.splice(0);

  // All off switches every member with its own power command; a plug never gets a lighting command.
  const result = group.locator('.group-panel-result');
  const allOff = group.getByRole('button', {name: 'All off', exact: true});await expect(allOff).toBeEnabled();
  await membersReady(group);await allOff.click();
  await expect.poll(() => sent.length).toBe(3);
  assert.deepEqual(sent.map(item => [item.path, item.target, item.on]).sort(), [['power-set', 'desk-lamp', false], ['power-set', 'lamp-c', false], ['power-set', 'shelf-lamp', false]],
    'each member gets its own existing power command');sent.splice(0);
  await expect(group.getByRole('button', {name: 'All on', exact: true})).toBeEnabled({timeout: 30_000});
  await expect(group.getByRole('button', {name: 'lamp-c power', exact: true})).toHaveAttribute('aria-pressed', 'false');
  await expect(result).toBeEmpty();
  // All on: one member refuses (the gateway refuses the plug's command) and one does not answer (the bulb's write is
  // held); the other still switches, and the panel names both instead of showing the group as switched.
  await expect(group.getByRole('button', {name: 'Shelf lamp power', exact: true})).toBeEnabled();
  await page.route('**/api/v2/commands/power-set', async route => {
    const body = JSON.parse(route.request().postData() ?? '{}') as {target: string};
    if (body.target === 'desk-lamp') await route.fulfill({status: 409, contentType: 'application/json', body: JSON.stringify({error: {code: 'unavailable', retryable: true}})});
    else await route.continue();
  });
  world.holdDeviceWrites(true);
  await membersReady(group);await group.getByRole('button', {name: 'All on', exact: true}).click();
  await expect.poll(() => sent.length).toBe(3);
  assert.deepEqual(sent.map(item => [item.path, item.target, item.on]).sort(), [['power-set', 'desk-lamp', true], ['power-set', 'lamp-c', true], ['power-set', 'shelf-lamp', true]]);sent.splice(0);
  await expect(result).toContainText('Desk lamp: Refused (unavailable) without changing state.');
  await expect(result).toContainText(/lamp-c: (Requested|Accepted)\. Waiting/);
  await expect.poll(() => world.wemo.state()['shelf-lamp']?.power).toBe(true);
  assert.equal(world.wemo.state()['desk-lamp']?.power, false, 'the refused plug did not switch');
  await expect(group.getByRole('button', {name: 'Shelf lamp power', exact: true})).toHaveAttribute('aria-pressed', 'true', {timeout: 30_000});
  await expect(group.getByRole('button', {name: 'lamp-c power', exact: true})).toBeDisabled();
  await page.unroute('**/api/v2/commands/power-set');
  world.holdDeviceWrites(false);
  await expect(result).not.toContainText('lamp-c:');
  // All off again switches every member once each is clear.
  await expect(allOff).toBeEnabled({timeout: 30_000});await membersReady(group);await allOff.click();
  await expect.poll(() => sent.length).toBe(3);sent.splice(0);
  await expect.poll(() => [world.wemo.state()['shelf-lamp']?.power, world.wemo.state()['desk-lamp']?.power]).toEqual([false, false]);
  await expect(result).not.toContainText('Refused');
  // A double click and a held Enter each send exactly one power command per member; opening the options sends nothing.
  await expect(group.getByRole('button', {name: 'All on', exact: true})).toBeEnabled({timeout: 30_000});
  await membersReady(group);await group.getByRole('button', {name: 'All on', exact: true}).dblclick();
  await expect.poll(() => sent.length).toBe(3);await page.waitForTimeout(500);
  assert.deepEqual(sent.map(item => item.target).sort(), ['desk-lamp', 'lamp-c', 'shelf-lamp'], 'a double click sends one command per member');sent.splice(0);
  await expect(allOff).toBeEnabled({timeout: 30_000});
  await membersReady(group);await allOff.focus();await page.keyboard.down('Enter');await page.keyboard.down('Enter');await page.keyboard.down('Enter');await page.keyboard.up('Enter');
  await expect.poll(() => sent.length).toBe(3);await page.waitForTimeout(500);
  assert.deepEqual(sent.map(item => [item.target, item.on]).sort(), [['desk-lamp', false], ['lamp-c', false], ['shelf-lamp', false]], 'a held Enter sends one command per member');sent.splice(0);
  await group.getByLabel(/^Options for /).click();await page.waitForTimeout(300);await group.getByLabel(/^Options for /).click();
  assert.equal(sent.length, 0, 'opening the group\'s options sends nothing');
  await expect(group.getByRole('button', {name: 'All on', exact: true})).toBeEnabled({timeout: 30_000});

  // The saved groups are there after a reload and in a second browser.
  await page.reload();await feed(page, 'connected');
  await groupOf(page, ['lamp-a', 'lamp-b']);await groupOf(page, ['lamp-c', 'desk-lamp', 'shelf-lamp']);
  const second = await browser.newContext({viewport: {width: 1440, height: 1000}});
  try {
    const other = await second.newPage();other.setDefaultTimeout(15_000);await other.goto(world.url);await feed(other, 'connected');
    await groupOf(other, ['lamp-a', 'lamp-b']);await groupOf(other, ['lamp-c', 'desk-lamp', 'shelf-lamp']);
  } finally {await second.close();}

  // Read-only: no handle, and neither grouping nor switching.
  const reader = await browser.newContext({viewport: {width: 1440, height: 1000}});
  try {
    const readOnly = await reader.newPage();readOnly.setDefaultTimeout(15_000);
    await readOnly.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
    const readSent = commands(readOnly);
    await readOnly.goto(world.url);await feed(readOnly, 'connected');
    const panel = await groupOf(readOnly, ['lamp-c', 'desk-lamp', 'shelf-lamp']);
    await expect(readOnly.locator('[data-fuse-handle]')).toHaveCount(0);
    for (const name of ['All on', 'Ungroup', 'lamp-c power', 'Desk lamp power', 'Shelf lamp power']) await expect(panel.getByRole('button', {name, exact: true})).toBeDisabled();
    await panel.getByLabel(/^Options for /).click();await expect(panel.getByLabel(/^Group .* with$/)).toBeDisabled();
    assert.deepEqual(readSent, [], 'a read-only session sends nothing');
  } finally {await reader.close();}
  // Home's one line tells every state of a layout save from a Home card (#1972 review): in flight, uncertain (with
  // Refresh records, and no resend), refused, and an uncertain grouping in place of its progress text.
  const line = page.locator('[data-fuse-status]'), layoutRoute = '**/api/v2/commands/lighting-layout-set';
  const pairA = await groupOf(page, ['lamp-a', 'lamp-b']);sent.splice(0);
  let letGo = (): void => {};const gate = new Promise<void>(resolve => {letGo = resolve;});
  await page.route(layoutRoute, async route => {await gate;await route.continue();});
  await pairA.getByRole('button', {name: 'Ungroup', exact: true}).click();
  await expect(line).toHaveText(/^Layout: (Requested|Accepted)\. Waiting/);
  await expect(page.locator('[data-fuse-handle]')).toHaveCount(0);
  letGo();
  await expect(card(page, light('lamp-a'))).toHaveAttribute('data-home-shape', 'square');await expect(line).toHaveCount(0);
  await page.unroute(layoutRoute);sent.splice(0);
  /** Runs `act` with the layout save's reply lost (the save itself goes through) while the dashboard stream is held. */
  const lostReply = async (act: () => Promise<void>, shown: RegExp): Promise<void> => {
    const release = await holdDashboardStream(page);
    await page.route(layoutRoute, async route => {
      world.dropDashboardStreams();const response = await route.fetch();await response.dispose();
      await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: {code: 'uncertain-result', retryable: false}})});
    });
    await act();
    await expect(line).toHaveText(shown);
    await expect(page.locator('[data-fuse-handle]')).toHaveCount(0);
    const before = sent.length;await line.getByRole('button', {name: 'Refresh records', exact: true}).click();
    await page.waitForTimeout(500);assert.equal(sent.length, before, 'Refresh records sends no command and resends nothing');
    await page.unroute(layoutRoute);release();await feed(page, 'connected');
    await expect(line).toHaveCount(0, {timeout: 30_000});
    assert.equal(sent.filter(item => item.path === 'lighting-layout-set').length, 1, 'an uncertain save is never sent again');sent.splice(0);
  };
  await lostReply(() => mouseDrag(page, light('lamp-b'), light('lamp-a')), /^Grouping lamp-a with lamp-b: Uncertain result\. The command may have taken effect; it was not sent again\./);
  const pairB = await groupOf(page, ['lamp-a', 'lamp-b']);
  await lostReply(() => pairB.getByRole('button', {name: 'Ungroup', exact: true}).click(), /^Layout: Uncertain result\. The command may have taken effect; it was not sent again\./);
  await expect(card(page, light('lamp-a'))).toHaveAttribute('data-home-shape', 'square');
  await page.route(layoutRoute, route => route.fulfill({status: 409, contentType: 'application/json', body: JSON.stringify({error: {code: 'revision-conflict', retryable: false}})}));
  const three = await groupOf(page, ['lamp-c', 'desk-lamp', 'shelf-lamp']);
  await three.getByRole('button', {name: 'Ungroup', exact: true}).click();
  await expect(line).toHaveText(/^Layout: Refused \(revision-conflict\) without changing state\./);
  await expect(line.getByRole('button', {name: 'Refresh records', exact: true})).toBeVisible();
  await groupOf(page, ['lamp-c', 'desk-lamp', 'shelf-lamp']);
  await page.unroute(layoutRoute);sent.splice(0);


  // light to the window's edge scrolls the page to a plug below the fold, and a tap on a member switch sends one command.
  await group.getByRole('button', {name: 'Ungroup', exact: true}).click();
  await expect(card(page, plug('desk-lamp'))).toHaveCount(1);await expect(card(page, plug('shelf-lamp'))).toHaveCount(1);sent.splice(0);
  const pocket = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});
  try {
    const small = await pocket.newPage();small.setDefaultTimeout(15_000);const smallSent = commands(small);
    await small.goto(world.url);await feed(small, 'connected');
    for (const widget of [light('lamp-a'), light('lamp-c'), plug('desk-lamp'), plug('shelf-lamp')]) {
      await expect(card(small, widget).locator('[data-fuse-handle]')).toHaveCount(1);
      await expect(card(small, widget).getByLabel(/^Group .* with$/)).toHaveCount(1);
    }
    await card(small, light('lamp-c')).locator('[data-fuse-handle]').evaluate(node => {node.scrollIntoView({block: 'start'});scrollBy(0, -80);});
    const grip = await center(handle(small, light('lamp-c')));
    const below = await card(small, plug('shelf-lamp')).boundingBox();assert.ok(below !== null && below.y > 844, 'the target starts below the fold');
    const cdp = await pocket.newCDPSession(small);
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [grip]});
    // The finger stops 14 px above the bottom, in the 56 px edge zone, and is held still: the page scrolls under it until
    // the plug, which started below the fold, is in view. The page checks every frame, so the wait ends on the frame it
    // comes into view, not up to a poll interval and a round trip later (#2017).
    for (let step = 1; step <= 6; step += 1) await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: grip.x, y: grip.y + (830 - grip.y) * step / 6}]});
    await small.waitForFunction(selector => {
      const box = document.querySelector(selector)?.getBoundingClientRect();return box !== undefined && box.top + box.height / 2 < 700;
    }, `[data-home-card="${plug('shelf-lamp')}"]`, {polling: 'raf', timeout: 20_000});
    // Then the finger leaves the edge zone at once, which stops the scroll, and moves onto the plug, as a person's does.
    // The page can scroll on by a frame or two before the first move lands, more on a slow runner, so the finger follows
    // the plug until it is the target with the finger outside both edge zones; a plug that went past the top is brought
    // back by the top edge.
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: grip.x, y: 422}]});
    await expect.poll(async () => {
      const shelf = await center(card(small, plug('shelf-lamp')));
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: shelf.x, y: Math.min(830, Math.max(20, shelf.y))}]});
      if (shelf.y <= 56 || shelf.y >= 844 - 56) return 'scrolling';
      if (await card(small, plug('shelf-lamp')).getAttribute('data-fuse-target') === '') return '';
      return `not the target (finger at ${String(Math.round(shelf.y))}, ${await card(small, light('lamp-c')).getAttribute('data-fuse-dragging') === '' ? 'still' : 'no longer'} dragging)`;
    }, {timeout: 20_000, intervals: [100]}).toBe('');
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    const pair = await groupOf(small, ['shelf-lamp', 'lamp-c']);
    assert.deepEqual(smallSent.map(item => item.path), ['lighting-layout-set'], 'the phone drag sends only the layout save');smallSent.splice(0);
    const member = pair.getByRole('button', {name: 'Shelf lamp power', exact: true});await member.scrollIntoViewIfNeeded();await expect(member).toBeEnabled({timeout: 30_000});
    const tap = await center(member);await small.touchscreen.tap(tap.x, tap.y);
    await expect.poll(() => smallSent.length).toBe(1);await small.waitForTimeout(500);
    assert.deepEqual(smallSent.map(item => [item.path, item.target]), [['power-set', 'shelf-lamp']], 'a tap on a member sends one command');
  } finally {await pocket.close();}
  assert.deepEqual(errors, []);
  await context.close();
  return {fuse: true, mouse: true, touch: true, keyboard: true, lights: true, plugs: true, lightWithPlug: true, refusedSave: true, dropElsewhere: true, allOnOff: true, memberRefused: true, memberNoAnswer: true, reload: true, secondBrowser: true, readOnly: true, ringDims: true, roomKept: true, noStaleLine: true, doubleClickOnce: true, heldEnterOnce: true, optionsSendNothing: true, phoneTouchAutoScroll: true, memberTap: true, lineInFlight: true, lineUncertainGroup: true, lineUncertainUngroup: true, lineRefused: true};
}
