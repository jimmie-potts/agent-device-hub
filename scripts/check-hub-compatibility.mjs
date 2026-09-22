// Synthetic source compatibility. Arguments must be explicitly prepared source archives.
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawn, execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createServer} from 'node:net';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {ownedChild} from './compatibility-process.mjs';

const [pixooSource, nanoSource, output] = process.argv.slice(2);
for (const path of [pixooSource, nanoSource, output]) {
  assert.ok(path && resolve(path) === path, 'two absolute source paths and a new absolute report path required');
}
const hash = value => createHash('sha256').update(value).digest('hex');
const pins = {};
// Reserve the report before preflight; never overwrite an earlier attempt.
await writeFile(output, JSON.stringify({status: 'running'}), {flag: 'wx', mode: 0o600});
let root;
const token = 'h'.repeat(43);
const headers = {authorization: 'Bearer ' + token, 'content-type': 'application/json', 'x-pixoo-request': '1'};
const scenarios = [];
let hub, pixoo, browser, nano, lines, nanoExit;
let stage = 'preflight';
let report = {pins, startedAt: new Date().toISOString(), physical: false, installedClients: false};
const delay = ms => new Promise(r => setTimeout(r, ms));
async function bounded(promise, label, ms = 8000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {timer = setTimeout(() => reject(new Error(label + ' timeout')), ms);})]); }
  finally { clearTimeout(timer); }
}
async function nanoRead() {
  const line = await bounded(lines.next(), 'Nanoleaf response');
  assert.equal(line.done, false, 'Nanoleaf exited');
  return JSON.parse(line.value);
}
async function nanoCall(operation, extra = {}) {
  nano.stdin.write(JSON.stringify({operation, ...extra}) + '\n');
  return nanoRead();
}
async function request(url, path, auth = headers, body) {
  const response = await fetch(url + path, {headers: auth, signal: AbortSignal.timeout(5000), redirect: 'error',
    ...(body === undefined ? {} : {method: 'POST', body: JSON.stringify(body)})});
  assert.ok(response.ok, path + ': ' + response.status + ' ' + await response.clone().text());
  return response.json();
}
async function until(check, label) {
  const deadline = Date.now() + 10000;
  do { const result = await check(); if (result) return result; await delay(150); } while (Date.now() < deadline);
  throw new Error(label + ' timeout');
}
try {
  for (const [name, source, file] of [
    ['pixoo', pixooSource, 'pixoo-source.json'],
    ['nanoleaf', nanoSource, 'compatibility-nanoleaf-source.json'],
  ]) {
    const pin = JSON.parse(await readFile(new URL('../apps/hub/fixtures/' + file, import.meta.url)));
    for (const [path, expected] of Object.entries(pin.sourceFiles)) {
      assert.equal(hash(await readFile(join(source, path))), expected, name + ' source mismatch: ' + path);
    }
    pins[name] = {revision: pin.revision, verifiedFiles: Object.keys(pin.sourceFiles)};
  }
  report = {...report,pins, hubRevision: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
    hubSourceClean: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {encoding: 'utf8'}).trim() === '',
    runnerSha256: hash(await readFile(new URL(import.meta.url))),
    processHelperSha256: hash(await readFile(new URL('./compatibility-process.mjs', import.meta.url))),
    nanoleafFixtureSha256: hash(await readFile(new URL('./compatibility-nanoleaf.py', import.meta.url))),
    node: process.version, physical: false, installedClients: false};
  report.packages = {};
  for (const path of ['packages/contracts', 'packages/lifecycle-contracts', 'packages/agent-state', 'packages/mcp', 'apps/hub']) {
    const manifest = JSON.parse(await readFile(new URL('../' + path + '/package.json', import.meta.url)));
    report.packages[manifest.name] = manifest.version;
  }
  root = await mkdtemp(join(tmpdir(), 'hub-compatibility-'));
  stage = 'build';
  async function build(directory) {
    const buildProcess = ownedChild('npm', ['run', 'build'], {cwd: directory, env: process.env, stdio: ['ignore', 'pipe', 'pipe']});
    let diagnostics = '';
    for (const stream of [buildProcess.child.stdout, buildProcess.child.stderr]) stream.on('data', value => {diagnostics = (diagnostics + value).slice(-8000);});
    try {const [code] = await bounded(buildProcess.exited, 'source build', 120000);assert.equal(code, 0, diagnostics);}
    finally {await buildProcess.stop();}
  }
  await build(new URL('../', import.meta.url).pathname);
  await build(pixooSource);
  const {startHub} = await import('../apps/hub/dist/server.js');
  stage = 'setup';
  nano = spawn('/usr/bin/python3', ['-B', new URL('./compatibility-nanoleaf.py', import.meta.url).pathname, nanoSource],
    {env: {PATH: '/usr/bin:/bin', TMPDIR: root}, stdio: ['pipe', 'pipe', 'pipe']});
  let diagnostics = '';
  nano.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-8000); });
  nanoExit = new Promise((resolveExit, reject) => {nano.once('exit', resolveExit); nano.once('error', reject);});
  lines = createInterface({input: nano.stdout})[Symbol.asyncIterator]();
  const native = await nanoRead().catch(error => {throw new Error(error.message + ': ' + diagnostics);});
  report.python = native.python;
  const reservation = createServer();
  await new Promise(r => reservation.listen(0, '127.0.0.1', r));
  const pixooPort = reservation.address().port;
  await new Promise(r => reservation.close(r));
  const local = join(root, 'pixoo');
  await mkdir(join(local, 'agent-monitor'), {recursive: true, mode: 0o700});
  const {provisionCredential} = await import(pathToFileURL(join(pixooSource, 'apps/server/dist/mcp-config.js')));
  const monitorToken = await provisionCredential(join(local, 'agent-monitor'), 'monitor', ['read', 'control']);
  const controllerToken = await provisionCredential(local, 'controller', ['read', 'control']);
  const pixooHeaders = {...headers, authorization: 'Bearer ' + monitorToken};
  const options = {directory: join(root, 'hub'), ownerId: 'compatibility', port: 0, mcp: true,
    consumers: [{id: 'dashboard', clearOnNewTurn: false}, {id: 'pixoo', clearOnNewTurn: true}, {id: 'nanoleaf', clearOnNewTurn: true}],
    credentials: [{id: 'fixture', digest: hash(token), scopes: ['read', 'control', 'ingest'], devices: ['wall', 'pixel']}],
    controllers: [
      {id: 'wall', kind: 'nanoleaf', controllerId: 'controller', deviceId: 'device', endpoint: native.endpoint, token: native.token},
      {id: 'pixel', kind: 'pixoo', controllerId: 'pixoo-controller', deviceId: 'pixoo-local', endpoint: `http://127.0.0.1:${pixooPort}/controller/v1`, token: controllerToken},
    ]};
  await mkdir(options.directory, {mode: 0o700});
  hub = await startHub(options);
  options.port = Number(new URL(hub.url).port);
  await writeFile(join(local, 'agent-monitor/config.json'), JSON.stringify({version: 1, mode: 'remote', ownerId: 'compatibility', endpoint: hub.url + '/api/monitor/v1', token}), {mode: 0o600});
  async function launchPixoo() {
    const owner = ownedChild(process.execPath, [join(pixooSource, 'apps/server/dist/main.js')], {
      env: {PIXOO_MODE: 'simulator', PIXOO_DATA_DIR: local, PIXOO_PORT: String(pixooPort), PIXOO_MONITOR_ENABLED: '1', PIXOO_CONTROLLER_ENABLED: '1'},
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    owner.child.stderr.resume();
    const input = createInterface({input: owner.child.stdout});
    const ready = new Promise(resolveReady => input.on('line', line => {
      if (line === `Pixoo simulator listening on http://127.0.0.1:${pixooPort}`) resolveReady();
    }));
    try {
      await bounded(Promise.race([ready, owner.exited.then(() => {throw new Error('Pixoo exited before readiness');})]), 'Pixoo readiness');
      return {...owner, url: `http://127.0.0.1:${pixooPort}`};
    } catch (error) {await owner.stop();throw error;}
  }
  pixoo = await launchPixoo();
  await nanoCall('configure', {endpoint: hub.url + '/api/monitor/v1', token});
  browser = await chromium.launch({headless: true});
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(hub.url);
  await page.getByLabel('Hub browser access token').fill(token);
  await page.getByRole('button', {name: 'Connect', exact: true}).click();
  const view = () => request(hub.url, '/api/monitor/v1/sessions');
  const pxView = () => request(pixoo.url, '/api/monitor/v1/sessions', pixooHeaders);
  async function compatible(label) {
    stage = label;
    const expected = (await view()).snapshot;
    const px = await until(async () => {const value = await pxView(); return value.connection === 'current' && value.snapshot.revision === expected.revision && value.snapshot;}, 'Pixoo current revision');
    const nl = await until(async () => {const value = await nanoCall('poll'); return value.connection === 'current' && value.revision === expected.revision && value;}, 'Nanoleaf current revision');
    const fields = sessions => sessions.map(s => Object.fromEntries(['identity', 'projectId', 'activity', 'attention', 'notices', 'read', 'freshness'].map(k => [k, s[k]]))).sort((a, b) => a.identity.sessionId.localeCompare(b.identity.sessionId));
    assert.deepEqual(fields(px.sessions), fields(expected.sessions), 'Pixoo shared semantics');
    assert.deepEqual(fields(nl.sessions), fields(expected.sessions), 'Nanoleaf shared semantics');
    await page.waitForFunction(revision => Number(document.getElementById('main')?.dataset.revision) >= revision, expected.revision);
    assert.equal(await page.locator('article.session').count(), expected.sessions.length);
    scenarios.push({name: label, revision: expected.revision, sessions: expected.sessions.length, outcome: 'passed'});
    return {snapshot: expected, nl};
  }
  await compatible('empty state');
  const identity = {provider: 'codex', client: 'cli', hostId: 'fixture', sourceId: 'fixture', sessionId: 'one'};
  let sequence = 0;
  const envelope = (kind, extra = {}) => ({apiVersion: '1.0', identity, projectId: 'project', turn: {status: 'known', id: 'turn-one'}, parent: {status: 'unknown'},
    ordering: {status: 'known', epoch: 'fixture', sequence: ++sequence}, observedAtMs: Date.now(), event: {kind}, ...extra});
  const send = event => request(hub.url, '/api/monitor/v1/events', headers, event);
  await send(envelope('turn.started', {label: {origin: 'user', value: 'Codex one'}}));
  await send(envelope('turn.started', {identity: {...identity, sessionId: 'two'}, label: {origin: 'user', value: 'Codex two'}}));
  await compatible('two active Codex sessions in one project');
  await send(envelope('question.continuing', {event: {kind: 'question.continuing', attention: {status: 'known', id: 'question'}}}));
  await send(envelope('attention.approval', {event: {kind: 'attention.approval', attention: {status: 'known', id: 'approval'}}}));
  await compatible('continuing question and blocked attention');
  await page.getByText('Question · continuing', {exact: true}).waitFor();
  await page.getByText('approval · blocked attention', {exact: true}).waitFor();
  const end = envelope('turn.ended'); await send(end);
  await compatible('turn end retains notice without inferred read or success');
  const article = page.locator('article.session').filter({has: page.getByRole('heading', {name: 'Codex one', exact: true})});
  await article.getByLabel('Chosen label').fill('Chosen compatibility label');
  await article.getByRole('button', {name: 'Apply label', exact: true}).click();
  const changed = page.locator('article.session').filter({has: page.getByRole('heading', {name: 'Chosen compatibility label', exact: true})});
  await changed.getByLabel('Acknowledge for').selectOption('dashboard');
  await changed.getByRole('button', {name: 'Apply monitor acknowledgment', exact: true}).click();
  await changed.getByText('Acknowledged by: dashboard.', {exact: false}).waitFor();
  let current = await compatible('frontend label and monitor acknowledgment');
  let session = current.snapshot.sessions.find(s => s.identity.sessionId === 'one');
  assert.equal(session.label, 'Chosen compatibility label');
  assert.equal((await pxView()).snapshot.sessions.find(s => s.identity.sessionId === 'one').label, session.label);
  assert.equal(session.read, 'unknown');
  assert.deepEqual(session.notices[0].acknowledgedBy, ['dashboard']);
  await send(end);
  assert.equal((await view()).snapshot.revision, current.snapshot.revision, 'duplicate cannot add notices');
  await send(envelope('turn.started', {turn: {status: 'known', id: 'turn-two'}}));
  const beforeLate = (await view()).snapshot;
  assert.equal((await send(envelope('turn.ended'))).outcome, 'stale');
  assert.equal((await view()).snapshot.revision, beforeLate.revision);
  await compatible('duplicate and prior-turn events');
  await send(envelope('turn.started', {identity: {...identity, provider: 'claude', client: 'code', sessionId: 'claude'}, label: {origin: 'user', value: 'Claude smoke'}}));
  await compatible('Claude compatibility smoke');
  await page.getByRole('heading', {name: 'Claude smoke', exact: true}).waitFor();
  stage = 'frontend Nanoleaf settings';
  const nativeSettings = () => request(new URL(native.endpoint).origin, '/controller/integration/v1/snapshot?deviceId=device', {...headers, authorization: 'Bearer ' + native.token});
  const settingsRevision = (await nativeSettings()).revision;
  const refreshedSettings = page.waitForResponse(async r => r.url().endsWith('/wall/integration/snapshot') && r.status() === 200 && (await r.json()).revision === settingsRevision);
  await page.getByRole('button', {name: 'wall nanoleaf', exact: true}).click();
  await refreshedSettings;
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.getByLabel('Layout style').selectOption('project');
  const queued = page.waitForResponse(r => r.url().endsWith('/wall/integration/commands') && r.request().method() === 'POST');
  await page.getByRole('button', {name: 'Apply integration settings', exact: true}).click();
  const queuedResponse = await queued;
  const receipt = await queuedResponse.json();
  assert.equal(queuedResponse.status(), 202, JSON.stringify(receipt));
  assert.equal(receipt.outcome, 'queued');
  await nanoCall('process');
  assert.equal((await nativeSettings()).settings.style, 'project');
  const applied = await request(new URL(native.endpoint).origin,
    `/controller/integration/v1/receipt?deviceId=device&epoch=${receipt.requestId.epoch}&sequence=${receipt.requestId.sequence}`,
    {...headers, authorization: 'Bearer ' + native.token});
  assert.equal(applied.outcome, 'applied'); assert.equal(applied.physicalOutcome, 'unknown');
  scenarios.push({name: stage, outcome: 'passed', physicalOutcome: 'unknown'});
  stage = 'MCP Pixoo monitor command';
  await page.getByRole('button', {name: 'Disconnect', exact: true}).click();
  let mcpSession, rpcId = 0;
  async function rpc(method, params) {
    const response = await fetch(hub.url + '/mcp', {method: 'POST', signal: AbortSignal.timeout(5000), headers: {...headers, accept: 'application/json, text/event-stream',
      ...(mcpSession ? {'mcp-session-id': mcpSession, 'mcp-protocol-version': '2025-11-25'} : {})},
      body: JSON.stringify({jsonrpc: '2.0', ...(method.startsWith('notifications/') ? {} : {id: ++rpcId}), method, params})});
    assert.ok(response.ok); mcpSession ||= response.headers.get('mcp-session-id');
    const text = await response.text(); return text ? JSON.parse(text) : null;
  }
  await rpc('initialize', {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'compatibility-fixture', version: '1'}});
  await rpc('notifications/initialized');
  async function tool(name, args = {}) {
    const value = (await rpc('tools/call', {name, arguments: args})).result;
    assert.ok(!value.isError, JSON.stringify(value)); return value.structuredContent.data.result;
  }
  const prefix = (await tool('hub_devices')).devices.find(d => d.alias === 'pixel').toolPrefix;
  const settings = await tool(prefix + '_integration_status');
  await tool(prefix + '_integration_set', {request_id: settings.nextRequestId, expectedConfigurationRevision: settings.configurationRevision,
    expectedGeneration: settings.generation, action: {operation: 'mode', mode: 'monitor'}});
  assert.equal((await tool(prefix + '_integration_status')).configuration.mode, 'monitor');
  scenarios.push({name: stage, outcome: 'passed', physicalOutcome: 'simulator only'});
  await page.getByLabel('Hub browser access token').fill(token);
  await page.getByRole('button', {name: 'Connect', exact: true}).click();
  await page.getByRole('button', {name: /^Activity /}).click();
  stage = 'disconnected consumer';
  await pixoo.stop(); pixoo = undefined;
  await send(envelope('activity.observed', {turn: {status: 'known', id: 'turn-two'}}));
  const revision = (await view()).snapshot.revision;
  await until(async () => (await nanoCall('poll')).revision === revision, 'healthy Nanoleaf consumer');
  await until(async () => (await request(hub.url, '/api/dashboard/v1/context')).components.find(c => c.id === 'pixel').health === 'unavailable', 'offline controller health');
  scenarios.push({name: stage, outcome: 'passed'});
  pixoo = await launchPixoo();
  await compatible('consumer reconnect');
  assert.equal((await request(pixoo.url, '/api/integration/v1/view', pixooHeaders)).integration.participating, false,
    'Pixoo reconnect must not reactivate presentation');
  stage = 'standalone restart';
  const before = (await view()).snapshot;
  await hub.close(); hub = undefined;
  await delay(1100);
  const stale = await nanoCall('poll'); assert.equal(stale.connection, 'stale');
  hub = await startHub(options);
  current = await compatible('standalone restart');
  assert.deepEqual(current.snapshot.sessions.map(s => [s.identity, s.label, s.notices]), before.sessions.map(s => [s.identity, s.label, s.notices]));
  assert.ok(current.snapshot.sessions.every(s => s.freshness === 'uncertain'));
  assert.equal(current.nl.fixtureEffects, 0, 'recovery removes obsolete celebrations');
  assert.deepEqual(current.nl.fixtureSuppressed.map(row => row[0]), current.nl.fixtureActivity.map(row => row[0]), 'stale task waves are suppressed');
  await delay(1100);
  const repeat = await nanoCall('poll');
  assert.equal(repeat.fixtureEffects, 0, 'recovery cannot replay effects');
  assert.deepEqual(repeat.fixtureActivity, current.nl.fixtureActivity, 'repeated snapshot cannot restart effect epochs');
  assert.deepEqual(errors, []);
  report = {...report, status: 'passed', scenarios, performanceReport: {issue: 30, status: 'separately required'}, contracts: ['agent-state/1.0', 'controller/1.0', 'nanoleaf.integration/1.0', 'pixoo-integration/1.0']};
} catch (error) {
  report = {...report, status: 'failed', stage, error: String(error), scenarios};
  process.exitCode = 1;
} finally {
  const cleanup = await Promise.allSettled([
    browser?.close(), hub?.close(), pixoo?.stop(),
    (async () => {
      if (!nano) return;
      if (nano.exitCode === null) {
        nano.stdin.end('{"operation":"stop"}\n');
        try {assert.equal(await bounded(nanoExit, 'Nanoleaf shutdown', 3000), 0);}
        catch (error) {if (nano.exitCode === null) {nano.kill('SIGKILL');await nanoExit;}throw error;}
      } else assert.equal(nano.exitCode, 0);
    })(),
  ]);
  if (root) await rm(root, {recursive: true, force: true});
  report.cleanup = cleanup.every(result => result.status === 'fulfilled');
  if (!report.cleanup) {report.status = 'failed';process.exitCode = 1;}
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', {mode: 0o600});
  console.log(JSON.stringify({status: report.status, scenarios: scenarios.length, cleanup: report.cleanup, report: output, ...(report.error ? {stage: report.stage, error: report.error} : {})}));
}
