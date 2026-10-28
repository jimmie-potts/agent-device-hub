import {openConnections, openSettings} from './navigation-helpers.ts';
// Disposable Caddy + real dashboard journey; this does not establish installed iPhone certificate trust.
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium, webkit, request} from 'playwright';
import {tokenDigest} from '../../dist/src/credentials.js';
import {sessionStarted, turnStarted} from '../../dist/tests/fixtures/agents.js';
import {changes, feed, startWorld} from './harness.ts';

const caddy = process.env.BUNNY_TEST_CADDY;
const privateEntry = process.env.BUNNY_TEST_ENTRY === 'private';
assert.ok(caddy !== undefined && caddy !== '', 'set BUNNY_TEST_CADDY to a verified Caddy executable; this test installs nothing');
const reservation = createServer();
await new Promise<void>((done, fail) => { reservation.once('error', fail); reservation.listen(0, '127.0.0.1', done); });
const address = reservation.address();
assert.ok(address !== null && typeof address !== 'string');
const origin = `https://127.0.0.1:${address.port}`;
await new Promise<void>(done => { reservation.close(() => { done(); }); });
const root = await mkdtemp(join(tmpdir(), 'bunny-wifi-browser-'));
const token = randomBytes(32).toString('base64url');
const password = randomBytes(24).toString('base64url');
const hash = execFileSync(caddy, ['hash-password'], {input: `${password}\n`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']}).trim();
const entry = {origin, tokenDigest: tokenDigest(token)};
const world = await startWorld({trusted: false, ...(privateEntry ? {privateProxy: entry} : {wifiProxy: entry})});
let config = fileURLToPath(new URL('../../wifi.Caddyfile', import.meta.url));
let forwarder: ReturnType<typeof spawn> | undefined;
let forwarderLog = '';
if (privateEntry) {
  await new Promise<void>((done, fail) => { reservation.once('error', fail); reservation.listen(0, '127.0.0.1', done); });
  const bound = reservation.address();
  assert.ok(bound !== null && typeof bound !== 'string');
  await new Promise<void>(done => { reservation.close(() => { done(); }); });
  forwarder = spawn(caddy, ['run', '--config', fileURLToPath(new URL('../../private.Caddyfile', import.meta.url)), '--adapter', 'caddyfile'], {
    env: {...process.env, BUNNY_PRIVATE_PORT: String(bound.port), BUNNY_PRIVATE_UPSTREAM: new URL(world.url).host,
      BUNNY_PRIVATE_HOST: new URL(origin).hostname, BUNNY_PRIVATE_PASSWORD_HASH: hash, BUNNY_PRIVATE_PROXY_TOKEN: token}, stdio: ['ignore', 'pipe', 'pipe'],
  });
  forwarder.stderr?.setEncoding('utf8').on('data', (chunk: string) => { forwarderLog += chunk; });
  // A disposable TLS terminator stands in for Serve. This does not qualify Tailscale or system certificate trust.
  config = join(root, 'tls.Caddyfile');
  await writeFile(config, `{\n admin off\n persist_config off\n skip_install_trust\n auto_https disable_redirects\n storage file_system {\n root "${root}"\n }\n}\n${origin} {\n bind 127.0.0.1\n tls internal\n reverse_proxy 127.0.0.1:${bound.port}\n}\n`);
}
let caddyLog = '';
const proxy = spawn(caddy, ['run', '--config', config, '--adapter', 'caddyfile'], {env: {...process.env,
  BUNNY_WIFI_DATA: resolve(root), BUNNY_WIFI_ORIGIN: origin, BUNNY_WIFI_BIND: '127.0.0.1', BUNNY_WIFI_UPSTREAM: new URL(world.url).host,
  BUNNY_WIFI_PASSWORD_HASH: hash, BUNNY_WIFI_PROXY_TOKEN: token,
}, stdio: ['ignore', 'pipe', 'pipe']});
proxy.stdout.on('data', () => {});
proxy.stderr.setEncoding('utf8').on('data', (chunk: string) => { caddyLog += chunk; });

try {
  const deadline = Date.now() + 10_000;
  while (!caddyLog.includes('server running') || !caddyLog.includes('certificate obtained successfully')) {
    assert.equal(proxy.exitCode, null, 'Caddy stopped before serving');
    assert.ok(Date.now() < deadline, 'Caddy did not start');
    await new Promise(done => { setTimeout(done, 50); });
  }
  if (privateEntry) {
    while (!forwarderLog.includes('server running')) {
      assert.equal(forwarder?.exitCode, null, 'private forwarder stopped before serving');
      assert.ok(Date.now() < deadline, 'private forwarder did not start');
      await new Promise(done => { setTimeout(done, 50); });
    }
    const client = await request.newContext({ignoreHTTPSErrors: true});
    try {
      assert.equal((await client.get(origin)).status(), 401);
      assert.equal((await client.get(origin, {headers: {authorization: 'Basic ' + Buffer.from('owner:wrong').toString('base64')}})).status(), 401);
      const headers = {authorization: 'Bearer ' + world.readerToken, 'bunny-private-proxy': 'forged', 'bunny-wifi-proxy': 'forged'};
      assert.equal((await client.get(origin + '/api/v2/build', {headers})).status(), 200, 'forwarder replaces supplied proxy proofs');
      assert.equal((await client.get(origin + '/api/v2/authority?scope=control', {headers})).status(), 403);
      assert.equal((await client.get(origin + '/api/v2/build', {headers: {...headers, origin}})).status(), 403);
      assert.equal((await client.post(origin + '/api/v2/browser/session', {headers: {...headers, origin, 'bunny-request': '1'}, data: {}})).status(), 403);
      assert.equal((await client.get(origin + '/api/v2/build', {headers: {authorization: 'Bearer invalid'}})).status(), 401);
    } finally { await client.dispose(); }
  }
  // Confirm the configured CA exists, rather than silently falling back to an HTTP test.
  assert.match(await readFile(join(root, 'pki/authorities/local/root.crt'), 'utf8'), /BEGIN CERTIFICATE/);
  const selected = process.env.BUNNY_TEST_BROWSER ?? 'chromium';
  assert.ok(['chromium', 'webkit', 'both'].includes(selected), 'BUNNY_TEST_BROWSER is chromium, webkit or both');
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]] as const) {
    if (selected !== 'both' && selected !== name) continue;
    const browser = await engine.launch({headless: true});
    try {
      // Only the disposable browser context skips OS trust installation; TLS validation has its own setup probe.
      const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true,
        ignoreHTTPSErrors: true, ...(name === 'webkit' ? {httpCredentials: {username: 'owner', password}} : {}), reducedMotion: 'reduce'});
      const page = await context.newPage();
      let passwordPrompts = 0;
      if (name === 'chromium') {
        // Supply the password once, as a person does. Automatically answering every challenge hides login loops.
        const authentication = await context.newCDPSession(page);
        authentication.on('Fetch.requestPaused', event => { void authentication.send('Fetch.continueRequest', {requestId: event.requestId}); });
        authentication.on('Fetch.authRequired', event => {
          passwordPrompts += 1;
          void authentication.send('Fetch.continueWithAuth', {requestId: event.requestId, authChallengeResponse:
            passwordPrompts === 1 ? {response: 'ProvideCredentials', username: 'owner', password} : {response: 'CancelAuth'}});
        });
        await authentication.send('Fetch.enable', {handleAuthRequests: true});
      }
      page.setDefaultTimeout(12_000);
      const errors: string[] = [];
      page.on('pageerror', error => { errors.push(error.name); });
      const sent = changes(page);
      const commands = (): number => sent.filter(item => item.endsWith('/commands/mode-set')).length;
      await page.goto(origin);
      await feed(page, 'connected');
      if (name === 'chromium') assert.equal(passwordPrompts, 1, 'one accepted owner password reaches the dashboard');
      assert.equal(await page.evaluate(() => window.isSecureContext && typeof crypto.randomUUID === 'function'), true);
      const cookie = (await context.cookies()).find(item => item.name === 'bunny-session');
      assert.ok(cookie !== undefined && cookie.secure && cookie.httpOnly && cookie.sameSite === 'Strict');
      await world.observe(sessionStarted, {title: {value: 'Wi-Fi browser check', source: 'provider'}});
      await world.observe(turnStarted);
      await page.getByRole('heading', {name: 'Wi-Fi browser check', exact: true}).waitFor();
      await openConnections(page);
      await page.getByRole('heading', {name: 'Connections', exact: true}).waitFor();
      await page.getByRole('link', {name: /^Home/}).click();
      const panel = page.locator('[data-widget="hub-mode"]');
      await panel.getByRole('button', {name: 'Quiet', exact: true}).click();
      await panel.getByRole('button', {name: 'Quiet', exact: true, pressed: true}).waitFor();
      assert.equal(commands(), 1);
      await context.setOffline(true);
      world.dropDashboardStreams();
      await page.waitForFunction(() => document.querySelector('main#main')?.getAttribute('data-feed') !== 'connected');
      await context.setOffline(false);
      await feed(page, 'connected');
      await page.reload();
      await feed(page, 'connected');
      assert.equal(commands(), 1, 'reconnect and reload never replay the control');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      const violations = (await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
      assert.deepEqual(violations.map(item => item.id), []);
      await openSettings(page);
      await page.getByRole('button', {name: 'Disconnect', exact: true}).click();
      await page.getByRole('button', {name: 'Sign in', exact: true}).waitFor();
      assert.equal(world.browserSessions(), 0);
      assert.deepEqual(errors, []);
      await context.close();
      process.stdout.write(`${JSON.stringify({entry: privateEntry ? 'private' : 'wifi', browser: name, passed: true, checks: ['HTTPS secure context', 'owner session', 'phone navigation', 'simulated control', 'offline recovery without replay', 'phone overflow and axe', 'logout'], actualIphone: false, tailscaleInstalled: false, systemTrustInstalled: false})}\n`);
    } finally { await browser.close(); }
  }
} finally {
  proxy.kill('SIGTERM');
  await new Promise<void>(done => { if (proxy.exitCode !== null) done(); else proxy.once('exit', () => { done(); }); });
  if (forwarder !== undefined) {
    const selected = forwarder;
    selected.kill('SIGTERM');
    await new Promise<void>(done => { if (selected.exitCode !== null) done(); else selected.once('exit', () => { done(); }); });
  }
  await world.close();
  await rm(root, {recursive: true, force: true});
}
