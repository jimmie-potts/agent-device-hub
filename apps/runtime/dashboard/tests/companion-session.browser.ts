// A native conversation's session tile names its companion apart from its title (Hub #2054), on the built runtime with
// the real companions module, a synthetic provider and a synthetic hook. The untitled session shows its persona once; the
// renamed one tags its companion in place of the client, which its facts keep (owner decision A); a shared room's record
// tags its first companion and counts the others (owner decision B); the facts name every companion, the search finds
// one by name or ID, a Claude session looks as before, and the face's first line stays one line, as tall as a line
// without a tag, at desktop and phone widths. It contacts no device.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium, type Browser, type Locator, type Page} from 'playwright';
import {openJourneyContext} from './browser-context.ts';
import {sessionStarted, turnStarted} from '../../dist/tests/fixtures/agents.js';
import {feed, startWorld} from './harness.ts';

const RENAMED = 'Synthetic kitchen plans';
// A shared room's companions (Hub #2032), in the room's order. The first has a long synthetic name (40 characters, the
// contract's limit), so the tag must shrink to keep the evidence age whole.
const LONG = 'Synthetic companion named at full length';
const ROOM = [{id: 'synthetic-long', name: LONG}, {id: 'reachy', name: 'Reachy'}, {id: 'microduck', name: 'MicroDuck'}];

/**
 * The face's first line at the page's width: one line inside the tile, with the evidence age whole and inside it, the
 * tag and count before the age, and no client beside a tag. Returns the line's height.
 */
async function oneLine(tile: Locator, label: string): Promise<number> {
  const box = await tile.locator('.agent-meta').evaluate(meta => {
    const rect = (node: Element | null) => node === null ? null : node.getBoundingClientRect();
    const heard = meta.querySelector<HTMLElement>('.agent-heard');
    return {viewport: window.innerWidth, face: rect(meta.closest('.agent-face')), line: rect(meta), tag: rect(meta.querySelector('.agent-companion')),
      more: rect(meta.querySelector('.agent-companion-more')), client: rect(meta.querySelector('.agent-client')), heard: rect(heard),
      heardWhole: heard !== null && heard.scrollWidth <= heard.clientWidth + 1};
  });
  assert.ok(box.face !== null && box.line !== null && box.heard !== null, label);
  assert.ok(box.face.right <= box.viewport + 1, `${label}: the tile stays inside the page`);
  assert.ok(box.heard.left >= box.face.left && box.heard.right <= box.face.right + 1, `${label}: the evidence age stays inside the tile`);
  assert.equal(box.heardWhole, true, `${label}: the evidence age is whole`);
  assert.ok(box.line.left >= box.face.left && box.line.right <= box.face.right + 1, `${label}: the line stays inside the tile`);
  assert.ok(box.line.height <= 20, `${label}: the line does not wrap (${String(box.line.height)}px)`);
  for (const [name, part] of [['tag', box.tag], ['count', box.more]] as const) {
    if (part === null) continue;
    assert.ok(part.right <= box.heard.left + 1 && Math.abs(part.top + part.height / 2 - (box.line.top + box.line.height / 2)) <= 2,
      `${label}: the ${name} sits centred on the line before the age`);
    assert.ok(part.left >= box.face.left && part.right <= box.face.right, `${label}: the ${name} stays inside the tile`);
  }
  if (box.tag !== null && box.more !== null) assert.ok(box.tag.right <= box.more.left + 1, `${label}: the count follows the tag`);
  assert.equal(box.tag !== null && box.client !== null, false, `${label}: beside a tag the line leaves out the client`);
  return box.line.height;
}

export async function companionSessionJourney(browser: Browser): Promise<void> {
  const world = await startWorld({companions: true, assistantProvider: {name: 'synthetic', model: 'synthetic',
    turn: () => Promise.resolve({text: 'Synthetic companion reply.', calls: [], stop: 'end', units: 1})}});
  const output = process.env.DASHBOARD_RECEIPTS;
  if (output !== undefined) await mkdir(output, {recursive: true});
  const shot = async (page: Page, name: string): Promise<void> => { if (output !== undefined) await page.screenshot({path: `${output}/${name}.png`, fullPage: false}); };
  const context = await openJourneyContext(browser, {viewport: {width: 1280, height: 900}, reducedMotion: 'reduce'});
  const errors: string[] = [];
  context.on('weberror', error => { errors.push(error.error().name); });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    const tile = (name: string): Locator => page.locator('article.session').filter({has: page.getByRole('heading', {name, exact: true})});
    // A Claude session beside the conversation, which shows no companion.
    await world.observe(sessionStarted, {title: {value: 'Port the wall', source: 'provider'}});
    await world.observe(turnStarted);
    // The B.U.N.N.Y. conversation's first task: its session is untitled and shows its persona.
    await page.goto(`${world.url}/#/module/companions/assistant`);
    await feed(page, 'connected');
    const conversation = page.getByRole('region', {name: 'B.U.N.N.Y. conversation', exact: true});
    await conversation.getByRole('button', {name: 'Enable conversation', exact: true}).click();
    await conversation.getByRole('textbox', {name: 'Message', exact: true}).fill('Synthetic companion check.');
    await conversation.getByRole('button', {name: 'Send', exact: true}).click();
    await conversation.getByText('Task completed', {exact: true}).waitFor();
    await page.goto(`${world.url}/#/`);
    await feed(page, 'connected');
    const persona = tile('B.U.N.N.Y.');
    await persona.waitFor();
    assert.equal(await persona.locator('.agent-companion').count(), 0, 'an untitled session showing its persona does not show the name twice');
    assert.equal(await persona.locator('.agent-client').textContent(), 'B.U.N.N.Y. assistant');
    await persona.locator('summary.agent-face').click();
    const facts = (card: Locator): Promise<[string, string][]> => card.locator('.agent-evidence dl.strip > div').evaluateAll(rows => rows.map((row): [string, string] =>
      [row.querySelector('dt')?.textContent ?? '', row.querySelector('dd')?.textContent ?? '']));
    assert.deepEqual((await facts(persona)).find(([term]) => term === 'Companion'), ['Companion', 'B.U.N.N.Y.'], 'its facts still name the companion');
    await persona.locator('summary.agent-face').click();
    const claude = tile('Port the wall');
    assert.equal(await claude.locator('.agent-companion').count(), 0, 'a Claude session shows no companion');
    await claude.locator('summary.agent-face').click();
    assert.equal((await facts(claude)).some(([term]) => term.startsWith('Companion')), false, 'nor a Companion fact');
    await claude.locator('summary.agent-face').click();
    // The owner renames the conversation: the title changes, the companion stays and is tagged apart from it.
    await page.goto(`${world.url}/#/module/companions/assistant`);
    await feed(page, 'connected');
    await conversation.getByRole('button', {name: 'Details', exact: true}).click();
    const details = conversation.getByRole('dialog', {name: 'Conversation details', exact: true});
    await details.getByText('Conversation settings', {exact: true}).click();
    await details.getByLabel('Rename conversation', {exact: true}).fill(RENAMED);
    await details.getByRole('button', {name: 'Rename', exact: true}).click();
    await page.goto(`${world.url}/#/`);
    await feed(page, 'connected');
    const renamed = tile(RENAMED);
    await renamed.waitFor();
    const tag = renamed.locator('.agent-companion');
    assert.equal(await tag.count(), 1);
    assert.equal(await tag.textContent(), 'Companion: B.U.N.N.Y.', 'the tag is named for assistive technology');
    assert.ok(await tag.locator('.agent-companion-word').evaluate(word => word.getBoundingClientRect().width <= 1), 'and shows only the companion\'s name');
    assert.equal(await tag.getAttribute('title'), 'Companion: B.U.N.N.Y.');
    // The tag's text keeps at least 4.5:1 contrast against its own fill.
    const contrast = await tag.evaluate(node => {
      const rgb = (color: string): number[] => (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const luminance = (color: string): number => {
        const [r = 0, g = 0, b = 0] = rgb(color).map(value => value / 255).map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const style = getComputedStyle(node), [a, b] = [luminance(style.color), luminance(style.backgroundColor)].sort((x, y) => y - x);
      return ((a ?? 0) + 0.05) / ((b ?? 0) + 0.05);
    });
    assert.ok(contrast >= 4.5, `the tag's text is readable on its fill (${contrast.toFixed(2)}:1)`);
    assert.equal(await renamed.getByRole('heading', {level: 3}).textContent(), RENAMED, 'the title holds no companion name');
    assert.equal(await tile('B.U.N.N.Y.').count(), 0);
    // A shared room's record, simulated: no producer names several companions yet (the Apartment room is #2032), so the
    // page's sync answer gives the renamed session the room's three companions. The page validates nothing more than
    // the core's own records.
    let room = true;
    await page.route('**/api/sdk/v1/sync', async route => {
      const response = await route.fetch();
      const body: unknown = await response.json();
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (typeof node !== 'object' || node === null) return;
        const message = node as {type?: unknown; data?: {identity?: {provider?: unknown}; companions?: unknown}};
        if (room && message.type === 'org.bunny.session.updated' && message.data?.identity?.provider === 'bunny') message.data.companions = ROOM;
        Object.values(node).forEach(walk);
      };
      walk(body);
      await route.fulfill({response, json: body});
    });
    await page.reload();
    await feed(page, 'connected');
    const more = renamed.locator('.agent-companion-more');
    // Wait for the room's record, however the face shows several companions, then check the line first.
    await renamed.locator('.agent-companion-more, .agent-companion:nth-child(2)').first().waitFor();
    await oneLine(renamed, 'room, desktop');
    assert.equal(await renamed.locator('.agent-companion').count(), 1, 'a room tags only its first companion');
    assert.equal(await renamed.locator('.agent-companion').textContent(), `Companion: ${LONG}`);
    assert.equal(await more.locator('[aria-hidden=true]').textContent(), '+2', 'and counts the others');
    assert.equal(await more.locator('.agent-companion-word').textContent(), 'and 2 more companions: Reachy, MicroDuck', 'with an accessible name');
    await shot(page, 'companion-session-room-desktop');
    await renamed.locator('summary.agent-face').click();
    assert.deepEqual((await facts(renamed)).find(([term]) => term === 'Companions'), ['Companions', `${LONG}, Reachy, MicroDuck`], 'the facts list every companion');
    await renamed.locator('summary.agent-face').click();
    await page.setViewportSize({width: 390, height: 844});
    await renamed.scrollIntoViewIfNeeded();
    await oneLine(renamed, 'room, phone');
    await shot(page, 'companion-session-room-phone');
    await page.setViewportSize({width: 1280, height: 900});
    room = false;
    await page.reload();
    await feed(page, 'connected');
    await renamed.waitFor();
    assert.equal(await more.count(), 0, 'the conversation\'s own record names one companion');
    // Owner decision A: beside the tag the line leaves out the client, and is exactly as tall as a line without a tag.
    const tagged = await oneLine(renamed, 'desktop');
    assert.equal(tagged, await oneLine(claude, 'desktop, Claude'), 'a tag leaves the line\'s height as it is');
    assert.equal(await claude.locator('.agent-client').textContent(), 'Claude Code', 'a tile without a tag keeps its client');
    const [taggedHeading, claudeHeading] = await Promise.all([renamed, claude].map(card => card.getByRole('heading', {level: 3}).evaluate(node => node.getBoundingClientRect().top)));
    assert.equal(taggedHeading, claudeHeading, 'the headings of neighbouring tiles line up');
    await shot(page, 'companion-session-desktop');
    await renamed.locator('summary.agent-face').click();
    assert.deepEqual((await facts(renamed)).find(([term]) => term === 'Companion'), ['Companion', 'B.U.N.N.Y.']);
    assert.deepEqual((await facts(renamed)).find(([term]) => term === 'Client'), ['Client', 'B.U.N.N.Y. assistant'], 'the facts keep the client');
    await renamed.locator('.agent-evidence dl.strip').scrollIntoViewIfNeeded();
    await shot(page, 'companion-session-desktop-facts');
    await renamed.locator('summary.agent-face').click();
    // The search finds the session by its companion's name or ID, and not the Claude session.
    const search = page.getByRole('searchbox', {name: 'Find a session', exact: true});
    for (const query of ['B.U.N.N.Y.', 'bunny']) {
      await search.fill(query);
      await claude.waitFor({state: 'hidden'});
      assert.equal(await renamed.isVisible(), true, `"${query}" finds the companion's titled session`);
      await search.fill('');
      await claude.waitFor();
    }
    // At phone width the first line stays one line, without horizontal page scroll.
    await page.setViewportSize({width: 390, height: 844});
    await renamed.scrollIntoViewIfNeeded();
    assert.equal(await oneLine(renamed, 'phone'), await oneLine(claude, 'phone, Claude'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'no horizontal page scroll');
    await shot(page, 'companion-session-phone');
    await renamed.locator('summary.agent-face').click();
    await renamed.locator('.agent-evidence').scrollIntoViewIfNeeded();
    await shot(page, 'companion-session-phone-facts');
    assert.deepEqual(errors, []);
    process.stdout.write('Companion session: untitled persona once, renamed tile tagged in place of its client, a room\'s first tag and count, Companion and Client facts, companion search by name and ID, Claude unchanged, one-line face of unchanged height at 1280 and 390 px passed.\n');
  } finally {
    await context.close();
    await world.close();
  }
}

if (import.meta.main) {
  const browser = await chromium.launch({headless: true});
  try {await companionSessionJourney(browser);} finally {await browser.close();}
}
