// HTTP-only uncertainty must lock every mounted control for the same target.
import assert from 'node:assert/strict';
import {chromium, type Locator, type Page} from 'playwright';
import {bounded, browserStepError, mainNow} from './feed-wait.ts';
import {changes, feed, startWorld} from './harness.ts';

/**
 * What the card and the advanced controls showed when a step failed (#2129): each one's status and hint lines and its
 * controls with their values and whether they were disabled (the main region's text when there is no card), the main
 * region's connection, the command requests the page sent and the attempts it retained. It reads the page once, after
 * the failure, within `bounded`'s limit.
 */
async function shown(page: Page, sent: readonly string[]): Promise<string> {
  const surfaces = bounded(() => page.evaluate(() => {
    const text = (node: Element): string => node.textContent.replace(/\s+/g, ' ').trim();
    const surface = (root: Element | null): string => {
      if (root === null) return 'absent';
      const lines = [...root.querySelectorAll('[role=status], [role=alert], .hint, .light-note, .light-card-heading p')].map(text).filter(line => line !== '');
      const controls = [...root.querySelectorAll('button, input, select')].map(node => {
        const control = node as HTMLButtonElement | HTMLInputElement | HTMLSelectElement;
        // A label that holds its control also holds a select's options, which are not its name.
        const label = control.labels?.[0];
        let name = control.getAttribute('aria-label');
        if (name === null) {
          name = control instanceof HTMLButtonElement || label === undefined ? text(control)
            : label.textContent.replace(control.textContent, '').replace(/\s+/g, ' ').trim();
        }
        return `${name}${control instanceof HTMLButtonElement ? '' : `=${JSON.stringify(control.value)}`}${control.disabled ? ' (disabled)' : ''}`;
      });
      return `lines ${JSON.stringify(lines)}; controls ${JSON.stringify(controls)}`;
    };
    const card = document.querySelector('article[aria-label="Pixoo display"]'), main = document.querySelector('main#main');
    return {hash: location.hash, card: card === null ? `absent; main region text ${JSON.stringify(main === null ? null : text(main).slice(0, 200))}` : surface(card),
      player: surface(document.querySelector('section[aria-label="Pixoo player"]')), device: surface(document.querySelector('[data-device="pixoo-1"]')),
      attempts: sessionStorage.getItem('bunny-device-attempts')?.slice(0, 300) ?? null};
  }));
  const [read, connection] = await Promise.all([surfaces, mainNow(page)]);
  const facts = 'value' in read ? [`route ${read.value.hash}`, `card: ${read.value.card}`, `advanced player: ${read.value.player}`,
    `advanced device controls: ${read.value.device}`, `retained attempts ${String(read.value.attempts)}`]
    : [`the card and the advanced controls could not be read: ${read.problem}`];
  return [...facts, connection, `command requests sent ${JSON.stringify(sent)}`].join('\n  ');
}
const browser = await chromium.launch({headless: true});
const results: {surface: string; direction: string; passed: boolean; reason?: string}[] = [];
try {
  for (const surface of ['player', 'device'] as const) for (const direction of ['card-to-advanced', 'advanced-to-card']) {
    const world = await startWorld({pixooPages: true});
    const context = await browser.newContext({viewport: {width: 1280, height: 1000}, reducedMotion: 'reduce'});
    const sent: string[] = [];
    let activeStep: string | undefined;
    const step = async (name: string, work: () => Promise<unknown>): Promise<void> => {
      activeStep = name;
      await work();
      activeStep = undefined;
    };
    try {
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      changes(page, sent);
      await page.goto(`${world.url}/${surface === 'player' ? '#/module/pixoo/player' : '#/component/pixoo-1'}`); await feed(page, 'connected');
      const cardOn = (where: 'player' | 'device') => page.getByRole('region', {name: where === 'player' ? 'Player' : 'Devices', exact: true})
        .getByRole('article', {name: 'Pixoo display', exact: true});
      const card = cardOn(surface);
      // Each new page mounts this card after Pixoo's own catalog sync. Under one-CPU contention its first
      // Display tab took up to 15.3 s after feed() returned (#2129). Command and lock checks keep their 10 s limit.
      const waitForCard = (target: Locator) => step('wait for the Pixoo card to load', () =>
        target.getByRole('tab', {name: 'Display', exact: true}).waitFor({timeout: 20_000}));
      await waitForCard(card);
      await step('open the advanced controls', () => page.getByText(surface === 'player' ? 'Advanced player' : 'Advanced device controls', {exact: true}).click());
      const advanced = surface === 'player' ? page.getByRole('region', {name: 'Pixoo player', exact: true}) : page.locator('[data-device="pixoo-1"]');
      if (direction === 'card-to-advanced') {
        // Give the sibling an older completed attempt before testing a newer HTTP-only unknown.
        if (surface === 'player') {
          await step('choose Work in the advanced Display mode', () => advanced.getByRole('combobox', {name: 'Display mode', exact: true}).selectOption('work'));
          await step('press the advanced Set display mode', () => advanced.getByRole('button', {name: 'Set display mode', exact: true}).click());
          await step('wait for the advanced "Completed: succeeded." status', () => advanced.getByRole('status').filter({hasText: 'Completed: succeeded.'}).waitFor());
          await step('choose Free in the advanced Display mode', () => advanced.getByRole('combobox', {name: 'Display mode', exact: true}).selectOption('free'));
        } else {
          await step('choose Work in the advanced Device mode', () => advanced.getByRole('combobox', {name: 'Device mode', exact: true}).selectOption('work'));
          await step('wait for the advanced "Completed: succeeded." status', () => advanced.getByRole('status').filter({hasText: 'Completed: succeeded.'}).waitFor());
        }
        await page.route('**/api/v2/commands/brightness-set', route => route.fulfill({status: 503, contentType: 'application/json', body: '{"error":{"code":"uncertain-result","retryable":false}}'}));
        await step('set the card\'s brightness slider to 42', () => card.getByRole('slider').fill('42'));
        await step('press the card\'s Apply brightness', () => card.getByRole('button', {name: 'Apply brightness', exact: true}).click());
        await step('wait for the card\'s "Uncertain result." status', () => card.getByRole('status').filter({hasText: 'Uncertain result.'}).waitFor());
      } else {
        await step('press the card\'s Screen on', () => card.getByRole('button', {name: 'Screen on', exact: true}).click());
        await step('wait for the card\'s "Completed: succeeded." status', () => card.getByRole('status').filter({hasText: 'Completed: succeeded.'}).waitFor());
        await page.route('**/api/v2/commands/device-mode-set', route => route.fulfill({status: 503, contentType: 'application/json', body: '{"error":{"code":"uncertain-result","retryable":false}}'}));
        if (surface === 'player') {
          await step('choose Work in the advanced Display mode', () => advanced.getByRole('combobox', {name: 'Display mode', exact: true}).selectOption('work'));
          await step('press the advanced Set display mode', () => advanced.getByRole('button', {name: 'Set display mode', exact: true}).click());
        } else await step('choose Work in the advanced Device mode', () => advanced.getByRole('combobox', {name: 'Device mode', exact: true}).selectOption('work'));
        await step('wait for the advanced "Uncertain result." status', () => advanced.getByRole('status').filter({hasText: 'Uncertain result.'}).waitFor());
      }
      const retained = await page.evaluate(() => sessionStorage.getItem('bunny-device-attempts'));
      assert.ok(retained !== null && retained.includes(direction === 'card-to-advanced' ? 'brightness-set' : 'device-mode-set'));
      const count = sent.length;
      assert.equal(await card.getByRole('button', {name: 'Screen on', exact: true}).isDisabled(), true, 'card shares the target lock');
      if (surface === 'player') assert.equal(await advanced.getByRole('button', {name: 'Set display mode', exact: true}).isDisabled(), true, 'advanced player shares the target lock');
      else assert.equal(await advanced.getByRole('combobox', {name: 'Device mode', exact: true}).isDisabled(), true, 'advanced device controls share the target lock');
      // Opening the same target on another surface, then reloading, must retain the unknown identity.
      const otherCard = cardOn(surface === 'player' ? 'device' : 'player');
      await page.goto(`${world.url}/${surface === 'player' ? '#/component/pixoo-1' : '#/module/pixoo/player'}`);
      await waitForCard(otherCard);
      await step('wait for the other surface\'s card Screen on', () => otherCard.getByRole('button', {name: 'Screen on', exact: true}).waitFor());
      assert.equal(await otherCard.getByRole('button', {name: 'Screen on', exact: true}).isDisabled(), true);
      await page.reload(); await feed(page, 'connected');
      await waitForCard(otherCard);
      await step('wait for the reloaded card\'s "Previous request has no confirmed result yet." status', () => otherCard.getByRole('status').filter({hasText: 'Previous request has no confirmed result yet.'}).waitFor());
      assert.equal(await otherCard.getByRole('button', {name: 'Screen on', exact: true}).isDisabled(), true);
      assert.equal(await page.evaluate(() => sessionStorage.getItem('bunny-device-attempts')), retained);
      assert.equal(sent.length, count, 'navigation and reload neither clear nor replay the unknown request');
      results.push({surface, direction, passed: true});
    } catch (error) {
      const page = context.pages()[0];
      const facts = page === undefined ? `page unavailable; command requests sent ${JSON.stringify(sent)}` : await shown(page, sent);
      const reason = [activeStep, browserStepError(error)].filter(part => part !== undefined).join(': ');
      results.push({surface, direction, passed: false, reason: `${reason}\n  ${facts}`});
    } finally { await context.close(); await world.close(); }
  }
} finally { await browser.close(); }
process.stdout.write(JSON.stringify(results)+'\n');
assert.equal(results.every(result => result.passed), true, results.filter(result => !result.passed).map(result => `${result.surface} ${result.direction}: ${result.reason ?? 'failed'}`).join('\n'));
