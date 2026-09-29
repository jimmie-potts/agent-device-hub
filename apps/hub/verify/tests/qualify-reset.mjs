// Owner-host qualification of the accepted real consumers. Run from the Hub
// checkout; args are the two clean pinned checkouts and a fresh evidence path.
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {consumerState, follows, sessionKey} from '../consumers.mjs';
import {HUB_ROOT} from '../compose.mjs';

const [nanoleaf, pixoo, output] = process.argv.slice(2).map(value => resolve(value));
assert.ok(nanoleaf && pixoo && output, 'need nanoleaf checkout, Pixoo checkout and fresh evidence directory');
assert.ok(!existsSync(output), 'evidence path must be new');
const manifest = JSON.parse(await readFile(new URL('../compose.json', import.meta.url), 'utf8'));
const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8'}).trim();
const revision = git(HUB_ROOT, 'rev-parse', 'HEAD');
for (const [id, path] of [['hub', HUB_ROOT], ['nanoleaf', nanoleaf], ['pixoo', pixoo]]) {
  assert.equal(git(path, 'status', '--porcelain'), '', `${id} checkout must be clean`);
  const pin = manifest.services.find(s => s.id === id).revision;
  if (pin !== 'self') assert.equal(git(path, 'rev-parse', 'HEAD'), pin, `${id} pin`);
}
await mkdir(output, {recursive: true, mode: 0o700});
const runtime = await mkdtemp(join(tmpdir(), 'cr-'));
assert.ok(Buffer.byteLength(join(runtime, 'hub-20260929T120000Z-abcdef', 'data/h/bunny-launch.sock')) <= 107, 'TMPDIR must be short enough for the Hub socket');
const env = {...process.env, APP_VERIFY_STATE_ROOT: runtime, APP_VERIFY_PROOF_ROOT: join(output, 'proof'), APP_VERIFY_WINDOWS_CHECK: 'off'};
let sequence = 0, id, browser, stopped = false;
const observations = {revision, consumerPins: manifest.services.filter(s => s.role === 'consumer').map(s => ({id: s.id, revision: s.revision})), results: []};
const persist = () => writeFile(join(output, 'qualification.json'), JSON.stringify(observations, null, 2) + '\n');
async function compose(...args) {
  const name = `${String(++sequence).padStart(2, '0')}-${args[0]}`;
  const child = spawn(process.execPath, [fileURLToPath(new URL('../compose.mjs', import.meta.url)), ...args], {cwd: HUB_ROOT, env, stdio: ['ignore', 'pipe', 'pipe']});
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise((resolveCode, reject) => { child.on('error', reject); child.on('close', resolveCode); });
  await writeFile(join(output, name + '.log'), stderr + stdout);
  const lines = stdout.trim().split('\n'); assert.equal(lines.length, 1, `${name}: one result line`);
  const value = JSON.parse(lines[0]);
  if (value.compositionId) id ??= value.compositionId;
  observations.results.push({operation: args[0], code, result: value}); await persist();
  assert.equal(code, 0, `${name}: ${JSON.stringify(value)}`);
  console.log(`${name}: passed`);
  return value;
}
const record = () => readFile(join(env.APP_VERIFY_PROOF_ROOT, id, 'composition.json'), 'utf8').then(JSON.parse);
async function files(dir) {
  const result = [];
  for (const item of await readdir(dir, {withFileTypes: true})) {
    const path = join(dir, item.name);
    if (item.isDirectory()) result.push(...await files(path)); else result.push(path);
  }
  return result;
}
async function hashes(c) {
  const result = {};
  for (const service of c.services) {
    const proof = join(service.proofDir, 'verified');
    execFileSync('sha256sum', ['-c', 'SHA256SUMS'], {cwd: proof, stdio: 'pipe'});
    for (const path of await files(proof)) result[path] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
  return result;
}
async function tokens(c) {
  const result = {};
  for (const s of c.services) for (const name of await readdir(join(runtime, s.runId))) {
    if (name.endsWith('-token')) result[`${s.id}/${name}`] = (await readFile(join(runtime, s.runId, name), 'utf8')).trim();
  }
  return result;
}
async function hubJson(hub, route) {
  const token = (await readFile(join(runtime, hub.runId, 'data/api-token'), 'utf8')).trim();
  const response = await fetch(new URL(route, hub.url), {headers: {authorization: `Bearer ${token}`, 'x-pixoo-request': '1'}});
  assert.equal(response.status, 200); return response.json();
}
const snapshot = async hub => (await hubJson(hub, '/api/monitor/v1/sessions')).snapshot;
async function settings(hub) {
  return {pixel: (await hubJson(hub, '/api/controllers/v1/pixel/snapshot')).state.desired, wall: (await hubJson(hub, '/api/controllers/v1/wall/integration/snapshot')).settings};
}
const identities = c => c.services.map(s => ({id: s.id, runId: s.runId, url: s.url, endpoints: s.endpoints}));
async function pages(c, label, absentTitles = []) {
  for (const service of c.services) {
    const page = await browser.newPage({viewport: {width: 1280, height: 900}});
    try {
      const response = await page.goto(service.url); assert.equal(response.status(), 200, `${service.id} page`);
      if (service.id === 'hub') await page.getByText('Control enabled · Local', {exact: true}).waitFor();
      if (service.id === 'pixoo') await page.getByRole('navigation', {name: 'Controller views'}).getByRole('button', {name: 'Monitor', exact: true}).click();
      await page.waitForTimeout(1500);
      const text = await page.locator('body').innerText(); assert.ok(text.trim().length > 10);
      for (const title of absentTitles) assert.ok(!text.includes(title), `${service.id} still shows changed session`);
      await page.screenshot({path: join(output, `${label}-${service.id}.png`), fullPage: true});
    } finally { await page.close(); }
  }
}
try {
  await compose('start', '--checkout', `nanoleaf=${nanoleaf}`, '--checkout', `pixoo=${pixoo}`, '--lease', '20');
  const initial = await record(), hub = initial.services.find(s => s.id === 'hub');
  assert.equal(initial.pinned, true);
  const baseline = await snapshot(hub), baselineSettings = await settings(hub), stable = identities(initial), pairing = await tokens(initial);
  const baselineWriters = Object.fromEntries(await Promise.all(initial.services.filter(s => s.role === 'consumer').map(async s => [s.id, (await consumerState(s.id, s.url)).writer])));
  assert.equal(Object.keys(pairing).length, 8);
  browser = await chromium.launch({headless: true});
  await pages(initial, 'initial');
  for (const step of ['integrated-lifecycle', 'integrated-command', 'one-owner']) await compose('capture', id, step);
  const changed = await snapshot(hub); assert.ok(changed.revision > baseline.revision);
  assert.notDeepEqual(await settings(hub), baselineSettings, 'capture changed controller settings');
  const changedTitles = changed.sessions.map(s => s.label ?? s.title?.value).filter(Boolean);
  assert.ok(changedTitles.length > 0);
  await pages(initial, 'changed');
  await compose('handoff', id);
  const frozen = await hashes(initial);
  for (const turn of [1, 2]) {
    const reset = await compose('reset', id);
    assert.equal(reset.state, 'running'); assert.equal(reset.reset.phase, 'complete');
    const c = await record(), owner = await snapshot(hub);
    assert.equal(owner.revision, baseline.revision); assert.ok(owner.revision < changed.revision);
    assert.deepEqual(owner.sessions, baseline.sessions); assert.deepEqual(identities(c), stable);
    assert.ok(JSON.stringify(await tokens(c)) === JSON.stringify(pairing), 'pairing tokens changed');
    assert.deepEqual(await settings(hub), baselineSettings, 'seeded controller settings restored');
    assert.deepEqual(await hashes(c), frozen);
    const source = {revision: owner.revision, sessions: owner.sessions.map(s => sessionKey(s.identity)).sort()};
    for (const service of c.services.filter(s => s.role === 'consumer')) {
      const state = await consumerState(service.id, service.url);
      assert.ok(follows(state, source), `${service.id} follows the fresh owner`);
      assert.deepEqual(state.writer, baselineWriters[service.id], 'writer counters return to the seed with no replay');
      for (const name of ['request', 'ack', 'release']) assert.equal(existsSync(join(runtime, service.runId, `feed-pause.${name}`)), false);
    }
    await compose('doctor', id); await pages(c, `reset-${turn}`, changedTitles);
  }
  const stop = await compose('stop', id); stopped = stop.cleanup.result === 'clean'; assert.ok(stopped);
  assert.deepEqual(stop.cleanup.services.map(s => s.id), ['hub', 'pixoo', 'nanoleaf']);
  assert.deepEqual(await hashes(initial), frozen);
  for (const service of initial.services) assert.equal(existsSync(join(runtime, service.runId)), false);
  for (const path of await files(output)) {
    const content = await readFile(path);
    for (const token of Object.values(pairing)) assert.equal(content.includes(Buffer.from(token)), false, 'pairing credential escaped into evidence');
  }
  observations.passed = true; observations.frozenHashes = frozen; observations.tokenHits = 0;
  await persist(); console.log(`real-consumer reset qualification: passed; ${output}`);
} finally {
  await browser?.close();
  if (id && !stopped) {
    try { const result = await compose('stop', id); stopped = result.cleanup.result === 'clean'; }
    catch { console.error(`cleanup failed; retained runtime ${runtime}; use compose stop ${id}`); }
  }
  if (stopped || !id) await rm(runtime, {recursive: true, force: true});
}
