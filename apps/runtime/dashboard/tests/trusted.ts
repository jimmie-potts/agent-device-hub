// Browser sign-in on the runtime's dashboard (Hub #922), converted from `apps/dashboard/tests/trusted.mjs`: the
// launcher's one-time code, the trusted loopback bookmark (Hub #276) on either loopback name, a reload and a second tab
// that share the browser's live session instead of opening more, a failed sign-in, Disconnect ending every tab's
// session, and another local app's link that opens the page while its frame, another host name's link and a hostile
// page that re-navigates the tab are refused or harmless (Hub #561). Nothing here sends a command.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium, type BrowserContext, type Page, type Response} from 'playwright';
import {requestBrowserLaunch} from '../../dist/src/index.js';
import {changes, feed, startWorld, type World} from './harness.ts';

const browser = await chromium.launch({headless: true});
const output = process.env.DASHBOARD_RECEIPTS;
if (output !== undefined) await mkdir(output, {recursive: true});
const checks: string[] = [];
const errors: string[] = [];
const sent: string[] = [];

async function fresh(): Promise<BrowserContext> {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, reducedMotion: 'reduce'});
  context.on('weberror', error => { errors.push(error.error().name); });
  context.on('page', page => {
    changes(page, sent);
    page.setDefaultTimeout(12_000);
  });
  return context;
}
async function open(context: BrowserContext, url: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(url);
  return page;
}
const signedIn = async (page: Page): Promise<void> => {
  await page.getByText('Control enabled · Local', {exact: true}).waitFor();
  await feed(page, 'connected');
};
const axe = async (page: Page): Promise<string[]> => (await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(violation => violation.id);

let world: World | undefined;
try {
  {
    // Without trusted loopback sign-in, a direct visit shows the launcher's page, and only the launcher's code signs in.
    world = await startWorld({trusted: false, launcher: true});
    const context = await fresh();
    const page = await open(context, world.url);
    await page.getByRole('heading', {name: 'Open B.U.N.N.Y. with the launcher.', exact: true}).waitFor();
    assert.equal(world.browserSessions(), 0);
    assert.deepEqual(await axe(page), []);
    const launch = await requestBrowserLaunch(world.stateDir);
    // The launcher opens a new tab at the runtime's origin with the code.
    const launched = await open(context, `${launch.url}#launch=${launch.code}`);
    await signedIn(launched);
    assert.equal(new URL(launched.url()).hash, '', 'the code leaves the address before it is exchanged');
    assert.equal(world.browserSessions(), 1);
    const again = await open(await fresh(), `${launch.url}#launch=${launch.code}`);
    await again.getByRole('alert').filter({hasText: 'That launch expired or failed. Run the launcher again.'}).waitFor();
    const malformed = await open(await fresh(), `${world.url}/#launch=not-a-code`);
    await malformed.getByRole('alert').filter({hasText: 'That launch expired or failed.'}).waitFor();
    assert.equal(world.browserSessions(), 1, 'a used or malformed code signs nobody in');
    checks.push('the launcher\'s code signs one browser in once, and a direct visit shows the launcher\'s page');
    await world.close();
    world = undefined;
  }
  {
    world = await startWorld();
    const context = await fresh();
    const page = await open(context, world.url);
    await signedIn(page);
    assert.equal(world.browserSessions(), 1, 'a bookmark signs in without a form');
    // A run names no place, so its Places lead nowhere local but here: a preview never links to an installed service.
    const places = page.getByRole('navigation', {name: 'Places'});
    await page.locator('nav[aria-label=Places][data-links=loaded]').waitFor();
    assert.deepEqual(await places.locator('a, [aria-current=page]').allTextContents(), ['Guide', 'Architecture', 'Atlas', 'Reference', 'B.U.N.N.Y.Local']);
    await page.reload();
    await signedIn(page);
    const second = await open(context, `${world.url}/#/connections`);
    await signedIn(second);
    await second.getByRole('heading', {name: 'Connections', exact: true}).waitFor();
    assert.equal(new URL(second.url()).hash, '#/connections', 'a bookmarked page keeps its address');
    assert.equal(world.browserSessions(), 1, 'a reload and a second tab use the live session');
    const localhost = await open(await fresh(), world.url.replace('127.0.0.1', 'localhost'));
    await signedIn(localhost);
    assert.equal(world.browserSessions(), 2, 'a bookmark on localhost signs its own browser in');
    checks.push('a bookmark signs in on either loopback name, and a reload and a second tab share its session');

    // Disconnect ends the session in every tab of the browser: the other tab offers one sign-in and waits for it.
    await page.getByRole('button', {name: 'Disconnect', exact: true}).click();
    await page.getByRole('heading', {name: 'You’re signed out.', exact: true}).waitFor();
    await feed(second, 'ended');
    await second.getByRole('button', {name: 'Sign in again', exact: true}).waitFor();
    await new Promise(resolve => { setTimeout(resolve, 1500); });
    assert.equal(world.browserSessions(), 1, 'only the localhost browser\'s session is left; nothing signed in by itself');
    await second.getByRole('button', {name: 'Sign in again', exact: true}).click();
    await signedIn(second);
    assert.equal(world.browserSessions(), 2);
    checks.push('Disconnect ends the session in every tab, which each offer one sign-in');

    // A sign-in that fails shows an alert with the launcher's text.
    const failing = await (await fresh()).newPage();
    failing.setDefaultTimeout(12_000);
    await failing.route('**/api/v2/browser/session', route => route.fulfill({status: 500, contentType: 'application/json', body: '{}'}));
    await failing.goto(world.url);
    await failing.getByRole('alert').filter({hasText: 'B.U.N.N.Y. couldn’t sign you in.'}).waitFor();
    await failing.getByText('The launcher opens this page and signs it in.', {exact: true}).waitFor();
    checks.push('a failed sign-in shows an alert and the launcher\'s text');
    await world.close();
    world = undefined;
  }
  {
    // Hub #561: a link on another loopback app's page opens the dashboard signed in; that app cannot frame it, a link
    // from another host name is refused, and a page that drives a window it opened back to the dashboard never evicts
    // the owner's session.
    world = await startWorld();
    const runtimePort = new URL(world.url).port;
    const other: Server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://other');
      const target = `http://${url.searchParams.get('to') === 'localhost' ? 'localhost' : '127.0.0.1'}:${runtimePort}/`;
      response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
      if (url.pathname === '/attack') {
        response.end(`<!doctype html><html lang="en"><title>Hostile local app</title><button id="go">Open</button><script>
          const runtime = ${JSON.stringify(target)}; window.rounds = 0; window.severed = false;
          document.getElementById('go').onclick = () => { const w = window.open(runtime); const tick = () => { if (w.closed) { window.severed = true; return; }
            w.location = runtime; window.rounds++; setTimeout(tick, 10 + Math.random() * 20); }; setTimeout(tick, 20); };
        </script></html>`);
        return;
      }
      response.end(`<!doctype html><html lang="en"><title>Another local app</title><a href="${target}" target="_blank" rel="noopener noreferrer">B.U.N.N.Y.</a>${url.pathname === '/framed' ? `<iframe title="Framed B.U.N.N.Y." src="${target}"></iframe>` : ''}</html>`);
    });
    await new Promise<void>(resolve => { other.listen(0, '127.0.0.1', resolve); });
    const otherPort = (other.address() as AddressInfo).port;
    const toRuntime = (response: Response): boolean => new URL(response.url()).port === runtimePort;
    try {
      const context = await fresh();
      const follow = async (from: string): Promise<{tab: Page; response: Response; site: string | undefined}> => {
        const page = await open(context, from);
        const [tab, response] = await Promise.all([
          context.waitForEvent('page'), context.waitForEvent('response', candidate => candidate.request().isNavigationRequest() && toRuntime(candidate)),
          page.getByRole('link', {name: 'B.U.N.N.Y.', exact: true}).click(),
        ]);
        return {tab, response, site: (await response.request().allHeaders())['sec-fetch-site']};
      };
      const linked = await follow(`http://127.0.0.1:${otherPort}/`);
      assert.deepEqual([linked.site, linked.response.status()], ['same-site', 200], 'a link from another loopback port is same-site and served');
      await signedIn(linked.tab);
      assert.equal(world.browserSessions(), 1);
      const crossed = await follow(`http://localhost:${otherPort}/`);
      assert.deepEqual([crossed.site, crossed.response.status()], ['cross-site', 403], 'a localhost page linking to 127.0.0.1 is refused');
      await crossed.tab.getByText('forbidden', {exact: false}).waitFor();
      checks.push('another local app\'s link opens the dashboard signed in, and another host name\'s link is refused');

      const framer = await context.newPage();
      const framed = framer.waitForResponse(toRuntime);
      await framer.goto(`http://127.0.0.1:${otherPort}/framed`);
      const frameResponse = await framed;
      assert.equal((await frameResponse.request().allHeaders())['sec-fetch-dest'], 'iframe');
      assert.equal(frameResponse.status(), 403, 'another loopback app cannot frame the dashboard');
      assert.equal(await framer.frameLocator('iframe').getByText('Control enabled · Local', {exact: true}).count(), 0);
      checks.push('another loopback app cannot frame the dashboard');

      // The negative control of #561: without the opener policy and the shared session, this loop would pile up
      // sign-ins until the session limit evicted the owner. Here the owner's tab stays signed in throughout.
      const hostile = await open(context, `http://127.0.0.1:${otherPort}/attack`);
      await hostile.getByRole('button', {name: 'Open', exact: true}).click();
      let most = 0;
      const started = Date.now();
      while (Date.now() - started < 5000) {
        most = Math.max(most, world.browserSessions());
        await new Promise(resolve => { setTimeout(resolve, 25); });
      }
      const attack = await hostile.evaluate(() => ({rounds: (window as unknown as {rounds: number}).rounds, severed: (window as unknown as {severed: boolean}).severed}));
      assert.equal(attack.severed, true, 'the opened tab no longer answers to the hostile page\'s handle');
      assert.ok(most <= 1, `the runtime held ${most} sessions`);
      await linked.tab.bringToFront();
      assert.equal(await linked.tab.locator('main#main').getAttribute('data-feed'), 'connected', 'the owner\'s tab is still signed in');
      checks.push('another local app cannot drive repeated sign-ins that evict the owner');
      if (output !== undefined) await linked.tab.screenshot({path: `${output}/runtime-linked.png`, fullPage: true});
      await context.close();
    } finally {
      other.closeAllConnections();
      await new Promise<void>(resolve => { other.close(() => { resolve(); }); });
    }
  }
  assert.deepEqual(sent, [], 'signing in and following links send no command');
  assert.deepEqual(errors, []);
  process.stdout.write(`${JSON.stringify({passed: true, checks})}\n`);
} finally {
  await world?.close();
  await browser.close();
}
