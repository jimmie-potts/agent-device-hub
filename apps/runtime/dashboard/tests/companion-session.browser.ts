// A native conversation's session tile names its companion apart from its title (Hub #2054), on the built runtime with
// the real companions module, a synthetic provider and a synthetic hook. The untitled session shows its persona once, the
// renamed one tags its companion before the client, the expanded facts name the companion, the search finds it, a Claude
// session looks as before, and the face's first line stays one line at desktop and phone widths. It contacts no device.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium, type Browser, type Locator, type Page} from 'playwright';
import {sessionStarted, turnStarted} from '../../dist/tests/fixtures/agents.js';
import {feed, startWorld} from './harness.ts';

const RENAMED = 'Synthetic kitchen plans';

/** The face's first line at the page's width: one line, inside the tile, with the evidence age whole. */
async function oneLine(tile: Locator, label: string): Promise<void> {
  const box = await tile.locator('.agent-meta').evaluate(meta => {
    const rect = (node: Element | null) => node === null ? null : node.getBoundingClientRect();
    const face = rect(meta.closest('.agent-face')), line = rect(meta), tag = rect(meta.querySelector('.agent-companion'));
    const client = rect(meta.querySelector('.agent-client')), heard = meta.querySelector('.agent-heard') as HTMLElement | null;
    return {viewport: window.innerWidth, face, line, tag, client, heardWhole: heard !== null && heard.scrollWidth <= heard.clientWidth + 1, height: parseFloat(getComputedStyle(meta).lineHeight)};
  });
  assert.ok(box.face !== null && box.line !== null && box.client !== null, label);
  assert.ok(box.line.left >= box.face.left && box.line.right <= box.face.right + 1, `${label}: the line stays inside the tile`);
  assert.ok(box.face.right <= box.viewport + 1, `${label}: the tile stays inside the page`);
  assert.ok(box.line.height < 2 * (Number.isNaN(box.height) ? 20 : box.height) + 8, `${label}: the line does not wrap (${String(box.line.height)}px)`);
  if (box.tag !== null) {
    assert.ok(Math.abs(box.tag.top + box.tag.height / 2 - (box.client.top + box.client.height / 2)) < 6, `${label}: the tag sits on the client's line`);
    assert.ok(box.tag.right <= box.client.left + 1, `${label}: the tag leads the client`);
  }
  assert.equal(box.heardWhole, true, `${label}: the evidence age is whole`);
}

export async function companionSessionJourney(browser: Browser): Promise<void> {
  const world = await startWorld({companions: true, assistantProvider: {name: 'synthetic', model: 'synthetic',
    turn: () => Promise.resolve({text: 'Synthetic companion reply.', calls: [], stop: 'end', units: 1})}});
  const output = process.env.DASHBOARD_RECEIPTS;
  if (output !== undefined) await mkdir(output, {recursive: true});
  const shot = async (page: Page, name: string): Promise<void> => { if (output !== undefined) await page.screenshot({path: `${output}/${name}.png`, fullPage: false}); };
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, reducedMotion: 'reduce'});
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
    const facts = (card: Locator) => card.locator('.agent-evidence dl.strip > div').evaluateAll(rows => rows.map(row =>
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
    await oneLine(renamed, 'desktop');
    await oneLine(claude, 'desktop, Claude');
    await shot(page, 'companion-session-desktop');
    await renamed.locator('summary.agent-face').click();
    assert.deepEqual((await facts(renamed)).find(([term]) => term === 'Companion'), ['Companion', 'B.U.N.N.Y.']);
    await renamed.locator('.agent-evidence dl.strip').scrollIntoViewIfNeeded();
    await shot(page, 'companion-session-desktop-facts');
    await renamed.locator('summary.agent-face').click();
    // The search finds the session by its companion's name, and not the Claude session.
    const search = page.getByRole('searchbox', {name: 'Find a session', exact: true});
    await search.fill('B.U.N.N.Y.');
    await claude.waitFor({state: 'hidden'});
    assert.equal(await renamed.isVisible(), true, 'the companion\'s name finds its titled session');
    await search.fill('');
    await claude.waitFor();
    // At phone width the first line stays one line, without horizontal page scroll.
    await page.setViewportSize({width: 390, height: 844});
    await renamed.scrollIntoViewIfNeeded();
    await oneLine(renamed, 'phone');
    await oneLine(claude, 'phone, Claude');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'no horizontal page scroll');
    await shot(page, 'companion-session-phone');
    await renamed.locator('summary.agent-face').click();
    await renamed.locator('.agent-evidence').scrollIntoViewIfNeeded();
    await shot(page, 'companion-session-phone-facts');
    assert.deepEqual(errors, []);
    process.stdout.write('Companion session: untitled persona once, renamed tile tagged apart from its title, Companion fact, companion search, Claude unchanged, one-line face at 1280 and 390 px passed.\n');
  } finally {
    await context.close();
    await world.close();
  }
}

if (import.meta.main) {
  const browser = await chromium.launch({headless: true});
  try {await companionSessionJourney(browser);} finally {await browser.close();}
}
