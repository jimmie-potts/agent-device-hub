// The ring dial (#1931) on the disposable lighting world: a light in the Small square Home shape switches and dims by
// pointer, touch and keyboard with the same guarded commands as the current card, shows observed state only (a request
// shows beside it until the light reports it), and keeps refused, unanswered, read-only and in-flight states truthful.
// Called by lighting.browser.ts; synthetic devices only. A simulated LIFX bulb reports its state when the module reads
// it, which a runtime restart does at once, so the journey restarts the runtime to see a request become observed.
import assert from 'node:assert/strict';
import {expect, type Browser, type Locator, type Page} from 'playwright/test';
import type {HomeLayoutRecord, HomePlacement} from '@jimmie-potts/event-contracts/v2/families';
import {feed} from './harness.ts';

type World = {url: string; restart(): Promise<void>; holdDeviceWrites(hold: boolean): void; loseDeviceReply(): void; restoreDeviceReply(): void; nanoleafPower(on: boolean): void};
type Sent = {path: string; target: string; keys: string; value: unknown};

/** Every device command the page sends, reduced to what makes two commands the same: route, target, data fields, value. */
function commands(page: Page): Sent[] {
  const sent: Sent[] = [];
  page.on('request', request => {
    const {pathname} = new URL(request.url());
    // Layout saves are the journey's own setup.
    if (request.method() !== 'POST' || !pathname.startsWith('/api/v2/commands/') || pathname.endsWith('layout-set')) return;
    const body = JSON.parse(request.postData() ?? '{}') as {target: string; requestId: string; data: Record<string, unknown>};
    assert.match(body.requestId, /^[0-9a-f-]{36}$/, 'every command carries its own request id');
    sent.push({path: pathname, target: body.target, keys: Object.keys(body.data).sort().join(','), value: body.data['on'] ?? body.data['percent']});
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
const placement = (id: string, shape: 'square' | 'wide'): HomePlacement => ({widget: `light:device:${id}`, size: shape === 'square' ? 'small' : 'medium', hidden: false, shape});
type Dial = {card: Locator; ring: Locator; slider: Locator; power: Locator; state: Locator; result: Locator};
const dialOf = (page: Page, id: string): Dial => {
  const card = page.locator(`[data-home-card="light:device:${id}"] .light-dial-card`);
  return {card, ring: card.locator('.light-dial'), slider: card.getByRole('slider', {name: `${id} brightness`, exact: true}),
    power: card.getByRole('switch', {name: `${id} power`, exact: true}), state: card.locator('.light-dial-state'), result: card.locator('.light-attention-line')};
};
/** Waits until the light's controls are usable again and none of its requests is still in progress. */
async function settled(dial: Dial): Promise<void> {
  await expect(dial.card).not.toHaveAttribute('data-command-busy');
  await expect(dial.power).toBeEnabled();await expect(dial.slider).toHaveAttribute('aria-disabled', 'false');
}
/**
 * Presses, drags or keys the dial (`act`) once it is settled and checks that the dial took it: a command was sent. The
 * dial reads its guards when the press lands, so a press that lands in the instant the dial is blocked again (a request
 * still finishing, or the light's records changing) does nothing, as a disabled control should. The journey then waits
 * and does it again, at most three times, rather than reading a press the dial never took as a missing result. A
 * press that sent a command is never repeated.
 */
async function taken(dial: Dial, sent: readonly unknown[], act: () => Promise<void>, label: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await settled(dial);const before = sent.length;await act();
    try {await expect.poll(() => sent.length, {timeout: 2000}).toBeGreaterThan(before);return;} catch { /* The press landed while the dial was blocked. */ }
  }
  throw new Error(`${label}: the dial never took it`);
}
/** What the dial shows from observation: the ring's power and value and the light it gives the glass layer. */
async function observed(dial: Dial): Promise<{on: boolean; value: string | null; lamp: string | null}> {
  return {on: await dial.ring.getAttribute('data-on') !== null, value: await dial.slider.getAttribute('aria-valuenow'), lamp: await dial.ring.getAttribute('data-glass-lamp')};
}
/** What the switch says a press switches away from. */
const switchedOn = async (dial: Dial): Promise<boolean> => await dial.power.getAttribute('aria-checked') === 'true';
const onTrackPoint = async (ring: Locator): Promise<[number, number]> => {const point = await onTrack(ring);return [point.x, point.y];};
/** A point on the ring's track, away from the switch in its center. */
async function onTrack(ring: Locator): Promise<{x: number; y: number}> {
  const box = await ring.boundingBox();assert.ok(box !== null);return {x: box.x + box.width / 2, y: box.y + 5};
}
const word = (on: boolean): string => on ? 'on' : 'off';

export async function dialJourney(browser: Browser, world: World): Promise<Record<string, unknown>> {
  // Fresh readings: every bulb's last report is newer than any earlier request.
  await world.restart();
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  const page = await context.newPage();page.setDefaultTimeout(15_000);
  const errors: string[] = [];page.on('pageerror', error => {errors.push(error.message);});
  const sent = commands(page);
  await page.goto(world.url);await feed(page, 'connected');
  await expect(page.getByRole('button', {name: 'Edit Home', exact: true})).toBeEnabled();

  // The current card's commands, from lamp-c's Wide shape: Off, and a brightness slider release. The dial's commands
  // must match them in route, data fields and value, for their own light.
  await arrange(page, [placement('lamp-c', 'wide'), placement('lamp-b', 'square'), placement('wall', 'square')]);
  const enabled = async (id: string): Promise<void> => {
    await page.waitForFunction(id => document.querySelector<HTMLButtonElement>(`[data-home-card="light:device:${id}"] .light-power button`)?.disabled === false, id)
      .catch(async (error: unknown) => {throw new Error(`${id} stays disabled: ${await page.locator(`[data-home-card="light:device:${id}"]`).innerText()}`, {cause: error});});
  };
  const wide = page.locator('[data-home-card="light:device:lamp-c"]');
  await enabled('lamp-c');await wide.getByRole('button', {name: 'Off', exact: true}).click();await enabled('lamp-c');
  await wide.getByRole('slider', {name: /^Brightness · (observed|requested)$/}).focus();await page.keyboard.press('ArrowLeft');await enabled('lamp-c');
  await expect.poll(() => sent.length).toBe(2);
  const [cardPower, cardBrightness] = sent.splice(0);
  assert.equal(cardPower?.target, 'lamp-c');assert.equal(cardBrightness?.target, 'lamp-c');
  assert.deepEqual([cardPower?.path, cardBrightness?.path], ['/api/v2/commands/power-set', '/api/v2/commands/brightness-set']);
  const same = async (reference: Sent | undefined, value: unknown, label: string): Promise<void> => {
    await expect.poll(() => sent.length, {message: `${label} sends one command`}).toBe(1);
    assert.deepEqual(sent.shift(), {...reference, target: 'lamp-b', value}, `${label} sends the current card's command`);
  };

  // Pointer: a press on the ring switches; the ring, the switch and the glow keep the observed state, and the request
  // shows beside it. A second press switches away from the request.
  await arrange(page, [placement('lamp-b', 'square'), placement('lamp-c', 'square'), placement('wall', 'square')]);
  const b = dialOf(page, 'lamp-b');await settled(b);
  const before = await observed(b), point = await onTrack(b.ring);
  assert.ok(Number(before.lamp) > 0 === before.on && await switchedOn(b) === before.on, `the glow and the switch follow the observed power: ${JSON.stringify(before)}`);
  await taken(b, sent, () => page.mouse.click(point.x, point.y), 'a pointer press on the ring');
  await same(cardPower, !before.on, 'a pointer press on the ring');await settled(b);
  await expect(b.state).toHaveText(`Requested ${word(!before.on)} · observed ${word(before.on)}`);
  assert.deepEqual(await observed(b), before, 'the ring and the glow still show the observed state');
  // While the request is newer than the bulb's report, the switch shows the request, which is what a press acts on.
  assert.equal(await switchedOn(b), !before.on, 'the switch agrees with what a press does');
  await expect(b.power).toHaveAccessibleDescription(`Requested ${word(!before.on)} · observed ${word(before.on)}`);
  await taken(b, sent, () => page.mouse.click(point.x, point.y), 'a second press');
  await same(cardPower, before.on, 'a second press');await settled(b);
  await expect(b.state).toHaveText(before.on ? /^On · \d+% · observed$/ : 'Off · observed');
  assert.equal(await switchedOn(b), before.on);

  // A drag dims from where the ring is, and sends once, on release.
  const box = await b.ring.boundingBox();assert.ok(box !== null);
  const from = Number(before.value), target = Math.min(100, from + 20);
  await taken(b, sent, async () => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);await page.mouse.down();
    for (let step = 1; step <= 5; step += 1) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - step * 5);
    await expect(b.slider).toHaveAttribute('aria-valuetext', `${String(target)}%, release to set`);
    assert.equal(sent.length, 0, 'a drag sends nothing until it is released');
    await page.mouse.up();
  }, 'a pointer drag');
  await same(cardBrightness, target, 'a pointer drag');await settled(b);
  assert.equal(sent.length, 0, 'a drag is not a press as well');
  assert.deepEqual(await observed(b), before, 'the ring and the glow wait for the light to report the new brightness');
  if (before.on) {
    await expect(b.state).toHaveText(`Requested ${String(target)}% · observed ${before.value ?? ''}%`);
    await expect(b.card.locator('.light-dial-requested')).toHaveCount(1);
  }

  // In flight: the request is sent and the dial locks; it still shows the observed state.
  world.holdDeviceWrites(true);
  await taken(b, sent, () => page.mouse.click(point.x, point.y), 'a press while writes are held');
  await expect(b.result).toHaveText(/Requested|Accepted|Waiting/);await expect(b.result).toBeVisible();
  await same(cardPower, !before.on, 'a press while writes are held');
  await expect(b.power).toBeDisabled();await expect(b.slider).toHaveAttribute('aria-disabled', 'true');
  assert.deepEqual(await observed(b), before, 'an unanswered request is not shown as done');
  await page.mouse.click(point.x, point.y);await b.slider.focus();await page.keyboard.press('End');
  assert.equal(sent.length, 0, 'a locked dial sends nothing');
  world.holdDeviceWrites(false);await settled(b);

  // Refused: the result shows on the face and the dial keeps the observed state.
  await page.route('**/api/v2/commands/power-set', route => route.fulfill({status: 403, contentType: 'application/json', body: JSON.stringify({error: {code: 'forbidden', retryable: false}})}));
  await taken(b, sent, () => page.mouse.click(point.x, point.y), 'a refused press');
  await expect(b.result).toHaveText(/Refused/);await expect(b.result).toBeVisible();
  assert.deepEqual(await observed(b), before);
  await page.unroute('**/api/v2/commands/power-set');sent.splice(0);await settled(b);

  // Keyboard: the ring is a slider (one request when the key is released) and its center a switch.
  await taken(b, sent, async () => {await b.slider.focus();await page.keyboard.press('Home');}, 'Home');
  await same(cardBrightness, 0, 'Home');await settled(b);
  // A key or a drag that leaves the value where it started sends nothing.
  await b.slider.focus();await page.keyboard.press('Home');await page.keyboard.press('PageDown');
  const still = await b.ring.boundingBox();assert.ok(still !== null);
  await page.mouse.move(still.x + still.width / 2, still.y + still.height / 2);await page.mouse.down();
  await page.mouse.move(still.x + still.width / 2, still.y + still.height / 2 - 20);await page.mouse.move(still.x + still.width / 2, still.y + still.height / 2);await page.mouse.up();
  await page.waitForTimeout(300);assert.deepEqual(sent, [], 'an unchanged value is not sent, and a drag is not a press');
  await taken(b, sent, async () => {
    await b.slider.focus();await page.keyboard.down('ArrowUp');
    await expect(b.slider).toHaveAttribute('aria-valuetext', '5%, release to set');assert.equal(sent.length, 0, 'holding a key sends nothing');
    await page.keyboard.up('ArrowUp');
  }, 'Arrow Up');
  await same(cardBrightness, 5, 'Arrow Up');await settled(b);
  await taken(b, sent, async () => {await b.slider.focus();await page.keyboard.press('End');}, 'End');
  await same(cardBrightness, 100, 'End');await settled(b);
  // A brightness write reads the bulb first, so the observed power may have caught up; a press switches away from the
  // newest of the request and the observation.
  const wanted = await switchedOn(b);
  await taken(b, sent, async () => {await b.power.focus();await page.keyboard.press('Space');}, 'Space on the switch');
  await same(cardPower, !wanted, 'Space on the switch');await settled(b);
  await taken(b, sent, async () => {await b.power.focus();await page.keyboard.press('Enter');}, 'Enter on the switch');
  await same(cardPower, wanted, 'Enter on the switch');await settled(b);
  if (!wanted) {await taken(b, sent, async () => {await b.power.focus();await page.keyboard.press('Space');}, 'Space again');await same(cardPower, true, 'Space again');await settled(b);}
  const now = await observed(b);
  assert.ok(Number(now.lamp) > 0 === now.on, `the glow follows the observed power: ${JSON.stringify(now)}`);
  await expect(b.state).toHaveText(/^Requested on · observed (on|off)$|^On · \d+% · observed$|^Requested 100% · observed \d+%$/);

  // Unanswered: the uncertain result locks the dial and nothing is resent.
  const c = dialOf(page, 'lamp-c');await settled(c);
  const cPoint = await onTrack(c.ring);
  world.loseDeviceReply();await taken(c, sent, () => page.mouse.click(cPoint.x, cPoint.y), 'a press whose reply is lost');
  await expect(c.result).toHaveText(/Uncertain/);world.restoreDeviceReply();
  await expect(c.power).toBeDisabled();await expect(c.slider).toHaveAttribute('aria-disabled', 'true');
  await page.mouse.click(cPoint.x, cPoint.y);await page.waitForTimeout(300);
  assert.equal(sent.length, 1, 'the uncertain light sends nothing more');sent.splice(0);

  // A light that follows the hub mode says so; a Nanoleaf light reports no color, so it glows warm white.
  const wall = dialOf(page, 'wall');
  await expect(wall.card.locator('.light-dial-mode')).toHaveText(/^(Following Hub (Work|Free|Quiet)|(Work|Free|Quiet) · individual exception)$/);
  await expect(wall.ring).not.toHaveAttribute('data-glass-lamp-color', /./);
  // The Nanoleaf light reports its own changes at once. Switched off and on from the dial, then off at its own switch:
  // the old request to be on must not take over after a write of another kind, so a press turns it on again.
  const stored = Number(/On · (\d+)% · observed/.exec(await wall.state.innerText())?.[1]);assert.ok(stored >= 5, 'the Nanoleaf light starts on');
  const wallPoint = await onTrackPoint(wall.ring);await settled(wall);sent.splice(0);
  const wallSent = async (value: unknown, family: Sent | undefined, label: string): Promise<void> => {
    await expect.poll(() => sent.length, {message: label}).toBe(1);assert.deepEqual(sent.shift(), {...family, target: 'wall', value}, label);await settled(wall);
  };
  await taken(wall, sent, () => page.mouse.click(...wallPoint), 'a press off');await wallSent(false, cardPower, 'the dial switches the Nanoleaf light off');
  await expect(wall.state).toHaveText('Off · observed');
  await taken(wall, sent, () => page.mouse.click(...wallPoint), 'a press on');await wallSent(true, cardPower, 'and on');
  await expect(wall.state).toHaveText(/^On · \d+% · observed$/);
  world.nanoleafPower(false);await expect(wall.state).toHaveText('Off · observed');
  // An off light's ring reads nothing, but its keys start from its stored brightness, never from 0.
  await taken(wall, sent, async () => {
    await wall.slider.focus();await page.keyboard.down('ArrowDown');
    await expect(wall.slider).toHaveAttribute('aria-valuetext', `${String(stored - 5)}%, release to set`);await page.keyboard.up('ArrowDown');
  }, 'Arrow Down on an off light');
  await wallSent(stored - 5, cardBrightness, 'an off light dims from its stored brightness');
  const after = await observed(wall);
  assert.equal(await switchedOn(wall), after.on, 'after a brightness write the switch follows the light, not an old power request');
  await expect(wall.state).not.toHaveText(/^Requested/);
  await taken(wall, sent, () => page.mouse.click(...wallPoint), 'a press after a brightness write');await wallSent(!after.on, cardPower, 'a press switches away from what the light reports');
  assert.deepEqual(errors, []);
  await context.close();

  // The light reports what was asked: the ring, the switch and the glow follow.
  await world.restart();
  const touch = await browser.newContext({viewport: {width: 1440, height: 300}, hasTouch: true});
  const phone = await touch.newPage();phone.setDefaultTimeout(15_000);
  const touchSent = commands(phone);
  await phone.goto(world.url);await feed(phone, 'connected');
  const t = dialOf(phone, 'lamp-b');await settled(t);
  await expect(t.state).toHaveText('On · 100% · observed');
  assert.deepEqual(await observed(t), {on: true, value: '100', lamp: '1'}, 'the reported state is drawn');assert.equal(await switchedOn(t), true);

  // Touch: a tap on the ring switches and a drag dims without scrolling the page. The hero sits above the cards, so the
  // short window is scrolled to the ring first.
  await t.ring.scrollIntoViewIfNeeded();
  const tap = await onTrack(t.ring);
  await taken(t, touchSent, () => phone.touchscreen.tap(tap.x, tap.y), 'a tap');
  await expect.poll(() => touchSent.length).toBe(1);
  assert.deepEqual(touchSent.shift(), {...cardPower, target: 'lamp-b', value: false}, 'a tap on the ring sends the current card\'s command');
  await settled(t);await expect(t.state).toHaveText('Requested off · observed on');
  await taken(t, touchSent, () => phone.touchscreen.tap(tap.x, tap.y), 'a second tap');
  await expect.poll(() => touchSent.length).toBe(1);assert.deepEqual(touchSent.shift(), {...cardPower, target: 'lamp-b', value: true}, 'a second tap');await settled(t);
  const scroller = (): Promise<{top: number; height: number}> => phone.evaluate(() => {const element = document.scrollingElement ?? document.documentElement;return {top: element.scrollTop, height: element.scrollHeight - innerHeight};});
  const scroll = await scroller();assert.ok(scroll.height > 0, 'the page can scroll');
  const ring = await t.ring.boundingBox();assert.ok(ring !== null);
  const cdp = await touch.newCDPSession(phone), x = ring.x + ring.width / 2, y = ring.y + ring.height / 2;
  await taken(t, touchSent, async () => {
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
    for (let step = 1; step <= 5; step += 1) await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y: y + step * 5}]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  }, 'a touch drag');
  await expect.poll(() => touchSent.length).toBe(1);
  assert.deepEqual(touchSent.shift(), {...cardBrightness, target: 'lamp-b', value: 80}, 'a touch drag down dims from where the ring is');
  assert.equal((await scroller()).top, scroll.top, 'a drag on the ring does not scroll the page');
  await expect(t.state).toHaveText('Requested 80% · observed 100%');
  await touch.close();

  // Read-only: the dial shows the observed state and sends nothing.
  const reader = await browser.newContext({viewport: {width: 1440, height: 1000}});
  const readOnly = await reader.newPage();readOnly.setDefaultTimeout(15_000);
  await readOnly.route('**/api/v2/authority?scope=control', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","retryable":false}}'}));
  const readSent = commands(readOnly);
  await readOnly.goto(world.url);await feed(readOnly, 'connected');
  const r = dialOf(readOnly, 'lamp-b');
  await expect(r.state).toHaveText('Read-only access');
  await expect(r.power).toBeDisabled();await expect(r.slider).toHaveAttribute('aria-disabled', 'true');
  assert.deepEqual(await observed(r), {on: true, value: '100', lamp: '1'});
  const readPoint = await onTrack(r.ring);await readOnly.mouse.click(readPoint.x, readPoint.y);
  await r.slider.focus();await readOnly.keyboard.press('End');
  assert.deepEqual(readSent, [], 'a read-only dial sends nothing');
  await reader.close();
  return {dial: true, pointer: true, touch: true, keyboard: true, observedOnly: true, inFlight: true, refused: true, uncertain: true, readOnly: true, modeLine: true};
}
